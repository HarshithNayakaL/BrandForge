import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCriticalOverride } from '../packages/contracts/src/qa.js';

const T = { product_accuracy: 7, realism: 6, brand_alignment: 6 };

const base = (over = {}) => ({
  product_accuracy: 9, realism: 9, brand_alignment: 9, creative_quality: 9,
  critical_checks: { identity: true, geometry: true, color: true, material: true, branding: true },
  invariant_checks: [{ key: 'colorway', pass: true, note: '' }],
  issues: [], repair_instruction: '', decision: 'PASS',
  ...over,
});

test('a clean review passes', () => {
  const v = applyCriticalOverride(base(), T, 0, 2);
  assert.equal(v.decision, 'PASS');
  assert.equal(v.override, null);
});

test('a beautiful image of the wrong product still fails', () => {
  // Every aesthetic score is perfect and the model says PASS.
  const qa = base({ critical_checks: { identity: false, geometry: true, color: true, material: true, branding: true } });
  const v = applyCriticalOverride(qa, T, 0, 2);
  assert.equal(v.decision, 'REPAIR');
  assert.match(v.override, /critical identity failure/);
  assert.deepEqual(v.hardFails, ['identity']);
});

test('a failed invariant overrides a PASS verdict', () => {
  const qa = base({ invariant_checks: [{ key: 'sole_geometry', pass: false, note: 'sole unit replaced' }] });
  const v = applyCriticalOverride(qa, T, 0, 2);
  assert.equal(v.decision, 'REPAIR');
  assert.deepEqual(v.failedInvariants, ['sole_geometry']);
});

test('product accuracy below threshold forces a repair', () => {
  const v = applyCriticalOverride(base({ product_accuracy: 6 }), T, 0, 2);
  assert.equal(v.decision, 'REPAIR');
  assert.match(v.override, /product_accuracy 6 < 7/);
});

test('weak realism or brand alignment forces a repair', () => {
  assert.equal(applyCriticalOverride(base({ realism: 4 }), T, 0, 2).decision, 'REPAIR');
  assert.equal(applyCriticalOverride(base({ brand_alignment: 3 }), T, 0, 2).decision, 'REPAIR');
});

test('exhausted repair attempts block instead of silently shipping', () => {
  const qa = base({ critical_checks: { identity: false, geometry: true, color: true, material: true, branding: true } });
  const v = applyCriticalOverride(qa, T, 2, 2);
  assert.equal(v.decision, 'BLOCK');
  assert.match(v.override, /exhausted 2 repair attempts/);
});

test('the loop is bounded — a passing image is never blocked by the cap', () => {
  const v = applyCriticalOverride(base(), T, 5, 2);
  assert.equal(v.decision, 'PASS');
});

test('a model BLOCK verdict is honoured', () => {
  const v = applyCriticalOverride(base({ decision: 'BLOCK' }), T, 0, 2);
  assert.equal(v.decision, 'BLOCK');
});
