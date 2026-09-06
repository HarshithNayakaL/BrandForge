/** Deterministic URL/image filtering. No LLM involved (PRD 9). */

const EXCLUDE_PATH = [
  'login', 'signin', 'sign-in', 'register', 'account', 'checkout', 'cart', 'basket',
  'wishlist', 'privacy', 'terms', 'conditions', 'cookie', 'legal', 'careers', 'jobs',
  'returns', 'shipping', 'faq', 'help', 'support', 'contact', 'newsletter',
  'gift-card', 'giftcard', 'store-locator', 'sitemap', 'search', 'blog/tag',
  'wp-admin', 'wp-login', 'admin', 'api/', 'feed', 'rss',
];

const TRACKING_PARAMS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
  'gclid', 'fbclid', 'msclkid', 'mc_cid', 'mc_eid', 'ref', '_ga', 'igshid', 'yclid',
];

const PRODUCT_HINTS = ['/product', '/products/', '/p/', '/item', '/dp/', '/pd/', '-p0', '/shop/'];
const COLLECTION_HINTS = ['/collection', '/collections/', '/category', '/categories', '/c/', '/shop', '/catalog', '/new-in', '/women', '/men'];
const CAMPAIGN_HINTS = ['/campaign', '/editorial', '/lookbook', '/stories', '/journal', '/magazine', '/world-of', '/inspiration'];
const ABOUT_HINTS = ['/about', '/our-story', '/brand', '/philosophy', '/sustainability', '/craft'];

export function normalizeUrl(raw, base) {
  let u;
  try { u = new URL(raw, base); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  u.hash = '';
  for (const p of TRACKING_PARAMS) u.searchParams.delete(p);
  // collapse trailing slash so /shop and /shop/ dedupe
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1);
  u.searchParams.sort();
  return u.toString();
}

export function sameSite(url, rootDomain) {
  try {
    const h = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return h === rootDomain || h.endsWith(`.${rootDomain}`);
  } catch { return false; }
}

export function isExcludedPath(url) {
  try {
    const p = new URL(url).pathname.toLowerCase();
    return EXCLUDE_PATH.some((x) => p.includes(x));
  } catch { return true; }
}

export function classifyPage(url) {
  const p = (() => { try { return new URL(url).pathname.toLowerCase(); } catch { return ''; } })();
  if (p === '' || p === '/') return 'home';
  if (PRODUCT_HINTS.some((h) => p.includes(h)) && /\d|[a-z0-9-]{8,}$/.test(p)) return 'product';
  if (CAMPAIGN_HINTS.some((h) => p.includes(h))) return 'campaign';
  if (COLLECTION_HINTS.some((h) => p.includes(h))) return 'collection';
  if (ABOUT_HINTS.some((h) => p.includes(h))) return 'about';
  return 'other';
}

const JUNK_IMAGE_TOKENS = [
  'icon', 'sprite', 'favicon', 'pixel', 'tracking', 'beacon', 'analytics',
  'payment', 'visa', 'mastercard', 'paypal', 'amex', 'klarna', 'applepay',
  'social', 'facebook', 'instagram', 'twitter', 'tiktok', 'youtube', 'pinterest',
  'placeholder', 'spinner', 'loader', 'loading', 'blank', 'transparent',
  'arrow', 'chevron', 'close', 'menu', 'burger', 'cart', 'search', 'badge',
  'flag', 'star-rating', 'swatch',
];

/** Score an image candidate; returns null to reject. */
export function scoreImage(img, { minWidth, minHeight }) {
  const url = img.url ?? '';
  const lower = url.toLowerCase();

  if (!/^https?:/i.test(url)) return null;
  if (lower.includes('.svg')) return null;          // almost always UI chrome
  if (lower.startsWith('data:')) return null;
  if (JUNK_IMAGE_TOKENS.some((t) => lower.includes(t))) {
    // logos are the one junk-token family we deliberately keep
    if (!/logo/.test(lower)) return null;
  }

  const w = img.naturalWidth || img.width || 0;
  const h = img.naturalHeight || img.height || 0;
  if (w && h) {
    if (w < minWidth || h < minHeight) return null;
    const ratio = w / h;
    if (ratio > 4 || ratio < 0.25) return null;     // banners/strips, not product photography
  }

  let confidence = 0.5;
  if (w >= 800 || h >= 800) confidence += 0.2;
  if (img.inMain) confidence += 0.1;
  if (img.alt && img.alt.length > 8) confidence += 0.1;
  if (img.isLcpCandidate) confidence += 0.1;
  if (/thumb|small|mini|_s\.|_xs/.test(lower)) confidence -= 0.2;

  return Math.max(0, Math.min(1, confidence));
}

export function classifyImage(img, pageRole) {
  const lower = (img.url ?? '').toLowerCase();
  const alt = (img.alt ?? '').toLowerCase();
  if (/logo|wordmark|brandmark/.test(lower) || /logo/.test(alt)) return 'logo';
  if (pageRole === 'campaign') return 'campaign';
  if (pageRole === 'product') {
    if (/detail|close|macro|zoom/.test(lower + alt)) return 'detail';
    return 'product';
  }
  if (pageRole === 'collection') return 'product';
  if (pageRole === 'home') return 'campaign';
  if (/model|wearing|worn|lifestyle|street/.test(lower + alt)) return 'lifestyle';
  return 'unknown';
}

export { EXCLUDE_PATH, TRACKING_PARAMS };
