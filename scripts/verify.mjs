/**
 * One command that checks everything. No API keys, no external network.
 *
 *   npm run verify
 *
 * Runs: palette contrast, unit tests, production build, n8n workflow
 * integrity, live security/error-path probes, and the full UI sweep across
 * three viewports. Exits non-zero on the first failing group so CI can gate
 * on it.
 */
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const API = 'http://localhost:3001';
const CRAWLER = 'http://localhost:3002';
const WEB = 'http://localhost:5173';

const results = [];
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(name, cmd, args, { optional = false } = {}) {
  process.stdout.write(`\n─ ${name}\n`);
  // npm/npx are .cmd shims on Windows and cannot be spawned without a shell
  const needsShell = process.platform === 'win32' && /\.cmd$/.test(cmd);
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: needsShell });
  const ok = r.status === 0;
  results.push({ name, ok, optional });
  return ok;
}

async function reachable(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(2500) });
    return r.ok;
  } catch { return false; }
}

async function probe(name, req, expect) {
  try {
    const res = await fetch(req.url, {
      method: req.method ?? 'GET',
      headers: req.headers,
      body: req.body,
      redirect: 'manual',
      signal: AbortSignal.timeout(8000),
    });
    const ok = res.status === expect;
    if (!ok) console.log(`    FAIL ${name}: got ${res.status}, want ${expect}`);
    return ok;
  } catch (e) {
    console.log(`    FAIL ${name}: ${e.message}`);
    return false;
  }
}

// ------------------------------------------------------------ static checks

run('palette contrast (WCAG AA)', 'node', ['scripts/check-contrast.mjs']);
run('unit tests', 'node', ['--test', 'tests/crawler-filters.test.js', 'tests/input-validation.test.js',
  'tests/model-json.test.js', 'tests/prompt-builder.test.js', 'tests/qa-override.test.js', 'tests/ssrf.test.js',
  'tests/crawler-tools.test.js', 'tests/model-config.test.js']);
run('production build', npm, ['run', 'build', '-w', 'web']);
run('config matches its documentation', 'node', ['scripts/check-config-docs.mjs']);
run('n8n workflow build', 'node', ['scripts/build-n8n-workflow.mjs']);
run('n8n workflow integrity', 'node', ['scripts/check-workflow.mjs']);

// ------------------------------------------------------------- live checks

const apiUp = await reachable(`${API}/api/health`);
const crawlerUp = await reachable(`${CRAWLER}/health`);
const webUp = await reachable(WEB);

if (!apiUp || !crawlerUp || !webUp) {
  console.log(`\n─ live checks skipped (api:${apiUp ? 'up' : 'down'} crawler:${crawlerUp ? 'up' : 'down'} web:${webUp ? 'up' : 'down'})`);
  console.log('  start everything with: npm run dev');
  results.push({ name: 'live checks', ok: false, optional: true, skipped: true });
} else {
  process.stdout.write('\n─ SSRF blocklist\n');
  const blocked = [
    'http://localhost/', 'http://127.0.0.1:22/', 'http://169.254.169.254/latest/meta-data/',
    'file:///etc/passwd', 'ftp://x.com', 'http://10.0.0.1/', 'http://192.168.1.1/',
    'http://172.16.0.1/', 'http://[::1]/', 'http://metadata.google.internal/',
    'http://box.local/', 'http://user:pw@example.com/', 'notaurl', 'http://100.64.0.1/',
    'http://0.0.0.0/', 'http://224.0.0.1/',
  ];
  let ssrfOk = true;
  for (const url of blocked) {
    const good = await probe(`blocks ${url}`, {
      url: `${CRAWLER}/crawl`, method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    }, 400);
    ssrfOk = ssrfOk && good;
  }
  // the agent-facing tools reach the network too, so they get the same guard
  for (const url of ['http://127.0.0.1:3001/api/health', 'http://169.254.169.254/', 'file:///etc/passwd']) {
    const good = await probe(`fetch-page blocks ${url}`, {
      url: `${CRAWLER}/tools/fetch-page`, method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    }, 400);
    ssrfOk = ssrfOk && good;
  }
  console.log(`  ${blocked.length + 3} vectors checked`);
  results.push({ name: 'SSRF blocklist', ok: ssrfOk });

  process.stdout.write('\n─ API security and error paths\n');
  const cases = [
    ['path traversal, encoded', { url: `${API}/api/campaign/run_fixture_complete/asset/..%2f..%2fpackage.json` }, 403],
    // fetch() collapses `../` client-side, so the server sees a normal miss.
    // The encoded case above is what actually exercises the guard.
    ['path traversal, dotdot is not served', { url: `${API}/api/campaign/run_fixture_complete/asset/../../package.json` }, 404],
    ['malformed run id', { url: `${API}/api/campaign/..%2fetc/status` }, 400],
    ['unknown run', { url: `${API}/api/campaign/run_00000000000000_deadbeef/status` }, 404],
    ['internal without token', { url: `${API}/internal/plan`, method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"run_id":"x"}' }, 401],
    ['internal with wrong token', { url: `${API}/internal/plan`, method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-token': 'nope' }, body: '{"run_id":"x"}' }, 401],
    ['known asset serves', { url: `${API}/api/campaign/run_fixture_complete/asset/final/shot_01.png` }, 200],
    ['missing asset 404s', { url: `${API}/api/campaign/run_fixture_complete/asset/final/nope.png` }, 404],
  ];
  let apiOk = true;
  for (const [n, req, exp] of cases) apiOk = (await probe(n, req, exp)) && apiOk;

  // Upload validation needs multipart bodies.
  const form = (url, bytes, name = 'product.png') => {
    const fd = new FormData();
    fd.set('brand_url', url);
    if (bytes) fd.set('product_image', new Blob([bytes], { type: 'image/png' }), name);
    return fd;
  };
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  const uploads = [
    ['rejects a non-URL', form('notaurl', png), 400],
    ['rejects a missing image', form('https://example.com', null), 400],
    ['rejects a disguised non-image', form('https://example.com', Buffer.from('<?php ?>')), 400],
  ];
  for (const [n, body, exp] of uploads) {
    apiOk = (await probe(n, { url: `${API}/api/campaign`, method: 'POST', body }, exp)) && apiOk;
  }
  console.log(`  ${cases.length + uploads.length} cases checked`);
  results.push({ name: 'API security and error paths', ok: apiOk });

  run('UI sweep (3 viewports, a11y, overflow, console)', 'node', ['scripts/ui-check.mjs', './ui-shots']);
}

// ------------------------------------------------------------------ report

console.log('\n' + '═'.repeat(58));
let failed = 0;
for (const r of results) {
  const mark = r.skipped ? 'skip' : r.ok ? ' ok ' : 'FAIL';
  if (!r.ok && !r.optional) failed++;
  console.log(`  ${mark}  ${r.name}`);
}
console.log('═'.repeat(58));
console.log(failed ? `\n  ${failed} group(s) failed\n` : '\n  everything passed\n');
process.exit(failed ? 1 : 0);
