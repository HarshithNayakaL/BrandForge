/**
 * Checks the things that actually stop a first run: missing keys, a service
 * that is not up, and Playwright's browser not being installed.
 *
 *   node scripts/preflight.mjs
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

const rows = [];
const add = (name, ok, detail) => rows.push({ name, ok, detail });

const LF = String.fromCharCode(10);
// --- env
const api = process.env.API_PORT ?? 3001;
const crawler = process.env.CRAWLER_PORT ?? 3002;

add('.env present', fs.existsSync('.env'), fs.existsSync('.env') ? '' : 'copy .env.example to .env');
add('GEMINI_API_KEY', Boolean(process.env.GEMINI_API_KEY), process.env.GEMINI_API_KEY ? `model ${process.env.GEMINI_MODEL ?? 'gemini-3.8-flash'}` : 'brand, product, planning and QA stages will fail');
add('OPENAI_API_KEY', Boolean(process.env.OPENAI_API_KEY), process.env.OPENAI_API_KEY ? `model ${process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-2.5'}` : 'image generation will fail');

// --- local .env vs .env.example
// .env is gitignored, so a change to the shipped defaults never reaches an
// existing checkout. A stale local file silently runs different models from
// the ones the README documents, which is exactly how this drifted before.
if (fs.existsSync('.env') && fs.existsSync('.env.example')) {
  const parse = (f) => Object.fromEntries(
    fs.readFileSync(f, 'utf8')
      .split(LF)
      .map((l) => l.trim().match(/^([A-Z0-9_]+)=(.*)$/))
      .filter(Boolean)
      .map((m) => [m[1], m[2].trim()])
  );
  const mine = parse('.env');
  const shipped = parse('.env.example');

  // Only the model ids matter here. Ports, limits and tokens are meant to differ.
  const watched = ['GEMINI_MODEL', 'GEMINI_VISION_MODEL', 'OPENAI_IMAGE_MODEL'];
  const stale = watched.filter((k) => mine[k] && shipped[k] && mine[k] !== shipped[k]);

  for (const k of stale) {
    add(`${k} matches .env.example`, false, `your .env says ${mine[k]}, shipped default is ${shipped[k]}`);
  }
  if (!stale.length) {
    add('model ids match .env.example', true, watched.filter((k) => mine[k]).map((k) => mine[k]).join(', '));
  }

  const missing = Object.keys(shipped).filter((k) => !(k in mine));
  if (missing.length) {
    add('.env covers .env.example', false, `missing: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ` (+${missing.length - 5})` : ''}`);
  }
}

// --- playwright browser
const pwDir = path.join(process.env.LOCALAPPDATA ?? process.env.HOME ?? '.', 'ms-playwright');
const hasChromium = fs.existsSync(pwDir) && fs.readdirSync(pwDir).some((d) => d.startsWith('chromium'));
add('Playwright chromium', hasChromium, hasChromium ? '' : 'run: npx playwright install chromium');

// --- services
async function ping(name, url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    const body = await res.json();
    add(name, body.ok === true, url);
    return body;
  } catch {
    add(name, false, `not reachable at ${url} — start it with npm run dev`);
    return null;
  }
}

const apiHealth = await ping('api service', `http://localhost:${api}/health`);
await ping('crawler service', `http://localhost:${crawler}/health`);

if (apiHealth?.keys) {
  add('api sees gemini key', apiHealth.keys.gemini, '');
  add('api sees openai key', apiHealth.keys.openai, '');
}

// --- report
const pad = Math.max(...rows.map((r) => r.name.length));
console.log('');
for (const r of rows) {
  console.log(`  ${r.ok ? '\x1b[32mok  \x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${r.name.padEnd(pad)}  ${r.detail}`);
}
const failed = rows.filter((r) => !r.ok).length;
console.log(`\n  ${rows.length - failed}/${rows.length} checks passed\n`);
process.exit(failed ? 1 : 0);
