import path from 'node:path';
import fsp from 'node:fs/promises';
import { runDir } from '../lib/store.js';
import { log } from '../lib/log.js';

/**
 * Downloads the curated reference set for a run (PRD 11, 16) so the evidence
 * can be shown back to the user from local storage instead of hot-linking the
 * brand's CDN, and so the same bytes are reused across all six generations.
 *
 * Bounded on every axis: count, per-file size, per-file timeout, concurrency.
 * Failures are non-fatal; a reference that will not download simply keeps
 * local_path = null and the UI falls back to its metadata.
 */

const MAX_BYTES = 6_000_000;
const TIMEOUT_MS = 12_000;

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' };

async function fetchOne(ref, dir, runId) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ref.image_url, {
      signal: ac.signal,
      redirect: 'follow',
      headers: { accept: 'image/*' },
    });
    if (!res.ok) return null;

    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const ext = EXT[type];
    if (!ext) return null;

    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > MAX_BYTES) return null;

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES || buf.byteLength < 1024) return null;

    // The filename comes from the hash-derived reference id, never from the URL.
    const rel = `crawl/references/${ref.reference_id}.${ext}`;
    const file = path.join(dir, rel);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, buf);
    return { rel, bytes: buf.byteLength, mime: type };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function downloadReferences(runId, evidence, { max = 18, concurrency = 4 } = {}) {
  const dir = runDir(runId);

  // Keep a spread across types rather than the top N of one kind.
  const picked = [];
  const push = (arr, n) => {
    for (const r of arr.slice(0, n)) {
      if (!picked.find((p) => p.reference_id === r.reference_id)) picked.push(r);
    }
  };
  push(evidence.logo_candidates, 2);
  push(evidence.campaign_examples, 8);
  push(evidence.product_examples, 8);
  push(evidence.visual_references, max);

  const targets = picked.slice(0, max);
  const byId = new Map();
  let cursor = 0;
  let saved = 0;

  const workers = Array.from({ length: Math.min(concurrency, targets.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= targets.length) return;
      const ref = targets[i];
      const got = await fetchOne(ref, dir, runId);
      if (got) { byId.set(ref.reference_id, got); saved++; }
    }
  });
  await Promise.all(workers);

  // Write local_path back onto every copy of the reference in the bundle.
  const apply = (arr) => (arr ?? []).map((r) => {
    const got = byId.get(r.reference_id);
    return got ? { ...r, local_path: got.rel, bytes: got.bytes } : r;
  });

  const updated = {
    ...evidence,
    visual_references: apply(evidence.visual_references),
    logo_candidates: apply(evidence.logo_candidates),
    product_examples: apply(evidence.product_examples),
    campaign_examples: apply(evidence.campaign_examples),
  };

  log('REFERENCES_SAVED', { run_id: runId, attempted: targets.length, saved });
  return { evidence: updated, saved, attempted: targets.length };
}
