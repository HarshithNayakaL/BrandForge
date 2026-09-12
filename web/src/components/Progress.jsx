import { useEffect, useState } from 'react';
import { STAGES, STAGE_ORDER, fmtDuration } from '../lib/api.js';

/**
 * This is the longest-lived screen in the product: a run takes minutes. So it
 * shows the work arriving (real frames as each shot clears QA) rather than a
 * spinner. Every mark is derived from server state; nothing advances on a timer.
 */
export default function Progress({ status, error }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!status) return null;

  const current = STAGE_ORDER.indexOf(status.status);
  const failed = status.status === 'FAILED';
  const elapsed = fmtDuration(now - new Date(status.created_at ?? now).getTime());

  // Stage durations come from the event log, so they are measured, not guessed.
  const stamps = {};
  for (const e of status.events ?? []) {
    if (!stamps[e.event]) stamps[e.event] = new Date(e.at).getTime();
  }
  const spanFor = (key) => {
    const pairs = {
      CRAWLING: ['CRAWL_STARTED', 'CRAWL_COMPLETED'],
      BRAND_ANALYSIS: ['BRAND_KIT_ANALYSIS_STARTED', 'BRAND_KIT_CREATED'],
      PRODUCT_ANALYSIS: ['PRODUCT_ANALYSIS_STARTED', 'PRODUCT_ANALYZED'],
      PLANNING: ['PRODUCT_ANALYZED', 'CAMPAIGN_PLANNED'],
    }[key];
    if (!pairs) return '';
    const [a, b] = pairs.map((k) => stamps[k]);
    return a && b ? fmtDuration(b - a) : '';
  };

  const p = status.progress ?? { generated: 0, total: 6, accepted: 0, blocked: 0 };
  const total = p.total || 6;
  const byId = new Map((status.shots ?? []).map((s) => [s.shot_id, s]));
  const base = status.assets_base ?? '';

  return (
    <div>
      <div className="run-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 className="page-title">{failed ? 'Run stopped' : status.stage}</h1>
          <div className="run-meta">
            <span className="mono">{status.run_id}</span>
            {status.brand && <span className="chip chip-neutral">{status.brand}</span>}
            {status.product_category && <span className="chip chip-neutral">{status.product_category}</span>}
            <span className="mono">{elapsed} elapsed</span>
          </div>
        </div>
        {failed
          ? <span className="chip chip-danger">{status.failure_code}</span>
          : <span className="chip chip-accent"><span className="spinner" aria-hidden="true" />Running</span>}
      </div>

      {failed && (
        <p className="alert" role="alert" style={{ marginTop: 0, marginBottom: 28 }}>
          <strong>{status.failure_code}</strong> {status.error}
        </p>
      )}

      <div className="progress-grid">
        <ul className="stages" aria-live="polite">
          {STAGES.map((s) => {
            const idx = STAGE_ORDER.indexOf(s.key);
            const done = current > idx;
            const active = status.status === s.key;
            const failedHere = failed && current === idx;
            return (
              <li key={s.key} className={`stage${failedHere ? ' failed' : done ? ' done' : active ? ' active' : ''}`}>
                <span className="mark" aria-hidden="true">
                  {active && !failed && <span className="spinner" />}
                </span>
                <span>{s.label}</span>
                <span className="tail">
                  {s.key === 'GENERATING' && (active || done) ? `${p.generated}/${total}` : spanFor(s.key)}
                </span>
              </li>
            );
          })}
        </ul>

        <div>
          <div className="slot-grid">
            {Array.from({ length: total }, (_, i) => {
              const id = `SHOT_0${i + 1}`;
              const shot = byId.get(id);
              const done = Boolean(shot?.output);
              const blocked = shot && shot.status !== 'ACCEPTED';
              return (
                <div key={id} className={`slot${done ? '' : ' pending'}${blocked ? ' blocked' : ''}`}>
                  {done && <img src={base + shot.output} alt={`${id} result`} />}
                  <span className="slot-label">
                    <span>{id}</span>
                    <span>
                      {shot
                        ? (blocked ? 'blocked' : `${shot.product_accuracy ?? '–'}/10`)
                        : ''}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>

          <details className="eventlog" open>
            <summary>Event log</summary>
            <div className="lines">
              {(status.events ?? []).slice().reverse().map((e, i) => (
                <div key={i}>
                  <b>{e.at?.slice(11, 19)}</b>
                  {e.event}
                  {e.shot_id ? ` ${e.shot_id}` : ''}
                  {e.decision ? ` → ${e.decision}` : ''}
                </div>
              ))}
              {!(status.events ?? []).length && <div>waiting for the first event…</div>}
            </div>
          </details>
        </div>
      </div>

      {error && <p className="alert" role="alert">{error}</p>}
    </div>
  );
}
