import { useEffect, useRef, useState } from 'react';
import Evidence from './Evidence.jsx';

const claim = (c) => (typeof c === 'string' ? c : c?.value ?? '');

function Tile({ shot, base, onOpen, hero, index }) {
  const accepted = shot.status === 'ACCEPTED';
  const src = shot.output ? base + shot.output : null;
  const qa = shot.qa;

  return (
    <article
      className={`tile${hero ? ' tile--hero' : ''}`}
      style={{ animationDelay: `${Math.min(index, 6) * 45}ms` }}
    >
      <div className="frame-wrap">
        <button
          className={`frame${accepted ? '' : ' blocked'}`}
          onClick={() => src && onOpen(shot)}
          disabled={!src}
          aria-label={`Open ${shot.shot_id}, ${shot.purpose}`}
        >
          {src
            ? <img src={src} alt={shot.purpose} loading={hero ? 'eager' : 'lazy'} />
            : <span className="none">No image was produced for this shot.</span>}
          {!accepted && (
            <span className="chip chip-danger badge">
              {shot.status === 'BLOCKED' ? 'Blocked' : 'Failed'}
            </span>
          )}
        </button>
        {hero && <span className="marks" aria-hidden="true" />}
      </div>

      <div className="tile-cap">
        <div className="row">
          <span className="mono">{shot.shot_id}</span>
          <span className="mono">{qa ? `${qa.product_accuracy}/10 accuracy` : 'not scored'}</span>
        </div>
        <p className="purpose">{shot.purpose}</p>
        {shot.repair_attempts > 0 && (
          <p className="sub">
            {accepted
              ? `Repaired ${shot.repair_attempts} time${shot.repair_attempts === 1 ? '' : 's'}, then passed`
              : `Still failing after ${shot.repair_attempts} repair attempt${shot.repair_attempts === 1 ? '' : 's'}`}
          </p>
        )}

        <details>
          <summary>Shot brief and review</summary>
          <dl className="facts">
            <dt>Camera</dt><dd>{shot.contract.camera}</dd>
            <dt>Light</dt><dd>{shot.contract.lighting}</dd>
            <dt>Ground</dt><dd>{shot.contract.background}</dd>
            <dt>Locked</dt><dd>{shot.contract.must_preserve.join(', ') || '—'}</dd>
            {qa && <><dt>Realism</dt><dd>{qa.realism}/10</dd></>}
            {qa && <><dt>Brand fit</dt><dd>{qa.brand_alignment}/10</dd></>}
          </dl>
          {qa?.issues?.length > 0 && (
            <ul className="issues">
              {qa.issues.slice(0, 5).map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          )}
          {shot.failure_reason && <p className="issues">{shot.failure_reason}</p>}
        </details>
      </div>
    </article>
  );
}

/** Side by side against the original: the judgement this product exists for. */
function Lightbox({ shot, base, original, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (shot && !d.open) d.showModal();
    if (!shot && d.open) d.close();
  }, [shot]);

  if (!shot) return null;
  const src = base + shot.output;

  return (
    <dialog
      className="lightbox"
      ref={ref}
      onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
    >
      <div className="lightbox-inner">
        <div className="lightbox-head">
          <span className="mono">{shot.shot_id}</span>
          <span className="h3">{shot.purpose}</span>
          <span className={`chip ${shot.status === 'ACCEPTED' ? 'chip-ok' : 'chip-danger'}`}>{shot.status}</span>
          <a className="btn btn-secondary btn-sm" href={src} download={`${shot.shot_id.toLowerCase()}.png`}>
            Download image
          </a>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
        </div>
        <div className="lightbox-body">
          <figure>
            <figcaption>
              <span>Generated</span>
              {shot.qa && <span>{shot.qa.product_accuracy}/10 product accuracy</span>}
            </figcaption>
            <img src={src} alt={shot.purpose} />
          </figure>
          <figure>
            <figcaption><span>Original product, the ground truth</span></figcaption>
            <img src={original} alt="The product you uploaded" />
          </figure>
        </div>
      </div>
    </dialog>
  );
}

export default function Results({ campaign, onNew }) {
  const { manifest, brand_kit: kit, product_identity: pi, assets_base: base, input } = campaign;
  const [open, setOpen] = useState(null);
  const [tab, setTab] = useState('campaign');

  if (!manifest) {
    return (
      <div>
        <h1 className="page-title">Run did not complete</h1>
        <p className="alert" role="alert">
          <strong>{campaign.failure_code}</strong> {campaign.error}
        </p>
        <p style={{ marginTop: 24 }}>
          <button className="btn btn-secondary" onClick={onNew}>Start another campaign</button>
        </p>
      </div>
    );
  }

  const photo = kit?.photography_language;
  const statusChip = manifest.status === 'COMPLETED' ? 'chip-ok'
    : manifest.status === 'PARTIAL' ? 'chip-warn' : 'chip-danger';

  // The hero is the first shot that actually passed. A blocked frame never
  // gets top billing, however good it looks.
  const heroId = (manifest.shots.find((s) => s.status === 'ACCEPTED') ?? manifest.shots[0])?.shot_id;

  return (
    <div>
      <div className="run-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 className="page-title">{manifest.brand}</h1>
          <div className="run-meta">
            <span className="mono">{new URL(manifest.brand_url).hostname}</span>
            <span className="chip chip-neutral">{manifest.product_category}</span>
            <span className="mono">{manifest.run_id}</span>
          </div>
        </div>
        <span className={`chip ${statusChip}`}>{manifest.status}</span>
      </div>

      <div className="tabs" role="tablist">
        <button
          role="tab" aria-selected={tab === 'campaign'}
          className={`tab${tab === 'campaign' ? ' on' : ''}`}
          onClick={() => setTab('campaign')}
        >
          Campaign
        </button>
        <button
          role="tab" aria-selected={tab === 'evidence'}
          className={`tab${tab === 'evidence' ? ' on' : ''}`}
          onClick={() => setTab('evidence')}
        >
          Brand evidence
        </button>
      </div>

      {tab === 'evidence' && <Evidence runId={manifest.run_id} brandKit={kit} />}

      {tab === 'campaign' && <>
        <div className="stats">
          <div>
            <span className="label">Accepted</span>
            <span className="val">{manifest.accepted}<small>of 6</small></span>
          </div>
          <div>
            <span className="label">Images generated</span>
            <span className="val">{manifest.usage.image_generations}</span>
          </div>
          <div>
            <span className="label">Repairs</span>
            <span className="val">{manifest.usage.repairs}</span>
          </div>
          <div>
            <span className="label">Locked attributes</span>
            <span className="val">{(pi?.must_preserve ?? []).length}</span>
          </div>
          {manifest.blocked > 0 && (
            <div>
              <span className="label">Blocked</span>
              <span className="val" style={{ color: 'var(--danger)' }}>{manifest.blocked}</span>
            </div>
          )}
        </div>

        <div className="direction">
          <span className="label">Detected direction</span>
          <p>
            {[claim(photo?.lighting?.[0]), claim(photo?.backgrounds?.[0]), claim(photo?.camera_style?.[0])]
              .filter(Boolean).join(' · ') || 'not determined'}
          </p>
          <div className="swatches">
            {(kit?.visual_identity?.dominant_colors ?? []).slice(0, 6).map((c, i) => (
              <i key={i} style={{ background: /^#|^rgb|^oklch/.test(c) ? c : 'var(--sunken)' }} title={c} />
            ))}
          </div>
        </div>

        <div className="gallery">
          {manifest.shots.map((s, i) => (
            <Tile
              key={s.shot_id}
              shot={s}
              base={base}
              onOpen={setOpen}
              hero={s.shot_id === heroId}
              index={i}
            />
          ))}
        </div>

        <p style={{ marginTop: 44, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={onNew}>Start another campaign</button>
          <a className="btn btn-secondary" href={`${base}manifest.json`} target="_blank" rel="noreferrer">
            View manifest
          </a>
        </p>

        <Lightbox shot={open} base={base} original={input?.product} onClose={() => setOpen(null)} />
      </>}
    </div>
  );
}
