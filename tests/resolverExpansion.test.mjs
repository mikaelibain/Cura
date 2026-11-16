import assert from 'node:assert/strict';
import test from 'node:test';
import { BraveSearchApiProvider, createProductResolver, DirectGoogleSearchProvider, parseProductUrl, SerpApiSearchProvider, verifyCandidate } from '../productResolver.mjs';
import { extractProduct } from '../server.mjs';

const url = 'https://www2.hm.com/en_ca/productpage.1349191002.html?srsltid=ABC';
const context = parseProductUrl(url);
const exact = 'https://www2.hm.com/en_ca/productpage.1349191002.html?utm_source=google';
const noNetworkValidation = async () => true;

test('Macy’s URL keeps Web ID and US market while dropping recommendation tracking', () => {
  const original = 'https://www.macys.com/shop/product/olaplex-n.7-bonding-oil-1-oz.?ID=10837615&tdp=cm_app~zMCOM-NAVAPP~zPDP_ZONE_A';
  const parsed = parseProductUrl(original);
  assert.equal(parsed.retailer, "Macy's");
  assert.equal(parsed.baseDomain, 'macys.com');
  assert.equal(parsed.country, 'US');
  assert.equal(parsed.currencyHint, 'USD');
  assert.equal(parsed.productId, '10837615');
  assert.equal(parsed.originalUrl, original);
  assert.equal(parsed.normalizedUrl, 'https://www.macys.com/shop/product/olaplex-n.7-bonding-oil-1-oz.?ID=10837615');
});

test('SerpAPI quota failure immediately falls through to the configured indexed API candidate', async () => {
  const original = 'https://www.macys.com/shop/product/olaplex-n.7-bonding-oil-1-oz.?ID=10837615&tdp=cm_app~zMCOM-NAVAPP';
  let serpCalls = 0;
  let braveCalls = 0;
  const serp = new SerpApiSearchProvider('serp-key', async () => {
    serpCalls += 1;
    return { ok: false, status: 429, json: async () => ({ error: 'Your account has run out of searches.' }) };
  });
  const exactUrl = 'https://www.macys.com/shop/product/olaplex-n.7-bonding-oil-1-oz.?ID=10837615';
  const brave = new BraveSearchApiProvider('brave-key', async () => {
    braveCalls += 1;
    return { ok: true, status: 200, json: async () => ({ web: { results: [{
      title: 'Olaplex Nº.7 Bonding Oil, 1 oz.', url: exactUrl,
      description: 'Current price $30.00. Olaplex Nº.7 Bonding Oil, 1 oz.',
      thumbnail: { src: 'https://images.example/olaplex-no7.jpg' },
      profile: { long_name: "Macy's" },
    }] } }) };
  });
  const resolver = createProductResolver({ statePath: ':memory:', urlValidator: noNetworkValidation,
    directResolver: async () => { throw new Error('HTTP_403'); }, searchProviders: [serp, brave] });
  const result = await resolver(original, { force: true });
  assert.equal(serpCalls, 1);
  assert.equal(serp.state, 'quota_exhausted');
  assert.equal(braveCalls, 1);
  assert.equal(result.productId, '10837615');
  assert.equal(result.imageUrl, 'https://images.example/olaplex-no7.jpg');
  assert.equal(result.price, '30.00');
  assert.equal(result.currency, 'USD');
  assert.equal(result.priceEstimated, false);
  assert.equal(result.fieldSources.price, 'brave_api_web');
});

test('wrong Macy’s Web ID is rejected even when the retailer and title look similar', async () => {
  const original = 'https://www.macys.com/shop/product/olaplex-n.7-bonding-oil-1-oz.?ID=10837615';
  const provider = new BraveSearchApiProvider('brave-key', async () => ({ ok: true, status: 200, json: async () => ({ web: { results: [{
    title: 'Olaplex Nº.7 Bonding Oil, 1 oz.', url: 'https://www.macys.com/shop/product/olaplex-n.7-bonding-oil-1-oz.?ID=99999999',
    description: 'Current price $30.00', thumbnail: { src: 'https://images.example/wrong.jpg' },
  }] } }) }));
  const resolver = createProductResolver({ statePath: ':memory:', urlValidator: noNetworkValidation,
    directResolver: async () => { throw new Error('HTTP_403'); }, searchProviders: [provider] });
  const result = await resolver(original, { force: true });
  assert.equal(result.price, '');
  assert.equal(result.imageUrl, '');
});

test('empty raw Google HTML is reported as unavailable and the next indexed provider runs', async () => {
  const original = 'https://www.macys.com/shop/product/olaplex-n.7-bonding-oil-1-oz.?ID=10837615';
  const google = new DirectGoogleSearchProvider(async () => ({ ok: true, text: async () => '<html>Please enable JavaScript</html>' }));
  let providerBCalls = 0;
  const providerB = new BraveSearchApiProvider('brave-key', async () => {
    providerBCalls += 1;
    return { ok: true, status: 200, json: async () => ({ web: { results: [] } }) };
  });
  const resolver = createProductResolver({ statePath: ':memory:', urlValidator: noNetworkValidation,
    directResolver: async () => { throw new Error('HTTP_403'); }, searchProviders: [google, providerB] });
  await resolver(original, { force: true });
  assert.equal(google.state, 'unavailable');
  assert.equal(google.lastFailureReason, 'NO_RESULT_CARDS_OR_JS_SHELL');
  assert.ok(providerBCalls > 0);
});

test('normalization preserves the pasted URL and meaningful parameters', () => {
  const parsed = parseProductUrl(`${url}&variant=123&utm_campaign=sale&unknown=keep`);
  assert.equal(parsed.originalUrl, `${url}&variant=123&utm_campaign=sale&unknown=keep`);
  assert.equal(parsed.normalizedUrl, 'https://www2.hm.com/en_ca/productpage.1349191002.html?variant=123&unknown=keep');
  assert.equal(parsed.retailer, 'H&M');
  assert.equal(parsed.productId, '1349191002');
  assert.equal(parsed.searchQueries[0], '1349191002');
});

test('Sephora search targets product ID, SKU, URL title, and exact normalized URL', async () => {
  const sephora = parseProductUrl('https://www.sephora.com/ca/en/product/kerastase-genesis-anti-hair-fall-fortifying-serum-P458591?skuId=2358794&utm_source=ads');
  const queries = [];
  const provider = new SerpApiSearchProvider('test-key', async (endpoint) => {
    queries.push(new URL(endpoint).searchParams.get('q'));
    return { ok: true, json: async () => ({ organic_results: [] }) };
  });
  await provider.resolveProductCandidates(sephora);
  assert.deepEqual(queries, [
    'site:sephora.com "P458591"',
    'site:sephora.com "2358794"',
    'site:sephora.com "kerastase genesis anti hair fall fortifying serum"',
    '"kerastase" "kerastase genesis anti hair fall fortifying serum" Sephora',
    sephora.normalizedUrl,
  ]);
  assert.equal(sephora.originalUrl, 'https://www.sephora.com/ca/en/product/kerastase-genesis-anti-hair-fall-fortifying-serum-P458591?skuId=2358794&utm_source=ads');
});

test('direct Google continues Sephora searches from ID to URL title until identity is verified', async () => {
  const { DirectGoogleSearchProvider } = await import('../productResolver.mjs');
  const sephora = parseProductUrl('https://www.sephora.com/ca/en/product/kerastase-genesis-anti-hair-fall-fortifying-serum-P458591?skuId=2358794');
  const queries = [];
  const provider = new DirectGoogleSearchProvider(async (endpoint) => {
    const parsed = new URL(endpoint);
    const query = parsed.searchParams.get('q');
    queries.push(query);
    return { ok: true, text: async () => query.includes('"kerastase genesis anti hair fall fortifying serum"')
      ? `<a href="${sephora.normalizedUrl}"><h3>Kérastase Genesis Anti Hair-Fall Fortifying Serum</h3></a>`
      : '<html>No matching result cards</html>' };
  });
  await provider.resolveProductCandidates(sephora);
  assert.equal(queries[0], 'site:sephora.com "P458591"');
  assert.ok(queries.some((query) => query.includes('"kerastase genesis anti hair fall fortifying serum"')));
});

test('candidate identity rejects another product and another merchant', () => {
  assert.equal(verifyCandidate({ url: exact, title: 'Dress' }, context).confidence, 'HIGH');
  assert.equal(verifyCandidate({ url: 'https://www2.hm.com/en_ca/productpage.9999999999.html', title: 'Dress' }, context).confidence, 'LOW');
  assert.equal(verifyCandidate({ url: 'https://poshmark.com/listing/1349191002', title: 'H&M Dress' }, context).confidence, 'LOW');
});

test('SerpAPI caches quota exhaustion and retries after its cooldown', async () => {
  let calls = 0;
  let time = 0;
  const provider = new SerpApiSearchProvider('key', async () => {
    calls += 1;
    return { ok: true, json: async () => ({ error: 'You have run out of searches and credits for this month' }) };
  }, () => time);
  await provider.resolveProductCandidates(context);
  assert.equal(provider.state, 'quota_exhausted');
  await provider.resolveProductCandidates(context);
  assert.equal(calls, 1);
  time = 60 * 60_000 + 1;
  await provider.resolveProductCandidates(context);
  assert.equal(calls, 2);
});

test('SerpAPI handles 429 and malformed responses without throwing', async () => {
  const limited = new SerpApiSearchProvider('key', async () => ({ ok: false, status: 429 }));
  assert.deepEqual(await limited.resolveProductCandidates(context), []);
  assert.equal(limited.state, 'rate_limited');
  const malformed = new SerpApiSearchProvider('key', async () => ({ ok: true, json: async () => { throw new SyntaxError('bad JSON'); } }));
  assert.deepEqual(await malformed.resolveProductCandidates(context), []);
  assert.equal(malformed.state, 'temporary_error');
});

test('SerpAPI evaluates multiple results and survives an empty response', async () => {
  const provider = new SerpApiSearchProvider('key', async (endpoint) => ({ ok: true, json: async () =>
    endpoint.searchParams.get('engine') === 'google' ? { organic_results: [
      { title: 'Wrong dress', link: 'https://www2.hm.com/en_ca/productpage.9999999999.html' },
      { title: 'Correct dress', link: exact },
    ] } : { shopping_results: [] } }));
  const candidates = await provider.resolveProductCandidates(context);
  assert.equal(candidates.length, 2);
  assert.equal(verifyCandidate(candidates[1], context).confidence, 'HIGH');
  const empty = new SerpApiSearchProvider('key', async () => ({ ok: true, json: async () => ({ organic_results: [], shopping_results: [] }) }));
  assert.deepEqual(await empty.resolveProductCandidates(context), []);
});

test('Google AI Overview price is tied to its cited exact Sephora product URL', async () => {
  const productUrl = 'https://www.sephora.com/ca/en/product/byoma-so-hydrated-set-P521848?skuId=2976694';
  const productContext = parseProductUrl(productUrl);
  const provider = new SerpApiSearchProvider('key', async () => ({ ok: true, json: async () => ({
    organic_results: [{ title: 'BYOMA So Hydrated Set', link: productUrl }],
    ai_overview: {
      text_blocks: [{ snippet: 'BYOMA So Hydrated Set is $30.00.', reference_indexes: [0] }],
      references: [{ title: 'BYOMA So Hydrated Set | Sephora', link: productUrl }],
    },
  }) }));
  const candidates = await provider.resolveProductCandidates(productContext);
  const overview = candidates.find((candidate) => candidate.providerSource === 'google_ai_overview');
  assert.equal(overview.price, '30.00');
  assert.equal(overview.currency, 'CAD');
  assert.equal(verifyCandidate(overview, productContext).confidence, 'HIGH');
});

test('direct Google discovers a later matching result and tolerates blocking', async () => {
  const html = '<a href="https://www2.hm.com/en_ca/productpage.9999999999.html"><img src="https://images.example/wrong.jpg"><h3>Wrong dress</h3></a>'
    + `<a href="${exact}"><img src="https://images.example/correct.jpg"><h3>Correct dress</h3></a>`;
  const provider = new DirectGoogleSearchProvider(async () => ({ ok: true, text: async () => html }));
  const candidates = await provider.resolveProductCandidates(context);
  assert.equal(candidates.length, 2);
  assert.equal(verifyCandidate(candidates[0], context).confidence, 'LOW');
  assert.equal(verifyCandidate(candidates[1], context).confidence, 'HIGH');
  assert.equal(candidates[1].imageUrl, 'https://images.example/correct.jpg');
  const blocked = new DirectGoogleSearchProvider(async () => ({ ok: true, text: async () => 'unusual traffic CAPTCHA' }));
  assert.deepEqual(await blocked.resolveProductCandidates(context), []);
  const empty = new DirectGoogleSearchProvider(async () => ({ ok: true, text: async () => '<html>No results</html>' }));
  assert.deepEqual(await empty.resolveProductCandidates(context), []);
});

test('quota exhaustion falls through to a verified later Google image', async () => {
  let serpCalls = 0;
  const serp = new SerpApiSearchProvider('key', async () => {
    serpCalls += 1;
    return { ok: true, json: async () => ({ error: 'Search quota exhausted' }) };
  });
  const google = new DirectGoogleSearchProvider(async () => ({ ok: true, text: async () =>
    `<a href="https://www2.hm.com/en_ca/productpage.9999999999.html"><img src="https://images.example/wrong.jpg"><h3>Wrong</h3></a><a href="${exact}"><img src="https://images.example/correct.jpg"><h3>Correct dress</h3></a>` }));
  const resolver = createProductResolver({ statePath: ':memory:', urlValidator: noNetworkValidation,
    directResolver: async () => { throw new Error('HTTP_403'); }, searchProviders: [serp, google] });
  const first = await resolver(url);
  assert.equal(first.imageUrl, 'https://images.example/correct.jpg');
  assert.equal(first.originalUrl, url);
  assert.equal(first.matchedCandidateUrl, exact);
  await resolver('https://www2.hm.com/en_ca/productpage.1349191002.html?utm_campaign=another');
  assert.equal(serpCalls, 1);
});

test('blocked retailer and search providers still produce a useful URL title', async () => {
  const resolver = createProductResolver({ statePath: ':memory:', urlValidator: noNetworkValidation,
    directResolver: async () => { throw new Error('HTTP_403'); }, searchProviders: [] });
  const result = await resolver('https://www.aritzia.com/en/product/sculpt-knit-squareneck-cropped-tank/123456.html');
  assert.equal(result.title, 'Sculpt Knit Squareneck Cropped Tank');
  assert.equal(result.retailer, 'Aritzia');
  assert.equal(result.price, '');
  assert.equal(result.fieldSources.title, 'url_slug');
});

test('verified image cannot replace a user image or a direct retailer image', async () => {
  const resolver = createProductResolver({ statePath: ':memory:', urlValidator: noNetworkValidation,
    directResolver: async () => ({ title: 'Dress', imageUrl: 'https://hm.com/direct.jpg', price: '40', currency: 'CAD' }),
    searchProviders: [{ resolveProductCandidates: async () => [{ url: exact, imageUrl: 'https://google.com/search.jpg', providerSource: 'shopping_result' }] }] });
  const result = await resolver(url, { lockedFields: ['imageUrl'], existing: { imageUrl: 'data:image/png;base64,user' } });
  assert.equal(result.imageUrl, 'data:image/png;base64,user');
  const withoutLock = await resolver(url);
  assert.equal(withoutLock.imageUrl, 'https://hm.com/direct.jpg');
});

test('direct extraction chooses the matching JSON-LD Product in a graph', () => {
  const html = `<script type="application/ld+json">${JSON.stringify({ '@graph': [
    { '@type': 'Product', name: 'Wrong', sku: '9999999999', offers: { price: '9' } },
    { '@type': 'Product', name: 'Correct dress', sku: '1349191002', image: 'https://images.example/correct.jpg', offers: { '@type': 'AggregateOffer', lowPrice: '68', priceCurrency: 'CAD' } },
  ] })}</script>`;
  const product = extractProduct(html, url);
  assert.equal(product.title, 'Correct dress');
  assert.equal(product.price, ''); // AggregateOffer.lowPrice is a range floor, not this product's current offer.
  assert.equal(product.currency, 'CAD');
  assert.equal(product.imageUrl, 'https://images.example/correct.jpg');
});

test('direct extraction reads ProductGroup, Open Graph, and safely parseable Next data', () => {
  const group = extractProduct('<script type="application/ld+json">{"@type":"ProductGroup","name":"Group dress","offers":{"price":"52","priceCurrency":"CAD"}}</script>', url);
  assert.equal(group.title, 'Group dress');
  assert.equal(group.price, '52');
  const og = extractProduct('<meta property="og:title" content="Open Graph Dress"><meta property="og:image" content="https://images.example/og.jpg">', url);
  assert.equal(og.title, 'Open Graph Dress');
  assert.equal(og.imageUrl, 'https://images.example/og.jpg');
  const next = extractProduct('<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"product":{"@type":"Product","name":"Next Dress","sku":"1349191002"}}}}</script>', url);
  assert.equal(next.title, 'Next Dress');
  assert.doesNotThrow(() => extractProduct('<script type="application/ld+json">{broken</script>', url));
  const shopify = extractProduct('<script type="application/json">{"product":{"handle":"linen-dress","title":"Linen Dress","vendor":"Maker","images":["https://images.example/linen.jpg"],"variants":[{"price":4500}]}}</script>', 'https://shop.example/products/linen-dress');
  assert.equal(shopify.title, 'Linen Dress');
  assert.equal(shopify.price, '45');
});

test('H&M adapter extracts article state for the Canada regression URL without hard-coding the article', () => {
  const original = 'https://www2.hm.com/en_ca/productpage.1338299003.html?srsltid=AU7gw4VtUkJeU7H5P_GkKQvbDnwObW_p2qoXwoMD43DFqTHD0W7ORocMmds';
  const html = '<script type="application/json; charset=utf-8">{"product":{"articleCode":"1338299003","name":"Asymmetric Dual-Fabric Dress","price":"34.99","currency":"CAD","images":["https://image.hm.com/assets/dress.jpg"],"brand":"H&M"}}</script>';
  const product = extractProduct(html, original);
  assert.equal(parseProductUrl(original).originalUrl, original);
  assert.equal(parseProductUrl(original).normalizedUrl, 'https://www2.hm.com/en_ca/productpage.1338299003.html');
  assert.equal(parseProductUrl(original).productId, '1338299003');
  assert.equal(product.title, 'Asymmetric Dual-Fabric Dress');
  assert.equal(product.brand, 'H&M');
  assert.equal(product.productId, '1338299003');
  assert.equal(product.price, '34.99');
  assert.equal(product.currency, 'CAD');
  assert.equal(product.imageUrl, 'https://image.hm.com/assets/dress.jpg');
  assert.equal(product.fieldSources.productId, 'hm_adapter');
});

test('H&M adapter generalizes to another article and safely ignores blocked challenge HTML', () => {
  const secondUrl = 'https://www2.hm.com/en_gb/productpage.1338299001.html';
  const html = '<script id="__NEXT_DATA__" type="application/json">{"page":{"product":{"articleNumber":"1338299001","title":"Asymmetric Dual-Fabric Dress","priceValue":19.99,"priceCurrency":"GBP","galleryImages":[{"url":"https://image.hm.com/assets/black.jpg"}]}}}</script>';
  const product = extractProduct(html, secondUrl);
  assert.equal(product.productId, '1338299001');
  assert.equal(product.price, '19.99');
  assert.equal(product.currency, 'GBP');
  assert.equal(product.imageUrl, 'https://image.hm.com/assets/black.jpg');
  const blocked = extractProduct('<HTML><BODY><H1>Access Denied</H1></BODY></HTML>', secondUrl);
  assert.equal(blocked.title, '');
  assert.equal(blocked.productId, '1338299001');
});

test('complete H&M direct extraction skips SerpAPI whether the provider is available or quota exhausted', async () => {
  const url = 'https://www2.hm.com/en_ca/productpage.1338299003.html?srsltid=tracking';
  const html = '<script type="application/json">{"product":{"articleCode":"1338299003","name":"Asymmetric Dual-Fabric Dress","price":"34.99","currency":"CAD","images":["https://image.hm.com/assets/dress.jpg"],"brand":"H&M"}}</script>';
  for (const state of ['available', 'quota_exhausted']) {
    let calls = 0;
    const provider = { kind: 'serpapi', state, resolveProductCandidates: async () => { calls += 1; return []; } };
    const resolver = createProductResolver({
      statePath: ':memory:',
      urlValidator: async () => true,
      directResolver: async (context) => ({ ...extractProduct(html, context.originalUrl), retailer: 'H&M', fieldSources: { title: 'hm_adapter', brand: 'hm_adapter', imageUrl: 'hm_adapter', price: 'hm_adapter' } }),
      searchProviders: [provider],
    });
    const result = await resolver(url, { force: true });
    assert.equal(result.title, 'Asymmetric Dual-Fabric Dress');
    assert.equal(result.productId, '1338299003');
    assert.equal(calls, 0, `SerpAPI should not be called for a complete direct result (${state})`);
  }
});
