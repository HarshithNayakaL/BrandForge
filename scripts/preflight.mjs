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

// --- env
const api = process.env.API_PORT ?? 3001;
const crawler = process.env.CRAWLER_PORT ?? 3002;

add('.env present', fs.existsSync('.env'), fs.existsSync('.env') ? '' : 'copy .env.example to .env');
add('GEMINI_API_KEY', Boolean(process.env.GEMINI_API_KEY), process.env.GEMINI_API_KEY ? `model ${process.env.GEMINI_MODEL ?? 'gemini-2.5-flash'}` : 'brand, product, planning and QA stages will fail');
add('OPENAI_API_KEY', Boolean(process.env.OPENAI_API_KEY), process.env.OPENAI_API_KEY ? `model ${process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-1'}` : 'image generation will fail');

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
