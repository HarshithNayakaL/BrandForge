import { ManifestSchema } from '@brandforge/contracts';
import { writeRunArtifact } from '../lib/store.js';
import { config, WORKFLOW_VERSION, BRAND_PROFILE_VERSION } from '../config.js';
import { log } from '../lib/log.js';

export function buildManifest({ state, brandKit, productIdentity, plan, shotResults }) {
  const shots = plan.shots.map((contract) => {
    const r = shotResults.find((x) => x.shot_id === contract.shot_id);
    return {
      shot_id: contract.shot_id,
      purpose: contract.purpose,
      status: r?.status ?? 'FAILED',
      contract,
      generation_attempts: r?.attempts ?? [],
      repair_attempts: r?.repair_attempts ?? 0,
      output: r?.output ?? null,
      qa: r?.qa ?? null,
      qa_history: r?.qa_history ?? [],
      failure_reason: r?.failure_reason ?? null,
    };
  });

  const accepted = shots.filter((s) => s.status === 'ACCEPTED').length;
  const blocked = shots.filter((s) => s.status !== 'ACCEPTED').length;

  return ManifestSchema.parse({
    run_id: state.run_id,
    workflow_version: WORKFLOW_VERSION,
    brand_profile_version: BRAND_PROFILE_VERSION,
    brand: brandKit.brand.name,
    brand_url: state.input.brand_url,
    brand_id: brandKit._meta.brand_id,
    product_category: productIdentity.category,
    product_asset_id: state.input.product_asset_id,
    models: {
      brand_intelligence: brandKit._meta.model,
      product_intelligence: productIdentity._meta.model,
      planner: config.gemini.model,
      image: config.openai.imageModel,
      qa: config.gemini.visionModel,
    },
    timestamps: {
      created_at: state.created_at,
      completed_at: new Date().toISOString(),
    },
    usage: state.usage,
    status: accepted === 6 ? 'COMPLETED' : accepted === 0 ? 'FAILED' : 'PARTIAL',
    accepted,
    blocked,
    shots,
    errors: state.errors ?? [],
  });
}

export async function writeManifest(runId, manifest) {
  await writeRunArtifact(runId, 'manifest.json', manifest);
  log('MANIFEST_WRITTEN', { run_id: runId, status: manifest.status, accepted: manifest.accepted, blocked: manifest.blocked });
  return manifest;
}
