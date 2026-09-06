/**
 * Builds the importable n8n workflow JSON.
 *
 * Node types and typeVersions below were read out of the locally installed
 * n8n 2.8.4 (defaultVersion in each node's compiled description), not from
 * memory: webhook 2.1, httpRequest 4.4, code 2, if 2.3, splitInBatches 3,
 * respondToWebhook 1.5, noOp 1.
 *
 * Re-run with:  node scripts/build-n8n-workflow.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'n8n', 'workflows', 'brandforge.json');

const API = 'http://localhost:3001';
const TOKEN_NOTE = 'dev-internal-token-change-me'; // must match INTERNAL_TOKEN in .env

const nodes = [];
const connections = {};
let idSeq = 0;
const uid = () => `bf-node-${String(++idSeq).padStart(3, '0')}`;

function node(name, type, typeVersion, parameters, position, extra = {}) {
  const n = { parameters, id: uid(), name, type, typeVersion, position, ...extra };
  nodes.push(n);
  return name;
}

function connect(from, to, { fromOutput = 0, toInput = 0 } = {}) {
  connections[from] ??= { main: [] };
  while (connections[from].main.length <= fromOutput) connections[from].main.push([]);
  connections[from].main[fromOutput].push({ node: to, type: 'main', index: toInput });
}

/**
 * Every call that can spend money or fail is wired with an explicit error
 * output, so a stage failure routes to the halt path instead of leaving the
 * execution dead with no record.
 */
function stageCall(name, endpoint, position, { timeout = 300000, extraBody = '' } = {}) {
  const body = extraBody
    ? `={{ JSON.stringify({ run_id: $('Init Run Context').first().json.run_id, ${extraBody} }) }}`
    : `={{ JSON.stringify({ run_id: $('Init Run Context').first().json.run_id }) }}`;

  return node(name, 'n8n-nodes-base.httpRequest', 4.4, {
    method: 'POST',
    url: `${API}/internal/${endpoint}`,
    sendHeaders: true,
    specifyHeaders: 'json',
    jsonHeaders: `={{ JSON.stringify({ "x-internal-token": $('Init Run Context').first().json.internal_token }) }}`,
    sendBody: true,
    specifyBody: 'json',
    jsonBody: body,
    options: { timeout, response: { response: { neverError: false } } },
  }, position, { onError: 'continueErrorOutput' });
}

// ------------------------------------------------------------ 01 - 03 intake

const webhook = node('01 Intake Webhook', 'n8n-nodes-base.webhook', 2.1, {
  httpMethod: 'POST',
  path: 'brandforge',
  responseMode: 'responseNode',
  options: {},
}, [-620, 300], { webhookId: 'brandforge-intake' });

const validate = node('02 Validate Intake', 'n8n-nodes-base.code', 2, {
  mode: 'runOnceForAllItems',
  language: 'javaScript',
  jsCode: `// Reject malformed calls before any downstream work is scheduled.
const body = $input.first().json.body ?? $input.first().json;
const runId = body.run_id;

if (typeof runId !== 'string' || !/^run_[0-9]{14}_[a-f0-9]{8}$/.test(runId)) {
  throw new Error('INVALID_INTAKE: run_id missing or malformed: ' + JSON.stringify(runId));
}

return [{ json: { run_id: runId, accepted_at: new Date().toISOString() } }];`,
}, [-420, 300]);

const respond = node('03 Respond 202', 'n8n-nodes-base.respondToWebhook', 1.5, {
  respondWith: 'json',
  responseBody: `={{ JSON.stringify({ accepted: true, run_id: $json.run_id }) }}`,
  options: { responseCode: 202 },
}, [-220, 300]);

// The browser is never held open for the length of a campaign (PRD 44):
// respond first, then continue orchestrating.
const init = node('Init Run Context', 'n8n-nodes-base.code', 2, {
  mode: 'runOnceForAllItems',
  language: 'javaScript',
  jsCode: `// Single source of truth for the rest of the run. Downstream nodes read
// these values via $('Init Run Context') rather than re-deriving them.
const runId = $input.first().json.run_id;

return [{
  json: {
    run_id: runId,
    api_base: '${API}',
    // Must match INTERNAL_TOKEN in the api service's .env
    internal_token: '${TOKEN_NOTE}',
    started_at: new Date().toISOString(),
  },
}];`,
}, [-20, 300]);

connect(webhook, validate);
connect(validate, respond);
connect(respond, init);

// -------------------------------------------------- 04 - 06 brand evidence

const cacheLookup = stageCall('04 Brand Cache Lookup', 'brand-cache', [180, 300], { timeout: 30000 });

const cacheDecision = node('05 Crawl Needed?', 'n8n-nodes-base.if', 2.3, {
  conditions: {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
    conditions: [{
      id: 'cache-miss',
      leftValue: '={{ $json.cache_hit }}',
      rightValue: false,
      operator: { type: 'boolean', operation: 'false', singleValue: true },
    }],
    combinator: 'and',
  },
  options: {},
}, [400, 300]);

// A fresh cached profile skips both the crawl and the Gemini call (PRD 47).
const crawl = stageCall('06 Playwright Crawl', 'crawl', [640, 200], { timeout: 300000 });
const brandKit = stageCall('08 Brand Intelligence', 'brand-kit', [900, 300], { timeout: 300000 });

connect(init, cacheLookup);
connect(cacheLookup, cacheDecision, { fromOutput: 0 });
connect(cacheDecision, crawl, { fromOutput: 0 });   // true  -> crawl needed
connect(cacheDecision, brandKit, { fromOutput: 1 }); // false -> reuse cache
connect(crawl, brandKit, { fromOutput: 0 });

// ------------------------------------------------ 09 - 12 product + plan

const product = stageCall('09 Product Intelligence', 'product-identity', [1140, 300], { timeout: 180000 });
const plan = stageCall('11 Campaign Planner', 'plan', [1380, 300], { timeout: 180000 });

connect(brandKit, product, { fromOutput: 0 });
connect(product, plan, { fromOutput: 0 });

// ----------------------------------------------- 13 - 15 fan out the shots

const split = node('13 Split Six Shots', 'n8n-nodes-base.code', 2, {
  mode: 'runOnceForAllItems',
  language: 'javaScript',
  jsCode: `// One item per shot. The HTTP node below then issues them with bounded
// concurrency via its batching options.
const runId = $('Init Run Context').first().json.run_id;
const shots = $input.first().json.shots ?? [];

if (!Array.isArray(shots) || shots.length !== 6) {
  throw new Error('CAMPAIGN_PLANNING_FAILED: expected 6 shot contracts, got ' + (shots?.length ?? 0));
}

return shots.map((s) => ({ json: { run_id: runId, shot_id: s.shot_id, purpose: s.purpose } }));`,
}, [1620, 300]);

/**
 * neverError keeps one failed shot from killing the other five; the per-shot
 * outcome is read back in the aggregator (PRD 31, 33).
 */
const generate = node('14 Generate + QA Shot', 'n8n-nodes-base.httpRequest', 4.4, {
  method: 'POST',
  url: `${API}/internal/shot`,
  sendHeaders: true,
  specifyHeaders: 'json',
  jsonHeaders: `={{ JSON.stringify({ "x-internal-token": $('Init Run Context').first().json.internal_token }) }}`,
  sendBody: true,
  specifyBody: 'json',
  jsonBody: `={{ JSON.stringify({ run_id: $json.run_id, shot_id: $json.shot_id }) }}`,
  options: {
    timeout: 900000,
    batching: { batch: { batchSize: 3, batchInterval: 1000 } },
    response: { response: { neverError: true, fullResponse: false } },
  },
}, [1860, 300], { onError: 'continueRegularOutput' });

const aggregate = node('19 Aggregate Campaign', 'n8n-nodes-base.code', 2, {
  mode: 'runOnceForAllItems',
  language: 'javaScript',
  jsCode: `// Summarise the six outcomes. The api has already persisted each shot's
// result; this is the orchestrator's own view for logging and routing.
const runId = $('Init Run Context').first().json.run_id;
const items = $input.all().map((i) => i.json ?? {});

const results = items.map((r) => ({
  shot_id: r.shot_id ?? null,
  status: r.status ?? 'FAILED',
  ok: r.success === true,
  repair_attempts: r.repair_attempts ?? 0,
  product_accuracy: r.product_accuracy ?? null,
  error: r.error ?? null,
}));

const accepted = results.filter((r) => r.status === 'ACCEPTED').length;

return [{
  json: {
    run_id: runId,
    shot_count: results.length,
    accepted,
    blocked: results.length - accepted,
    results,
  },
}];`,
}, [2100, 300]);

const finalize = stageCall('20 Finalize + Manifest', 'finalize', [2340, 300], { timeout: 120000 });

const done = node('21 Run Complete', 'n8n-nodes-base.noOp', 1, {}, [2580, 300]);

connect(plan, split, { fromOutput: 0 });
connect(split, generate);
connect(generate, aggregate);
connect(aggregate, finalize);
connect(finalize, done, { fromOutput: 0 });

// ------------------------------------------------------------- halt branch

/**
 * Every stage's error output lands here. The api service has already written
 * the failure into the run's state, so this node's job is to make the failure
 * visible in the n8n execution rather than to retry it.
 */
const halt = node('Halt: Stage Failed', 'n8n-nodes-base.code', 2, {
  mode: 'runOnceForAllItems',
  language: 'javaScript',
  jsCode: `// Bounded failure: no retry loop here. The api already recorded the run as
// FAILED with a failure_code; retrying a stage that spent model calls would
// double-bill it.
const runId = $('Init Run Context').first().json.run_id;
const err = $input.first().json ?? {};

const detail = err.error?.message ?? err.error ?? err.message ?? 'unknown stage failure';
const code = err.code ?? err.error?.code ?? 'SYSTEM_ERROR';

throw new Error('BrandForge run ' + runId + ' halted [' + code + ']: ' + detail);`,
}, [900, 600]);

for (const [n, out] of [
  [cacheLookup, 1], [crawl, 1], [brandKit, 1],
  [product, 1], [plan, 1], [finalize, 1],
]) {
  connect(n, halt, { fromOutput: out });
}

// ------------------------------------------------------------------ output

const workflow = {
  name: 'BrandForge — Brand to Campaign',
  nodes,
  connections,
  active: false,
  settings: { executionOrder: 'v1', saveManualExecutions: true, saveExecutionProgress: true },
  pinData: {},
  meta: { instanceId: 'brandforge-local' },
  tags: [],
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(workflow, null, 2));
console.log(`wrote ${OUT}`);
console.log(`nodes: ${nodes.length}, connection sources: ${Object.keys(connections).length}`);
