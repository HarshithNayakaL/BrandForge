import { z } from 'zod';

export const QAResultSchema = z.object({
  product_accuracy: z.number().min(0).max(10),
  realism: z.number().min(0).max(10),
  brand_alignment: z.number().min(0).max(10),
  creative_quality: z.number().min(0).max(10),
  critical_checks: z.object({
    identity: z.boolean(),
    geometry: z.boolean(),
    color: z.boolean(),
    material: z.boolean(),
    branding: z.boolean(),
  }),
  invariant_checks: z.array(z.object({
    key: z.string(),
    pass: z.boolean(),
    note: z.string().default(''),
  })).default([]),
  issues: z.array(z.string()).default([]),
  repair_instruction: z.string().default(''),
  decision: z.enum(['PASS', 'REPAIR', 'BLOCK']),
});

/**
 * PRD 30: a beautiful image of the wrong product FAILS.
 * The model's own `decision` is advisory; deterministic rules override it.
 * Returns the final decision plus the reason it was overridden, if it was.
 */
export function applyCriticalOverride(qa, thresholds, attemptsUsed, maxRepairAttempts) {
  const hardFails = Object.entries(qa.critical_checks).filter(([, v]) => v === false).map(([k]) => k);
  const failedInvariants = (qa.invariant_checks ?? []).filter((i) => !i.pass).map((i) => i.key);

  let decision = qa.decision;
  let override = null;

  if (hardFails.length || failedInvariants.length) {
    decision = 'REPAIR';
    override = `critical identity failure: ${[...hardFails, ...failedInvariants].join(', ')}`;
  } else if (qa.product_accuracy < thresholds.product_accuracy) {
    decision = 'REPAIR';
    override = `product_accuracy ${qa.product_accuracy} < ${thresholds.product_accuracy}`;
  } else if (qa.realism < thresholds.realism || qa.brand_alignment < thresholds.brand_alignment) {
    decision = decision === 'PASS' ? 'REPAIR' : decision;
    override = `realism/brand_alignment below threshold (${qa.realism}/${qa.brand_alignment})`;
  }

  // Bound the loop: out of repairs means BLOCK, never a silent PASS.
  if (decision === 'REPAIR' && attemptsUsed >= maxRepairAttempts) {
    decision = 'BLOCK';
    override = `${override ?? 'unresolved QA failure'}; exhausted ${maxRepairAttempts} repair attempts`;
  }

  return { decision, override, hardFails, failedInvariants };
}
