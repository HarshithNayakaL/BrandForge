import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl, sameSite, isExcludedPath, classifyPage, scoreImage, classifyImage } from '../services/crawler/src/filters.js';

const B = { minWidth: 400, minHeight: 400 };

test('normalisation strips tracking params, hashes and trailing slashes', () => {
  const a = normalizeUrl('https://x.com/shop/?utm_source=ig&gclid=1#top', 'https://x.com');
  const b = normalizeUrl('https://x.com/shop', 'https://x.com');
  assert.equal(a, b, 'tracking variants must dedupe to one URL');
});

test('normalisation sorts query params so order does not create duplicates', () => {
  assert.equal(
    normalizeUrl('https://x.com/p?b=2&a=1', 'https://x.com'),
    normalizeUrl('https://x.com/p?a=1&b=2', 'https://x.com')
  );
});

test('non-http schemes are dropped', () => {
  assert.equal(normalizeUrl('mailto:a@b.com', 'https://x.com'), null);
  assert.equal(normalizeUrl('javascript:void(0)', 'https://x.com'), null);
});

test('same-site accepts subdomains only', () => {
  assert.equal(sameSite('https://shop.nike.com/x', 'nike.com'), true);
  assert.equal(sameSite('https://www.nike.com/x', 'nike.com'), true);
  assert.equal(sameSite('https://nike.com.evil.net/x', 'nike.com'), false);
  assert.equal(sameSite('https://adidas.com/x', 'nike.com'), false);
});

test('transactional and legal pages are excluded', () => {
  for (const p of ['/cart', '/checkout', '/account/login', '/privacy-policy', '/careers', '/terms']) {
    assert.equal(isExcludedPath(`https://x.com${p}`), true, `${p} should be excluded`);
  }
});

test('page roles are derived from the URL, not from any brand assumption', () => {
  assert.equal(classifyPage('https://x.com/'), 'home');
  assert.equal(classifyPage('https://x.com/products/tree-runner-grey'), 'product');
  assert.equal(classifyPage('https://x.com/collections/new-in'), 'collection');
  assert.equal(classifyPage('https://x.com/pages/our-story'), 'about');
  assert.equal(classifyPage('https://x.com/lookbook'), 'campaign');
});

test('junk imagery is rejected', () => {
  const junk = [
    'https://x.com/icons/cart.png', 'https://x.com/img/visa.png',
    'https://x.com/social/instagram.png', 'https://x.com/px/tracking.gif',
    'https://x.com/ui/chevron.png', 'https://x.com/placeholder.png',
  ];
  for (const url of junk) {
    assert.equal(scoreImage({ url, naturalWidth: 800, naturalHeight: 800 }, B), null, `${url} should be rejected`);
  }
});

test('logos survive the junk filter', () => {
  assert.notEqual(scoreImage({ url: 'https://x.com/img/logo-seo.jpg', naturalWidth: 800, naturalHeight: 800 }, B), null);
});

test('undersized images and extreme aspect ratios are rejected', () => {
  assert.equal(scoreImage({ url: 'https://x.com/a.jpg', naturalWidth: 100, naturalHeight: 100 }, B), null);
  assert.equal(scoreImage({ url: 'https://x.com/banner.jpg', naturalWidth: 2000, naturalHeight: 200 }, B), null);
});

test('bigger, in-content, described images score higher', () => {
  const small = scoreImage({ url: 'https://x.com/a.jpg', naturalWidth: 500, naturalHeight: 500 }, B);
  const big = scoreImage({ url: 'https://x.com/b.jpg', naturalWidth: 1600, naturalHeight: 1600, inMain: true, alt: 'a full product photograph' }, B);
  assert.ok(big > small, 'a large in-main image with alt text should outrank a bare thumbnail');
});

test('image type follows the page it came from, with no category hardcoding', () => {
  assert.equal(classifyImage({ url: 'https://x.com/a.jpg', alt: '' }, 'product'), 'product');
  assert.equal(classifyImage({ url: 'https://x.com/a-detail.jpg', alt: '' }, 'product'), 'detail');
  assert.equal(classifyImage({ url: 'https://x.com/logo.svgx', alt: '' }, 'product'), 'logo');
  assert.equal(classifyImage({ url: 'https://x.com/a.jpg', alt: '' }, 'campaign'), 'campaign');
});
