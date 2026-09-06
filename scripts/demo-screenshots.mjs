/**
 * Drives the real UI end to end and captures each state.
 *
 *   node scripts/demo-screenshots.mjs <brand-url> <product-image> <out-dir>
 *
 * Nothing is stubbed: this fills the real form, uploads a real file, and
 * screenshots whatever the app actually does.
 */
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';

const [, , brandUrl = 'https://www.aesop.com', productPath, outDir = './shots'] = process.argv;
if (!productPath) {
  console.error('usage: node scripts/demo-screenshots.mjs <brand-url> <product-image> [out-dir]');
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
const shot = async (page, name) => {
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log('captured', file);
  return file;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });

await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
await shot(page, '01-intake-empty');

await page.fill('#brand-url', brandUrl);
await page.setInputFiles('#product-file', path.resolve(productPath));
await page.waitForTimeout(400);
await shot(page, '02-intake-filled');

await page.click('button[type="submit"]');

// Capture the live progress view as the real run advances.
const seen = new Set();
const deadline = Date.now() + 240_000;
let frame = 0;

while (Date.now() < deadline) {
  const heading = await page.locator('.progress h2, .result-head h1, .section-title').first().textContent().catch(() => null);
  const isResults = await page.locator('.result-head, .gallery').count();

  if (heading && !seen.has(heading)) {
    seen.add(heading);
    await shot(page, `03-progress-${String(++frame).padStart(2, '0')}-${heading.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 32)}`);
  }
  if (isResults) break;
  await page.waitForTimeout(1500);
}

await page.waitForTimeout(1500);
await shot(page, '04-final');

// And the history screen, which reads from disk.
await page.click('text=History');
await page.waitForTimeout(1200);
await shot(page, '05-history');

await browser.close();
console.log('\nstates captured:', [...seen].join(' -> '));
