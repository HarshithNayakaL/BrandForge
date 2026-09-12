import 'dotenv/config';
import express from 'express';
import { EvidenceBundleSchema } from '@brandforge/contracts';
import { crawlBrand } from './crawl.js';
import { lookupBrand, siteMap, timeline, extractSocialHandles, getText, decodeEntities } from './tools.js';
import { SSRFError } from './ssrf.js';

const num = (k, d) => Number(process.env[k] ?? d);

const cfg = {
  maxPages: num('MAX_CRAWL_PAGES', 12),
  maxProductPages: num('MAX_PRODUCT_PAGES', 5),
  maxReferenceImages: num('MAX_REFERENCE_IMAGES', 24),
  pageTimeoutMs: num('PAGE_TIMEOUT_MS', 20000),
  totalTimeoutMs: num('TOTAL_CRAWL_TIMEOUT_MS', 120000),
  concurrency: num('CRAWL_CONCURRENCY', 3),
  minImageWidth: num('MIN_IMAGE_WIDTH', 400),
  minImageHeight: num('MIN_IMAGE_HEIGHT', 400),
};

const app = express();
app.use(express.json({ limit: '1mb' }));

const log = (event, data = {}) =>
  console.log(JSON.stringify({ svc: 'crawler', event, ...data, at: new Date().toISOString() }));

app.get('/health', (_req, res) => res.json({ ok: true, service: 'crawler', config: cfg }));

app.post('/crawl', async (req, res) => {
  const { url, run_id: runId = null, overrides = {} } = req.body ?? {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ success: false, code: 'INVALID_URL', error: 'url is required' });
  }

  const effective = { ...cfg, ...overrides };
  const started = Date.now();
  log('crawl_started', { run_id: runId, url });

  try {
    const evidence = await crawlBrand(url, effective, (e, d) => log(e, { run_id: runId, ...d }));

    // The crawler is a contract boundary: nothing leaves unvalidated.
    const parsed = EvidenceBundleSchema.safeParse(evidence);
    if (!parsed.success) {
      log('crawl_contract_violation', { run_id: runId, issues: parsed.error.issues.slice(0, 5) });
      return res.status(500).json({
        success: false,
        code: 'CRAWL_FAILED',
        error: 'crawler produced evidence that violates its own contract',
        details: parsed.error.issues.slice(0, 5),
      });
    }

    log('crawl_completed', {
      run_id: runId,
      duration_ms: Date.now() - started,
      pages: parsed.data.crawl_metadata.pages_visited,
      images: parsed.data.crawl_metadata.images_kept,
    });
    return res.json({ success: true, evidence: parsed.data });
  } catch (e) {
    const code = e instanceof SSRFError ? 'INVALID_URL'
      : /timeout/i.test(e.message) ? 'CRAWL_TIMEOUT'
        : 'CRAWL_FAILED';
    log('crawl_failed', { run_id: runId, code, error: e.message });
    return res.status(code === 'INVALID_URL' ? 400 : 502).json({ success: false, code, error: e.message });
  }
});

/* ------------------------------------------------------------------ tools
 * The retrieval surface the brand agent drives. Each is a single, bounded
 * unit of work so the agent can decide what it needs next rather than
 * receiving one fixed bundle.
 */

const tool = (name, fn) => async (req, res) => {
  const started = Date.now();
  try {
    const out = await fn(req.body ?? {});
    log('tool_ok', { tool: name, ms: Date.now() - started });
    res.json({ success: true, tool: name, ...out });
  } catch (e) {
    const code = e.code ?? (e.name === 'SSRFError' ? 'INVALID_URL' : 'TOOL_FAILED');
    log('tool_failed', { tool: name, code, error: e.message });
    res.status(code === 'INVALID_URL' ? 400 : 502).json({ success: false, tool: name, code, error: e.message });
  }
};

/** Established brand or unknown? Answered from public reference data. */
app.post('/tools/lookup-brand', tool('lookup-brand', (b) => lookupBrand(b)));

/** The brand's own inventory of pages, straight from its sitemap. */
app.post('/tools/site-map', tool('site-map', (b) => {
  if (!b.url) throw Object.assign(new Error('url is required'), { code: 'INVALID_URL' });
  return siteMap(b);
}));

/** How the brand presented itself over time, via the Wayback CDX API. */
app.post('/tools/timeline', tool('timeline', (b) => {
  if (!b.domain) throw Object.assign(new Error('domain is required'), { code: 'INVALID_URL' });
  return timeline(b);
}));

/** One page, fetched and reduced. The agent's primary read operation. */
app.post('/tools/fetch-page', tool('fetch-page', async (b) => {
  if (!b.url) throw Object.assign(new Error('url is required'), { code: 'INVALID_URL' });
  const r = await getText(b.url, { timeoutMs: 20000 });
  if (!r.ok) return { ok: false, status: r.status, error: r.error ?? `HTTP ${r.status}` };

  const html = r.body;
  const strip = (s) => decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  const grab = (re, n = 20) => [...html.matchAll(re)].map((m) => strip(m[1])).filter(Boolean).slice(0, n);

  const jsonld = [];
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { jsonld.push(JSON.parse(m[1])); } catch { /* malformed ld+json is common */ }
  }

  return {
    ok: true,
    final_url: r.finalUrl ?? b.url,
    title: strip((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) ?? [])[1] ?? ''),
    meta_description: decodeEntities((html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i) ?? [])[1] ?? ''),
    og_image: (html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i) ?? [])[1] ?? null,
    headings: grab(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi, 15),
    paragraphs: grab(/<p[^>]*>([\s\S]*?)<\/p>/gi, 15).filter((t) => t.length > 40),
    jsonld: jsonld.slice(0, 5),
    social: extractSocialHandles(html, r.finalUrl ?? b.url),
    bytes: html.length,
  };
}));

const port = num('CRAWLER_PORT', 3002);
app.listen(port, () => log('listening', { port }));
