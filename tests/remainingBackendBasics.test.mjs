import assert from 'node:assert/strict';
import test from 'node:test';
import { clearResolverDiagnostics, createProductResolver, getResolverDiagnostics } from '../productResolver.mjs';

const noNetworkValidation = async () => true;

test('#20 exact verified prices remain exact while unverified prices are omitted', async () => {
  const exactResolver = createProductResolver({
    statePath: ':memory:', urlValidator: noNetworkValidation,
    directResolver: async () => { throw new Error('HTTP_403'); },
    searchProviders: [{ resolveProductCandidates: async (context) => [{
      title: 'Exact Dress', retailer: 'Shop', url: context.canonicalCandidate,
      productId: context.productId, price: '84.99', currency: 'CAD', providerSource: 'shopping_result',
    }] }],
  });
  const exact = await exactResolver('https://shop.example/en_ca/products/exact-dress-123456');
  assert.equal(exact.price, '84.99');
  assert.equal(exact.priceEstimated, false);
  assert.equal(exact.fieldConfidence.price, 'HIGH');

  const mediumResolver = createProductResolver({
    statePath: ':memory:', urlValidator: noNetworkValidation,
    directResolver: async () => { throw new Error('HTTP_403'); },
    searchProviders: [{ resolveProductCandidates: async () => [{
      title: 'Loose-Fit Sweatshirt', brand: 'H&M', retailer: 'H&M', url: 'https://www2.hm.com/en_ca/index.html',
      price: '24.99', currency: 'CAD', providerSource: 'shopping_result',
    }] }],
  });
  const medium = await mediumResolver('https://www2.hm.com/en_ca/productpage.1353138005.html');
  assert.equal(medium.price, '');
  assert.equal(medium.priceEstimated, false);
});

test('last-chance category estimates never enter the canonical offer price', async () => {
  const resolver = createProductResolver({
    statePath: ':memory:', urlValidator: noNetworkValidation,
    directResolver: async () => { throw new Error('HTTP_403'); },
    searchProviders: [],
    lastChanceResolver: async () => ({
      price: '37', currency: 'USD', priceEstimated: true,
      fieldSources: { price: 'retailer_price_estimate' }, fieldConfidence: { price: 'MEDIUM' },
    }),
  });
  const result = await resolver('https://www.macys.com/shop/product/olaplex-n.7-bonding-oil-1-oz.?ID=10837615', { force: true });
  assert.equal(result.price, '');
  assert.equal(result.currency, 'USD');
  assert.equal(result.priceEstimated, false);
});

test('#21 URL locale supplies currency and rejects an exact-ID result from the wrong market', async () => {
  const inferredResolver = createProductResolver({
    statePath: ':memory:', urlValidator: noNetworkValidation,
    directResolver: async () => ({ title: 'Canadian Product', brand: 'Maker', retailer: 'Shop', imageUrl: 'https://images.example/ca.jpg', price: '30', currency: '' }),
    searchProviders: [{ resolveProductCandidates: async () => [] }],
  });
  const inferred = await inferredResolver('https://shop.example/en_ca/products/canadian-product-111111');
  assert.equal(inferred.currency, 'CAD');
  assert.equal(inferred.fieldSources.currency, 'url_locale');

  const mismatchResolver = createProductResolver({
    statePath: ':memory:', urlValidator: noNetworkValidation,
    directResolver: async () => { throw new Error('HTTP_403'); },
    searchProviders: [{ resolveProductCandidates: async () => [{
      title: 'Canadian Product', retailer: 'Shop', url: 'https://shop.example/en_us/products/canadian-product-222222',
      productId: '222222', price: '30', currency: 'USD', providerSource: 'shopping_result',
    }] }],
  });
  const mismatch = await mismatchResolver('https://shop.example/en_ca/products/canadian-product-222222');
  assert.equal(mismatch.price, '');
  assert.equal(mismatch.currency, 'CAD');
});

test('#38 cache stores verified products, expires them, and briefly caches URL-derived partial results', async () => {
  let successfulCalls = 0;
  const expiringResolver = createProductResolver({
    statePath: ':memory:', cacheTtlMs: -1, urlValidator: noNetworkValidation,
    directResolver: async () => {
      successfulCalls += 1;
      return { title: 'Fresh Product', brand: 'Maker', retailer: 'Shop', imageUrl: 'https://images.example/fresh.jpg', price: '18', currency: 'USD' };
    },
  });
  await expiringResolver('https://shop.example/products/fresh-333333');
  await expiringResolver('https://shop.example/products/fresh-333333');
  assert.equal(successfulCalls, 2);

  let failedCalls = 0;
  const failedResolver = createProductResolver({
    statePath: ':memory:', urlValidator: noNetworkValidation,
    directResolver: async () => { failedCalls += 1; throw new Error('HTTP_403'); },
    searchProviders: [{ resolveProductCandidates: async () => [] }],
  });
  await failedResolver('https://shop.example/products/unresolved-444444');
  await failedResolver('https://shop.example/products/unresolved-444444');
  assert.equal(failedCalls, 1);
  assert.equal(Object.keys(failedResolver.inspectState().products).length, 1);
});

test('#39 every populated field records source and confidence provenance', async () => {
  const resolver = createProductResolver({
    statePath: ':memory:', urlValidator: noNetworkValidation,
    directResolver: async () => ({ title: 'Provenance Product', imageUrl: 'https://images.example/provenance.jpg', price: '60' }),
    searchProviders: [{ resolveProductCandidates: async () => [] }],
  });
  const result = await resolver('https://independent-shop.example/en_ca/products/provenance-product-555555');
  for (const field of ['title', 'imageUrl', 'price', 'retailer', 'brand', 'currency']) {
    assert.ok(result[field], field);
    assert.ok(result.fieldSources[field], `${field} source`);
    assert.ok(result.fieldConfidence[field], `${field} confidence`);
  }
  assert.equal(result.fieldSources.title, 'retailer_page');
  assert.equal(result.fieldSources.retailer, 'url_domain');
  assert.equal(result.fieldSources.currency, 'url_locale');
});

test('#49 diagnostics record the resolution lifecycle without entering product fields', async () => {
  clearResolverDiagnostics();
  const resolver = createProductResolver({
    statePath: ':memory:', urlValidator: noNetworkValidation,
    directResolver: async () => { throw new Error('HTTP_403'); },
    searchProviders: [{ resolveProductCandidates: async (context) => [{
      title: 'Observed Product', brand: 'Maker', retailer: 'Shop', url: context.canonicalCandidate,
      imageUrl: 'https://images.example/observed.jpg', price: '70', currency: 'USD', providerSource: 'shopping_result',
    }] }],
  });
  const result = await resolver('https://shop.example/products/observed-666666');
  await resolver('https://shop.example/products/observed-666666');
  const events = getResolverDiagnostics().map((entry) => entry.event);
  for (const event of ['URL_PARSED', 'CACHE_MISS', 'DIRECT_STARTED', 'DIRECT_BLOCKED', 'FALLBACK_STARTED', 'CANDIDATE_FOUND', 'CANDIDATE_VERIFIED', 'FIELD_MERGED', 'RESOLUTION_COMPLETE', 'CACHE_HIT']) {
    assert.ok(events.includes(event), event);
  }
  assert.equal(Object.hasOwn(result, 'diagnostics'), false);
});
