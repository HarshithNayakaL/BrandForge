import path from 'node:path';
import fsp from 'node:fs/promises';
import { generateShotImage } from '../ai/openai-image.js';
import { fetchImagePart } from '../ai/gemini.js';
import { buildGenerationPrompt, buildRepairPrompt } from './prompt-builder.js';
import { config } from '../config.js';
import { runDir, saveBinary, exists } from '../lib/store.js';
import { log } from '../lib/log.js';

/**
 * Reference images are fetched once per run and reused across all six shots.
 * Cheap, and it keeps the six generations visually consistent with each other.
 */
export async function loadShotReferences(brandKit, evidence, shot, cache, runId) {
  if (!evidence) return [];
  const wanted = (shot.reference_ids ?? []).slice(0, 2);
  const out = [];
  for (const id of wanted) {
    if (cache.has(id)) {
      const v = cache.get(id);
      if (v) out.push(v);
      continue;
    }
    const ref = evidence.visual_references.find((r) => r.reference_id === id);
    if (!ref) { cache.set(id, null); continue; }

    let value = null;
    // The crawl stage already saved the curated set, so re-fetching the
    // brand's CDN on every run would be wasted traffic.
    if (ref.local_path && runId) {
      try {
        const file = path.join(runDir(runId), ref.local_path);
        const buffer = await fsp.readFile(file);
        const ext = path.extname(file).toLowerCase();
        const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
          : ext === '.webp' ? 'image/webp' : ext === '.avif' ? 'image/avif' : 'image/png';
        value = { buffer, mime, filename: path.basename(file), reference_id: id };
      } catch { /* fall through to the network */ }
    }
    if (!value) {
      const fetched = await fetchImagePart(ref.image_url);
      value = fetched ? { buffer: fetched.buffer, mime: fetched.mime, filename: `${id}.png`, reference_id: id } : null;
    }
    cache.set(id, value);
    if (value) out.push(value);
  }
  return out;
}

/**
 * Generation is idempotent per (run, shot, attempt): if the output file for
 * this attempt already exists we return it instead of paying for the call
 * again. This is what makes a retry safe (PRD 35).
 */
export async function generateShot({
  runId,
  shot,
  attempt,
  kind = 'INITIAL',
  brandKit,
  productIdentity,
  productImage,
  referenceImages = [],
  qa = null,
}) {
  const shotDir = path.join(runDir(runId), 'generations', shot.shot_id.toLowerCase());
  const outPath = path.join(shotDir, `attempt_${String(attempt).padStart(2, '0')}.png`);
  const relOut = path.relative(runDir(runId), outPath).split(path.sep).join('/');

  const referenceNote = referenceImages.length
    ? `BRAND REFERENCE IMAGES: images ${referenceImages.map((_, i) => i + 2).join(' and ')} are existing photographs by this brand, supplied ONLY as a style reference for light, mood and treatment. Do not copy their subject matter and do not let them alter the product.`
    : '';

  const built = kind === 'REPAIR' && qa
    ? buildRepairPrompt({ brandKit, productIdentity, shot, qa, referenceNote })
    : buildGenerationPrompt({ brandKit, productIdentity, shot, referenceNote });

  const record = {
    shot_id: shot.shot_id,
    attempt,
    kind,
    status: 'PENDING',
    model: config.openai.imageModel,
    prompt_hash: built.hash,
    started_at: new Date().toISOString(),
    completed_at: null,
    output_path: null,
    error: null,
  };

  if (exists(outPath)) {
    log('SHOT_GENERATION_SKIPPED', { run_id: runId, shot_id: shot.shot_id, attempt, reason: 'output already exists' });
    return {
      record: { ...record, status: 'GENERATED', completed_at: new Date().toISOString(), output_path: relOut },
      buffer: await fsp.readFile(outPath),
      mime: 'image/png',
      reused: true,
    };
  }

  await fsp.mkdir(shotDir, { recursive: true });
  await fsp.writeFile(path.join(shotDir, `attempt_${String(attempt).padStart(2, '0')}.prompt.txt`), built.text);

  log('SHOT_GENERATION_STARTED', { run_id: runId, shot_id: shot.shot_id, attempt, kind, prompt_hash: built.hash });

  try {
    const result = await generateShotImage({
      promptText: built.text,
      productImage,
      referenceImages,
    });
    await saveBinary(runId, relOut, result.buffer);
    log('SHOT_GENERATED', { run_id: runId, shot_id: shot.shot_id, attempt, model: result.model, bytes: result.buffer.byteLength });
    return {
      record: { ...record, status: 'GENERATED', completed_at: new Date().toISOString(), output_path: relOut },
      buffer: result.buffer,
      mime: result.mime,
      reused: false,
    };
  } catch (e) {
    log('SHOT_GENERATION_FAILED', { run_id: runId, shot_id: shot.shot_id, attempt, code: e.code, error: e.message });
    return {
      record: { ...record, status: 'FAILED', completed_at: new Date().toISOString(), error: `${e.code ?? 'GENERATION_FAILED'}: ${e.message}` },
      buffer: null,
      error: e,
    };
  }
}

/** Bounded parallelism, so six shots do not open six concurrent API calls. */
export async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
