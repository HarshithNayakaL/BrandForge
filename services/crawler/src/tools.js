import { assertSafeUrl } from './ssrf.js';
import { normalizeUrl, classifyPage, isExcludedPath, sameSite } from './filters.js';

/**
 * The retrieval tools the brand agent calls. This is the grounding layer:
 * instead of the model reaching for training-data recall or a paid search
 * API, it asks these.
 *
 * Everything here is free and keyless. General web search deliberately is
 * not included: every free engine blocks automated clients (verified), so
 * building on one would be building on sand. What this exposes instead is
 * the brand's own output, which is what the product actually reasons about.
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

async function getText(url, { timeoutMs = 15000, maxBytes = 4_000_000, accept = 'text/html,application/xml,*/*' } = {}) {
  await assertSafeUrl(url);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal, redirect: 'follow', headers: { 'user-agent': UA, accept } });
    if (!res.ok) return { ok: false, status: res.status, body: '' };
    // re-validate after redirects
    await assertSafeUrl(res.url);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > maxBytes) return { ok: false, status: 413, body: '' };
    return { ok: true, status: res.status, body: buf.toString('utf8'), finalUrl: res.url };
  } catch (e) {
    return { ok: false, status: 0, body: '', error: e.message };
  } finally {
    clearTimeout(timer);
  }
}

async function getJson(url, opts) {
  const r = await getText(url, { accept: 'application/json', ...opts });
  if (!r.ok) return null;
  try { return JSON.parse(r.body); } catch { return null; }
}

// ------------------------------------------------------------ brand lookup

/**
 * Is this an established brand or an unknown one? The answer decides whether
 * the agent is allowed to lean on prior knowledge to steer its search, or
 * has to discover everything by crawling. It is answered from data rather
 * than from the model's own sense of familiarity, which is exactly where
 * confident hallucination comes from.
 */
export async function lookupBrand({ name, domain }) {
  const query = name || domain;
  if (!query) return { found: false, reason: 'no name or domain supplied' };

  const search = await getJson(
    `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=3&origin=*`
  );
  const hits = search?.query?.search ?? [];

  const entity = await getJson(
    `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(query)}&language=en&format=json&limit=1&origin=*`
  );
  const ent = entity?.search?.[0] ?? null;

  let claims = {};
  if (ent?.id) {
    const detail = await getJson(
      `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ent.id}&props=claims&format=json&origin=*`
    );
    const c = detail?.entities?.[ent.id]?.claims ?? {};
    const val = (prop) => c[prop]?.[0]?.mainsnak?.datavalue?.value ?? null;
    claims = {
      official_site: val('P856'),
      inception: val('P571')?.time ?? null,
      industry_id: val('P452')?.id ?? null,
      country_id: val('P17')?.id ?? null,
    };
  }

  // A brand with a Wikipedia article and a Wikidata entity is "established"
  // in the only sense that matters here: public reference data exists, so
  // the model's prior is likely to be real rather than invented.
  const established = hits.length > 0 && Boolean(ent);

  return {
    found: established,
    established,
    query,
    wikipedia: hits.slice(0, 3).map((h) => ({ title: h.title, snippet: h.snippet.replace(/<[^>]+>/g, '') })),
    wikidata: ent ? { id: ent.id, label: ent.label, description: ent.description, ...claims } : null,
    guidance: established
      ? 'Public reference data exists. Prior knowledge may be used to decide WHERE to look, but every claim that reaches the brand kit must still come from a fetched page.'
      : 'No public reference data. Prior knowledge about this brand is unreliable; discover everything by fetching pages.',
  };
}

// -------------------------------------------------------------- site map

function extractLocs(xml) {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
}

/**
 * A sitemap is the brand telling us its own inventory, which beats guessing
 * from link-following. Falls back to robots.txt, then to nothing, in which
 * case the caller should use the bounded crawl instead.
 */
export async function siteMap({ url, max = 400 }) {
  const base = await assertSafeUrl(url);
  const origin = base.origin;
  const tried = [];
  const candidates = [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`, `${origin}/sitemap.xml.gz`];

  // robots.txt often names a non-standard sitemap location
  const robots = await getText(`${origin}/robots.txt`, { timeoutMs: 8000 });
  if (robots.ok) {
    for (const m of robots.body.matchAll(/sitemap:\s*(\S+)/gi)) candidates.unshift(m[1].trim());
  }

  const seen = new Set();
  let locs = [];

  for (const c of [...new Set(candidates)].slice(0, 5)) {
    if (locs.length >= max) break;
    tried.push(c);
    const r = await getText(c, { timeoutMs: 15000 });
    if (!r.ok || !/<loc>/i.test(r.body)) continue;

    const found = extractLocs(r.body);
    // a sitemap index points at more sitemaps; follow one level only
    const nested = found.filter((u) => /\.xml/i.test(u)).slice(0, 6);
    const direct = found.filter((u) => !/\.xml/i.test(u));
    locs.push(...direct);

    for (const n of nested) {
      if (locs.length >= max) break;
      const rn = await getText(n, { timeoutMs: 15000 });
      if (rn.ok) locs.push(...extractLocs(rn.body).filter((u) => !/\.xml/i.test(u)));
    }
  }

  const rootDomain = base.hostname.toLowerCase().replace(/^www\./, '');
  const pages = [];
  for (const raw of locs) {
    const n = normalizeUrl(raw, origin);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    if (!sameSite(n, rootDomain) || isExcludedPath(n)) continue;
    pages.push({ url: n, role: classifyPage(n) });
    if (pages.length >= max) break;
  }

  const byRole = pages.reduce((m, p) => ({ ...m, [p.role]: (m[p.role] ?? 0) + 1 }), {});
  return {
    available: pages.length > 0,
    tried,
    total: pages.length,
    by_role: byRole,
    pages,
  };
}

// --------------------------------------------------------------- timeline

/**
 * How the brand presented itself over time, from the Wayback CDX API.
 * This is what answers "their initial posting and their current posting":
 * snapshots are collapsed per year so the agent can compare eras cheaply.
 */
export async function timeline({ domain, path = '', limit = 40 }) {
  const host = String(domain).replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const target = path ? `${host}/${path.replace(/^\//, '')}` : host;
  const url = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(target)}`
    + `&output=json&filter=statuscode:200&filter=mimetype:text/html`
    + `&collapse=timestamp:4&limit=${Math.min(limit, 120)}`;

  const rows = await getJson(url, { timeoutMs: 25000 });
  if (!Array.isArray(rows) || rows.length < 2) {
    return { available: false, snapshots: [] };
  }

  const [header, ...data] = rows;
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const snapshots = data.map((r) => {
    const ts = r[idx.timestamp];
    return {
      timestamp: ts,
      year: ts.slice(0, 4),
      original: r[idx.original],
      snapshot_url: `https://web.archive.org/web/${ts}/${r[idx.original]}`,
    };
  });

  return {
    available: true,
    domain: host,
    span: snapshots.length ? `${snapshots[0].year}–${snapshots[snapshots.length - 1].year}` : null,
    count: snapshots.length,
    snapshots,
  };
}

// ----------------------------------------------------------- social handles

const SOCIAL = [
  ['instagram', /instagram\.com\/([A-Za-z0-9_.]{2,40})/i],
  ['tiktok', /tiktok\.com\/@([A-Za-z0-9_.]{2,40})/i],
  ['youtube', /youtube\.com\/(?:@|c\/|user\/)([A-Za-z0-9_.-]{2,60})/i],
  ['x', /(?:twitter|x)\.com\/([A-Za-z0-9_]{2,20})/i],
  ['pinterest', /pinterest\.[a-z.]{2,6}\/([A-Za-z0-9_-]{2,40})/i],
  ['facebook', /facebook\.com\/([A-Za-z0-9_.-]{2,60})/i],
];

/**
 * Brands link their own profiles in the footer. We read the handles, not the
 * feeds: the platforms are auth-walled and prohibit automated collection, so
 * a scraper aimed at them would be unreliable as well as out of bounds. The
 * handles still tell the agent which platforms the brand actually invests in,
 * which is itself a signal about how they post.
 */
export function extractSocialHandles(html, pageUrl) {
  const out = {};
  for (const [platform, re] of SOCIAL) {
    const m = html.match(re);
    if (!m) continue;
    const handle = m[1];
    if (/^(p|share|sharer|intent|home|about|privacy|policy|tr)$/i.test(handle)) continue;
    out[platform] = { handle, profile_url: m[0].startsWith('http') ? m[0] : `https://${m[0]}`, found_on: pageUrl };
  }
  return out;
}

/** Titles and copy arrive entity-encoded; downstream consumers want text. */
export function decodeEntities(str) {
  if (!str) return '';
  const named = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    mdash: '—', ndash: '–', hellip: '…',
    lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  };
  return String(str)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => named[n.toLowerCase()] ?? m);
}

export { getText, getJson };
