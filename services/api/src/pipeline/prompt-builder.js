import crypto from 'node:crypto';

/**
 * Prompts are COMPOSED, never handwritten per brand or per shot (PRD 25).
 * Each block below is a reusable component; the same code path produces the
 * prompt for a skincare jar on a minimal D2C brand and a boot on a heritage
 * outdoor brand. Nothing here knows any brand or category name.
 */

const claimValues = (arr, n = 4) =>
  (arr ?? []).map((c) => (typeof c === 'string' ? c : c.value)).filter(Boolean).slice(0, n);

/** Observed claims outrank inferred ones when we have to choose. */
const rankedClaims = (arr, n = 4) => {
  const list = (arr ?? []).map((c) => (typeof c === 'string' ? { value: c, basis: 'INFERRED' } : c));
  const observed = list.filter((c) => c.basis === 'OBSERVED').map((c) => c.value);
  const inferred = list.filter((c) => c.basis !== 'OBSERVED').map((c) => c.value);
  return [...observed, ...inferred].filter(Boolean).slice(0, n);
};

function bullets(lines) {
  return lines.filter(Boolean).map((l) => `- ${l}`).join('\n');
}

function productBlock(productIdentity, shot) {
  const keys = new Set(shot.must_preserve ?? []);
  const invariants = productIdentity.must_preserve.filter((i) => keys.has(i.key));
  const chosen = invariants.length ? invariants : productIdentity.must_preserve;

  return [
    'THE PRODUCT (NON-NEGOTIABLE)',
    '',
    'The first supplied image is the real product. It is the ground truth. Reproduce it exactly as it appears there.',
    '',
    productIdentity.description_for_generation,
    '',
    'These attributes must survive unchanged in the output:',
    bullets(chosen.map((i) => `${i.label}: ${i.description}${i.severity === 'CRITICAL' ? '  [CRITICAL]' : ''}`)),
    productIdentity.uncertain_features?.length
      ? `\nDo not invent detail for these ambiguous areas — keep them as they appear in the reference: ${productIdentity.uncertain_features.join('; ')}.`
      : '',
  ].filter(Boolean).join('\n');
}

function brandBlock(brandKit) {
  const p = brandKit.photography_language;
  return [
    'BRAND VISUAL LANGUAGE',
    '',
    bullets([
      p.lighting?.length && `Lighting: ${rankedClaims(p.lighting).join('; ')}`,
      p.backgrounds?.length && `Backgrounds: ${rankedClaims(p.backgrounds).join('; ')}`,
      p.camera_style?.length && `Camera: ${rankedClaims(p.camera_style).join('; ')}`,
      p.composition?.length && `Composition: ${rankedClaims(p.composition).join('; ')}`,
      p.styling?.length && `Styling: ${rankedClaims(p.styling).join('; ')}`,
      p.post_processing?.length && `Finish: ${rankedClaims(p.post_processing).join('; ')}`,
      p.depth_of_field && `Depth of field: ${p.depth_of_field}`,
      p.product_scale && `Product scale in frame: ${p.product_scale}`,
      p.model_usage && `Use of models: ${p.model_usage}`,
      brandKit.visual_identity.dominant_colors?.length &&
        `Palette: ${brandKit.visual_identity.dominant_colors.slice(0, 5).join(', ')}`,
      brandKit.visual_identity.background_preferences?.length &&
        `Preferred backgrounds: ${brandKit.visual_identity.background_preferences.slice(0, 4).join(', ')}`,
      brandKit.visual_identity.contrast && `Contrast: ${brandKit.visual_identity.contrast}`,
    ]),
    brandKit.brand_rules?.length ? `\nBrand rules:\n${bullets(brandKit.brand_rules.slice(0, 8))}` : '',
  ].filter(Boolean).join('\n');
}

function shotBlock(shot) {
  return [
    `THIS SHOT — ${shot.shot_id}: ${shot.purpose}`,
    '',
    bullets([
      `Composition: ${shot.composition}`,
      `Camera: ${shot.camera}`,
      `Framing: ${shot.framing}`,
      `Background: ${shot.background}`,
      `Lighting: ${shot.lighting}`,
      `Styling: ${shot.styling}`,
      `Product position: ${shot.product_position}`,
    ]),
    shot.creative_freedom?.length
      ? `\nYou may freely invent: ${shot.creative_freedom.join('; ')}.`
      : '',
  ].filter(Boolean).join('\n');
}

function avoidBlock(brandKit, shot) {
  const items = [
    ...(shot.avoid ?? []),
    ...(brandKit.avoid ?? []).slice(0, 6),
    'any alteration to the product itself',
    'text, watermarks, logos or graphics that are not physically part of the product',
    'distorted, duplicated or anatomically impossible detail',
    'a visibly synthetic, over-smoothed or plastic rendering',
  ];
  return `DO NOT INCLUDE\n\n${bullets([...new Set(items)])}`;
}

const PRIORITY_HEADER = `Produce one photorealistic commercial product photograph.

PRIORITY ORDER — resolve every conflict in this order:
1. The product in the first supplied image must be reproduced exactly. Product accuracy is non-negotiable.
2. The brand's visual language.
3. This shot's creative direction.
4. Your own aesthetic judgement.

If the shot direction cannot be executed without changing the product, change the shot, never the product.`;

export function buildGenerationPrompt({ brandKit, productIdentity, shot, referenceNote }) {
  const text = [
    PRIORITY_HEADER,
    '',
    productBlock(productIdentity, shot),
    '',
    brandBlock(brandKit),
    '',
    shotBlock(shot),
    '',
    referenceNote ? `${referenceNote}\n` : '',
    avoidBlock(brandKit, shot),
    '',
    'Output: a single finished photograph, no borders, no collage, no text overlay.',
  ].filter((s) => s !== null && s !== undefined).join('\n');

  return { text, hash: crypto.createHash('sha256').update(text).digest('hex').slice(0, 16) };
}

/**
 * A repair prompt keeps everything that worked and names precisely what
 * broke, so the regeneration is corrective rather than a fresh roll of the
 * dice (PRD 32).
 */
export function buildRepairPrompt({ brandKit, productIdentity, shot, qa, referenceNote }) {
  const failedKeys = (qa.invariant_checks ?? []).filter((c) => !c.pass);
  const failedChecks = Object.entries(qa.critical_checks ?? {}).filter(([, v]) => !v).map(([k]) => k);

  const corrections = [
    ...failedKeys.map((c) => {
      const inv = productIdentity.must_preserve.find((i) => i.key === c.key);
      return `${inv?.label ?? c.key}: ${c.note || 'was rendered incorrectly'}. Correct value from the reference: ${inv?.description ?? 'see the first supplied image'}.`;
    }),
    ...failedChecks.map((k) => `The ${k} of the product does not match the reference image and must be corrected.`),
    ...(qa.issues ?? []).slice(0, 6),
  ];

  const text = [
    PRIORITY_HEADER,
    '',
    'THIS IS A CORRECTION PASS.',
    '',
    'A previous attempt at this shot was rejected by quality control. The composition, lighting and background of that attempt were acceptable — preserve that creative direction. Fix only the product fidelity problems listed below.',
    '',
    'PROBLEMS TO FIX',
    '',
    bullets(corrections.length ? corrections : ['The product did not match the reference image closely enough.']),
    qa.repair_instruction ? `\nReviewer note: ${qa.repair_instruction}` : '',
    '',
    productBlock(productIdentity, shot),
    '',
    brandBlock(brandKit),
    '',
    shotBlock(shot),
    '',
    referenceNote ? `${referenceNote}\n` : '',
    avoidBlock(brandKit, shot),
    '',
    'Output: a single corrected photograph, no borders, no collage, no text overlay.',
  ].filter(Boolean).join('\n');

  return { text, hash: crypto.createHash('sha256').update(text).digest('hex').slice(0, 16) };
}

export { claimValues, rankedClaims };
