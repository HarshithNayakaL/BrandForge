import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSocialHandles, decodeEntities } from '../services/crawler/src/tools.js';

test('social handles are read from a brand\'s own footer markup', () => {
  const html = `
    <footer>
      <a href="https://www.instagram.com/allbirds/">Instagram</a>
      <a href="https://www.tiktok.com/@weareallbirds">TikTok</a>
      <a href="https://twitter.com/allbirds">Twitter</a>
      <a href="https://www.pinterest.com/weareallbirds/">Pinterest</a>
    </footer>`;
  const out = extractSocialHandles(html, 'https://x.com/page');
  assert.equal(out.instagram.handle, 'allbirds');
  assert.equal(out.tiktok.handle, 'weareallbirds');
  assert.equal(out.x.handle, 'allbirds');
  assert.equal(out.pinterest.handle, 'weareallbirds');
});

test('share widgets are not mistaken for the brand\'s own profile', () => {
  // These appear on almost every product page and are not brand accounts.
  const html = `
    <a href="https://www.facebook.com/sharer/sharer.php?u=x">Share</a>
    <a href="https://twitter.com/intent/tweet?url=x">Tweet</a>
    <a href="https://www.pinterest.com/pin/create/button/">Pin</a>`;
  const out = extractSocialHandles(html, 'https://x.com/p');
  assert.equal(out.facebook, undefined);
  assert.equal(out.x, undefined);
});

test('missing platforms are simply absent, not guessed', () => {
  const out = extractSocialHandles('<footer><a href="https://example.com">Home</a></footer>', 'https://x.com');
  assert.deepEqual(out, {});
});

test('entities are decoded so downstream consumers get real text', () => {
  assert.equal(decodeEntities('Shoes &amp; Apparel'), 'Shoes & Apparel');
  assert.equal(decodeEntities('The world&#39;s most comfortable'), "The world's most comfortable");
  assert.equal(decodeEntities('caf&#xe9;'), 'café');
  assert.equal(decodeEntities('a &ndash; b'), 'a – b');
  assert.equal(decodeEntities(''), '');
  assert.equal(decodeEntities(null), '');
});

test('an unrecognised entity is left alone rather than mangled', () => {
  assert.equal(decodeEntities('100 &fake; x'), '100 &fake; x');
});
