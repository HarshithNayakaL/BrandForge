import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBrandUrl, validateProductImage, sniffImageMime } from '../services/api/src/lib/validate-input.js';
import { assertSafeId, brandIdFromUrl } from '../services/api/src/lib/store.js';

const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const jpeg = Buffer.concat([Buffer.from('ffd8ffe000104a464946', 'hex'), Buffer.alloc(8)]);
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]);

test('magic bytes decide the type, not the filename', () => {
  assert.equal(sniffImageMime(png), 'image/png');
  assert.equal(sniffImageMime(jpeg), 'image/jpeg');
  assert.equal(sniffImageMime(webp), 'image/webp');
  assert.equal(sniffImageMime(Buffer.from('<?php system($_GET[0]); ?>')), null);
});

test('a renamed script is rejected however it is labelled', () => {
  const r = validateProductImage({ buffer: Buffer.from('GIF89a not really'), size: 17, mimetype: 'image/png' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'INVALID_PRODUCT_IMAGE');
});

test('oversized uploads are rejected', () => {
  const r = validateProductImage({ buffer: png, size: 99_000_000 });
  assert.equal(r.ok, false);
});

test('a real png is accepted', () => {
  const r = validateProductImage({ buffer: png, size: png.length });
  assert.equal(r.ok, true);
  assert.equal(r.ext, 'png');
});

test('a bare domain gets an https scheme', () => {
  const r = validateBrandUrl('brand.com');
  assert.equal(r.ok, true);
  assert.equal(r.url, 'https://brand.com/');
});

test('junk urls are rejected before any crawl is attempted', () => {
  for (const u of ['notaurl', '', 'ftp://x.com', 'https://user:pw@x.com', 'http://localhost']) {
    assert.equal(validateBrandUrl(u).ok, false, `${u} should be rejected`);
  }
});

test('run and brand ids can never escape their directory', () => {
  for (const bad of ['../../etc', 'a/b', 'x\\y', '..', 'a b', '']) {
    assert.throws(() => assertSafeId(bad, 'run_id'), `${bad} should be rejected`);
  }
  assert.equal(assertSafeId('run_20260101120000_abcd1234'), 'run_20260101120000_abcd1234');
});

test('brand ids are derived from the host and are filesystem-safe', () => {
  assert.equal(brandIdFromUrl('https://www.Nike.com/x?y=1'), 'nike.com');
  assert.equal(brandIdFromUrl('https://shop.example.co.uk/'), 'shop.example.co.uk');
  assert.doesNotThrow(() => assertSafeId(brandIdFromUrl('https://www.allbirds.com'), 'brand_id'));
});
