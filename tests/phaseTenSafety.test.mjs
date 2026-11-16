import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicUrlValidator, secureFetch } from '../productResolver.mjs';
import { createImageModerationService, createReportStore, createUrlSafetyService } from '../safety.mjs';

test('local validation rejects malformed, credentialed, internal, obfuscated and dangerous-port URLs without DNS', async () => {
  let lookups = 0;
  const validator = createPublicUrlValidator({ dnsLookup: async () => { lookups += 1; return [{ address: '93.184.216.34' }]; } });
  for (const value of [
    'not a url', 'file:///etc/passwd', 'https://user:pass@example.com/item',
    'http://127.0.0.1/item', 'http://169.254.169.254/latest/meta-data',
    'http://localhost/item', 'http://service.internal/item', 'https://example.com:22/item',
    'https://example.com\\@safe.example/item',
  ]) await assert.rejects(() => validator(value));
  assert.equal(lookups, 0);
});

test('DNS validation permits public answers and rejects private answers deterministically', async () => {
  const validator = createPublicUrlValidator({
    dnsLookup: async (hostname) => hostname === 'public.example'
      ? [{ address: '93.184.216.34' }]
      : [{ address: '10.0.0.8' }],
  });
  assert.equal((await validator('https://public.example/product')).hostname, 'public.example');
  await assert.rejects(() => validator('https://rebound.example/product'), /PRIVATE_ADDRESS/);
});

test('safety verdict is cached by canonical URL rather than placement or tracking URL', async () => {
  let checks = 0;
  const service = createUrlSafetyService({
    validate: async (url) => new URL(url),
    canonicalize: (url) => { const parsed = new URL(url); parsed.search = ''; return parsed.toString(); },
    provider: { check: async () => { checks += 1; return { safe: true, provider: 'test' }; } },
  });
  const first = await service.check('https://shop.example/product?utm_source=one');
  const second = await service.check('https://shop.example/product?utm_source=two');
  assert.equal(first.cacheHit, false);
  assert.equal(second.cacheHit, true);
  assert.equal(checks, 1);
});

test('unsafe cached verdicts remain rejected', async () => {
  const service = createUrlSafetyService({ validate: async (url) => new URL(url), canonicalize: String, provider: { check: async () => ({ safe: false, provider: 'test' }) } });
  await assert.rejects(() => service.check('https://bad.example/item'), /UNSAFE_URL/);
  await assert.rejects(() => service.check('https://bad.example/item'), /UNSAFE_URL/);
});

test('secure fetch validates every redirect before following it', async () => {
  let calls = 0;
  const validator = createPublicUrlValidator({ dnsLookup: async () => [{ address: '93.184.216.34' }] });
  const fetcher = async () => {
    calls += 1;
    return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } });
  };
  await assert.rejects(() => secureFetch('https://catalog.example/product', { urlValidator: validator, fetcher }), /PRIVATE_ADDRESS/);
  assert.equal(calls, 1);
});

test('image moderation uses content cache and blocks provider-rejected imagery', async () => {
  let calls = 0;
  const service = createImageModerationService({ provider: { moderate: async () => { calls += 1; return { allowed: false, provider: 'test' }; } } });
  const first = await service.moderate(Buffer.from('image bytes'));
  const second = await service.moderate(Buffer.from('image bytes'));
  assert.equal(first.allowed, false);
  assert.equal(second.cacheHit, true);
  assert.equal(calls, 1);
});

test('lightweight reporting accepts only item and board targets', () => {
  const store = createReportStore();
  assert.equal(store.submit({ targetType: 'item', targetId: 'item-1', collectionId: 'shared-1' }).status, 'open');
  assert.equal(store.submit({ targetType: 'board', targetId: 'board-1', collectionId: 'shared-1' }).targetType, 'board');
  assert.throws(() => store.submit({ targetType: 'canvas', targetId: 'x', collectionId: 'shared-1' }), /INVALID_REPORT/);
  assert.equal(store.list().length, 2);
});
