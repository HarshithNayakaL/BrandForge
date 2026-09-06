import path from 'node:path';
import fsp from 'node:fs/promises';
import { EvidenceBundleSchema } from '@brandforge/contracts';
import { config } from '../config.js';
import {
  updateRun, getRun, writeRunArtifact, readRunArtifact, runDir,
  brandIdFromUrl, getCachedBrandKit,
} from '../lib/store.js';
import { log } from '../lib/log.js';
import { buildBrandKit } from './brand-intelligence.js';
import { analyzeProduct } from './product-intelligence.js';
import { planCampaign } from './planner.js';
import { generateShot, loadShotReferences, mapWithConcurrency } from './generate.js';
import { reviewShot } from './qa.js';
import { buildManifest, writeManifest } from './manifest.js';
import { downloadReferences } from './references.js';

/**
 * Each exported stage is independently callable. n8n drives them one by one
 * over HTTP (it owns routing and the repair decision); `runPipeline` chains
 * the same functions for the standalone path when n8n is not in play.
 * There is exactly one implementation of each stage either way.
 */

const STAGE_LABELS = {
  CRAWLING: 'Analyzing website',
  BRAND_ANALYSIS: 'Building brand profile',
  PRODUCT_ANALYSIS: 'Analyzing product',
  PLANNING: 'Planning campaign',
  GENERATING: 'Creating six shots',
  QA: 'Checking product accuracy',
  REPAIRING: 'Repairing failed shots',
  FINALIZING: 'Finalizing campaign',
};

async function setStage(runId, status, stage, extra = {}) {
  return updateRun(runId, (s) => ({ ...s, status, stage: stage ?? STAGE_LABELS[status] ?? status, ...extra }));
}

async function recordError(runId, code, message) {
  return updateRun(runId, (s) => ({
    ...s,
    errors: [...(s.errors ?? []), { code, message, at: new Date().toISOString() }],
  }));
}

async function bumpUsage(runId, patch) {
  return updateRun(runId, (s) => ({
    ...s,
    usage: Object.fromEntries(Object.entries(s.usage).map(([k, v]) => [k, v + (patch[k] ?? 0)])),
  }));
}

// ------------------------------------------------------------------ stages

export async function stageCrawl(runId) {
  const state = await getRun(runId);
  await setStage(runId, 'CRAWLING', 'Analyzing website');
  log('CRAWL_STARTED', { run_id: runId, url: state.input.brand_url });

  const res = await fetch(`${config.crawlerUrl}/crawl`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: state.input.brand_url, run_id: runId }),
  }).catch((e) => {
    throw Object.assign(new Error(`Crawler service unreachable at ${config.crawlerUrl}: ${e.message}`), { code: 'CRAWL_FAILED' });
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success) {
    throw Object.assign(new Error(body.error ?? `Crawl failed with status ${res.status}`), { code: body.code ?? 'CRAWL_FAILED' });
  }

  const parsed = EvidenceBundleSchema.parse(body.evidence);

  // Save the curated reference set locally so the evidence can be shown back
  // to the user, and so generation reuses the same bytes (PRD 11, 16).
  const { evidence } = await downloadReferences(runId, parsed);

  await writeRunArtifact(runId, 'crawl/evidence.json', evidence);
  await bumpUsage(runId, { crawl_pages: evidence.crawl_metadata.pages_visited });
  log('CRAWL_COMPLETED', {
    run_id: runId,
    pages: evidence.crawl_metadata.pages_visited,
    images: evidence.crawl_metadata.images_kept,
    duration_ms: evidence.crawl_metadata.duration_ms,
  });
  return evidence;
}

/** Cache lookup is deterministic; only a miss costs a crawl + Gemini call. */
export async function stageBrandKit(runId, { forceRefresh = false } = {}) {
  const state = await getRun(runId);
  const brandId = brandIdFromUrl(state.input.brand_url);

  if (!forceRefresh) {
    const cached = await getCachedBrandKit(brandId);
    if (cached.hit) {
      await writeRunArtifact(runId, 'intelligence/brand-kit.json', cached.kit);
      await setStage(runId, 'BRAND_ANALYSIS', 'Reusing cached brand profile', { brand: cached.kit.brand.name });
      log('BRAND_CACHE_HIT', { run_id: runId, brand_id: brandId, age_hours: cached.age_hours });
      return { brandKit: cached.kit, evidence: await readRunArtifact(runId, 'crawl/evidence.json'), cached: true };
    }
    log('BRAND_CACHE_MISS', { run_id: runId, brand_id: brandId, reason: cached.reason });
  }

  const evidence = (await readRunArtifact(runId, 'crawl/evidence.json')) ?? (await stageCrawl(runId));
  await setStage(runId, 'BRAND_ANALYSIS', 'Building brand profile');

  const { brandKit, geminiCalls } = await buildBrandKit(evidence, { runId });
  await writeRunArtifact(runId, 'intelligence/brand-kit.json', brandKit);
  await bumpUsage(runId, { gemini_calls: geminiCalls });
  await updateRun(runId, { brand: brandKit.brand.name });
  return { brandKit, evidence, cached: false };
}

export async function stageProductIdentity(runId) {
  const state = await getRun(runId);
  await setStage(runId, 'PRODUCT_ANALYSIS', 'Analyzing product');

  const productImage = await loadProductImage(runId);
  const { productIdentity, geminiCalls } = await analyzeProduct({
    buffer: productImage.buffer,
    mime: productImage.mime,
    productAssetId: state.input.product_asset_id,
    runId,
  });

  await writeRunArtifact(runId, 'intelligence/product-identity.json', productIdentity);
  await bumpUsage(runId, { gemini_calls: geminiCalls });
  await updateRun(runId, { product_category: productIdentity.category });
  return productIdentity;
}

export async function stagePlan(runId) {
  await setStage(runId, 'PLANNING', 'Planning campaign');
  const brandKit = await readRunArtifact(runId, 'intelligence/brand-kit.json');
  const productIdentity = await readRunArtifact(runId, 'intelligence/product-identity.json');
  if (!brandKit || !productIdentity) {
    throw Object.assign(new Error('Cannot plan before brand kit and product identity exist'), { code: 'CAMPAIGN_PLANNING_FAILED' });
  }

  const { plan, geminiCalls } = await planCampaign({ brandKit, productIdentity, runId });
  await writeRunArtifact(runId, 'campaign/shot-plan.json', plan);
  await bumpUsage(runId, { gemini_calls: geminiCalls });
  return plan;
}

export async function loadProductImage(runId) {
  const dir = path.join(runDir(runId), 'input');
  const files = await fsp.readdir(dir);
  const f = files.find((n) => n.startsWith('product.'));
  if (!f) throw Object.assign(new Error('Product image missing from run input'), { code: 'INVALID_PRODUCT_IMAGE' });
  const ext = path.extname(f).toLowerCase();
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
  return { buffer: await fsp.readFile(path.join(dir, f)), mime, filename: f };
}

/**
 * One shot, end to end: generate -> QA -> bounded selective repair.
 * Failure here is contained to this shot; the other five are unaffected
 * (PRD 31 - never regenerate all six because one drifted).
 */
export async function runShot({ runId, shot, brandKit, productIdentity, productImage, evidence, refCache }) {
  const attempts = [];
  const qaHistory = [];
  let repairAttempts = 0;
  let lastQa = null;

  const references = await loadShotReferences(brandKit, evidence, shot, refCache, runId);

  for (let attemptNo = 1; ; attemptNo++) {
    const kind = attemptNo === 1 ? 'INITIAL' : 'REPAIR';
    if (kind === 'REPAIR') {
      log('SHOT_REPAIR_STARTED', { run_id: runId, shot_id: shot.shot_id, repair_attempt: repairAttempts + 1 });
    }

    const gen = await generateShot({
      runId, shot, attempt: attemptNo, kind,
      brandKit, productIdentity, productImage,
      referenceImages: references,
      qa: lastQa,
    });
    attempts.push(gen.record);
    if (!gen.reused) await bumpUsage(runId, { image_generations: 1, repairs: kind === 'REPAIR' ? 1 : 0 });

    if (gen.record.status === 'FAILED') {
      if (attemptNo > config.generation.maxRepairAttempts) {
        log('SHOT_BLOCKED', { run_id: runId, shot_id: shot.shot_id, reason: gen.record.error });
        return { shot_id: shot.shot_id, status: 'FAILED', attempts, repair_attempts: repairAttempts, output: null, qa: lastQa, qa_history: qaHistory, failure_reason: gen.record.error };
      }
      repairAttempts++;
      continue;
    }

    let review;
    try {
      review = await reviewShot({
        productImage,
        generatedImage: { buffer: gen.buffer, mime: gen.mime },
        productIdentity, brandKit, shot,
        repairAttemptsUsed: repairAttempts,
        runId,
      });
      await bumpUsage(runId, { gemini_calls: review.geminiCalls });
    } catch (e) {
      // A QA failure must not silently ship the image.
      log('SHOT_QA_ERROR', { run_id: runId, shot_id: shot.shot_id, error: e.message });
      return {
        shot_id: shot.shot_id, status: 'BLOCKED', attempts, repair_attempts: repairAttempts,
        output: gen.record.output_path, qa: null, qa_history: qaHistory,
        failure_reason: `QA_FAILED: ${e.message}`,
      };
    }

    lastQa = review.qa;
    qaHistory.push(review.qa);
    await writeRunArtifact(runId, `qa/${shot.shot_id.toLowerCase()}_attempt_${attemptNo}.json`, review.qa);

    if (review.qa.decision === 'PASS') {
      const finalRel = `final/${shot.shot_id.toLowerCase()}.png`;
      await fsp.mkdir(path.join(runDir(runId), 'final'), { recursive: true });
      await fsp.copyFile(path.join(runDir(runId), gen.record.output_path), path.join(runDir(runId), finalRel));
      log('SHOT_ACCEPTED', { run_id: runId, shot_id: shot.shot_id, attempt: attemptNo, product_accuracy: review.qa.product_accuracy });
      await updateRun(runId, (s) => ({ ...s, progress: { ...s.progress, accepted: s.progress.accepted + 1 } }));
      return { shot_id: shot.shot_id, status: 'ACCEPTED', attempts, repair_attempts: repairAttempts, output: finalRel, qa: review.qa, qa_history: qaHistory, failure_reason: null };
    }

    if (review.qa.decision === 'BLOCK') {
      log('SHOT_BLOCKED', { run_id: runId, shot_id: shot.shot_id, issues: review.qa.issues.slice(0, 3) });
      await updateRun(runId, (s) => ({ ...s, progress: { ...s.progress, blocked: s.progress.blocked + 1 } }));
      return {
        shot_id: shot.shot_id, status: 'BLOCKED', attempts, repair_attempts: repairAttempts,
        output: gen.record.output_path, qa: review.qa, qa_history: qaHistory,
        failure_reason: review.qa.issues[0] ?? 'blocked by QA',
      };
    }

    repairAttempts++;
    await setStage(runId, 'REPAIRING', `Repairing ${shot.shot_id.replace('SHOT_0', 'Shot ')}`);
  }
}

export async function stageGenerateAndQA(runId) {
  const [brandKit, productIdentity, plan, evidence] = await Promise.all([
    readRunArtifact(runId, 'intelligence/brand-kit.json'),
    readRunArtifact(runId, 'intelligence/product-identity.json'),
    readRunArtifact(runId, 'campaign/shot-plan.json'),
    readRunArtifact(runId, 'crawl/evidence.json'),
  ]);
  const productImage = await loadProductImage(runId);
  const refCache = new Map();

  await setStage(runId, 'GENERATING', 'Creating six shots', { progress: { generated: 0, total: 6, accepted: 0, blocked: 0 } });

  const results = await mapWithConcurrency(plan.shots, config.generation.concurrency, async (shot) => {
    const r = await runShot({ runId, shot, brandKit, productIdentity, productImage, evidence, refCache });
    await updateRun(runId, (s) => ({
      ...s,
      progress: { ...s.progress, generated: s.progress.generated + 1 },
      stage: `Completed ${s.progress.generated + 1} / 6`,
    }));
    return r;
  });

  await writeRunArtifact(runId, 'campaign/shot-results.json', results);
  return results;
}

export async function stageFinalize(runId) {
  await setStage(runId, 'FINALIZING', 'Finalizing campaign');
  const [state, brandKit, productIdentity, plan, shotResults] = await Promise.all([
    getRun(runId),
    readRunArtifact(runId, 'intelligence/brand-kit.json'),
    readRunArtifact(runId, 'intelligence/product-identity.json'),
    readRunArtifact(runId, 'campaign/shot-plan.json'),
    readRunArtifact(runId, 'campaign/shot-results.json', []),
  ]);

  const manifest = buildManifest({ state, brandKit, productIdentity, plan, shotResults });
  await writeManifest(runId, manifest);

  const status = manifest.status === 'COMPLETED' ? 'COMPLETED' : manifest.status === 'FAILED' ? 'FAILED' : 'PARTIAL';
  await updateRun(runId, {
    status,
    stage: status === 'COMPLETED' ? 'Campaign ready' : `Campaign ready — ${manifest.accepted} accepted, ${manifest.blocked} blocked`,
    completed_at: new Date().toISOString(),
    progress: { generated: 6, total: 6, accepted: manifest.accepted, blocked: manifest.blocked },
  });

  log(status === 'FAILED' ? 'RUN_FAILED' : 'RUN_COMPLETED', {
    run_id: runId, status, accepted: manifest.accepted, blocked: manifest.blocked,
  });
  return manifest;
}

// --------------------------------------------------------- standalone path

export async function runPipeline(runId) {
  try {
    await stageCrawl(runId);
    await stageBrandKit(runId);
    await stageProductIdentity(runId);
    await stagePlan(runId);
    await stageGenerateAndQA(runId);
    return await stageFinalize(runId);
  } catch (e) {
    const code = e.code ?? 'SYSTEM_ERROR';
    await recordError(runId, code, e.message);
    await updateRun(runId, {
      status: 'FAILED',
      failure_code: code,
      error: e.message,
      stage: 'Failed',
      completed_at: new Date().toISOString(),
    });
    log('RUN_FAILED', { run_id: runId, code, error: e.message, details: e.details });
    throw e;
  }
}

export { setStage, recordError, bumpUsage };
