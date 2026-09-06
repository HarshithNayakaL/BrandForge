import test from 'node:test';
import assert from 'node:assert/strict';
import { isBlockedIP, assertSafeUrl, SSRFError } from '../services/crawler/src/ssrf.js';

test('blocks loopback, private, link-local and metadata addresses', () => {
  const blocked = [
    '127.0.0.1', '127.1.2.3', '10.0.0.1', '10.255.255.255',
    '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
    '0.0.0.0', '100.64.0.1', '198.18.0.1', '224.0.0.1', '255.255.255.255',
    '::1', '::', 'fe80::1', 'fd00::1', 'ff02::1', '::ffff:127.0.0.1',
  ];
  for (const ip of blocked) assert.equal(isBlockedIP(ip), true, `${ip} should be blocked`);
});

test('allows genuine public addresses', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '2606:4700::1111']) {
    assert.equal(isBlockedIP(ip), false, `${ip} should be allowed`);
  }
});

test('172.16/12 boundary is exact', () => {
  assert.equal(isBlockedIP('172.15.255.255'), false);
  assert.equal(isBlockedIP('172.16.0.0'), true);
  assert.equal(isBlockedIP('172.31.255.255'), true);
  assert.equal(isBlockedIP('172.32.0.0'), false);
});

test('rejects non-http protocols', async () => {
  for (const u of ['file:///etc/passwd', 'ftp://example.com', 'gopher://example.com', 'data:text/html,x']) {
    await assert.rejects(() => assertSafeUrl(u), SSRFError, `${u} should be rejected`);
  }
});

test('rejects malformed urls and embedded credentials', async () => {
  await assert.rejects(() => assertSafeUrl('not a url'), SSRFError);
  await assert.rejects(() => assertSafeUrl('https://user:pass@example.com'), SSRFError);
});

test('rejects internal hostnames and TLDs without needing DNS', async () => {
  for (const u of ['http://localhost', 'http://metadata.google.internal', 'http://box.local', 'http://svc.internal']) {
    await assert.rejects(() => assertSafeUrl(u), SSRFError, `${u} should be rejected`);
  }
});

test('rejects literal private IPs in the URL', async () => {
  for (const u of ['http://127.0.0.1:3000/x', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]/']) {
    await assert.rejects(() => assertSafeUrl(u), SSRFError, `${u} should be rejected`);
  }
});
