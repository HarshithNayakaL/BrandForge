import { z } from 'zod';

export const VisualReferenceSchema = z.object({
  reference_id: z.string(),
  image_url: z.string(),
  source_page: z.string(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  reference_type: z.enum(['product', 'campaign', 'lifestyle', 'editorial', 'detail', 'logo', 'unknown']),
  local_path: z.string().nullable().default(null),
  bytes: z.number().nullable().default(null),
  alt: z.string().default(''),
  confidence: z.number().min(0).max(1),
});

export const TextEvidenceSchema = z.object({
  source_page: z.string(),
  kind: z.enum(['title', 'meta_description', 'heading', 'copy', 'product_description', 'nav', 'category']),
  text: z.string(),
});

export const PageRecordSchema = z.object({
  url: z.string(),
  final_url: z.string(),
  status: z.number(),
  role: z.enum(['seed', 'home', 'collection', 'product', 'campaign', 'about', 'other']),
  title: z.string().default(''),
  ok: z.boolean(),
  error: z.string().nullable().default(null),
});

export const EvidenceBundleSchema = z.object({
  brand_url: z.string(),
  domain: z.string(),
  pages: z.array(PageRecordSchema),
  text_evidence: z.array(TextEvidenceSchema),
  visual_references: z.array(VisualReferenceSchema),
  logo_candidates: z.array(VisualReferenceSchema),
  product_examples: z.array(VisualReferenceSchema),
  campaign_examples: z.array(VisualReferenceSchema),
  palette: z.array(z.object({ hex: z.string(), source: z.string() })).default([]),
  crawl_metadata: z.object({
    started_at: z.string(),
    completed_at: z.string(),
    duration_ms: z.number(),
    pages_visited: z.number(),
    pages_failed: z.number(),
    images_seen: z.number(),
    images_kept: z.number(),
    truncated: z.boolean(),
    notes: z.array(z.string()).default([]),
  }),
});

/** Minimum evidence required before we are willing to spend a Gemini call. */
export function evidenceIsSufficient(ev) {
  const reasons = [];
  if (!ev?.pages?.some((p) => p.ok)) reasons.push('no pages loaded successfully');
  const visuals = (ev?.visual_references?.length ?? 0);
  if (visuals < 3) reasons.push(`only ${visuals} usable visual references (need 3)`);
  const words = (ev?.text_evidence ?? []).reduce((n, t) => n + t.text.split(/\s+/).length, 0);
  if (words < 60) reasons.push(`only ${words} words of text evidence (need 60)`);
  return { ok: reasons.length === 0, reasons };
}
