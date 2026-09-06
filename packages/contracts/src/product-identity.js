import { z } from 'zod';

export const InvariantSchema = z.object({
  key: z.string(),                 // e.g. "sole_geometry"
  label: z.string(),               // human readable
  description: z.string(),         // what exactly must be preserved, from THIS image
  severity: z.enum(['CRITICAL', 'IMPORTANT']).default('CRITICAL'),
});

export const ProductIdentitySchema = z.object({
  category: z.string(),
  subcategory: z.string().default(''),
  appearance: z.object({
    colors: z.array(z.string()).default([]),
    materials: z.array(z.string()).default([]),
    texture: z.array(z.string()).default([]),
  }),
  geometry: z.record(z.string()).default({}),
  construction: z.array(z.string()).default([]),
  branding: z.array(z.object({
    type: z.enum(['logo', 'wordmark', 'text', 'label', 'none']),
    content: z.string().default(''),
    placement: z.string().default(''),
  })).default([]),
  distinctive_features: z.array(z.string()).default([]),
  /** Dynamic, category-derived invariants (PRD 20). */
  must_preserve: z.array(InvariantSchema).min(1),
  uncertain_features: z.array(z.string()).default([]),
  description_for_generation: z.string(),
  confidence: z.number().min(0).max(1).default(0.5),
});

export const StoredProductIdentitySchema = ProductIdentitySchema.extend({
  _meta: z.object({
    product_asset_id: z.string(),
    created_at: z.string(),
    model: z.string(),
  }),
});
