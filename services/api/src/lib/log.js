import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

/**
 * Structured event log. Every event carries run_id (and shot_id where it
 * applies) so a run can be reconstructed from the log alone (PRD 48).
 * Events are appended to the run's own events.ndjson as well as stdout,
 * which is what the frontend polls to render real progress.
 */
export const EVENTS = [
  'RUN_CREATED', 'INPUT_VALIDATED', 'CRAWL_STARTED', 'CRAWL_COMPLETED',
  'BRAND_CACHE_HIT', 'BRAND_KIT_CREATED', 'PRODUCT_ANALYZED', 'CAMPAIGN_PLANNED',
  'SHOT_GENERATION_STARTED', 'SHOT_GENERATED', 'SHOT_QA_STARTED', 'SHOT_QA_PASSED',
  'SHOT_QA_FAILED', 'SHOT_REPAIR_STARTED', 'SHOT_ACCEPTED', 'SHOT_BLOCKED',
  'MANIFEST_WRITTEN', 'RUN_COMPLETED', 'RUN_FAILED',
];

export function log(event, data = {}) {
  const line = { svc: 'api', event, ...data, at: new Date().toISOString() };
  console.log(JSON.stringify(line));
  if (data.run_id) {
    try {
      const dir = path.join(config.dataDir, 'runs', data.run_id);
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(path.join(dir, 'events.ndjson'), JSON.stringify(line) + '\n');
    } catch {
      // never let logging break a run
    }
  }
}
