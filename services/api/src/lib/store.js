import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config, BRAND_PROFILE_VERSION } from '../config.js';

/**
 * File-backed run state. Deliberately not a database: the PRD's storage
 * layout is already a natural on-disk tree, every artefact is inspectable
 * by hand, and there are no native build dependencies to install.
 * Writes are atomic (tmp + rename) so a crash mid-write cannot corrupt state.
 */

const runsDir = () => path.join(config.dataDir, 'runs');
const brandsDir = () => path.join(config.dataDir, 'brands');

export function newRunId() {
  const ts = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `run_${ts}_${crypto.randomBytes(4).toString('hex')}`;
}

/** Path segments are never user-controlled; ids are generated server-side. */
export function assertSafeId(id, label = 'id') {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_.-]{3,80}$/.test(id)) {
    const e = new Error(`Unsafe ${label}: ${id}`);
    e.code = 'SYSTEM_ERROR';
    throw e;
  }
  return id;
}

export function brandIdFromUrl(url) {
  const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  return host.replace(/[^a-z0-9.-]/g, '_');
}

export function runDir(runId) {
  return path.join(runsDir(), assertSafeId(runId, 'run_id'));
}

async function writeAtomic(file, content) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fsp.writeFile(tmp, content);
  await fsp.rename(tmp, file);
}

export async function writeJson(file, obj) {
  await writeAtomic(file, JSON.stringify(obj, null, 2));
  return file;
}

export async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export async function writeRunArtifact(runId, relPath, obj) {
  return writeJson(path.join(runDir(runId), relPath), obj);
}

export async function readRunArtifact(runId, relPath, fallback = null) {
  return readJson(path.join(runDir(runId), relPath), fallback);
}

export async function saveBinary(runId, relPath, buffer) {
  const file = path.join(runDir(runId), relPath);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, buffer);
  return file;
}

export function exists(file) {
  return fs.existsSync(file);
}

// ---------------------------------------------------------------- run state

const STATE_FILE = 'state.json';

export async function createRun(input) {
  const runId = newRunId();
  const state = {
    run_id: runId,
    status: 'CREATED',
    stage: 'Run created',
    progress: { generated: 0, total: 6, accepted: 0, blocked: 0 },
    input,
    error: null,
    failure_code: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    completed_at: null,
    usage: { image_generations: 0, repairs: 0, gemini_calls: 0, crawl_pages: 0 },
  };
  await writeRunArtifact(runId, STATE_FILE, state);
  await appendIndex({
    run_id: runId,
    brand_url: input.brand_url,
    brand: null,
    product_category: null,
    status: 'CREATED',
    created_at: state.created_at,
    accepted: 0,
    blocked: 0,
  });
  return state;
}

export async function getRun(runId) {
  return readRunArtifact(runId, STATE_FILE);
}

/**
 * Read-modify-write is serialised per run id so concurrent shot updates
 * (six parallel generations) cannot clobber each other.
 */
const locks = new Map();
export async function updateRun(runId, patch) {
  const prev = locks.get(runId) ?? Promise.resolve();
  const next = prev.then(async () => {
    const state = await getRun(runId);
    if (!state) throw Object.assign(new Error(`Unknown run ${runId}`), { code: 'SYSTEM_ERROR' });
    const updated = typeof patch === 'function' ? patch(state) : { ...state, ...patch };
    updated.updated_at = new Date().toISOString();
    await writeRunArtifact(runId, STATE_FILE, updated);
    if (patch.status || updated.status !== state.status) {
      await patchIndex(runId, {
        status: updated.status,
        brand: updated.brand ?? null,
        product_category: updated.product_category ?? null,
        accepted: updated.progress?.accepted ?? 0,
        blocked: updated.progress?.blocked ?? 0,
      });
    }
    return updated;
  });
  locks.set(runId, next.catch(() => {}));
  return next;
}

// -------------------------------------------------------------- run index

const indexFile = () => path.join(runsDir(), 'index.json');
let indexLock = Promise.resolve();

async function appendIndex(entry) {
  indexLock = indexLock.then(async () => {
    const idx = (await readJson(indexFile(), [])) ?? [];
    idx.unshift(entry);
    await writeJson(indexFile(), idx.slice(0, 500));
  });
  return indexLock;
}

async function patchIndex(runId, patch) {
  indexLock = indexLock.then(async () => {
    const idx = (await readJson(indexFile(), [])) ?? [];
    const i = idx.findIndex((e) => e.run_id === runId);
    if (i >= 0) {
      idx[i] = { ...idx[i], ...patch };
      await writeJson(indexFile(), idx);
    }
  });
  return indexLock;
}

export async function listRuns(limit = 50) {
  const idx = (await readJson(indexFile(), [])) ?? [];
  return idx.slice(0, limit);
}

// ------------------------------------------------------------ brand cache

export function brandDir(brandId) {
  return path.join(brandsDir(), assertSafeId(brandId, 'brand_id'));
}

export async function getCachedBrandKit(brandId) {
  const file = path.join(brandDir(brandId), 'brand-kit.json');
  const kit = await readJson(file);
  if (!kit?._meta) return { hit: false, reason: 'no cached profile' };

  if (kit._meta.brand_profile_version !== BRAND_PROFILE_VERSION) {
    return { hit: false, reason: `schema version changed (${kit._meta.brand_profile_version} -> ${BRAND_PROFILE_VERSION})` };
  }
  const age = Date.now() - new Date(kit._meta.created_at).getTime();
  if (age > config.brandCacheTtlMs) {
    return { hit: false, reason: `cached profile is stale (${Math.round(age / 3600000)}h old)`, stale: kit };
  }
  return { hit: true, kit, age_hours: Math.round(age / 3600000) };
}

export async function putCachedBrandKit(brandId, kit) {
  return writeJson(path.join(brandDir(brandId), 'brand-kit.json'), kit);
}
