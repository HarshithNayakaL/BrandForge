import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGenerationPrompt, buildRepairPrompt } from '../services/api/src/pipeline/prompt-builder.js';

/**
 * These fixtures deliberately describe an invented category. If a prompt can
 * be built correctly for a product type nobody hardcoded, the builder is
 * genuinely brand- and category-agnostic (PRD 3, 58).
 */
const productIdentity = {
  category: 'desk lamp',
  subcategory: 'articulated task lamp',
  appearance: { colors: ['matte olive'], materials: ['powder-coated steel'], texture: ['fine matte grain'] },
  geometry: { silhouette: 'two-segment arm on a round base' },
  construction: ['exposed pivot joints'],
  branding: [{ type: 'wordmark', content: 'LUMA', placement: 'base front' }],
  distinctive_features: ['brass pivot collars'],
  must_preserve: [
    { key: 'colorway', label: 'Colourway', description: 'Matte olive body with brass collars', severity: 'CRITICAL' },
    { key: 'arm_geometry', label: 'Arm geometry', description: 'Two equal segments, 40cm each', severity: 'CRITICAL' },
    { key: 'wordmark', label: 'Wordmark', description: 'LUMA in small caps on the base front', severity: 'IMPORTANT' },
  ],
  uncertain_features: ['exact cable colour'],
  description_for_generation: 'A matte olive articulated task lamp with brass pivot collars.',
  confidence: 0.8,
};

const brandKit = {
  brand: { name: 'Testbrand', category: ['homeware'], positioning: 'quiet utility', personality: ['calm'] },
  visual_identity: {
    dominant_colors: ['#e8e4dc', '#1a1a18'], accent_colors: [],
    background_preferences: ['seamless paper'], contrast: 'low', visual_density: 'sparse',
  },
  photography_language: {
    lighting: [
      { value: 'hard directional sun', basis: 'INFERRED', evidence_refs: [] },
      { value: 'soft north light', basis: 'OBSERVED', evidence_refs: ['ref_a'] },
    ],
    backgrounds: [{ value: 'warm seamless paper', basis: 'OBSERVED', evidence_refs: ['ref_a'] }],
    camera_style: [], framing: [], composition: [],
    depth_of_field: 'deep', product_scale: 'centred, generous margin', model_usage: 'never',
    styling: [], post_processing: [],
  },
  creative_patterns: { catalog: [], editorial: [], lifestyle: [], detail: [], campaign: [] },
  brand_rules: ['product always fully in frame'],
  avoid: ['busy props'],
  confidence: {}, evidence_refs: ['ref_a'],
};

const shot = {
  shot_id: 'SHOT_03',
  purpose: 'Macro of the pivot collar',
  composition: 'tight crop on the upper joint',
  camera: '100mm macro, slightly above axis',
  framing: 'square',
  background: 'warm seamless paper falling off to shadow',
  lighting: 'single soft source camera left',
  styling: 'no props',
  product_position: 'joint occupying the middle third',
  reference_ids: ['ref_a'],
  must_preserve: ['colorway', 'arm_geometry'],
  creative_freedom: ['shadow direction', 'depth of the fall-off'],
  avoid: ['visible cable'],
};

test('generation prompt states the priority order with the product first', () => {
  const { text } = buildGenerationPrompt({ brandKit, productIdentity, shot });
  assert.match(text, /PRIORITY ORDER/);
  const productPos = text.indexOf('Product accuracy is non-negotiable');
  const brandPos = text.indexOf("The brand's visual language");
  assert.ok(productPos !== -1 && productPos < brandPos, 'product accuracy must outrank brand direction');
});

test('only the invariants this shot names are spelled out, plus their real values', () => {
  const { text } = buildGenerationPrompt({ brandKit, productIdentity, shot });
  assert.match(text, /Matte olive body with brass collars/);
  assert.match(text, /Two equal segments, 40cm each/);
  assert.doesNotMatch(text, /LUMA in small caps/, 'wordmark is not in this shot\'s must_preserve list');
});

test('observed brand claims are ranked ahead of inferred ones', () => {
  const { text } = buildGenerationPrompt({ brandKit, productIdentity, shot });
  const observed = text.indexOf('soft north light');
  const inferred = text.indexOf('hard directional sun');
  assert.ok(observed !== -1 && observed < inferred, 'evidence-backed lighting should lead');
});

test('shot direction and brand avoid-list both reach the prompt', () => {
  const { text } = buildGenerationPrompt({ brandKit, productIdentity, shot });
  assert.match(text, /100mm macro/);
  assert.match(text, /visible cable/);
  assert.match(text, /busy props/);
  assert.match(text, /any alteration to the product itself/);
});

test('ambiguous features are flagged rather than invented', () => {
  const { text } = buildGenerationPrompt({ brandKit, productIdentity, shot });
  assert.match(text, /exact cable colour/);
});

test('identical inputs hash identically; a changed shot does not', () => {
  const a = buildGenerationPrompt({ brandKit, productIdentity, shot });
  const b = buildGenerationPrompt({ brandKit, productIdentity, shot });
  const c = buildGenerationPrompt({ brandKit, productIdentity, shot: { ...shot, lighting: 'hard flash' } });
  assert.equal(a.hash, b.hash, 'prompt construction must be deterministic');
  assert.notEqual(a.hash, c.hash);
});

test('repair prompt names the specific failure and preserves what worked', () => {
  const qa = {
    product_accuracy: 4, realism: 8, brand_alignment: 8, creative_quality: 8,
    critical_checks: { identity: true, geometry: true, color: false, material: true, branding: true },
    invariant_checks: [
      { key: 'colorway', pass: false, note: 'rendered in charcoal grey instead of olive' },
      { key: 'arm_geometry', pass: true, note: '' },
    ],
    issues: ['colour drift on the body'],
    repair_instruction: 'Restore the olive body colour.',
    decision: 'REPAIR',
  };
  const { text } = buildRepairPrompt({ brandKit, productIdentity, shot, qa });

  assert.match(text, /CORRECTION PASS/);
  assert.match(text, /rendered in charcoal grey instead of olive/);
  assert.match(text, /Correct value from the reference: Matte olive body with brass collars/);
  assert.match(text, /preserve that creative direction/);
  assert.doesNotMatch(text, /Arm geometry: .*was rendered incorrectly/, 'a passing invariant must not be listed as a problem');
});

test('a repair prompt differs from the initial prompt for the same shot', () => {
  const qa = {
    product_accuracy: 4, realism: 8, brand_alignment: 8, creative_quality: 8,
    critical_checks: { identity: true, geometry: true, color: false, material: true, branding: true },
    invariant_checks: [], issues: [], repair_instruction: '', decision: 'REPAIR',
  };
  const initial = buildGenerationPrompt({ brandKit, productIdentity, shot });
  const repair = buildRepairPrompt({ brandKit, productIdentity, shot, qa });
  assert.notEqual(initial.hash, repair.hash);
});
