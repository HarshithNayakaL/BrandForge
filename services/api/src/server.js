import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import cors from 'cors';
import path from 'node:path';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';

import { config, keyStatus, WORKFLOW_VERSION } from './config.js';
import { log } from './lib/log.js';
import {
  createRun, getRun, updateRun, listRuns, runDir,
  readRunArtifact, saveBinary, assertSafeId, brandIdFromUrl, getCachedBrandKit,
} from './lib/store.js';
import { validateBrandUrl, validateProductImage } from './lib/validate-input.js';
import {
  runPipeline, stageCrawl, stageBrandKit, stageProductIdentity,
  stagePlan, stageGenerateAndQA, stageFinalize, runShot, loadProductImage,
} from './pipeline/orchestrator.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.upload.maxBytes, files: 1 },
});

// ------------------------------------------------------------------ health

const health = (_req, res) =>
  res.json({
    ok: true,
    service: 'api',
    workflow_version: WORKFLOW_VERSION,
    keys: keyStatus(),
    crawler: config.crawlerUrl,
    orchestrator: process.env.ORCHESTRATOR ?? 'internal',
  });

app.get('/health', health);
app.get('/api/health', health);

// ------------------------------------------------------------ campaign API

/**
 * Intake. Returns a run_id immediately and never blocks the browser for the
 * length of a campaign (PRD 44). Orchestration is then either handed to n8n
 * or run in-process, depending on ORCHESTRATOR.
 */
app.post('/api/campaign', upload.single('product_image'), async (req, res) => {
  const urlCheck = validateBrandUrl(req.body?.brand_url);
  if (!urlCheck.ok) return res.status(400).json({ error: urlCheck.error, code: urlCheck.code });

  const imgCheck = validateProductImage(req.file);
  if (!imgCheck.ok) return res.status(400).json({ error: imgCheck.error, code: imgCheck.code });

  const productAssetId = `pa_${crypto.createHash('sha256').update(req.file.buffer).digest('hex').slice(0, 16)}`;

  const state = await createRun({
    brand_url: urlCheck.url,
    source_url: req.body?.brand_url,
    product_asset_id: productAssetId,
    product_mime: imgCheck.mime,
    workflow_version: WORKFLOW_VERSION,
    timestamp: new Date().toISOString(),
  });

  // Filename is generated, never taken from the upload.
  await saveBinary(state.run_id, `input/product.${imgCheck.ext}`, req.file.buffer);
  log('RUN_CREATED', { run_id: state.run_id, brand_url: urlCheck.url, product_asset_id: productAssetId });
  log('INPUT_VALIDATED', { run_id: state.run_id, mime: imgCheck.mime, bytes: req.file.size });

  res.status(202).json({ run_id: state.run_id, status: state.status });

  // Kick orchestration off after responding.
  startOrchestration(state.run_id).catch((e) =>
    log('ORCHESTRATION_ERROR', { run_id: state.run_id, error: e.message }));
});

async function startOrchestration(runId) {
  if ((process.env.ORCHESTRATOR ?? 'internal') === 'n8n') {
    const res = await fetch(config.n8nWebhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ run_id: runId }),
    }).catch((e) => {
      throw new Error(`n8n webhook unreachable at ${config.n8nWebhookUrl}: ${e.message}`);
    });
    log('ORCHESTRATION_HANDED_TO_N8N', { run_id: runId, status: res.status });
    return;
  }
  return runPipeline(runId).catch(() => {}); // failure is already recorded in run state
}

app.get('/api/campaign/:runId/status', async (req, res) => {
  const state = await safeGetRun(req, res);
  if (!state) return;
  const events = await tailEvents(state.run_id, 40);

  // Shots that have already finished, so the waiting screen can show real
  // frames arriving instead of six grey rectangles.
  const partial = (await readRunArtifact(state.run_id, 'campaign/shot-results.json', [])) ?? [];
  const shots = partial.map((r) => ({
    shot_id: r.shot_id,
    status: r.status,
    output: r.output,
    product_accuracy: r.qa?.product_accuracy ?? null,
  }));

  res.json({
    shots,
    assets_base: `/api/campaign/${state.run_id}/asset/`,
    run_id: state.run_id,
    status: state.status,
    stage: state.stage,
    progress: state.progress,
    brand: state.brand ?? null,
    product_category: state.product_category ?? null,
    error: state.error,
    failure_code: state.failure_code,
    usage: state.usage,
    created_at: state.created_at,
    completed_at: state.completed_at,
    events,
  });
});

app.get('/api/campaign/:runId', async (req, res) => {
  const state = await safeGetRun(req, res);
  if (!state) return;

  const [manifest, brandKit, productIdentity, plan] = await Promise.all([
    readRunArtifact(state.run_id, 'manifest.json'),
    readRunArtifact(state.run_id, 'intelligence/brand-kit.json'),
    readRunArtifact(state.run_id, 'intelligence/product-identity.json'),
    readRunArtifact(state.run_id, 'campaign/shot-plan.json'),
  ]);

  res.json({
    run_id: state.run_id,
    status: state.status,
    stage: state.stage,
    error: state.error,
    failure_code: state.failure_code,
    input: { brand_url: state.input.brand_url, product: `/api/campaign/${state.run_id}/asset/input/product.${extOf(state.input.product_mime)}` },
    brand_kit: brandKit,
    product_identity: productIdentity,
    plan,
    manifest,
    assets_base: `/api/campaign/${state.run_id}/asset/`,
  });
});

/** Serves run artefacts. Path is confined to the run directory. */
app.get('/api/campaign/:runId/asset/*splat', async (req, res) => {
  let runId;
  try { runId = assertSafeId(req.params.runId, 'run_id'); } catch { return res.status(400).end(); }

  // Express 5 names wildcards; splat arrives as an array of path segments.
  const splat = req.params.splat;
  const rel = Array.isArray(splat) ? splat.join('/') : (splat ?? '');
  const base = runDir(runId);
  const target = path.resolve(base, rel);
  if (!target.startsWith(path.resolve(base) + path.sep)) return res.status(403).end();

  try {
    const buf = await fsp.readFile(target);
    const ext = path.extname(target).toLowerCase();
    res.type(ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : ext === '.json' ? 'application/json' : 'text/plain');
    res.setHeader('cache-control', 'public, max-age=3600');
    res.send(buf);
  } catch {
    res.status(404).json({ error: 'asset not found' });
  }
});

/**
 * The crawl evidence is served separately from the campaign payload: it is
 * large, and only wanted when the user opens the evidence view.
 */
app.get('/api/campaign/:runId/evidence', async (req, res) => {
  const state = await safeGetRun(req, res);
  if (!state) return;
  const evidence = await readRunArtifact(state.run_id, 'crawl/evidence.json');
  if (!evidence) return res.status(404).json({ error: 'no crawl evidence for this run' });
  res.json({ run_id: state.run_id, assets_base: `/api/campaign/${state.run_id}/asset/`, evidence });
});

app.get('/api/runs', async (req, res) => {
  res.json({ runs: await listRuns(Number(req.query.limit ?? 50)) });
});

app.get('/api/brands/:brandId/cache', async (req, res) => {
  try {
    res.json(await getCachedBrandKit(assertSafeId(req.params.brandId, 'brand_id')));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ------------------------------------------------- internal API (for n8n)

/**
 * n8n owns routing and the repair decision; these endpoints are the units of
 * work it schedules. They are guarded by a shared token because they can
 * spend money.
 */
const internal = express.Router();
internal.use((req, res, next) => {
  if (req.get('x-internal-token') !== config.internalToken) {
    return res.status(401).json({ error: 'invalid internal token' });
  }
  next();
});

const stage = (name, fn) => async (req, res) => {
  const runId = req.body?.run_id ?? req.params.runId;
  try {
    assertSafeId(runId, 'run_id');
    const out = await fn(runId, req.body ?? {});
    res.json({ success: true, run_id: runId, ...out });
  } catch (e) {
    const code = e.code ?? 'SYSTEM_ERROR';
    log('STAGE_FAILED', { run_id: runId, stage: name, code, error: e.message });
    await updateRun(runId, (s) => ({
      ...s,
      status: 'FAILED', failure_code: code, error: e.message,
      stage: 'Failed', completed_at: new Date().toISOString(),
      errors: [...(s.errors ?? []), { code, message: e.message, at: new Date().toISOString() }],
    })).catch(() => {});
    res.status(500).json({ success: false, code, error: e.message, details: e.details ?? null });
  }
};

internal.post('/crawl', stage('crawl', async (runId) => {
  const evidence = await stageCrawl(runId);
  return { pages: evidence.crawl_metadata.pages_visited, images: evidence.crawl_metadata.images_kept };
}));

internal.post('/brand-cache', stage('brand-cache', async (runId) => {
  const state = await getRun(runId);
  const brandId = brandIdFromUrl(state.input.brand_url);
  const cached = await getCachedBrandKit(brandId);
  return { brand_id: brandId, cache_hit: cached.hit, reason: cached.reason ?? null };
}));

internal.post('/brand-kit', stage('brand-kit', async (runId, body) => {
  const { brandKit, cached } = await stageBrandKit(runId, { forceRefresh: body.force_refresh === true });
  return { brand: brandKit.brand.name, category: brandKit.brand.category, cached };
}));

internal.post('/product-identity', stage('product-identity', async (runId) => {
  const pi = await stageProductIdentity(runId);
  return { category: pi.category, invariants: pi.must_preserve.map((i) => i.key), confidence: pi.confidence };
}));

internal.post('/plan', stage('plan', async (runId) => {
  const plan = await stagePlan(runId);
  return { shots: plan.shots.map((s) => ({ shot_id: s.shot_id, purpose: s.purpose })) };
}));

/** Lets n8n fan out over the six shots itself, one HTTP call per shot. */
internal.post('/shot', stage('shot', async (runId, body) => {
  const [brandKit, productIdentity, plan, evidence] = await Promise.all([
    readRunArtifact(runId, 'intelligence/brand-kit.json'),
    readRunArtifact(runId, 'intelligence/product-identity.json'),
    readRunArtifact(runId, 'campaign/shot-plan.json'),
    readRunArtifact(runId, 'crawl/evidence.json'),
  ]);
  const shot = plan.shots.find((s) => s.shot_id === body.shot_id);
  if (!shot) throw Object.assign(new Error(`Unknown shot ${body.shot_id}`), { code: 'SYSTEM_ERROR' });

  const productImage = await loadProductImage(runId);
  const result = await runShot({ runId, shot, brandKit, productIdentity, productImage, evidence, refCache: new Map() });

  const all = (await readRunArtifact(runId, 'campaign/shot-results.json', [])) ?? [];
  const merged = [...all.filter((r) => r.shot_id !== result.shot_id), result].sort((a, b) => a.shot_id.localeCompare(b.shot_id));
  await import('./lib/store.js').then((m) => m.writeRunArtifact(runId, 'campaign/shot-results.json', merged));

  return { shot_id: result.shot_id, status: result.status, repair_attempts: result.repair_attempts, product_accuracy: result.qa?.product_accuracy ?? null };
}));

internal.post('/generate-all', stage('generate-all', async (runId) => {
  const results = await stageGenerateAndQA(runId);
  return { results: results.map((r) => ({ shot_id: r.shot_id, status: r.status })) };
}));

internal.post('/finalize', stage('finalize', async (runId) => {
  const manifest = await stageFinalize(runId);
  return { status: manifest.status, accepted: manifest.accepted, blocked: manifest.blocked };
}));

app.use('/internal', internal);

// ----------------------------------------------------------------- helpers

async function safeGetRun(req, res) {
  let runId;
  try { runId = assertSafeId(req.params.runId, 'run_id'); } catch {
    res.status(400).json({ error: 'invalid run id' });
    return null;
  }
  const state = await getRun(runId);
  if (!state) { res.status(404).json({ error: 'run not found' }); return null; }
  return state;
}

async function tailEvents(runId, n) {
  try {
    const raw = await fsp.readFile(path.join(runDir(runId), 'events.ndjson'), 'utf8');
    return raw.trim().split('\n').slice(-n).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch {
    return [];
  }
}

function extOf(mime) {
  return mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png';
}

// ------------------------------------------------------------ error guard

app.use((err, _req, res, _next) => {
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ code: 'INVALID_PRODUCT_IMAGE', error: `Image exceeds the ${Math.round(config.upload.maxBytes / 1e6)}MB limit` });
  }
  log('UNHANDLED_ERROR', { error: err?.message });
  res.status(500).json({ code: 'SYSTEM_ERROR', error: err?.message ?? 'unexpected error' });
});

app.listen(config.port, () =>
  log('listening', { port: config.port, orchestrator: process.env.ORCHESTRATOR ?? 'internal', keys: keyStatus() }));
