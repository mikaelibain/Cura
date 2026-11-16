import assert from 'node:assert/strict';
import test from 'node:test';
import { createProductResolver, parseProductUrl, SephoraSkuImageProvider } from '../productResolver.mjs';

const url = 'https://www.sephora.com/ca/en/product/kerastase-genesis-anti-hair-fall-fortifying-serum-P458591?skuId=2358794';
const imageUrl = 'https://www.sephora.com/productimages/sku/s2358794-main-zoom.jpg';
const jpeg = new Uint8Array(6_000); jpeg[0] = 0xff; jpeg[1] = 0xd8;
const assetProvider = () => new SephoraSkuImageProvider(async () => ({ ok: true, headers: new Headers({ 'content-type': 'image/jpeg', 'content-length': '6000' }), arrayBuffer: async () => jpeg.buffer }));
const candidate = (overrides = {}) => ({ url, title: 'Genesis Anti Hair-Fall Fortifying Serum', brand: 'Kérastase',
  retailer: 'Sephora', sku: '2358794', price: '95.00', currency: 'CAD', providerSource: 'search_result', ...overrides });
const resolver = (providers) => createProductResolver({ statePath: ':memory:', urlValidator: async () => true,
  directResolver: async () => { throw new Error('HTTP_403'); }, searchProviders: providers });

test('title-only Sephora cache stays enrichable and writes verified fields back to the shared record', async () => {
  let calls = 0;
  const provider = { kind: 'serpapi', resolveProductCandidates: async () => {
    calls += 1;
    return calls === 1 ? [] : [candidate()];
  } };
  const resolve = resolver([assetProvider(), provider]);
  const first = await resolve(url);
  assert.equal(first.fieldSources.title, 'url_slug');
  assert.equal(first.imageUrl, imageUrl);
  assert.equal(first.price, '');
  const second = await resolve(url, { force: true });
  assert.equal(second.title, 'Genesis Anti Hair-Fall Fortifying Serum');
  assert.equal(second.brand, 'Kérastase');
  assert.equal(second.retailer, 'Sephora');
  assert.equal(second.price, '95.00');
  assert.equal(second.imageUrl, imageUrl);
  const record = Object.values(resolve.inspectState().products)[0];
  assert.equal(record.product.price, '95.00');
  assert.equal(record.product.imageUrl, imageUrl);
  assert.equal(record.product.fieldSources.brand, 'search_result');
  const third = await resolve(url);
  assert.equal(third.cacheHit, true);
  assert.equal(calls, 2);
});

test('a provider failure does not block Sephora SKU image and later verified candidate', async () => {
  const resolve = resolver([{ resolveProductCandidates: async () => { throw new Error('failed'); } }, assetProvider(),
    { resolveProductCandidates: async () => [candidate()] }]);
  const result = await resolve(url);
  assert.equal(result.imageUrl, imageUrl);
  assert.equal(result.price, '95.00');
});

test('another retailer cannot supply Sephora price; exact global ID may supply image only', async () => {
  const context = parseProductUrl(url);
  context.upc = '123456789012';
  const resolve = createProductResolver({ statePath: ':memory:', urlValidator: async () => true,
    directResolver: async () => ({ upc: context.upc }), searchProviders: [{ resolveProductCandidates: async () => [
      candidate({ url: 'https://www.walmart.ca/en/ip/serum/123456789012', retailer: 'Walmart Canada', upc: context.upc,
        imageUrl: 'https://images.example/verified-serum.jpg', price: '40.00' }),
    ] }] });
  const result = await resolve(url);
  assert.equal(result.imageUrl, 'https://images.example/verified-serum.jpg');
  assert.equal(result.price, '');
});

test('Sephora SKU asset rejects a broken or tiny image', async () => {
  const context = parseProductUrl(url);
  const provider = new SephoraSkuImageProvider(async () => ({ ok: true, headers: new Headers({ 'content-type': 'image/jpeg', 'content-length': '250' }), arrayBuffer: async () => new Uint8Array(250).buffer }));
  assert.deepEqual(await provider.resolveProductCandidates(context, { missingFields: ['imageUrl'] }), []);
});

test('placeholder title and zero price do not stop field completion', async () => {
  let called = false;
  const resolve = createProductResolver({ statePath: ':memory:', urlValidator: async () => true,
    directResolver: async () => ({ title: 'Sephora product', price: '0', currency: 'CAD' }),
    searchProviders: [{ resolveProductCandidates: async () => { called = true; return [candidate({ imageUrl })]; } }],
  });
  const result = await resolve(url);
  assert.equal(called, true);
  assert.equal(result.title, 'Genesis Anti Hair-Fall Fortifying Serum');
  assert.equal(result.price, '95.00');
  assert.equal(result.imageUrl, imageUrl);
});
