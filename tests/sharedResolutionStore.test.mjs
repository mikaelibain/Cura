import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createProductResolver, parseProductUrl, RESOLVER_VERSION, upsertResolvedProduct } from '../productResolver.mjs';

const base = 'https://www2.hm.com/en_ca/productpage.1349191002.html';
const image = 'https://image.hm.com/product-1349191002.jpg';
const direct = { title: 'Tie-detail halterneck dress', retailer: 'H&M', brand: 'H&M', imageUrl: image, price: '34.99', currency: 'CAD' };
const noNetworkValidation = async () => true;
const resolver = (directResolver, statePath = ':memory:', extras = {}) => createProductResolver({ directResolver, statePath, urlValidator: noNetworkValidation, ...extras });
const recordFor = (instance, url = base) => Object.values(instance.inspectState().products).find((entry) => entry.identity?.normalizedUrl === parseProductUrl(url).normalizedUrl);
const legacyKey = (url) => `${createHash('sha256').update(parseProductUrl(url).normalizedUrl).digest('hex')}::size::||||||||`;
const legacyState = (url, product, resolverVersion = 2) => ({ version: 1, registry: {}, products: {
  [legacyKey(url)]: { product, resolverVersion, resolvedAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString(), expiresAt: new Date(Date.now() + 60 * 60_000).toISOString() },
} });

test('title-only shared record gains image and price and is written back for the next user', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'cura-shared-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const statePath = join(dir, 'state.json');
  writeFileSync(statePath, JSON.stringify(legacyState(base, { title: direct.title, retailer: 'H&M', imageUrl: '', price: '', currency: 'CAD' })));
  let calls = 0;
  const userB = resolver(async () => { calls++; return direct; }, statePath);
  const enriched = await userB(`${base}?srsltid=B`);
  assert.equal(enriched.imageUrl, image);
  assert.equal(enriched.price, '34.99');
  const stored = Object.values(JSON.parse(readFileSync(statePath)).products).find((entry) => entry.resolverVersion === RESOLVER_VERSION && entry.product?.price === '34.99');
  assert.equal(stored.priceInfo.currency, 'CAD');
  assert.equal(stored.fieldMetadata.imageUrl.source, 'retailer_page');
  const userC = resolver(async () => { calls++; throw new Error('should not fetch'); }, statePath);
  const reused = await userC(`${base}?srsltid=C`);
  assert.equal(reused.cacheHit, true);
  assert.equal(reused.originalUrl, `${base}?srsltid=C`);
  assert.equal(calls, 1);
});

test('old generic title and weak URL title are corrected by verified data', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'cura-title-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'state.json');
  writeFileSync(path, JSON.stringify(legacyState(base, { title: 'Www2 product', fieldSources: { title: 'url_slug' } })));
  const instance = resolver(async () => direct, path);
  assert.equal((await instance(base)).title, direct.title);
  assert.equal(recordFor(instance).fieldMetadata.title.source, 'retailer_page');
});

test('strong retailer image survives a weaker verified Google thumbnail', () => {
  const context = parseProductUrl(base);
  const first = upsertResolvedProduct(null, { ...direct, fieldSources: { imageUrl: 'retailer_page' } }, context);
  const next = upsertResolvedProduct(first, { imageUrl: 'https://google.example/small.jpg', fieldSources: { imageUrl: 'direct_google_shopping' } }, context);
  assert.equal(next.product.imageUrl, image);
  assert.equal(next.fieldMetadata.imageUrl.source, 'retailer_page');
});

test('same-market verified price fills blank shared price with provenance and timestamp', () => {
  const context = parseProductUrl(base);
  const first = upsertResolvedProduct(null, { title: direct.title, fieldSources: { title: 'retailer_page' } }, context);
  const next = upsertResolvedProduct(first, { price: '35.00', currency: 'CAD', fieldSources: { price: 'direct_google_shopping' } }, context);
  assert.equal(next.priceInfo.amount, '35.00');
  assert.equal(next.priceInfo.market, 'CA');
  assert.equal(next.priceInfo.source, 'direct_google_shopping');
  assert.ok(Date.parse(next.priceInfo.verifiedAt));
});

test('foreign price cannot replace a Canadian shared price', () => {
  const context = parseProductUrl(base);
  const first = upsertResolvedProduct(null, { ...direct, fieldSources: { price: 'retailer_page' } }, context);
  const next = upsertResolvedProduct(first, { price: '20', currency: 'GBP', fieldSources: { price: 'direct_google_shopping' } }, context);
  assert.equal(next.product.price, '34.99');
  assert.equal(next.product.currency, 'CAD');
});

test('legacy estimated prices are discarded from shared offers and can be independently enriched', () => {
  const context = parseProductUrl(base);
  const stale = upsertResolvedProduct(null, {
    ...direct, price: '48', priceEstimated: true, estimateLow: '20', estimateHigh: '80',
    fieldSources: { title: 'retailer_page', imageUrl: 'retailer_page', price: 'retailer_price_estimate', currency: 'retailer_price_estimate' },
  }, context);
  assert.equal(stale.product.price, '');
  assert.equal(stale.product.priceEstimated, false);
  const enriched = upsertResolvedProduct(stale, {
    price: '34.99', currency: 'CAD', priceEstimated: false,
    fieldSources: { price: 'retailer_first_party_api', currency: 'retailer_first_party_api' },
    fieldConfidence: { price: 'HIGH', currency: 'HIGH' },
  }, context);
  assert.equal(enriched.product.price, '34.99');
  assert.equal(enriched.product.priceEstimated, false);
});

test('old resolver version triggers lazy enrichment while a current fresh complete record skips lookup', async () => {
  let calls = 0;
  const instance = resolver(async () => { calls++; return direct; });
  await instance(base);
  assert.equal(recordFor(instance).resolverVersion, RESOLVER_VERSION);
  assert.equal((await instance(base)).cacheHit, true);
  assert.equal(calls, 1);
});

test('a complete legacy-version record still runs the improved resolver once', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'cura-version-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'state.json');
  writeFileSync(path, JSON.stringify(legacyState(base, { ...direct, title: 'Www2 product' }, 2)));
  let calls = 0;
  const instance = resolver(async () => { calls++; return direct; }, path);
  assert.equal((await instance(base)).title, direct.title);
  assert.equal(calls, 1);
  assert.equal(recordFor(instance).resolverVersion, RESOLVER_VERSION);
});

test('a stale direct price can be refreshed by a verified local shopping offer', () => {
  const context = parseProductUrl(base);
  const oldTime = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
  const first = upsertResolvedProduct(null, { ...direct, fieldSources: { price: 'retailer_page' } }, context, oldTime);
  const next = upsertResolvedProduct(first, { price: '37.99', currency: 'CAD', fieldSources: { price: 'direct_google_shopping' } }, context);
  assert.equal(next.product.price, '37.99');
  assert.equal(next.priceInfo.market, 'CA');
});

test('manual Item price and image stay separate from improved shared metadata', async () => {
  const instance = resolver(async () => direct);
  const result = await instance(base, { lockedFields: ['price', 'imageUrl'], existing: { price: '68', imageUrl: 'data:image/png;base64,user' } });
  assert.equal(result.price, '68');
  assert.equal(result.imageUrl, 'data:image/png;base64,user');
  assert.equal(recordFor(instance).product.price, '34.99');
  assert.equal(recordFor(instance).product.imageUrl, image);
  assert.equal(JSON.stringify(instance.inspectState()).includes('base64,user'), false);
});

test('tracking variants share one identity while variant and seller identities stay separate', async () => {
  const instance = resolver(async () => direct);
  await instance(`${base}?srsltid=ONE`);
  await instance(`${base}?utm_source=two`);
  assert.equal(Object.keys(instance.inspectState().products).length, 1);
  await instance(`${base}?variant=red`);
  await instance(`${base}?variant=blue`);
  await instance(`${base}?selectedSellerId=0`);
  await instance(`${base}?selectedSellerId=1`);
  assert.equal(Object.keys(instance.inspectState().products).length, 5);
});

test('a failed search remains eligible for a later successful search', async () => {
  let calls = 0;
  const instance = resolver(async () => ({ title: 'Dress', retailer: 'H&M' }), ':memory:', { partialRetryMs: 0,
    searchProviders: [{ resolveProductCandidates: async () => (++calls === 1 ? [] : [{ title: direct.title, retailer: 'H&M', url: base, imageUrl: image, price: '34.99', currency: 'CAD', providerSource: 'shopping_result' }]) }],
  });
  assert.equal((await instance(base)).imageUrl, '');
  assert.equal((await instance(base)).imageUrl, image);
  assert.equal(calls, 2);
});

test('stale prices trigger enrichment and a newer verified local price replaces them', async () => {
  let price = '34.99';
  let calls = 0;
  const instance = resolver(async () => { calls++; return { ...direct, price }; }, ':memory:', { priceTtlMs: 1 });
  await instance(base);
  await new Promise((resolve) => setTimeout(resolve, 5));
  price = '36.99';
  assert.equal((await instance(base)).price, '36.99');
  assert.equal(calls, 2);
});

test('concurrent equivalent submissions share one lookup and preserve each pasted URL', async () => {
  let calls = 0;
  const instance = resolver(async () => { calls++; await new Promise((resolve) => setTimeout(resolve, 20)); return direct; });
  const [a, b] = await Promise.all([instance(`${base}?srsltid=A`), instance(`${base}?srsltid=B`)]);
  assert.equal(calls, 1);
  assert.equal(a.originalUrl, `${base}?srsltid=A`);
  assert.equal(b.originalUrl, `${base}?srsltid=B`);
  assert.equal(Object.keys(instance.inspectState().products).length, 1);
});

test('a running resolver reads an enriched persistent record ahead of its title-only memory cache', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'cura-read-through-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'state.json');
  let calls = 0;
  const instance = resolver(async () => { calls++; return { title: 'Dress', retailer: 'H&M' }; }, path);
  await instance(base);
  const persisted = JSON.parse(readFileSync(path));
  const key = legacyKey(base);
  persisted.products[key] = upsertResolvedProduct(persisted.products[key], direct, parseProductUrl(base));
  persisted.products[key].expiresAt = new Date(Date.now() + 60_000).toISOString();
  writeFileSync(path, JSON.stringify(persisted));
  const result = await instance(`${base}?srsltid=NEW`);
  assert.equal(result.cacheHit, true);
  assert.equal(result.imageUrl, image);
  assert.equal(result.price, '34.99');
  assert.equal(calls, 1);
});

test('write-back merges against a newer persistent enrichment completed during an older lookup', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'cura-write-race-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'state.json');
  let release;
  let started;
  const startedPromise = new Promise((resolve) => { started = resolve; });
  const pendingDirect = new Promise((resolve) => { release = resolve; });
  const instance = resolver(async () => { started(); return pendingDirect; }, path);
  const pending = instance(base);
  await startedPromise;
  const stored = upsertResolvedProduct(null, direct, parseProductUrl(base));
  stored.expiresAt = new Date(Date.now() + 60_000).toISOString();
  writeFileSync(path, JSON.stringify({ version: 1, registry: {}, products: { [legacyKey(base)]: stored } }));
  release({ title: 'Dress', retailer: 'H&M' });
  const result = await pending;
  assert.equal(result.imageUrl, image);
  assert.equal(result.price, '34.99');
  const written = Object.values(JSON.parse(readFileSync(path)).products);
  assert.equal(written.length, 1);
  assert.equal(written[0].resolverVersion, RESOLVER_VERSION);
  assert.equal(written[0].product.imageUrl, image);
});
