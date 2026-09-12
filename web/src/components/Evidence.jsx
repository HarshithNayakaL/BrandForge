import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

const ROLE_ORDER = ['seed', 'home', 'collection', 'product', 'campaign', 'about', 'other'];
const TYPES = ['all', 'product', 'campaign', 'lifestyle', 'editorial', 'detail', 'logo', 'unknown'];

const claimText = (c) => (typeof c === 'string' ? { value: c, basis: 'INFERRED', evidence_refs: [] } : c);

/**
 * Shows exactly what the crawler took off the brand's site, so a user can
 * check the brand profile against its sources rather than trusting it
 * (PRD 13, 15).
 */
export default function Evidence({ runId, brandKit }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    let cancelled = false;
    api.evidence(runId)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setErr(e.message); });
    return () => { cancelled = true; };
  }, [runId]);

  if (err) {
    return (
      <div className="empty panel">
        <p className="h3">No crawl evidence</p>
        <p>{err}</p>
      </div>
    );
  }
  if (!data) return <div className="empty"><span className="spinner" aria-hidden="true" /> Loading evidence</div>;

  const { evidence: ev, assets_base: base } = data;
  const meta = ev.crawl_metadata;
  const refs = filter === 'all'
    ? ev.visual_references
    : ev.visual_references.filter((r) => r.reference_type === filter);

  const counts = ev.visual_references.reduce((m, r) => ({ ...m, [r.reference_type]: (m[r.reference_type] ?? 0) + 1 }), {});
  const savedCount = ev.visual_references.filter((r) => r.local_path).length;

  const pages = [...ev.pages].sort(
    (a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));

  const byKind = (k) => ev.text_evidence.filter((t) => t.kind === k);

  return (
    <div className="evidence">
      <div className="stats">
        <div><span className="label">Pages read</span><span className="val">{meta.pages_visited}</span></div>
        <div><span className="label">Images seen</span><span className="val">{meta.images_seen}</span></div>
        <div><span className="label">Kept after filtering</span><span className="val">{meta.images_kept}</span></div>
        <div><span className="label">Saved locally</span><span className="val">{savedCount}</span></div>
        <div><span className="label">Text snippets</span><span className="val">{ev.text_evidence.length}</span></div>
        <div><span className="label">Crawl time</span><span className="val">{(meta.duration_ms / 1000).toFixed(1)}<small>s</small></span></div>
      </div>

      {meta.pages_failed > 0 && (
        <p className="sub" style={{ marginBottom: 20 }}>
          {meta.pages_failed} page{meta.pages_failed === 1 ? '' : 's'} could not be read.
          {meta.truncated ? ' The crawl also hit its page or time limit.' : ''}
        </p>
      )}

      <section className="ev-section">
        <div className="ev-head">
          <h2 className="h2">Reference images</h2>
          <div className="filters">
            {TYPES.filter((t) => t === 'all' || counts[t]).map((t) => (
              <button
                key={t}
                className={`filter${filter === t ? ' on' : ''}`}
                onClick={() => setFilter(t)}
                aria-pressed={filter === t}
              >
                {t}{t !== 'all' && <span className="n">{counts[t]}</span>}
              </button>
            ))}
          </div>
        </div>

        {refs.length === 0 && <p className="sub">No references of this type.</p>}

        <div className="ref-grid">
          {refs.map((r) => (
            <figure key={r.reference_id} className="ref">
              <div className="ref-frame">
                {r.local_path
                  ? <img
                      src={base + r.local_path}
                      alt={r.alt || r.reference_type}
                      loading="lazy"
                      decoding="async"
                      width={r.width ?? undefined}
                      height={r.height ?? undefined}
                    />
                  : <span className="ref-missing">not saved locally</span>}
              </div>
              <figcaption>
                <div className="ref-row">
                  <span className="chip chip-neutral">{r.reference_type}</span>
                  <span className="mono">{Math.round(r.confidence * 100)}%</span>
                </div>
                {r.width && r.height && <p className="mono">{r.width}&times;{r.height}</p>}
                {r.alt && <p className="ref-alt">{r.alt}</p>}
                <a className="ref-src" href={r.source_page} target="_blank" rel="noreferrer noopener">
                  {new URL(r.source_page).pathname || '/'}
                </a>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="ev-section">
        <h2 className="h2">Pages read</h2>
        <table className="table ev-pages">
          <thead>
            <tr><th>Role</th><th>Path</th><th>Status</th></tr>
          </thead>
          <tbody>
            {pages.map((p) => (
              <tr key={p.url}>
                <td className="c-status"><span className="chip chip-neutral">{p.role}</span></td>
                <td className="c-brand">
                  <a href={p.final_url} target="_blank" rel="noreferrer noopener">
                    {new URL(p.final_url).pathname || '/'}
                  </a>
                  {p.title && <div className="sub">{p.title}</div>}
                </td>
                <td className="c-counts mono">{p.ok ? p.status : (p.error ?? 'failed')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="ev-section">
        <h2 className="h2">Text taken from the site</h2>
        <div className="ev-cols">
          {[
            ['Headings', byKind('heading')],
            ['Body copy', byKind('copy')],
            ['Product descriptions', byKind('product_description')],
            ['Categories and navigation', [...byKind('category'), ...byKind('nav')]],
          ].filter(([, v]) => v.length).map(([title, items]) => (
            <div key={title}>
              <h3 className="label">{title} <span className="mono">{items.length}</span></h3>
              <ul className="ev-list">
                {items.slice(0, 12).map((t, i) => <li key={i}>{t.text.slice(0, 180)}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {ev.palette?.length > 0 && (
        <section className="ev-section">
          <h2 className="h2">Colours sampled from the pages</h2>
          <div className="palette-row">
            {ev.palette.map((p, i) => (
              <div key={i} className="pal">
                <i style={{ background: p.hex }} />
                <span className="mono">{p.hex}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {brandKit && (
        <section className="ev-section">
          <h2 className="h2">What was concluded from it</h2>
          <p className="sub" style={{ marginBottom: 16, maxWidth: '72ch' }}>
            Claims marked observed are backed by specific images or text above. Claims marked
            inferred are the model generalising, and carry less weight.
          </p>
          <div className="claims">
            {Object.entries(brandKit.photography_language ?? {})
              .filter(([, v]) => Array.isArray(v) && v.length)
              .map(([key, list]) => (
                <div key={key} className="claim-group">
                  <h3 className="label">{key.replace(/_/g, ' ')}</h3>
                  <ul>
                    {list.map(claimText).map((c, i) => (
                      <li key={i}>
                        <span className={`basis ${c.basis === 'OBSERVED' ? 'obs' : 'inf'}`}>
                          {c.basis === 'OBSERVED' ? 'observed' : 'inferred'}
                        </span>
                        <span>{c.value}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
          </div>
        </section>
      )}
    </div>
  );
}
