import { z } from 'zod';

export const ShotContractSchema = z.object({
  shot_id: z.string().regex(/^SHOT_\d{2}$/),
  purpose: z.string(),
  composition: z.string(),
  camera: z.string(),
  framing: z.string(),
  background: z.string(),
  lighting: z.string(),
  styling: z.string(),
  product_position: z.string(),
  reference_ids: z.array(z.string()).default([]),
  must_preserve: z.array(z.string()).default([]),   // invariant keys, resolved from ProductIdentity
  creative_freedom: z.array(z.string()).default([]),
  avoid: z.array(z.string()).default([]),
});

export const CampaignPlanSchema = z.object({
  rationale: z.string().default(''),
  shots: z.array(ShotContractSchema).length(6),
});

export const GenerationAttemptSchema = z.object({
  shot_id: z.string(),
  attempt: z.number().int().min(1),
  kind: z.enum(['INITIAL', 'REPAIR']).default('INITIAL'),
  status: z.enum(['PENDING', 'GENERATED', 'FAILED']),
  model: z.string(),
  prompt_hash: z.string().default(''),
  started_at: z.string(),
  completed_at: z.string().nullable().default(null),
  output_path: z.string().nullable().default(null),
  error: z.string().nullable().default(null),
});
