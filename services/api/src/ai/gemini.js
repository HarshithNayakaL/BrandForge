import { config, requireKey } from '../config.js';
import { parseModelJson } from '@brandforge/contracts';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

class ModelError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'ModelError';
    this.code = code;
    this.details = details;
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * Single Gemini call. `parts` may mix text and inline images.
 * Always asks for JSON back; the caller validates against a zod schema.
 */
async function callGemini({ model, parts, temperature = 0.3, timeoutMs = 90_000, maxOutputTokens = 8192 }) {
  requireKey('gemini');
  const url = `${BASE}/models/${model}:generateContent?key=${encodeURIComponent(config.gemini.apiKey)}`;
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature,
      maxOutputTokens,
      responseMimeType: 'application/json',
    },
    safetySettings: [],
  };

  const attempts = 3;
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      const text = await res.text();

      if (res.status === 429 || res.status >= 500) {
        lastErr = new ModelError(res.status === 429 ? 'RATE_LIMITED' : 'SYSTEM_ERROR', `Gemini ${res.status}: ${text.slice(0, 300)}`);
        if (i < attempts) { await sleep(1500 * i * i); continue; }
        throw lastErr;
      }
      if (!res.ok) throw new ModelError('SYSTEM_ERROR', `Gemini ${res.status}: ${text.slice(0, 400)}`);

      const json = JSON.parse(text);
      const cand = json.candidates?.[0];
      if (!cand) throw new ModelError('SYSTEM_ERROR', `Gemini returned no candidates: ${text.slice(0, 300)}`);
      if (cand.finishReason === 'MAX_TOKENS') {
        throw new ModelError('SYSTEM_ERROR', 'Gemini response hit the output token limit (truncated JSON)');
      }
      const out = (cand.content?.parts ?? []).map((p) => p.text ?? '').join('');
      if (!out.trim()) throw new ModelError('SYSTEM_ERROR', `Gemini returned empty content (finishReason=${cand.finishReason})`);
      return out;
    } catch (e) {
      if (e.name === 'AbortError') {
        lastErr = new ModelError('SYSTEM_ERROR', `Gemini call timed out after ${timeoutMs}ms`);
        if (i < attempts) continue;
        throw lastErr;
      }
      if (e instanceof ModelError && i >= attempts) throw e;
      if (!(e instanceof ModelError)) throw new ModelError('SYSTEM_ERROR', `Gemini call failed: ${e.message}`);
      lastErr = e;
      await sleep(1200 * i);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr ?? new ModelError('SYSTEM_ERROR', 'Gemini call failed');
}

/**
 * Ask Gemini for structured output and validate it.
 * One retry with the validation errors fed back, because a schema-violating
 * response is usually recoverable and much cheaper than failing the run.
 */
export async function generateStructured({ model, parts, schema, label, temperature, failureCode = 'SYSTEM_ERROR' }) {
  const m = model ?? config.gemini.model;
  let raw = await callGemini({ model: m, parts, temperature });
  try {
    return { data: parseModelJson(raw, schema, label), model: m, calls: 1 };
  } catch (first) {
    const repairParts = [
      ...parts,
      { text: `Your previous response was rejected by the schema validator.\n\nErrors:\n${JSON.stringify(first.details ?? first.message, null, 2)}\n\nPrevious response:\n${String(raw).slice(0, 4000)}\n\nReturn ONLY corrected JSON matching the schema exactly. No prose, no markdown fences.` },
    ];
    raw = await callGemini({ model: m, parts: repairParts, temperature: 0.1 });
    try {
      return { data: parseModelJson(raw, schema, label), model: m, calls: 2 };
    } catch (second) {
      throw new ModelError(failureCode, `${label} failed schema validation twice`, {
        first: first.details ?? first.message,
        second: second.details ?? second.message,
      });
    }
  }
}

export function imagePart(buffer, mime = 'image/png') {
  return { inline_data: { mime_type: mime, data: buffer.toString('base64') } };
}

/** Fetch a remote reference image for multimodal input, with a hard size cap. */
export async function fetchImagePart(url, { timeoutMs = 15000, maxBytes = 5_000_000 } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal, redirect: 'follow' });
    if (!res.ok) return null;
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim();
    if (!/^image\/(jpeg|png|webp)$/.test(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > maxBytes || buf.byteLength < 1024) return null;
    return { part: imagePart(buf, type), buffer: buf, mime: type };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export { ModelError };
