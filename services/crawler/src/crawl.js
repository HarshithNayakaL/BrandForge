import { chromium } from 'playwright';
import crypto from 'node:crypto';
import { assertSafeUrl, SSRFError } from './ssrf.js';
import { normalizeUrl, sameSite, isExcludedPath, classifyPage, scoreImage, classifyImage } from './filters.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

/** Runs inside the page. Extracts everything we need in a single pass. */
const EXTRACTOR = () => {
  const abs = (u) => { try { return new URL(u, location.href).toString(); } catch { return null; } };
  const clean = (s) => (s ?? '').replace(/\s+/g, ' ').trim();

  const images = [];
  const seen = new Set();
  const push = (url, el, extra = {}) => {
    const a = abs(url);
    if (!a || seen.has(a)) return;
    seen.add(a);
    const r = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    images.push({
      url: a,
      alt: clean(el && el.getAttribute ? el.getAttribute('alt') : ''),
      naturalWidth: (el && el.naturalWidth) || 0,
      naturalHeight: (el && el.naturalHeight) || 0,
      width: Math.round((r && r.width) || 0),
      height: Math.round((r && r.height) || 0),
      inMain: !!(el && el.closest && el.closest('main, [role="main"], article, .product, .pdp, #main')),
      isLcpCandidate: ((r && r.top) ?? 9999) < 1200 && ((r && r.width) || 0) > 300,
      ...extra,
    });
  };

  for (const img of document.querySelectorAll('img')) {
    // Prefer the largest srcset candidate; `src` is often a blurred placeholder.
    const ss = img.getAttribute('srcset');
    let best = img.currentSrc || img.src;
    if (ss) {
      const scored = ss.split(',')
        .map((s) => s.trim().split(/\s+/))
        .filter((p) => p[0])
        .map((p) => ({ u: p[0], w: parseInt(p[1] || '0', 10) || 0 }))
        .sort((a, b) => b.w - a.w);
      if (scored[0] && scored[0].w > 0) best = scored[0].u;
    }
    if (best) push(best, img);
    const lazy = img.getAttribute('data-src') || img.getAttribute('data-original') || img.getAttribute('data-lazy');
    if (lazy) push(lazy, img);
  }
  for (const src of document.querySelectorAll('picture source[srcset]')) {
    const first = src.getAttribute('srcset').split(',')[0].trim().split(/\s+/)[0];
    if (first) push(first, src.parentElement ? src.parentElement.querySelector('img') : null);
  }
  // og:image is the brand's own chosen hero frame.
  for (const m of document.querySelectorAll('meta[property="og:image"], meta[name="twitter:image"]')) {
    push(m.getAttribute('content'), null, { inMain: true, isLcpCandidate: true, alt: 'og:image' });
  }

  const links = [...document.querySelectorAll('a[href]')]
    .map((a) => abs(a.getAttribute('href')))
    .filter(Boolean);

  const text = [];
  const add = (kind, s) => {
    const t = clean(s);
    if (t && t.length > 2 && t.length < 1200) text.push({ kind, text: t });
  };
  add('title', document.title);
  const md = document.querySelector('meta[name="description"]');
  add('meta_description', md ? md.content : '');
  for (const h of [...document.querySelectorAll('h1, h2')].slice(0, 12)) add('heading', h.textContent);
  for (const p of [...document.querySelectorAll('main p, article p, .description p, [class*="product-detail"] p')].slice(0, 12)) add('copy', p.textContent);
  for (const n of [...document.querySelectorAll('nav a')].slice(0, 30)) add('nav', n.textContent);

  // JSON-LD gives clean brand/product facts when the site publishes it.
  const jsonld = [];
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try { jsonld.push(JSON.parse(s.textContent)); } catch { /* malformed ld+json is common in the wild */ }
  }

  // Sample computed colours of large surfaces as a palette hint.
  const colors = {};
  for (const el of [document.body, ...document.querySelectorAll('header, footer, main, section')].slice(0, 20)) {
    if (!el) continue;
    const cs = getComputedStyle(el);
    for (const c of [cs.backgroundColor, cs.color]) {
      if (!c || c === 'rgba(0, 0, 0, 0)' || c === 'transparent') continue;
      colors[c] = (colors[c] || 0) + 1;
    }
  }

  return { images, links, text, jsonld, colors, title: clean(document.title) };
};

function rgbToHex(rgb) {
  const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  return '#' + [1, 2, 3].map((i) => Number(m[i]).toString(16).padStart(2, '0')).join('');
}

function refId(url) {
  return 'ref_' + crypto.createHash('sha1').update(url).digest('hex').slice(0, 10);
}

export async function crawlBrand(rawUrl, cfg, log = () => {}) {
  const started = Date.now();
  const seedUrl = await assertSafeUrl(rawUrl);
  const rootDomain = seedUrl.hostname.toLowerCase().replace(/^www\./, '');

  const notes = [];
  const pages = [];
  const textEvidence = [];
  const imageCandidates = [];
  const colorCounts = {};
  let imagesSeen = 0;
  let truncated = false;

  const browser = await chromium.launch({ args: ['--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1440, height: 1000 },
    ignoreHTTPSErrors: false,
  });
  // Block heavy subresources: we read image URLs from the DOM, never the pixels.
  await ctx.route('**/*', (route) => {
    const t = route.request().resourceType();
    if (t === 'media' || t === 'font') return route.abort();
    return route.continue();
  });

  const queue = [{ url: normalizeUrl(seedUrl.toString(), seedUrl.toString()), role: 'seed', depth: 0 }];
  const visited = new Set();
  const roleCounts = { product: 0, collection: 0, campaign: 0, about: 0, home: 0, other: 0 };
  const deadline = started + cfg.totalTimeoutMs;

  const visit = async (job) => {
    if (!job || visited.has(job.url) || visited.size >= cfg.maxPages) return;
    if (Date.now() > deadline) { truncated = true; return; }
    visited.add(job.url);

    const page = await ctx.newPage();
    const record = { url: job.url, final_url: job.url, status: 0, role: job.role, title: '', ok: false, error: null };
    try {
      await assertSafeUrl(job.url);
      const resp = await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: cfg.pageTimeoutMs });
      record.status = resp ? resp.status() : 0;
      record.final_url = page.url();
      // A redirect can leave the safe set entirely, so re-validate the landing URL.
      await assertSafeUrl(record.final_url);
      if (!sameSite(record.final_url, rootDomain)) throw new Error(`redirected off-domain to ${record.final_url}`);

      // Give lazy-loaded imagery a chance to resolve.
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.6)).catch(() => {});
      await page.waitForTimeout(900);
      await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});

      const data = await page.evaluate(EXTRACTOR);
      record.title = data.title;
      record.ok = true;

      let role = job.role;
      if (role === 'seed') {
        const c = classifyPage(record.final_url);
        role = c === 'other' ? 'seed' : c;
      }
      record.role = role;

      for (const t of data.text) {
        textEvidence.push({ source_page: record.final_url, kind: t.kind, text: t.text });
      }
      for (const block of data.jsonld) {
        const arr = Array.isArray(block) ? block : [block];
        for (const node of arr) {
          if (!node || typeof node !== 'object') continue;
          if (node.name) textEvidence.push({ source_page: record.final_url, kind: 'category', text: String(node.name).slice(0, 300) });
          if (node.description) textEvidence.push({ source_page: record.final_url, kind: 'product_description', text: String(node.description).slice(0, 800) });
          if (node.brand && node.brand.name) textEvidence.push({ source_page: record.final_url, kind: 'category', text: `brand:${node.brand.name}` });
        }
      }
      for (const [c, n] of Object.entries(data.colors)) colorCounts[c] = (colorCounts[c] || 0) + n;

      imagesSeen += data.images.length;
      for (const img of data.images) {
        const conf = scoreImage(img, { minWidth: cfg.minImageWidth, minHeight: cfg.minImageHeight });
        if (conf === null) continue;
        imageCandidates.push({
          reference_id: refId(img.url),
          image_url: img.url,
          source_page: record.final_url,
          width: img.naturalWidth || img.width || null,
          height: img.naturalHeight || img.height || null,
          reference_type: classifyImage(img, role),
          local_path: null,
          alt: img.alt || '',
          confidence: conf,
        });
      }

      // Bounded, prioritised expansion — never a blind full-domain crawl.
      if (visited.size < cfg.maxPages) {
        const seenLinks = new Set();
        for (const raw of data.links) {
          const n = normalizeUrl(raw, record.final_url);
          if (!n || seenLinks.has(n) || visited.has(n)) continue;
          seenLinks.add(n);
          if (!sameSite(n, rootDomain) || isExcludedPath(n)) continue;
          const r = classifyPage(n);
          if (r === 'other') continue;
          const cap = r === 'product' ? cfg.maxProductPages : 3;
          if (roleCounts[r] >= cap) continue;
          roleCounts[r]++;
          queue.push({ url: n, role: r, depth: job.depth + 1 });
        }
      }
    } catch (e) {
      record.error = e instanceof SSRFError ? `blocked: ${e.message}` : e.message;
      log('page_failed', { url: job.url, error: record.error });
    } finally {
      pages.push(record);
      await page.close().catch(() => {});
    }
  };

  try {
    // Seed sequentially so its link discovery informs the rest of the crawl.
    await visit(queue.shift());
    while (queue.length && visited.size < cfg.maxPages && Date.now() < deadline) {
      const batch = queue.splice(0, cfg.concurrency);
      await Promise.all(batch.map(visit));
    }
    if (queue.length) truncated = true;
  } finally {
    await ctx.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  // Dedupe, rank, then bound the reference set.
  const byId = new Map();
  for (const r of imageCandidates) {
    const prev = byId.get(r.reference_id);
    if (!prev || r.confidence > prev.confidence) byId.set(r.reference_id, r);
  }
  const ranked = [...byId.values()].sort((a, b) => b.confidence - a.confidence);
  const logos = ranked.filter((r) => r.reference_type === 'logo').slice(0, 3);
  const nonLogo = ranked.filter((r) => r.reference_type !== 'logo').slice(0, cfg.maxReferenceImages);
  const visual = [...logos, ...nonLogo];

  const palette = Object.entries(colorCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([c]) => rgbToHex(c))
    .filter(Boolean)
    .slice(0, 8)
    .map((hex) => ({ hex, source: 'computed-style' }));

  // Compact the text: we never dump a raw site into Gemini (PRD 12).
  const seenText = new Set();
  const text = textEvidence.filter((t) => {
    const k = t.text.toLowerCase();
    if (seenText.has(k)) return false;
    seenText.add(k);
    return true;
  }).slice(0, 220);

  if (truncated) notes.push('crawl bounded by page limit or total timeout');

  return {
    brand_url: rawUrl,
    domain: rootDomain,
    pages,
    text_evidence: text,
    visual_references: visual,
    logo_candidates: logos,
    product_examples: nonLogo.filter((r) => r.reference_type === 'product' || r.reference_type === 'detail'),
    campaign_examples: nonLogo.filter((r) => ['campaign', 'lifestyle', 'editorial'].includes(r.reference_type)),
    palette,
    crawl_metadata: {
      started_at: new Date(started).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - started,
      pages_visited: pages.filter((p) => p.ok).length,
      pages_failed: pages.filter((p) => !p.ok).length,
      images_seen: imagesSeen,
      images_kept: visual.length,
      truncated,
      notes,
    },
  };
}
