import { QAResultSchema, applyCriticalOverride } from '@brandforge/contracts';
import { generateStructured, imagePart } from '../ai/gemini.js';
import { config } from '../config.js';
import { log } from '../lib/log.js';

/**
 * Generated output is treated as untrusted until verified (PRD 52).
 * The model scores it; deterministic rules in applyCriticalOverride decide.
 */
const INSTRUCTIONS = `You are a quality-control reviewer for a commercial photography studio. You are strict. Your job is to catch product inaccuracies that a casual viewer would miss but a buyer would not.

You are given:
  IMAGE A — the original reference photograph of the real product (ground truth)
  IMAGE B — a generated campaign image that is supposed to show the SAME product
  plus the product's canonical identity, the shot's brief, and the brand's rules.

Compare B against A attribute by attribute.

RULES

1. A beautiful image of the wrong product is a FAILURE. Aesthetics never compensate for a product mismatch.
2. For every invariant listed in the product identity, decide pass/fail and say what you actually see in B. Populate "invariant_checks" with one entry per invariant key given to you, using the exact keys.
3. "critical_checks" is a summary: identity (is this recognisably the same item), geometry (shape/proportion), color, material, branding (logos/text present, correct and correctly placed). Set false the moment there is a visible discrepancy. If the product carries no branding, branding passes when B has also not invented any.
4. Score 0-10:
   - product_accuracy: how faithfully B reproduces the product in A
   - realism: does it read as a real photograph (check for AI artefacts, warped geometry, impossible reflections, melted edges, duplicated parts)
   - brand_alignment: does it obey the brand's visual language and rules
   - creative_quality: is it a good commercial image, and does it fulfil the shot brief
5. "issues" lists concrete defects, each naming what is wrong and where.
6. "repair_instruction" is a single actionable paragraph telling the generator exactly what to change and what to leave alone. Reference the correct values from IMAGE A. Leave it empty only when decision is PASS.
7. "decision": PASS when the product is faithfully reproduced and the image is usable; REPAIR when the composition is worth saving but the product or realism needs correcting; BLOCK only when the result is unusable and unlikely to be fixable by regeneration.

Return ONLY JSON matching:

{
  "product_accuracy": number, "realism": number, "brand_alignment": number, "creative_quality": number,
  "critical_checks": { "identity": boolean, "geometry": boolean, "color": boolean, "material": boolean, "branding": boolean },
  "invariant_checks": [{ "key": string, "pass": boolean, "note": string }],
  "issues": string[],
  "repair_instruction": string,
  "decision": "PASS" | "REPAIR" | "BLOCK"
}`;

export async function reviewShot({
  productImage,      // { buffer, mime }
  generatedImage,    // { buffer, mime }
  productIdentity,
  brandKit,
  shot,
  repairAttemptsUsed = 0,
  runId,
}) {
  const relevant = productIdentity.must_preserve.filter((i) => (shot.must_preserve ?? []).includes(i.key));
  const invariants = relevant.length ? relevant : productIdentity.must_preserve;

  const parts = [
    { text: INSTRUCTIONS },
    { text: '\n\nIMAGE A — ORIGINAL PRODUCT (GROUND TRUTH):' },
    imagePart(productImage.buffer, productImage.mime),
    { text: '\n\nIMAGE B — GENERATED CAMPAIGN IMAGE UNDER REVIEW:' },
    imagePart(generatedImage.buffer, generatedImage.mime),
    { text: `\n\nPRODUCT IDENTITY\n${JSON.stringify({
      category: productIdentity.category,
      subcategory: productIdentity.subcategory,
      appearance: productIdentity.appearance,
      geometry: productIdentity.geometry,
      branding: productIdentity.branding,
      distinctive_features: productIdentity.distinctive_features,
      uncertain_features: productIdentity.uncertain_features,
    }, null, 2)}` },
    { text: `\n\nINVARIANTS TO CHECK (return one invariant_checks entry per key)\n${JSON.stringify(invariants, null, 2)}` },
    { text: `\n\nSHOT BRIEF\n${JSON.stringify(shot, null, 2)}` },
    { text: `\n\nBRAND RULES\n${JSON.stringify({ rules: brandKit.brand_rules, avoid: brandKit.avoid, photography: brandKit.photography_language }, null, 2)}` },
  ];

  log('SHOT_QA_STARTED', { run_id: runId, shot_id: shot.shot_id });

  const { data, calls } = await generateStructured({
    parts,
    schema: QAResultSchema,
    label: 'QA Result',
    model: config.gemini.visionModel,
    temperature: 0.1,
    failureCode: 'QA_FAILED',
  });

  // Guarantee an entry for every invariant we asked about, so a silently
  // omitted check can never be read as a pass.
  const byKey = new Map(data.invariant_checks.map((c) => [c.key, c]));
  const checks = invariants.map((i) => byKey.get(i.key) ?? { key: i.key, pass: false, note: 'reviewer did not report on this invariant' });

  const qa = { ...data, invariant_checks: checks };
  const verdict = applyCriticalOverride(qa, config.qaThresholds, repairAttemptsUsed, config.generation.maxRepairAttempts);

  const final = { ...qa, decision: verdict.decision };
  if (verdict.override) {
    final.issues = [...new Set([...final.issues, `[override] ${verdict.override}`])];
  }

  log(final.decision === 'PASS' ? 'SHOT_QA_PASSED' : 'SHOT_QA_FAILED', {
    run_id: runId,
    shot_id: shot.shot_id,
    decision: final.decision,
    model_decision: data.decision,
    override: verdict.override,
    product_accuracy: final.product_accuracy,
    failed_invariants: verdict.failedInvariants,
  });

  return { qa: final, geminiCalls: calls, verdict };
}
