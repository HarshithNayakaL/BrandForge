import { CampaignPlanSchema } from '@brandforge/contracts';
import { generateStructured } from '../ai/gemini.js';
import { config } from '../config.js';
import { log } from '../lib/log.js';

/**
 * The planner is the join point: it is the first stage that sees both the
 * brand and the product. It decides what six images make sense for THIS
 * pairing rather than filling a fixed template (PRD 22-23).
 */
const INSTRUCTIONS = `You are a campaign art director.

You are given a Brand Kit (how a specific brand photographs things, derived from its own website) and a Canonical Product Identity (what a specific uploaded product actually is).

Design a six-image campaign for this product, shot in this brand's visual language.

RULES

1. Decide the six shots yourself, from the product's category and the brand's creative patterns. Do not fill a fixed template. A pair of sunglasses, a moisturiser and a running shoe should each get a different six.
2. The six must be genuinely different from one another: vary distance, angle, context and purpose. A campaign of six near-identical hero shots is a failure.
3. Every shot must be physically photographable. No impossible optics, no floating products unless the brand's own evidence supports that treatment.
4. Respect the brand's rules and avoid list. If the brand never uses models, do not plan an on-model shot. If the brand's backgrounds are always seamless studio, do not plan a street scene.
5. For each shot, "must_preserve" must contain ONLY invariant keys copied verbatim from the product identity's must_preserve list — pick the ones this particular framing puts on camera. A macro detail shot should name the invariants visible at that distance.
6. "creative_freedom" states what the generator may invent for this shot (background, props, light direction, model, atmosphere). It must never include any product attribute.
7. "avoid" is shot-specific: what would ruin this particular frame.
8. shot_id values must be exactly SHOT_01 through SHOT_06 in order.
9. Write "composition", "camera", "lighting", "background", "styling", "framing" and "product_position" as concrete direction a photographer could execute, one or two sentences each.

Return ONLY JSON matching:

{
  "rationale": string,
  "shots": [
    {
      "shot_id": "SHOT_01",
      "purpose": string,
      "composition": string,
      "camera": string,
      "framing": string,
      "background": string,
      "lighting": string,
      "styling": string,
      "product_position": string,
      "reference_ids": string[],
      "must_preserve": string[],
      "creative_freedom": string[],
      "avoid": string[]
    }
    // ... exactly 6
  ]
}`;

export async function planCampaign({ brandKit, productIdentity, runId }) {
  const invariantKeys = productIdentity.must_preserve.map((i) => i.key);

  const parts = [
    { text: INSTRUCTIONS },
    { text: `\n\nBRAND KIT\n${JSON.stringify(stripMeta(brandKit), null, 2)}` },
    { text: `\n\nCANONICAL PRODUCT IDENTITY\n${JSON.stringify(stripMeta(productIdentity), null, 2)}` },
    { text: `\n\nVALID invariant keys for must_preserve (use these exact strings, nothing else):\n${JSON.stringify(invariantKeys)}` },
    { text: `\n\nAvailable brand reference ids you may cite in reference_ids:\n${JSON.stringify(brandKit.evidence_refs ?? [])}` },
  ];

  const { data, model, calls } = await generateStructured({
    parts,
    schema: CampaignPlanSchema,
    label: 'Campaign Plan',
    model: config.gemini.model,
    temperature: 0.6,
    failureCode: 'CAMPAIGN_PLANNING_FAILED',
  });

  // Deterministic clean-up: the model does not get to invent invariant keys,
  // and every shot must carry at least the CRITICAL ones.
  const criticalKeys = productIdentity.must_preserve.filter((i) => i.severity === 'CRITICAL').map((i) => i.key);
  const validRefs = new Set(brandKit.evidence_refs ?? []);

  const shots = data.shots.map((s, i) => {
    const named = s.must_preserve.filter((k) => invariantKeys.includes(k));
    return {
      ...s,
      shot_id: `SHOT_0${i + 1}`,
      must_preserve: [...new Set([...criticalKeys, ...named])],
      reference_ids: s.reference_ids.filter((r) => validRefs.has(r)),
    };
  });

  const plan = { rationale: data.rationale, shots };
  log('CAMPAIGN_PLANNED', {
    run_id: runId,
    shots: shots.map((s) => `${s.shot_id}:${s.purpose.slice(0, 40)}`),
    model,
  });

  return { plan, geminiCalls: calls };
}

function stripMeta(obj) {
  const { _meta, ...rest } = obj;
  return rest;
}
