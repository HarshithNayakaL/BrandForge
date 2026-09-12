/**
 * Audits the running UI against the responsive/accessibility floor that the
 * normal sweep does not cover: 320px, mobile body-text minimums, iOS input
 * zoom, touch target sizes, viewport units, safe areas, CLS from unsized
 * images, and 200% browser zoom.
 *
 *   node scripts/responsive-audit.mjs
 *
 * Reports only; it changes nothing.
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:5173';
const findings = [];
const add = (sev, scope, msg) => findings.push({ sev, scope, msg });

const browser = await chromium.launch();

// ---------------------------------------------------- static CSS inspection
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });

  const css = await page.evaluate(async () => {
    const out = [];
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) out.push(rule.cssText);
      } catch { /* cross-origin sheet */ }
    }
    return out.join('\n');
  });

  const vh = [...css.matchAll(/[^d s]vh\b/g)].length;
  const rawVh = /\b\d+vh\b/.test(css) && !/dvh|svh|lvh/.test(css);
  if (/\b\d+vh\b/.test(css)) {
    const uses = [...css.matchAll(/[^{;]*\b\d+vh\b[^};]*/g)].map((m) => m[0].trim()).slice(0, 4);
    add('high', 'viewport units', `uses vh instead of dvh/svh: ${uses.join(' | ')}`);
  }
  if (!/safe-area-inset/.test(css)) {
    add('high', 'safe areas', 'no env(safe-area-inset-*) anywhere; fixed/sticky edges will sit under notches and home indicators');
  }
  if (!/prefers-color-scheme/.test(css)) {
    add('info', 'theming', 'no prefers-color-scheme handling (light only)');
  }
  if (!/clamp\(/.test(css)) {
    add('med', 'typography', 'no clamp() anywhere; display type does not adapt between breakpoints');
  }
  await ctx.close();
}

// ------------------------------------------------- per-viewport measurements
const VIEWPORTS = [
  { name: '320 compact phone', width: 320, height: 720 },
  { name: '390 standard phone', width: 390, height: 844 },
  { name: '834 tablet portrait', width: 834, height: 1112 },
  { name: '1440 desktop', width: 1440, height: 900 },
];

const ROUTES = [
  ['intake', async () => {}],
  ['history', async (p) => { await p.click('text=History'); await p.waitForTimeout(700); }],
  ['results', async (p) => {
    await p.click('text=History'); await p.waitForTimeout(700);
    await p.click('text=run_fixture_complete'); await p.waitForTimeout(1300);
  }],
];

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    hasTouch: vp.width < 900,
    isMobile: vp.width < 900,
  });

  for (const [routeName, go] of ROUTES) {
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await go(page);
    await page.waitForTimeout(400);
    const scope = `${vp.name} · ${routeName}`;

    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 1) add('high', scope, `horizontal scroll of ${overflow}px`);

    if (vp.width < 900) {
      // Body copy and form controls under 16px cause iOS to zoom on focus.
      const small = await page.evaluate(() => {
        const bad = [];
        const seen = new Set();
        for (const el of document.querySelectorAll('p, li, dd, td, input, textarea, select, button, .purpose, .intake-lede')) {
          const cs = getComputedStyle(el);
          const size = parseFloat(cs.fontSize);
          // hidden controls never receive focus, so they cannot zoom the page
          if (cs.display === 'none' || cs.visibility === 'hidden' || el.hasAttribute('hidden')) continue;
          if (!el.textContent.trim() && el.tagName !== 'INPUT') continue;
          if (size >= 16) continue;
          const key = `${el.tagName.toLowerCase()}.${el.className || '-'}`;
          if (seen.has(key)) continue;
          seen.add(key);
          bad.push({ key, size, isField: ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) });
        }
        return bad.slice(0, 8);
      });
      for (const s of small) {
        add(s.isField ? 'high' : 'med', scope,
          `${s.key} is ${s.size}px${s.isField ? ' — iOS zooms form fields under 16px' : ''}`);
      }

      // Touch target floor: 44px, 48px for primary actions.
      const targets = await page.evaluate(() => {
        const bad = [];
        const seen = new Set();
        for (const el of document.querySelectorAll('button, a[href], input:not([type=file]), [tabindex]:not([tabindex="-1"])')) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          const key = `${el.tagName.toLowerCase()}.${(el.className || '-').split(' ')[0]}`;
          if (seen.has(key)) continue;
          const min = Math.min(r.width, r.height);
          if (min >= 44) continue;
          seen.add(key);
          bad.push({ key, w: Math.round(r.width), h: Math.round(r.height) });
        }
        return bad.slice(0, 8);
      });
      for (const t of targets) add('med', scope, `touch target ${t.key} is ${t.w}x${t.h}, floor is 44`);
    }

    // Layout shift only happens when nothing reserves the box. An explicit
    // width/height pair, an aspect-ratio, or a sized ancestor all prevent it.
    const unsized = await page.evaluate(() => {
      const reserved = (el) => {
        const cs = getComputedStyle(el);
        if (cs.aspectRatio && cs.aspectRatio !== 'auto') return true;
        if (cs.height && cs.height !== 'auto' && parseFloat(cs.height) > 0 && cs.position === 'absolute') return true;
        return false;
      };
      return [...document.images].filter((img) => {
        if (img.getAttribute('width') && img.getAttribute('height')) return false;
        if (reserved(img)) return false;
        let el = img.parentElement;
        for (let i = 0; i < 3 && el; i++, el = el.parentElement) {
          const cs = getComputedStyle(el);
          if (cs.aspectRatio && cs.aspectRatio !== 'auto') return false;
          if (parseFloat(cs.minHeight) > 0) return false;
        }
        return true;
      }).map((i) => (i.currentSrc || i.src).split('/').slice(-2).join('/')).slice(0, 4);
    });
    if (unsized.length) add('med', scope, `${unsized.length} image(s) with no reserved box, so they shift layout while decoding: ${unsized.join(', ')}`);

    await page.close();
  }
  await ctx.close();
}

// ------------------------------------------------------------ 200% zoom pass
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  // 200% zoom on a 1280 viewport behaves like a 640 CSS viewport.
  await page.setViewportSize({ width: 640, height: 400 });
  await page.waitForTimeout(400);
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) add('high', '200% zoom (640x400)', `horizontal scroll of ${overflow}px`);
  await ctx.close();
}

await browser.close();

// ------------------------------------------------------------------- report
const order = { high: 0, med: 1, info: 2 };
findings.sort((a, b) => order[a.sev] - order[b.sev]);
const counts = findings.reduce((m, f) => ({ ...m, [f.sev]: (m[f.sev] ?? 0) + 1 }), {});

console.log('\n  responsive / a11y floor audit\n' + '  ' + '─'.repeat(66));
if (!findings.length) console.log('  nothing found');
for (const f of findings) {
  console.log(`  ${f.sev.toUpperCase().padEnd(5)} ${f.scope}\n        ${f.msg}`);
}
console.log('  ' + '─'.repeat(66));
console.log(`  ${counts.high ?? 0} high · ${counts.med ?? 0} medium · ${counts.info ?? 0} info\n`);
