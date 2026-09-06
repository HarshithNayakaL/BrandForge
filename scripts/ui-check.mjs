/**
 * Full UI verification sweep. No network beyond localhost, no API keys.
 *
 *   node scripts/ui-check.mjs [outDir]
 *
 * Visits every screen at three widths, captures screenshots, and fails on:
 *   - any console error or page exception
 *   - any failed network request
 *   - horizontal overflow of the document
 *   - text overflowing its container
 *   - images that never load
 *   - interactive elements below the 24px minimum target size
 *   - missing accessible names on buttons
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve(process.argv[2] ?? './ui-shots');
fs.mkdirSync(OUT, { recursive: true });

const BASE = 'http://localhost:5173';
const WIDTHS = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'tablet', width: 834, height: 1100 },
  { name: 'mobile', width: 390, height: 900 },
];

const problems = [];
const note = (scope, msg) => { problems.push(`${scope}: ${msg}`); };

const browser = await chromium.launch();

// ---------------------------------------------------------------- per width
for (const vp of WIDTHS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.name === 'desktop' ? 2 : 1,
  });
  const page = await ctx.newPage();

  const consoleErrors = [];
  const netFails = [];
  let expectRejection = false;
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // the deliberate invalid-URL submission logs its own 400 here
    if (expectRejection && m.text().includes('400')) return;
    consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => {
    // fonts.googleapis is allowed to fail offline; it has a fallback stack.
    if (!r.url().includes('fonts.g')) netFails.push(`${r.url()} ${r.failure()?.errorText}`);
  });
  page.on('response', (r) => {
    if (r.status() < 400 || r.url().includes('fonts.g')) return;
    // the invalid-URL step below is supposed to be rejected with a 400
    if (expectRejection && r.status() === 400 && r.url().endsWith('/api/campaign')) return;
    netFails.push(`${r.status()} ${r.url()}`);
  });

  const audit = async (scope) => {
    // horizontal overflow of the page itself
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 1) note(scope, `document scrolls horizontally by ${overflow}px`);

    // text overflowing its own box
    const clipped = await page.evaluate(() => {
      const bad = [];
      for (const el of document.querySelectorAll('h1,h2,h3,p,span,strong,td,th,button,a,dd,dt,li')) {
        if (!el.textContent.trim()) continue;
        const cs = getComputedStyle(el);
        if (cs.overflow === 'hidden' && cs.textOverflow === 'ellipsis') continue;
        if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') continue;
        if (el.scrollWidth - el.clientWidth > 2 && el.clientWidth > 0) {
          bad.push(`${el.tagName.toLowerCase()}.${el.className || '-'} overflows by ${el.scrollWidth - el.clientWidth}px: "${el.textContent.trim().slice(0, 40)}"`);
        }
      }
      return bad.slice(0, 6);
    });
    clipped.forEach((c) => note(scope, c));

    // images that failed to decode
    const brokenImgs = await page.evaluate(() =>
      [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.currentSrc || i.src).slice(0, 5));
    brokenImgs.forEach((s) => note(scope, `image failed to load: ${s}`));

    // target size + accessible name
    const controls = await page.evaluate(() => {
      const small = [];
      const unnamed = [];
      for (const el of document.querySelectorAll('button, a[href], input, [tabindex]:not([tabindex="-1"])')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;          // hidden
        if (el.hasAttribute('hidden') || el.type === 'file') continue;
        if (r.height < 24 || r.width < 24) {
          small.push(`${el.tagName.toLowerCase()}.${el.className || '-'} is ${Math.round(r.width)}x${Math.round(r.height)}`);
        }
        const name = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || '').trim();
        if (el.tagName === 'BUTTON' && !name) {
          unnamed.push(`button.${el.className || '-'} has no accessible name`);
        }
      }
      return { small: small.slice(0, 5), unnamed: unnamed.slice(0, 5) };
    });
    controls.small.forEach((s) => note(scope, `target too small: ${s}`));
    controls.unnamed.forEach((s) => note(scope, s));
  };

  const shot = async (name) => {
    await page.screenshot({ path: path.join(OUT, `${vp.name}-${name}.png`), fullPage: true });
  };

  // 1. intake
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await audit('intake');
  await shot('01-intake');

  // 2. validation error path (no keys needed; the server rejects it)
  await page.fill('#brand-url', 'notaurl');
  await page.setInputFiles('#product-file', path.resolve('data/runs/run_fixture_complete/input/product.png'));
  await page.waitForTimeout(300);
  await shot('02-intake-filled');
  expectRejection = true;
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1200);
  await audit('intake-error');
  await shot('03-intake-error');
  expectRejection = false;

  // 3. history
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.click('text=History');
  await page.waitForTimeout(800);
  await audit('history');
  await shot('04-history');

  // 4. completed campaign — the screen that matters most
  await page.click('text=run_fixture_complete');
  await page.waitForTimeout(1400);
  await audit('results-complete');
  await shot('05-results-complete');

  // 5. expanded shot detail
  const det = page.locator('.tile details summary').first();
  if (await det.count()) {
    await det.click();
    await page.waitForTimeout(400);
    await shot('06-results-detail');
  }

  // 6. lightbox comparison
  const frame = page.locator('.tile .frame').first();
  if (await frame.count()) {
    await frame.click();
    await page.waitForTimeout(700);
    await audit('lightbox');
    await shot('07-lightbox');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }

  // 7. brand evidence view
  const evTab = page.locator('.tab', { hasText: 'Brand evidence' });
  if (await evTab.count()) {
    await evTab.click();
    await page.waitForTimeout(1400);
    await audit('evidence');
    await shot('10-evidence');
    // filter chips must not break the grid
    const chip = page.locator('.filter', { hasText: 'campaign' }).first();
    if (await chip.count()) {
      await chip.click();
      await page.waitForTimeout(400);
      await audit('evidence-filtered');
      await shot('11-evidence-filtered');
    }
  }

  // 8. partial campaign, which carries the blocked shot
  await page.click('text=History');
  await page.waitForTimeout(700);
  await page.click('text=run_fixture_partial');
  await page.waitForTimeout(1400);
  await audit('results-partial');
  await shot('08-results-partial');

  // 9. failed run
  await page.click('text=History');
  await page.waitForTimeout(700);
  await page.click('text=run_fixture_failed');
  await page.waitForTimeout(1000);
  await audit('results-failed');
  await shot('09-results-failed');

  consoleErrors.forEach((e) => note(vp.name, `console error: ${e.slice(0, 160)}`));
  netFails.forEach((e) => note(vp.name, `request failed: ${e.slice(0, 160)}`));

  await ctx.close();
  console.log(`  captured ${vp.name}`);
}

// ------------------------------------------------------- keyboard traversal
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });

  const reached = [];
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    const el = await page.evaluate(() => {
      const a = document.activeElement;
      if (!a || a === document.body) return null;
      const cs = getComputedStyle(a);
      return {
        tag: a.tagName.toLowerCase(),
        cls: a.className,
        outline: (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none',
      };
    });
    if (!el) break;
    reached.push(el);
    if (!el.outline) note('keyboard', `no visible focus ring on ${el.tag}.${el.cls || '-'}`);
  }
  if (reached.length < 4) note('keyboard', `only ${reached.length} elements reachable by Tab on intake`);
  console.log(`  keyboard: ${reached.length} focusable stops on intake`);
  await ctx.close();
}

await browser.close();

console.log(`\n  screenshots -> ${OUT}`);
if (problems.length) {
  console.log(`\n  ${problems.length} problem(s):`);
  problems.forEach((p) => console.log(`    - ${p}`));
  process.exit(1);
}
console.log('\n  no problems found\n');
