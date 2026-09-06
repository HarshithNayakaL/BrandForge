import { BrandKitSchema, StoredBrandKitSchema, evidenceIsSufficient } from '@brandforge/contracts';
import { generateStructured, fetchImagePart, ModelError } from '../ai/gemini.js';
import { config, BRAND_PROFILE_VERSION } from '../config.js';
import { brandIdFromUrl, putCachedBrandKit } from '../lib/store.js';
import { log } from '../lib/log.js';

const MAX_VISION_REFS = 10;

/**
 * Compact the evidence before it reaches the model. We send a curated,
 * source-attributed digest — never a raw site dump (PRD 12).
 */
function digestEvidence(ev) {
  const byKind = (k) => ev.text_evidence.filter((t) => t.kind === k).map((t) => t.text);
  const uniq = (a, n) => [...new Set(a)].slice(0, n);

  return {
    domain: ev.domain,
    pages_sampled: ev.pages.filter((p) => p.ok).map((p) => ({ url: p.final_url, role: p.role, title: p.title })),
    titles: uniq(byKind('title'), 12),
    meta_descriptions: uniq(byKind('meta_description'), 8),
    headings: uniq(byKind('heading'), 30),
    copy: uniq(byKind('copy'), 20).map((t) => t.slice(0, 400)),
    navigation_terms: uniq(byKind('nav'), 40),
    categories: uniq(byKind('category'), 25),
    product_descriptions: uniq(byKind('product_description'), 10).map((t) => t.slice(0, 500)),
    sampled_palette: ev.palette.map((p) => p.hex),
    reference_counts: {
      product: ev.product_examples.length,
      campaign: ev.campaign_examples.length,
      logo: ev.logo_candidates.length,
      total: ev.visual_references.length,
    },
  };
}

const SYSTEM_INSTRUCTIONS = `You are a brand visual-systems analyst.

You will be given (a) a compacted textual digest of a brand's own website and (b) a set of images taken from that website, each labelled with a reference id and the page it came from.

Your job is to produce a structured Brand Kit that a downstream image-generation system will use to make new campaign photography for this brand.

RULES

1. Work only from the supplied evidence. Do not use outside knowledge about the brand, even if you recognise it. If the evidence does not support a claim, say so through low confidence rather than inventing detail.
2. Separate OBSERVATION from INFERENCE. For every claim in photography_language, set "basis" to "OBSERVED" when you can point at specific supplied images or text, and "INFERRED" when you are generalising. Cite the reference ids you relied on in "evidence_refs".
3. Describe the brand's PHOTOGRAPHY LANGUAGE concretely and reusably: how it lights products, what backgrounds it uses, typical camera distance and angle, how much negative space, whether models appear and how they are styled, colour grading and retouching character.
4. Be category-agnostic. Do not assume the brand's sector; derive it from evidence.
5. "brand_rules" are positive constraints any new image for this brand must satisfy. "avoid" lists what would look off-brand. Both must be specific and actionable for a photographer, not marketing adjectives.
6. "confidence" maps section names (brand, visual_identity, photography_language, creative_patterns) to a number 0-1 reflecting how well the evidence supported that section.

Return ONLY JSON matching this shape:

{
  "brand": { "name": string, "category": string[], "positioning": string, "personality": string[] },
  "visual_identity": {
    "dominant_colors": string[], "accent_colors": string[], "background_preferences": string[],
    "contrast": string, "visual_density": string
  },
  "photography_language": {
    "lighting": Claim[], "backgrounds": Claim[], "camera_style": Claim[], "framing": Claim[],
    "composition": Claim[], "depth_of_field": string, "product_scale": string, "model_usage": string,
    "styling": Claim[], "post_processing": Claim[]
  },
  "creative_patterns": {
    "catalog": string[], "editorial": string[], "lifestyle": string[], "detail": string[], "campaign": string[]
  },
  "brand_rules": string[],
  "avoid": string[],
  "confidence": { [section: string]: number },
  "evidence_refs": string[]
}

where Claim = { "value": string, "basis": "OBSERVED" | "INFERRED", "evidence_refs": string[] }`;

export async function buildBrandKit(evidence, { runId } = {}) {
  const sufficiency = evidenceIsSufficient(evidence);
  if (!sufficiency.ok) {
    throw new ModelError('INSUFFICIENT_BRAND_EVIDENCE',
      `Not enough evidence to build a brand profile: ${sufficiency.reasons.join('; ')}`,
      { reasons: sufficiency.reasons });
  }

  // Pick a spread across reference types so the model sees the brand's range,
  // not ten near-duplicate product shots.
  const pick = [];
  const takeFrom = (arr, n) => { for (const r of arr.slice(0, n)) if (!pick.find((p) => p.reference_id === r.reference_id)) pick.push(r); };
  takeFrom(evidence.logo_candidates, 1);
  takeFrom(evidence.campaign_examples, 4);
  takeFrom(evidence.product_examples, 4);
  takeFrom(evidence.visual_references, MAX_VISION_REFS);

  const parts = [{ text: SYSTEM_INSTRUCTIONS }];
  parts.push({ text: `\n\nTEXTUAL EVIDENCE DIGEST\n${JSON.stringify(digestEvidence(evidence), null, 2)}` });

  const included = [];
  for (const ref of pick.slice(0, MAX_VISION_REFS)) {
    const fetched = await fetchImagePart(ref.image_url);
    if (!fetched) continue;
    parts.push({ text: `\nIMAGE ${ref.reference_id} — type=${ref.reference_type}, from ${ref.source_page}${ref.alt ? `, alt="${ref.alt}"` : ''}` });
    parts.push(fetched.part);
    included.push(ref.reference_id);
  }

  if (included.length < 2) {
    throw new ModelError('INSUFFICIENT_BRAND_EVIDENCE',
      `Only ${included.length} brand reference images could be downloaded for analysis`, { included });
  }

  log('BRAND_KIT_ANALYSIS_STARTED', { run_id: runId, images: included.length, pages: evidence.crawl_metadata.pages_visited });

  const { data, model, calls } = await generateStructured({
    model: config.gemini.visionModel,
    parts,
    schema: BrandKitSchema,
    label: 'Brand Kit',
    temperature: 0.25,
    failureCode: 'BRAND_ANALYSIS_FAILED',
  });

  const brandId = brandIdFromUrl(evidence.brand_url);
  const stored = StoredBrandKitSchema.parse({
    ...data,
    // Model-supplied refs are unreliable; intersect with what we actually sent.
    evidence_refs: [...new Set([...(data.evidence_refs ?? []), ...included])].filter((r) => included.includes(r)),
    _meta: {
      brand_id: brandId,
      brand_url: evidence.brand_url,
      brand_profile_version: BRAND_PROFILE_VERSION,
      created_at: new Date().toISOString(),
      model,
      evidence_page_count: evidence.crawl_metadata.pages_visited,
      evidence_image_count: included.length,
    },
  });

  await putCachedBrandKit(brandId, stored);
  log('BRAND_KIT_CREATED', { run_id: runId, brand_id: brandId, brand: stored.brand.name, gemini_calls: calls });

  return { brandKit: stored, geminiCalls: calls, referencesUsed: included };
}
