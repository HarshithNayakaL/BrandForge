import 'dotenv/config';
import express from 'express';
import { EvidenceBundleSchema } from '@brandforge/contracts';
import { crawlBrand } from './crawl.js';
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

const port = num('CRAWLER_PORT', 3002);
app.listen(port, () => log('listening', { port }));
