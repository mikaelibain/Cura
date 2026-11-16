import assert from 'node:assert/strict';
import test from 'node:test';
import { createProductResolver, parseProductUrl } from '../productResolver.mjs';
import { createExactPageResolver, parseExactPage } from '../server/resolver/exactPage.mjs';
import { FirecrawlProvider } from '../server/resolver/providers/firecrawl.mjs';

const url = 'https://www.example.ca/products/face-toner/p/123456';
const context = parseProductUrl(url);
const json = (node) => `<script type="application/ld+json">${JSON.stringify(node)}</script>`;
const product = (offers = { price: '67.00', priceCurrency: 'CAD' }) => ({ '@type': 'Product',
  name: 'Hydrating Face Toner 200ml', offers, image: 'https://cdn.example.ca/123456.jpg' });
const page = (rawHtml) => ({ rawHtml, metadata: { sourceURL: url } });
const parse = (html) => parseExactPage(page(html), context);
const quota = { spend: () => true };
const noNetwork = async () => true;

test('JSON-LD price wins over labeled text and supplies title, verified image and provenance', () => {
  const result = parse(json(product()) + '<p>Our price $99</p>');
  assert.equal(result.price, '67');
  assert.equal(result.currency, 'CAD');
  assert.equal(result.title, 'Hydrating Face Toner 200ml');
  assert.equal(result.imageUrl, 'https://cdn.example.ca/123456.jpg');
  assert.equal(result.fieldSources.price, 'firecrawl_scrape');
  assert.equal(result.priceInfo.identityBasis, 'exact_url_same_market');
  assert.equal(JSON.stringify(result).includes('rawHtml'), false);
});

test('labeled current prices accepted, unlabeled promotions, old prices, installments, ranges and zero rejected', () => {
  for (const label of ['Our Price', 'Current price', 'Sale price', 'Now', 'Price']) assert.equal(parse(`<p>${label}: $67.00</p>`).price, '67');
  for (const text of ['$1.99 promotional deal', 'Was $79', 'Regular price $79', 'MSRP price $79', 'Save price $10',
    'Shipping price $1.99', 'Price $12 per month', 'Price $49-$79', 'Our price $0']) assert.equal(parse(text).price, '', text);
  assert.equal(parse('Was $79.00, now $49.99').price, '49.99');
  assert.equal(parse('Our Price $49.99; Current price $59.99').rejectionReason, 'PRICE_AMBIGUOUS');
  assert.equal(parse('Our Price $49.99; Current price $49.99').price, '49.99');
  assert.equal(parseExactPage({ markdown: '**Our Price:** $67.00' }, context).price, '67');
});

test('foreign JSON-LD currency and final URL market rejected', () => {
  assert.equal(parse(json(product({ price: 30, priceCurrency: 'USD' }))).rejectionReason, 'FOREIGN_MARKET_PRICE');
  assert.equal(parse('Current price USD 30').rejectionReason, 'FOREIGN_MARKET_PRICE');
  assert.equal(parseExactPage({ ...page(json(product())), metadata: { url: 'https://www.example.ca/en-us/products/face-toner/p/123456' } }, context).price, '');
});

test('ProductGroup priceSpecification supported; lowPrice and ranges never accepted', () => {
  assert.equal(parse(json({ ...product({ priceCurrency: 'CAD', priceSpecification: { price: 25 } }), '@type': 'ProductGroup' })).price, '25');
  assert.equal(parse(json(product({ lowPrice: 20, highPrice: 40, priceCurrency: 'CAD' }))).price, '');
  assert.equal(parse(json(product({ price: '20-40', priceCurrency: 'CAD' }))).price, '');
});

test('embedded state must be tied to the same product ID', () => {
  const state = (id) => `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { product: { productId: id, price: 45, currency: 'CAD' } } })}</script>`;
  const c = { ...context, productId: '123456' };
  assert.equal(parseExactPage(page(state('123456')), c).price, '45');
  assert.equal(parseExactPage(page(state('999999')), c).price, '');
});

test('scrape runs after direct and before missing-field search; verified image skips image search', async () => {
  const calls = [];
  const resolver = createProductResolver({ statePath: ':memory:', urlValidator: noNetwork,
    directResolver: async () => { calls.push('direct'); return {}; },
    exactPageResolver: createExactPageResolver({ quota, urlValidator: noNetwork, provider: { scrape: async () => { calls.push('scrape'); return page(json(product())); } } }),
    searchProviders: [{ resolveProductCandidates: async () => { calls.push('search'); return []; } }],
    imageResolver: { resolve: async () => { calls.push('image'); return null; } },
  });
  const first = await resolver(url);
  assert.equal(first.price, '67'); assert.equal(first.priceLookupOutcome, 'PRICE_FOUND');
  assert.equal(first.priceInfo.source, 'firecrawl_scrape');
  assert.deepEqual(calls, ['direct', 'scrape']);
  assert.equal((await resolver(url)).cacheHit, true);
  const manual = await resolver(url, { existing: { price: '12', currency: 'CAD' }, lockedFields: ['price', 'currency'] });
  assert.equal(manual.price, '12'); assert.equal(manual.fieldSources.price, 'user_edit');
  assert.equal((await resolver(url)).price, '67');
});

test('scrape quota failure stays retryable despite a successful empty search', async () => {
  let available = false, scrapes = 0;
  const resolver = createProductResolver({ statePath: ':memory:', urlValidator: noNetwork,
    directResolver: async () => ({ title: 'Hydrating Face Toner 200ml' }),
    exactPageResolver: createExactPageResolver({ urlValidator: noNetwork, quota: { spend: () => available },
      provider: { scrape: async () => { scrapes++; return page(json(product())); } } }),
    searchProviders: [{ resolveProductCandidates: async () => Object.assign([], { searchOutcome: 'empty', priceLookupOutcome: 'PRICE_NOT_FOUND' }) }],
  });
  assert.equal((await resolver(url)).priceLookupOutcome, 'PRICE_LOOKUP_UNAVAILABLE');
  available = true;
  assert.equal((await resolver(url)).price, '67');
  assert.equal(scrapes, 1);
});

test('search receives only fields still missing after scrape and cannot overwrite its verified price', async () => {
  let requested;
  const resolver = createProductResolver({ statePath: ':memory:', urlValidator: noNetwork, directResolver: async () => ({}),
    exactPageResolver: async () => parse(json({ ...product(), image: undefined })),
    searchProviders: [{ resolveProductCandidates: async (_context, options) => { requested = options.missingFields; return []; } }],
  });
  const result = await resolver(url);
  assert.equal(result.price, '67');
  assert.ok(requested.includes('imageUrl'));
  assert.ok(!requested.includes('price') && !requested.includes('title') && !requested.includes('currency'));
  assert.equal(JSON.stringify(resolver.inspectState()).includes('rawHtml'), false);
});

test('scrape HTTP and timeout failures never enter a negative cache', async () => {
  for (const error of [new Error('HTTP_402'), new Error('HTTP_429'), new Error('HTTP_503'), new DOMException('timeout', 'TimeoutError')]) {
    let attempts = 0;
    const resolver = createProductResolver({ statePath: ':memory:', urlValidator: noNetwork, directResolver: async () => ({}),
      exactPageResolver: async () => { attempts++; if (attempts === 1) throw error; return parse(json(product())); },
    });
    assert.equal((await resolver(url)).priceLookupOutcome, 'PRICE_LOOKUP_UNAVAILABLE');
    assert.deepEqual(resolver.inspectState().negative, {});
    assert.equal((await resolver(url)).price, '67');
    assert.equal(attempts, 2);
  }
});

test('scrape validates public source and final destinations and rejects unrelated product images', async () => {
  let called = false;
  const resolve = createExactPageResolver({ quota, provider: { scrape: async () => { called = true; return {}; } },
    urlValidator: async () => { throw new Error('PRIVATE_ADDRESS'); } });
  await assert.rejects(resolve(context), /PRIVATE_ADDRESS/);
  assert.equal(called, false);
  assert.equal(parse(json({ ...product(), image: 'https://cdn.example.ca/logo.png' })).imageUrl, undefined);
  assert.equal(parseExactPage({ ...page(json(product())), metadata: { url: url.replace('123456', '999999') } }, context).price, '');
});

test('completed empty scrape has short cache cooldown and no raw content in results', async () => {
  let scrapes = 0;
  const resolver = createProductResolver({ statePath: ':memory:', urlValidator: noNetwork, directResolver: async () => ({}),
    exactPageResolver: createExactPageResolver({ quota, urlValidator: noNetwork,
      provider: { scrape: async () => { scrapes++; return page(json(product(undefined)).replace('"67.00"', 'null')); } } }),
  });
  const first = await resolver(url);
  assert.equal(first.priceLookupOutcome, 'PRICE_NOT_FOUND');
  const second = await resolver(url);
  assert.equal(second.cacheHit, true); assert.equal(scrapes, 1);
  assert.equal(JSON.stringify(second).includes('rawHtml'), false);
});

test('Firecrawl uses scrape endpoint and treats quota, rate limit, server errors and timeout as failures', async () => {
  let body;
  const provider = new FirecrawlProvider('fixture', async (endpoint, options) => {
    assert.equal(endpoint, 'https://api.firecrawl.dev/v2/scrape'); body = JSON.parse(options.body);
    return { ok: true, json: async () => ({ success: true, data: page('Our price $67') }) };
  });
  await provider.scrape(url);
  assert.deepEqual(body, { url, formats: ['rawHtml', 'markdown'], onlyMainContent: false });
  for (const status of [402, 429, 500, 503]) {
    const failed = new FirecrawlProvider('fixture', async () => ({ ok: false, status }));
    await assert.rejects(failed.scrape(url), new RegExp(`HTTP_${status}`));
  }
  await assert.rejects(new FirecrawlProvider('fixture', async () => { throw new DOMException('timeout', 'TimeoutError'); }).scrape(url), /timeout/);
});
