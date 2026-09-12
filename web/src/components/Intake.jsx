import { useEffect, useRef, useState } from 'react';

const STEPS = [
  'Crawls the brand site for real photography and copy',
  'Builds a brand profile from that evidence, not from memory',
  'Analyses your product and locks what cannot change',
  'Plans six shots for this brand and this product',
  'Generates them with your photo as the anchor',
  'Reviews each one and repairs or blocks failures',
];

export default function Intake({ onSubmit, error, keysReady }) {
  const [url, setUrl] = useState('');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef(null);

  // Object URLs leak if they are not revoked when the selection changes.
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const take = (f) => {
    if (!f) return;
    setFile(f);
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(f);
    });
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!url.trim() || !file || busy) return;
    setBusy(true);
    await onSubmit(url.trim(), file);
    setBusy(false);
  };

  return (
    <div className="intake">
      <form onSubmit={submit}>
        <h1>Six campaign shots, in someone else&rsquo;s brand language.</h1>
        <p className="intake-lede">
          Point it at a brand&rsquo;s website and give it one photo of your product. It reads how
          that brand shoots, works out what cannot change about your product, then makes the
          images and checks every one against your original.
        </p>

        <div className="field">
          <label className="label" htmlFor="brand-url">Brand website</label>
          <input
            id="brand-url"
            className="input"
            type="text"
            inputMode="url"
            placeholder="https://brand.com"
            value={url}
            autoComplete="off"
            spellCheck="false"
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>

        <div className="field">
          <label className="label" htmlFor="product-file">Product image</label>
          <button
            type="button"
            className={`dropzone${over ? ' over' : ''}${file ? ' filled' : ''}`}
            onClick={() => input.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files?.[0]); }}
          >
            {preview
              ? <img className="preview" src={preview} alt="" />
              : (
                <span className="slot" aria-hidden="true">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </span>
              )}
            <span className="dz-text">
              <strong>{file ? file.name : 'Choose a file or drop it here'}</strong>
              <span>{file ? `${(file.size / 1e6).toFixed(1)} MB` : 'JPEG, PNG or WebP, up to 12 MB'}</span>
            </span>
          </button>
          <input
            id="product-file"
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={(e) => take(e.target.files?.[0])}
          />
        </div>

        <div className="intake-actions">
          <button className="btn btn-primary" type="submit" disabled={!url.trim() || !file || busy}>
            {busy && <span className="spinner" aria-hidden="true" />}
            {busy ? 'Starting run' : 'Generate campaign'}
          </button>
          {keysReady === false && (
            <span className="chip chip-warn">Model keys missing, the run will stop early</span>
          )}
        </div>

        {error && (
          <p className="alert" role="alert">
            <strong>Could not start.</strong> {error}
          </p>
        )}
      </form>

      <aside className="rail panel">
        <h2>What it does with them</h2>
        <p>Six stages, two to four minutes.</p>
        <ol>
          {STEPS.map((s) => <li key={s}><span>{s}</span></li>)}
        </ol>
      </aside>
    </div>
  );
}
