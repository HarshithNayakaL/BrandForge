const j = async (res) => {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error ?? `Request failed (${res.status})`), { code: body.code });
  return body;
};

export const api = {
  createCampaign: (brandUrl, file) => {
    const fd = new FormData();
    fd.append('brand_url', brandUrl);
    fd.append('product_image', file);
    return fetch('/api/campaign', { method: 'POST', body: fd }).then(j);
  },
  status: (runId) => fetch(`/api/campaign/${runId}/status`).then(j),
  campaign: (runId) => fetch(`/api/campaign/${runId}`).then(j),
  evidence: (runId) => fetch(`/api/campaign/${runId}/evidence`).then(j),
  runs: () => fetch('/api/runs').then(j),
  health: () => fetch('/api/health').then(j).catch(() => null),
};

/** Mirrors the server's run statuses; nothing here advances on its own. */
export const STAGES = [
  { key: 'CRAWLING', label: 'Analysing website' },
  { key: 'BRAND_ANALYSIS', label: 'Building brand profile' },
  { key: 'PRODUCT_ANALYSIS', label: 'Analysing product' },
  { key: 'PLANNING', label: 'Planning campaign' },
  { key: 'GENERATING', label: 'Creating six shots' },
  { key: 'QA', label: 'Checking product accuracy' },
  { key: 'REPAIRING', label: 'Repairing failed shots' },
  { key: 'FINALIZING', label: 'Finalising campaign' },
];

export const STAGE_ORDER = [
  'CREATED', 'CRAWLING', 'BRAND_ANALYSIS', 'PRODUCT_ANALYSIS', 'PLANNING',
  'GENERATING', 'QA', 'REPAIRING', 'FINALIZING', 'COMPLETED',
];

export const TERMINAL = ['COMPLETED', 'PARTIAL', 'FAILED'];

export const fmtDuration = (ms) => {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
};
