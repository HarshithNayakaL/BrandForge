import { ProductIdentitySchema, StoredProductIdentitySchema } from '@brandforge/contracts';
import { generateStructured, imagePart } from '../ai/gemini.js';
import { config } from '../config.js';
import { log } from '../lib/log.js';

/**
 * The product is analysed with NO knowledge of the brand. Keeping these two
 * analyses independent is what stops brand styling from leaking into the
 * description of what the product actually is (PRD 18).
 */
const INSTRUCTIONS = `You are a product forensics analyst working for a commercial photography studio.

You will be given ONE photograph of a physical product. That photograph is the sole ground truth about this product.

Produce a canonical, factual description precise enough that another artist could re-render this exact product from your description alone and a buyer would recognise it as the same item.

RULES

1. Describe only what is visible. Never guess a brand, model name, price or material you cannot see. Anything you are unsure about goes in "uncertain_features", not into the confident fields.
2. First determine the product category yourself from the image. Do not assume a category.
3. Then derive the invariants for THAT category — the specific attributes which, if altered, would make this a different product to a buyer. Put them in "must_preserve".
   Each invariant needs a stable snake_case "key", a short "label", and a "description" that states the concrete observed value from THIS image (not a generic instruction).
   Bad:  { "key": "color", "description": "Keep the colour accurate." }
   Good: { "key": "colorway", "description": "Matte charcoal-grey body with a single warm brass ring at the base; no secondary colours anywhere." }
   Derive between 5 and 10 invariants appropriate to the category. A watch, a sneaker, a jar of moisturiser and a jacket each need different ones.
4. Mark an invariant CRITICAL when changing it makes the image unusable, IMPORTANT when it degrades but does not invalidate it.
5. "geometry" is a free-form object of measured/relative proportions you can see, e.g. { "silhouette": "...", "aspect_ratio": "roughly 3:2 wider than tall", "profile": "..." }.
6. "branding" records every logo, wordmark or printed text visible, with its exact content and placement. If none is visible, return a single entry with type "none".
7. "description_for_generation" is a single dense paragraph (60-120 words) describing the product exactly, written to be pasted into an image-generation prompt. No brand names you cannot see, no marketing language, no scene or background — the product only.
8. "confidence" is 0-1 for how clearly the photograph reveals the product.

Return ONLY JSON matching:

{
  "category": string,
  "subcategory": string,
  "appearance": { "colors": string[], "materials": string[], "texture": string[] },
  "geometry": { [key: string]: string },
  "construction": string[],
  "branding": [{ "type": "logo"|"wordmark"|"text"|"label"|"none", "content": string, "placement": string }],
  "distinctive_features": string[],
  "must_preserve": [{ "key": string, "label": string, "description": string, "severity": "CRITICAL"|"IMPORTANT" }],
  "uncertain_features": string[],
  "description_for_generation": string,
  "confidence": number
}`;

export async function analyzeProduct({ buffer, mime, productAssetId, runId }) {
  log('PRODUCT_ANALYSIS_STARTED', { run_id: runId, product_asset_id: productAssetId, bytes: buffer.byteLength });

  const parts = [
    { text: INSTRUCTIONS },
    { text: '\n\nPRODUCT PHOTOGRAPH:' },
    imagePart(buffer, mime),
  ];

  const { data, model, calls } = await generateStructured({
    parts,
    schema: ProductIdentitySchema,
    label: 'Product Identity',
    model: config.gemini.visionModel,
    temperature: 0.15,
    failureCode: 'PRODUCT_ANALYSIS_FAILED',
  });

  const stored = StoredProductIdentitySchema.parse({
    ...data,
    _meta: {
      product_asset_id: productAssetId,
      created_at: new Date().toISOString(),
      model,
    },
  });

  log('PRODUCT_ANALYZED', {
    run_id: runId,
    category: stored.category,
    invariants: stored.must_preserve.map((i) => i.key),
    confidence: stored.confidence,
  });

  return { productIdentity: stored, geminiCalls: calls };
}
