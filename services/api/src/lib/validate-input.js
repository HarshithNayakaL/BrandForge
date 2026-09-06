import { config } from '../config.js';

/** Magic-byte sniffing: never trust a client-supplied Content-Type. */
export function sniffImageMime(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export function validateProductImage(file) {
  if (!file) return { ok: false, code: 'INVALID_PRODUCT_IMAGE', error: 'A product image is required' };
  if (file.size > config.upload.maxBytes) {
    return { ok: false, code: 'INVALID_PRODUCT_IMAGE', error: `Image exceeds the ${Math.round(config.upload.maxBytes / 1e6)}MB limit` };
  }
  const mime = sniffImageMime(file.buffer);
  if (!mime) return { ok: false, code: 'INVALID_PRODUCT_IMAGE', error: 'File is not a readable JPEG, PNG or WebP image' };
  if (!config.upload.allowedMime.includes(mime)) {
    return { ok: false, code: 'INVALID_PRODUCT_IMAGE', error: `${mime} is not an accepted image type` };
  }
  return { ok: true, mime, ext: EXT[mime] };
}

/**
 * Shape validation only. The authoritative SSRF check happens in the crawler
 * (it resolves DNS), but rejecting obvious junk here avoids a wasted hop.
 */
export function validateBrandUrl(raw) {
  if (!raw || typeof raw !== 'string') return { ok: false, code: 'INVALID_URL', error: 'A brand URL is required' };
  let candidate = raw.trim();
  if (!/^https?:\/\//i.test(candidate)) candidate = `https://${candidate}`;

  let u;
  try { u = new URL(candidate); } catch { return { ok: false, code: 'INVALID_URL', error: `Not a valid URL: ${raw}` }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, code: 'INVALID_URL', error: 'Only http and https URLs are supported' };
  }
  if (u.username || u.password) return { ok: false, code: 'INVALID_URL', error: 'URLs with credentials are not supported' };
  if (!u.hostname.includes('.')) return { ok: false, code: 'INVALID_URL', error: `"${u.hostname}" is not a public hostname` };

  return { ok: true, url: u.toString() };
}
