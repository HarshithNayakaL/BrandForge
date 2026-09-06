import { useEffect, useState } from 'react';
import { STAGES, STAGE_ORDER, fmtDuration } from '../lib/api.js';

/**
 * Every mark below is derived from the run's real status and its event log.
 * Stages ahead of the server are never shown as done, and no timer advances
 * the display on its own.
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
  const slots = Array.from({ length: p.total || 6 }, (_, i) => i);

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
        {!failed && <span className="chip chip-accent"><span className="spinner" aria-hidden="true" />Running</span>}
        {failed && <span className="chip chip-danger">{status.failure_code}</span>}
      </div>

      {failed && (
        <p className="alert" role="alert" style={{ marginBottom: 28, marginTop: 0 }}>
          <strong>{status.failure_code}</strong> {status.error}
        </p>
      )}

      <div className="progress-grid">
        <ul className="stages" aria-live="polite">
          {STAGES.map((s) => {
            const idx = STAGE_ORDER.indexOf(s.key);
            const done = current > idx;
            const active = status.status === s.key;
            const isFailedHere = failed && current === idx;
            return (
              <li key={s.key} className={`stage${isFailedHere ? ' failed' : done ? ' done' : active ? ' active' : ''}`}>
                <span className="mark" aria-hidden="true">
                  {active && !failed && <span className="spinner" />}
                </span>
                <span>{s.label}</span>
                <span className="tail">
                  {s.key === 'GENERATING' && (active || done) ? `${p.generated}/${p.total}` : spanFor(s.key)}
                </span>
              </li>
            );
          })}
        </ul>

        <div>
          <div className="slot-grid">
            {slots.map((i) => {
              const filled = i < p.generated;
              return (
                <div key={i} className={`slot${filled ? '' : ' pending'}`}>
                  <span className="slot-label">
                    SHOT_0{i + 1}{filled ? ' · done' : ''}
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
