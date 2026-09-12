import 'dotenv/config';
import path from 'node:path';

const num = (k, d) => Number(process.env[k] ?? d);
const str = (k, d = '') => process.env[k] ?? d;

export const WORKFLOW_VERSION = 'brandforge-1.0.0';
export const BRAND_PROFILE_VERSION = 'bk-1.0.0';

export const config = {
  port: num('API_PORT', 3001),
  dataDir: path.resolve(process.cwd(), str('DATA_DIR', './data')),
  crawlerUrl: str('CRAWLER_URL', 'http://localhost:3002'),
  n8nWebhookUrl: str('N8N_WEBHOOK_URL', 'http://localhost:5678/webhook/brandforge'),
  internalToken: str('INTERNAL_TOKEN', 'dev-internal-token-change-me'),

  gemini: {
    apiKey: str('GEMINI_API_KEY'),
    model: str('GEMINI_MODEL', 'gemini-3.8-flash'),
    visionModel: str('GEMINI_VISION_MODEL', str('GEMINI_MODEL', 'gemini-3.8-flash')),
  },
  openai: {
    apiKey: str('OPENAI_API_KEY'),
    imageModel: str('OPENAI_IMAGE_MODEL', 'gpt-image-2.5'),
    imageSize: str('OPENAI_IMAGE_SIZE', '1024x1024'),
    imageQuality: str('OPENAI_IMAGE_QUALITY', 'high'),
  },

  generation: {
    concurrency: num('GENERATION_CONCURRENCY', 3),
    timeoutMs: num('GENERATION_TIMEOUT_MS', 180000),
    maxRetries: num('MAX_GENERATION_RETRIES', 2),
    maxRepairAttempts: num('MAX_REPAIR_ATTEMPTS', 2),
  },

  qaThresholds: {
    product_accuracy: num('QA_MIN_PRODUCT_ACCURACY', 7),
    realism: num('QA_MIN_REALISM', 6),
    brand_alignment: num('QA_MIN_BRAND_ALIGNMENT', 6),
  },

  upload: {
    maxBytes: num('MAX_UPLOAD_BYTES', 12_000_000),
    allowedMime: ['image/jpeg', 'image/png', 'image/webp'],
  },

  brandCacheTtlMs: num('BRAND_PROFILE_TTL_HOURS', 168) * 3600 * 1000,
};

/** Fail loudly at the point of use, not silently mid-run. */
export function requireKey(which) {
  if (which === 'gemini' && !config.gemini.apiKey) {
    const e = new Error('GEMINI_API_KEY is not configured');
    e.code = 'SYSTEM_ERROR';
    throw e;
  }
  if (which === 'openai' && !config.openai.apiKey) {
    const e = new Error('OPENAI_API_KEY is not configured');
    e.code = 'SYSTEM_ERROR';
    throw e;
  }
}

export function keyStatus() {
  return {
    gemini: Boolean(config.gemini.apiKey),
    openai: Boolean(config.openai.apiKey),
  };
}
