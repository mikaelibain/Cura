import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProductImageResolver, buildImageQuery, validateImageCandidate, rasterDimensions } from '../server/resolver/images.mjs';
import { FirecrawlProvider } from '../server/resolver/providers/firecrawl.mjs';
import { SearchQuota } from '../server/resolver/quota.mjs';
import { createProductResolver, parseProductUrl, clearResolverDiagnostics, getResolverDiagnostics } from '../productResolver.mjs';
const url = 'https://www2.hm.com/en_ca/productpage.1337767006.html';
const context = parseProductUrl(url);
const product = { title: 'Purple Cowl-Neck Dress', fieldConfidence: { title: 'HIGH' }, fieldSources: { title: 'tavily_search' } };
const candidate = { imageUrl: 'https://image.hm.com/product.jpg', sourcePageUrl: url, title: product.title, width: 600, height: 800 };
test('image planner uses exact identity and verified title, never weak slug', () => {
  assert.equal(buildImageQuery(context, product), 'site:hm.com "1337767006" "Purple Cowl-Neck Dress"');
  assert.equal(buildImageQuery(context, {}), 'site:hm.com "1337767006"');
  assert.equal(buildImageQuery({ baseDomain: 'example.com' }, { title: 'dress', fieldSources: { title: 'url_slug' } }), '');
});
test('image identity accepts exact cross-market product, rejects unrelated and conflicting variants', () => {
  for (const locale of ['en_ca', 'fr_ca', 'en_us']) {
    const result = validateImageCandidate({ ...candidate, sourcePageUrl: url.replace('en_ca', locale) }, context, product);
    assert.equal(result.accepted, true); assert.equal(result.variantVerified, false);
    assert.equal(result.identityBasis, locale === 'en_ca' ? 'exact_url_same_market' : 'verified_same_product_cross_locale');
  }
  assert.equal(validateImageCandidate({ ...candidate, sourcePageUrl: url.replace('1337767006', '1337767007') }, context).accepted, false);
  assert.equal(validateImageCandidate({ ...candidate, sourcePageUrl: 'https://other.example/product/1337767006' }, context).accepted, false);
  const colored = parseProductUrl(url + '?color=red');
  assert.equal(validateImageCandidate({ ...candidate, sourcePageUrl: url + '?color=blue' }, colored).reason, 'VARIANT_CONFLICT');
  assert.equal(validateImageCandidate({ ...candidate, sourcePageUrl: url + '?color=red' }, colored).variantVerified, true);
  for (const imageUrl of ['https://image.hm.com/logo.png', 'file:///product.jpg', 'https://image.hm.com/banner.jpg']) assert.equal(validateImageCandidate({ ...candidate, imageUrl }, context).accepted, false);
  assert.equal(validateImageCandidate({ ...candidate, width: 16 }, context).reason, 'TINY_IMAGE');
  assert.equal(validateImageCandidate({ ...candidate, sourcePageUrl: 'https://other.example/p/0123456789012' }, { ...context, gtin: '0123456789012' }).accepted, true);
});
test('Firecrawl sends only image source and normalizes actual REST image fields', async () => {
  const provider = new FirecrawlProvider('test', async (endpoint, options) => {
    assert.equal(endpoint, 'https://api.firecrawl.dev/v2/search');
    assert.deepEqual(JSON.parse(options.body), { query: 'query', sources: ['images'], limit: 8 });
    assert.equal(options.headers.Authorization, 'Bearer test');
    assert.equal(options.headers['Content-Type'], 'application/json');
    assert.ok(options.signal instanceof AbortSignal);
    return { ok: true, json: async () => ({ success: true, creditsUsed: 2, data: { images: [{ url, imageUrl: candidate.imageUrl, title: product.title, imageWidth: 600, imageHeight: 800, position: 2 }] } }) };
  });
  const result = await provider.searchImages('query');
  assert.equal(result.candidates[0].sourcePageUrl, url); assert.equal(result.candidates[0].width, 600); assert.equal(result.creditsUsed, 2);
  assert.equal(result.candidates[0].position, 2);
});
test('image cache shares tracking equivalents, deduplicates concurrent requests, and counts one provider call', async () => {
  const path = await mkdtemp(join(tmpdir(), 'cura-images-'));
  try {
    let calls = 0;
    const quota = new SearchQuota({ path: join(path, 'quota.json'), dailyCap: 10, providerCaps: { firecrawl: 10 } });
    const make = () => new ProductImageResolver({ cachePath: join(path, 'images'), quota,
      provider: { searchImages: async () => { calls++; return { candidates: [candidate] }; } }, checkAsset: async () => ({ width: 600, height: 800 }) });
    const [a, b] = await Promise.all([make().resolve(context, product), make().resolve(parseProductUrl(url + '?utm_source=ad'), product)]);
    assert.equal(a.imageUrl, candidate.imageUrl); assert.deepEqual(a, b); assert.equal(calls, 1);
    assert.equal((await make().resolve(context, product)).imageUrl, candidate.imageUrl); assert.equal(calls, 1);
    assert.equal(quota.getDailyUsage(), 1);
    assert.equal(Object.values(quota.state.calls)[0].firecrawlImageCalls, 1);
    assert.equal(await make().resolve(context, { imageUrl: 'https://image.hm.com/direct.jpg' }), null); assert.equal(calls, 1);
  } finally { await rm(path, { recursive: true, force: true }); }
});
test('image parser exclusively reads data.images and tolerates missing optional fields', async () => {
  for (const payload of [{ data: { web: [candidate] } }, { data: [candidate] }, { images: [candidate] }]) {
    const provider = new FirecrawlProvider('test', async () => ({ ok: true, json: async () => payload }));
    await assert.rejects(provider.searchImages('q'), /INVALID_IMAGE_RESPONSE/);
  }
  const provider = new FirecrawlProvider('test', async () => ({ ok: true, json: async () => ({ data: { images: [{ imageUrl: candidate.imageUrl }] } }) }));
  const result = await provider.searchImages('q');
  assert.equal(result.candidates[0].imageUrl, candidate.imageUrl);
  assert.equal(result.candidates[0].width, undefined);
  assert.equal(result.candidates[0].sourcePageUrl, undefined);
});
test('image 502 preserves safe upstream diagnostics, charges one attempt, and leaves web cooldown untouched', async () => {
  const path = await mkdtemp(join(tmpdir(), 'cura-image-errors-'));
  try {
    clearResolverDiagnostics();
    const key = 'test-private-key';
    let calls = 0;
    const provider = new FirecrawlProvider(key, async () => {
      calls++;
      return { ok: false, status: 502, json: async () => ({ error: { code: 'UPSTREAM_TIMEOUT', message: `Image backend timeout; Bearer ${key}; token=secret-value` }, headers: { Authorization: key } }) };
    });
    const quota = new SearchQuota({ path: join(path, 'quota.json'), dailyCap: 10, providerCaps: { firecrawl: 10 } });
    const resolver = new ProductImageResolver({ provider, quota, cachePath: join(path, 'cache') });
    assert.equal(await resolver.resolve(context, product), null);
    assert.equal(calls, 1); assert.equal(quota.getDailyUsage(), 1);
    assert.equal(Object.values(quota.state.calls)[0].firecrawlImageCalls, 1);
    assert.equal(provider.retryAt, 0); assert.ok(provider.imageRetryAt > Date.now());
    const event = getResolverDiagnostics().find((entry) => entry.event === 'IMAGE_PROVIDER_FAILURE');
    assert.equal(event.status, 502); assert.equal(event.requestMode, 'IMAGE_SEARCH');
    assert.equal(event.upstreamCode, 'UPSTREAM_TIMEOUT'); assert.match(event.upstreamMessage, /Image backend timeout/);
    assert.ok(!JSON.stringify(event).includes(key)); assert.ok(!JSON.stringify(event).includes('secret-value'));
    assert.equal(await resolver.resolve(context, product), null); assert.equal(calls, 1);
  } finally { await rm(path, { recursive: true, force: true }); }
});
test('non-JSON image errors retain HTTP status without logging raw response', async () => {
  const provider = new FirecrawlProvider('test', async () => ({ ok: false, status: 502, json: async () => { throw new Error('HTML gateway response'); } }));
  await assert.rejects(provider.searchImages('q'), (error) => error.status === 502 && error.upstreamMessage === undefined);
});
test('provider outages are retryable; broken assets are rejected before selection', async () => {
  const path = await mkdtemp(join(tmpdir(), 'cura-images-'));
  try {
    let calls = 0;
    const resolver = new ProductImageResolver({ cachePath: path, quota: { spend: () => true },
      provider: { searchImages: async () => { if (++calls === 1) throw new Error('HTTP_429'); return { candidates: [{ ...candidate, imageUrl: 'https://image.hm.com/broken.jpg' }, candidate] }; } },
      checkAsset: async (image) => { if (image.includes('broken')) throw new Error('IMAGE_HTTP_404'); return { width: 600, height: 800 }; } });
    assert.equal(await resolver.resolve(context, product), null);
    assert.equal((await resolver.resolve(context, product)).imageUrl, candidate.imageUrl); assert.equal(calls, 2);
  } finally { await rm(path, { recursive: true, force: true }); }
});
test('image-only skips retailer extraction and price; preserves image provenance in shared records', async () => {
  let imageCalls = 0;
  const resolve = createProductResolver({ statePath: ':memory:', urlValidator: async () => {},
    directResolver: async () => { throw new Error('must not call retailer'); },
    searchProviders: [{ name: 'fixture', resolveProductCandidates: async (_, { missingFields }) => {
      assert.ok(!missingFields.includes('price')); return [{ url, title: product.title, providerSource: 'tavily_search', price: '30', currency: 'CAD' }];
    } }], imageResolver: { resolve: async () => { imageCalls++; return { imageUrl: candidate.imageUrl, confidence: 'HIGH', imageInfo: { identityBasis: 'verified_retailer' } }; } } });
  const result = await resolve(url, { imageOnly: true });
  assert.equal(result.imageUrl, candidate.imageUrl); assert.equal(result.price, ''); assert.equal(result.imageInfo.identityBasis, 'verified_retailer'); assert.equal(imageCalls, 1);
});
test('raster header validation rejects HTML and reads real dimensions', () => {
  assert.equal(rasterDimensions(Buffer.from('<html>not an image at all</html>')), null);
  const png = Buffer.alloc(32); Buffer.from([137,80,78,71,13,10,26,10]).copy(png); png.writeUInt32BE(600, 16); png.writeUInt32BE(800, 20);
  assert.deepEqual(rasterDimensions(png), [600, 800]);
});
test('manufacturer title matching requires brand, size and variant evidence', () => {
  const identity = { title: 'Lancome Tonique Confort 200ml', brand: 'Lancome', fieldSources: { brand: 'retailer_page' }, fieldConfidence: { title: 'HIGH' } };
  const official = { ...candidate, sourcePageUrl: 'https://www.lancome.com/tonique-confort', title: identity.title };
  assert.equal(validateImageCandidate(official, context, identity).identityBasis, 'verified_manufacturer');
  assert.equal(validateImageCandidate({ ...official, title: 'Lancome Tonique Confort 400ml' }, context, identity).accepted, false);
  assert.equal(validateImageCandidate(official, { ...context, colorId: 'pink' }, identity).accepted, false);
  assert.equal(validateImageCandidate({ ...official, sourcePageUrl: 'https://random.example/tonique-confort' }, context, identity).accepted, false);
});
test('good direct and user-locked images never spend image credits', async () => {
  let imageCalls = 0;
  const imageResolver = { resolve: async () => { imageCalls++; return null; } };
  const make = (direct) => createProductResolver({ statePath: ':memory:', urlValidator: async () => {}, imageResolver, directResolver: async () => direct });
  const direct = await make({ title: product.title, imageUrl: candidate.imageUrl })(url);
  assert.equal(direct.imageUrl, candidate.imageUrl); assert.equal(imageCalls, 0);
  const user = await make({})(url, { existing: { imageUrl: 'https://user.example/my.jpg' }, lockedFields: ['imageUrl'] });
  assert.equal(user.imageUrl, 'https://user.example/my.jpg'); assert.equal(imageCalls, 0);
});
