import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

const CHIP = { COMPLETED: 'chip-ok', PARTIAL: 'chip-warn', FAILED: 'chip-danger' };

export default function History({ onOpen, onNew }) {
  const [runs, setRuns] = useState(null);

  useEffect(() => {
    api.runs().then((r) => setRuns(r.runs)).catch(() => setRuns([]));
  }, []);

  if (runs === null) {
    return (
      <div className="empty">
        <span className="spinner" aria-hidden="true" /> Loading runs
      </div>
    );
  }

  if (!runs.length) {
    return (
      <div>
        <h1 className="page-title">Run history</h1>
        <div className="empty panel" style={{ marginTop: 24 }}>
          <p className="h3">No campaigns yet</p>
          <p style={{ maxWidth: '46ch', margin: '0 auto 18px' }}>
            Every run is kept here with its brand profile, shot plan, generated images and QA
            verdicts, so you can reopen and compare them later.
          </p>
          <button className="btn btn-primary" onClick={onNew}>Start the first campaign</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="page-title">Run history</h1>
      <div className="run-meta" style={{ marginBottom: 24 }}>
        <span className="mono">{runs.length} run{runs.length === 1 ? '' : 's'}</span>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>Brand</th><th>Product</th><th>Started</th><th>Status</th><th>Accepted</th><th>Blocked</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.run_id} onClick={() => onOpen(r.run_id)} tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') onOpen(r.run_id); }}>
              <td className="c-brand">
                <div className="primary">{r.brand ?? new URL(r.brand_url).hostname}</div>
                <div className="mono">{r.run_id}</div>
              </td>
              <td className="c-product">{r.product_category ?? '—'}</td>
              <td className="c-date mono">{r.created_at.slice(0, 16).replace('T', ' ')}</td>
              <td className="c-status"><span className={`chip ${CHIP[r.status] ?? 'chip-neutral'}`}>{r.status}</span></td>
              <td className="c-counts" data-l="accepted">{r.accepted ?? 0}</td>
              <td className="c-blocked" data-l="blocked">{r.blocked ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
