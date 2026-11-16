import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProductResolver, parseProductUrl, upsertResolvedProduct } from '../productResolver.mjs';
import { buildSearchQueries, normalizeSearchCandidate, parseSearchPrice } from '../server/resolver/matcher.mjs';
import { SearchRotation } from '../server/resolver/rotation.mjs';
import { SearchQuota } from '../server/resolver/quota.mjs';
import { extractProduct } from '../server.mjs';
import { hasValidProductPrice } from '../src/pricePresentation.ts';
import { readFile } from 'node:fs/promises';

const london = 'https://www.londondrugs.com/products/lancome-tonique-confort-200ml/p/L0012328';
const hm = 'https://www2.hm.com/en_ca/productpage.1337767006.html';
const hmFr = 'https://www2.hm.com/fr_ca/productpage.1337767006.html';
const hmUs = 'https://www2.hm.com/en_us/productpage.1337767006.html';
const noNetwork = async () => true;
const exactPrice = { title: 'LANCOME TONIQUE CONFORT 200ML', url: london, snippet: 'LANCOME TONIQUE CONFORT 200ML — $67.00 CAD current price at London Drugs' };

test('same retailer, exact product, current CAD offer is accepted with provenance', async () => {
  const context = parseProductUrl(london);
  const parsed = parseSearchPrice(exactPrice, context);
  assert.equal(parsed.price, '67'); assert.equal(parsed.currency, 'CAD');
  const resolver = createProductResolver({ statePath: ':memory:', urlValidator: noNetwork,
    directResolver: async () => { throw new Error('search-only must not fetch retailer'); },
    searchProviders: [{ kind: 'cura_search_rotation', name: 'Tavily to Firecrawl', resolveProductCandidates: async () => [normalizeSearchCandidate(exactPrice, context, { name: 'Tavily', kind: 'tavily_search' })] }],
  });
  const result = await resolver(london, { searchOnly: true });
  assert.equal(result.price, '67'); assert.equal(result.currency, 'CAD'); assert.equal(result.fieldConfidence.price, 'HIGH');
  assert.equal(result.fieldSources.price, 'tavily_search');
  assert.equal(result.priceInfo.identityBasis, 'exact_product_same_market');
  assert.equal(result.priceInfo.currentOfferVerified, true); assert.equal(result.resolutionStatus, 'RESOLVED');
});

test('search price parser rejects foreign, installment, savings, ranges, old price, and zero evidence', () => {
  const context = parseProductUrl(london);
  const check = (snippet, url = london) => parseSearchPrice({ url, snippet }, context);
  assert.equal(check('Current price $24.99', hmUs).rejectionReason, 'FOREIGN_MARKET_PRICE');
  assert.equal(check('4 payments of $12.50').rejectionReason, 'INSTALLMENT_PRICE');
  assert.equal(check('Save $10 today').rejectionReason, 'SAVINGS_NOT_CURRENT');
  assert.equal(check('Price $49.99-$79.99').rejectionReason, 'PRICE_RANGE');
  assert.equal(check('Was $79.00').rejectionReason, 'OLD_PRICE');
  assert.equal(check('Current price $0').rejectionReason, 'ZERO_OR_INVALID_PRICE');
  assert.equal(check('Was $79.00, now $49.99').price, '49.99');
  assert.equal(check('$49.99 (was $79.00)').price, '49.99');
});

test('exact H&M French Canada price is allowed while US price cannot fill CAD', async () => {
  const context = parseProductUrl(hm);
  const provider = (candidate) => ({ kind: 'fixture', resolveProductCandidates: async () => [
    normalizeSearchCandidate(candidate, context, { name: 'Tavily', kind: 'tavily_search' }),
  ] });
  const resolve = (candidate) => createProductResolver({ statePath: ':memory:', urlValidator: noNetwork,
    directResolver: async () => ({}), searchProviders: [provider(candidate)] })(hm, { searchOnly: true });
  const french = await resolve({ url: hmFr, title: 'Purple Cowl Neck Dress', snippet: 'Current price CA$39.99', image: 'https://image.hm.com/product.jpg' });
  assert.equal(french.title, 'Purple Cowl Neck Dress'); assert.equal(french.imageUrl, 'https://image.hm.com/product.jpg');
  assert.equal(french.price, '39.99'); assert.equal(french.currency, 'CAD');
  const american = await resolve({ url: hmUs, title: 'Purple Cowl Neck Dress', snippet: 'Current price US$24.99', image: 'https://image.hm.com/product.jpg' });
  assert.equal(american.title, 'Purple Cowl Neck Dress'); assert.equal(american.imageUrl, 'https://image.hm.com/product.jpg');
  assert.equal(american.price, ''); assert.equal(american.currency, 'CAD');
});

test('wrong product ID and another retailer price are rejected', async () => {
  const context = parseProductUrl(london);
  const wrong = normalizeSearchCandidate({ ...exactPrice, url: london.replace('L0012328', 'L0012237'), snippet: 'Current price CA$41.00' }, context, { name: 'Tavily', kind: 'tavily_search' });
  const other = normalizeSearchCandidate({ ...exactPrice, url: 'https://www.lancome.ca/products/tonique-confort', snippet: 'Current price CA$41.00' }, context, { name: 'Tavily', kind: 'tavily_search' });
  const resolver = createProductResolver({ statePath: ':memory:', urlValidator: noNetwork, directResolver: async () => ({}),
    searchProviders: [{ resolveProductCandidates: async () => [wrong, other] }],
  });
  assert.equal((await resolver(london, { searchOnly: true })).price, '');
});

test('price focused second text query learns title and asks for a price within two queries', async () => {
  const context = parseProductUrl(london);
  const calls = [];
  const tavily = { name: 'Tavily', search: async (query) => {
    calls.push(['Tavily', query]);
    return calls.length === 1 ? [{ ...exactPrice, snippet: 'LANCOME TONIQUE CONFORT 200ML', price: undefined }]
      : [{ ...exactPrice, snippet: 'LANCOME TONIQUE CONFORT 200ML current price CA$67.00' }];
  } };
  const firecrawl = { name: 'Firecrawl', search: async (query) => { calls.push(['Firecrawl', query]); return []; } };
  const rotation = new SearchRotation({ providers: [tavily, firecrawl], quota: { canSpend: () => true, spend: () => true } });
  const candidates = await rotation.resolveProductCandidates(context, { missingFields: ['title', 'price', 'currency'] });
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], 'Tavily'); assert.equal(calls[1][0], 'Tavily');
  assert.match(calls[1][1], /"\$"/);
  assert.equal(candidates.priceLookupOutcome, 'PRICE_FOUND');
});

test('Firecrawl is not called when Tavily has a verified current price', async () => {
  const context = parseProductUrl(london); const calls = [];
  const rotation = new SearchRotation({ quota: { canSpend: () => true, spend: () => true }, providers: [
    { name: 'Tavily', search: async () => { calls.push('Tavily'); return [{ ...exactPrice, snippet: 'Current price CA$67.00' }]; } },
    { name: 'Firecrawl', search: async () => { calls.push('Firecrawl'); return []; } },
  ] });
  await rotation.resolveProductCandidates(context, { missingFields: ['title', 'price', 'currency'] });
  assert.deepEqual(calls, ['Tavily']);
});

test('direct structured offers prefer a current sale offer and ignore aggregate lowPrice', () => {
  const product = (offers) => extractProduct(`<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: 'LANCOME TONIQUE CONFORT 200ML', sku: 'L0012328', offers })}</script>`, london);
  const sale = product({ '@type': 'Offer', priceCurrency: 'CAD', price: '79.00', priceSpecification: [
    { '@type': 'UnitPriceSpecification', price: '79.00', priceCurrency: 'CAD', priceType: 'https://schema.org/ListPrice' },
    { '@type': 'UnitPriceSpecification', price: '49.99', priceCurrency: 'CAD', priceType: 'https://schema.org/SalePrice' },
  ] });
  assert.equal(sale.price, '49.99'); assert.equal(sale.currency, 'CAD');
  const range = product({ '@type': 'AggregateOffer', lowPrice: '35.00', highPrice: '70.00', priceCurrency: 'CAD' });
  assert.equal(range.price, '');
});

test('stale automated offer is replaced; user price stays local and wins', () => {
  const context = parseProductUrl(london); const oldTime = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
  const old = upsertResolvedProduct(null, { title: exactPrice.title, price: '79', currency: 'CAD', fieldSources: { title: 'tavily_search', price: 'tavily_search' }, fieldConfidence: { title: 'HIGH', price: 'HIGH' } }, context, oldTime, 60_000);
  const fresh = upsertResolvedProduct(old, { price: '49.99', currency: 'CAD', fieldSources: { price: 'firecrawl_search' }, fieldConfidence: { price: 'HIGH' } }, context, new Date().toISOString(), 60_000);
  assert.equal(fresh.product.price, '49.99');
  const manual = upsertResolvedProduct(fresh, { price: '12', currency: 'CAD', fieldSources: { price: 'user_edit' } }, context);
  assert.equal(manual.product.price, '49.99');
});

test('provider quota failure is retryable on the next UTC day and counts one call per request', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cura-price-quota-'));
  try {
    const path = join(dir, 'quota.json');
    const quota = new SearchQuota({ path, dailyCap: 2, providerCaps: { firecrawl: 20 } });
    assert.equal(quota.spend('firecrawl', 1, 'web'), true);
    assert.equal(quota.spend('firecrawl', 1, 'image'), true);
    assert.equal(quota.spend('firecrawl', 1, 'web'), false);
    const state = JSON.parse(await (await import('node:fs/promises')).readFile(path, 'utf8'));
    assert.equal(Object.values(state.calls)[0].firecrawlWebCalls, 1);
    assert.equal(Object.values(state.calls)[0].firecrawlImageCalls, 1);
    const day = new Date().toISOString().slice(0, 10);
    state.daily = { [day === '2026-01-01' ? '2025-12-31' : '2026-01-01']: 2 };
    await (await import('node:fs/promises')).writeFile(path, JSON.stringify(state));
    assert.equal(quota.spend('firecrawl', 1, 'web'), true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('quota and 502 price lookup failures do not poison the product; a later attempt enriches shared price', async () => {
  let calls = 0;
  const direct = async () => ({ title: exactPrice.title, imageUrl: 'https://cdn.londondrugs.com/L0012328.jpg', retailer: 'London Drugs' });
  const resolver = createProductResolver({ statePath: ':memory:', urlValidator: noNetwork, directResolver: direct, partialRetryMs: 0,
    searchProviders: [{ resolveProductCandidates: async (context) => {
      calls++;
      if (calls === 1) throw Object.assign(new Error('HTTP_502'), { status: 502 });
      return [normalizeSearchCandidate(exactPrice, context, { name: 'Tavily', kind: 'tavily_search' })];
    } }],
  });
  const first = await resolver(london);
  assert.equal(first.price, ''); assert.equal(first.priceLookupOutcome, 'PRICE_LOOKUP_UNAVAILABLE');
  const second = await resolver(london);
  assert.equal(second.price, '67'); assert.equal(second.priceLookupOutcome, 'PRICE_FOUND');
  assert.equal(calls, 2);
  const third = await resolver(london);
  assert.equal(third.price, '67'); assert.equal(calls, 2);
});

test('price only skips image enrichment and emits verified price provenance', async () => {
  let imageCalls = 0;
  const context = parseProductUrl(london);
  const resolver = createProductResolver({ statePath: ':memory:', urlValidator: noNetwork, directResolver: async () => ({}),
    imageResolver: { resolve: async () => { imageCalls++; return null; } },
    searchProviders: [{ resolveProductCandidates: async () => [normalizeSearchCandidate(exactPrice, context, { name: 'Tavily', kind: 'tavily_search' })] }],
  });
  const result = await resolver(london, { priceOnly: true });
  assert.equal(result.price, '67'); assert.equal(result.currency, 'CAD'); assert.equal(imageCalls, 0);
  assert.equal(result.priceInfo.provider, 'Tavily'); assert.equal(result.priceInfo.sourcePageUrl, london);
});

test('Add price appears only when a positive amount and currency are unavailable; native amount is preserved', () => {
  assert.equal(hasValidProductPrice(67, 'CAD'), true);
  assert.equal(hasValidProductPrice(67, 'CAD'), true); // manual and automatic prices share canonical Item state
  assert.equal(hasValidProductPrice(null, 'CAD'), false);
  assert.equal(hasValidProductPrice(0, 'CAD'), false);
  assert.equal(hasValidProductPrice(67, ''), false);
  assert.equal(hasValidProductPrice(Number.NaN, 'CAD'), false);
});

test('card condition uses canonical amount and currency rather than resolution status', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /!hasValidProductPrice\(item\.price, item\.currency\) && !item\.isLoading/);
  assert.equal(hasValidProductPrice(67, 'CAD'), true); // both user and verified automation use the canonical Item amount
  assert.equal(hasValidProductPrice(67, 'CAD'), true);
  assert.equal(hasValidProductPrice(null, 'CAD'), false);
});

test('price query planner adds one exact-ID price-focused second query', () => {
  const context = parseProductUrl(london); context.knownTitle = exactPrice.title;
  assert.equal(buildSearchQueries(context, { priceFocus: true })[0], 'site:londondrugs.com "L0012328" "LANCOME TONIQUE CONFORT 200ML" "$"');
});
