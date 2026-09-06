import { z } from 'zod';

const Claim = z.object({
  value: z.string(),
  basis: z.enum(['OBSERVED', 'INFERRED']),
  evidence_refs: z.array(z.string()).default([]),
});

/** Accept either a bare string or a {value, basis} claim; normalise to a claim. */
const claim = z.union([z.string(), Claim]).transform((v) =>
  typeof v === 'string' ? { value: v, basis: 'INFERRED', evidence_refs: [] } : v
);
const claims = z.array(claim).default([]);

export const BrandKitSchema = z.object({
  brand: z.object({
    name: z.string(),
    category: z.array(z.string()).default([]),
    positioning: z.string().default(''),
    personality: z.array(z.string()).default([]),
  }),
  visual_identity: z.object({
    dominant_colors: z.array(z.string()).default([]),
    accent_colors: z.array(z.string()).default([]),
    background_preferences: z.array(z.string()).default([]),
    contrast: z.string().default(''),
    visual_density: z.string().default(''),
  }),
  photography_language: z.object({
    lighting: claims,
    backgrounds: claims,
    camera_style: claims,
    framing: claims,
    composition: claims,
    depth_of_field: z.string().default(''),
    product_scale: z.string().default(''),
    model_usage: z.string().default(''),
    styling: claims,
    post_processing: claims,
  }),
  creative_patterns: z.object({
    catalog: z.array(z.string()).default([]),
    editorial: z.array(z.string()).default([]),
    lifestyle: z.array(z.string()).default([]),
    detail: z.array(z.string()).default([]),
    campaign: z.array(z.string()).default([]),
  }),
  brand_rules: z.array(z.string()).default([]),
  avoid: z.array(z.string()).default([]),
  confidence: z.record(z.number().min(0).max(1)).default({}),
  evidence_refs: z.array(z.string()).default([]),
});

/** Metadata the pipeline attaches; not produced by the model. */
export const StoredBrandKitSchema = BrandKitSchema.extend({
  _meta: z.object({
    brand_id: z.string(),
    brand_url: z.string(),
    brand_profile_version: z.string(),
    created_at: z.string(),
    model: z.string(),
    evidence_page_count: z.number(),
    evidence_image_count: z.number(),
  }),
});
