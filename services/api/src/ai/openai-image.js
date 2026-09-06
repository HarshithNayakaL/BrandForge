import { config, requireKey } from '../config.js';
import { ModelError } from './gemini.js';

const BASE = 'https://api.openai.com/v1';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * Image generation always goes through the *edits* endpoint with the
 * uploaded product photo as an input image. This is the single most
 * important decision for product fidelity: a text-only generation would
 * invent a plausible product, whereas an edit is anchored to the real one
 * (PRD 21 - product truth outranks creative direction).
 */
export async function generateShotImage({
  promptText,
  productImage,          // { buffer, mime, filename }
  referenceImages = [],  // [{ buffer, mime, filename }]
  size = config.openai.imageSize,
  quality = config.openai.imageQuality,
  timeoutMs = config.generation.timeoutMs,
  maxRetries = config.generation.maxRetries,
}) {
  requireKey('openai');

  const form = new FormData();
  form.set('model', config.openai.imageModel);
  form.set('prompt', promptText);
  form.set('size', size);
  form.set('quality', quality);
  form.set('n', '1');

  const attach = (img) => {
    const name = img.filename ?? `image.${img.mime === 'image/jpeg' ? 'jpg' : img.mime === 'image/webp' ? 'webp' : 'png'}`;
    form.append('image[]', new Blob([img.buffer], { type: img.mime }), name);
  };
  attach(productImage);                       // index 0 is always the product
  for (const r of referenceImages.slice(0, 3)) attach(r);

  let lastErr;
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(`${BASE}/images/edits`, {
        method: 'POST',
        headers: { authorization: `Bearer ${config.openai.apiKey}` },
        body: form,
        signal: ac.signal,
      });
      const text = await res.text();

      if (res.status === 429) {
        lastErr = new ModelError('RATE_LIMITED', `OpenAI rate limited: ${text.slice(0, 200)}`);
        if (attempt <= maxRetries) { await sleep(4000 * attempt); continue; }
        throw lastErr;
      }
      if (res.status >= 500) {
        lastErr = new ModelError('GENERATION_FAILED', `OpenAI ${res.status}: ${text.slice(0, 200)}`);
        if (attempt <= maxRetries) { await sleep(2500 * attempt); continue; }
        throw lastErr;
      }
      if (!res.ok) throw new ModelError('GENERATION_FAILED', `OpenAI ${res.status}: ${text.slice(0, 400)}`);

      const json = JSON.parse(text);
      const b64 = json.data?.[0]?.b64_json;
      if (!b64) throw new ModelError('GENERATION_FAILED', `OpenAI returned no image data: ${text.slice(0, 300)}`);

      return {
        buffer: Buffer.from(b64, 'base64'),
        mime: 'image/png',
        model: config.openai.imageModel,
        usage: json.usage ?? null,
        attempts: attempt,
      };
    } catch (e) {
      if (e.name === 'AbortError') {
        lastErr = new ModelError('GENERATION_TIMEOUT', `Image generation timed out after ${timeoutMs}ms`);
        if (attempt <= maxRetries) continue;
        throw lastErr;
      }
      if (e instanceof ModelError) {
        lastErr = e;
        if (attempt > maxRetries) throw e;
        await sleep(2000 * attempt);
        continue;
      }
      throw new ModelError('GENERATION_FAILED', `Image generation failed: ${e.message}`);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr ?? new ModelError('GENERATION_FAILED', 'Image generation failed');
}
