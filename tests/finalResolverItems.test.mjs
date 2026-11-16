import assert from 'node:assert/strict';
import test from 'node:test';
import { createProductResolver } from '../productResolver.mjs';

const noNetworkValidation = async () => true;
const partialDirect = async () => ({
  title: 'Pattern Product', brand: 'Maker', retailer: 'Pattern Shop',
  imageUrl: 'https://images.example/pattern.jpg', currency: 'CAD',
});

test('#32 learns independently for distinct URL path patterns on the same retailer', async () => {
  const timing = [];
  let phase = 'train';
  const resolver = createProductResolver({
    statePath: ':memory:',
    urlValidator: noNetworkValidation,
    directResolver: async (context) => {
      if (phase === 'check-products') await new Promise((resolve) => setTimeout(resolve, 20));
      timing.push(`direct:${context.pathPattern}`);
      return partialDirect();
    },
    searchProviders: [{ resolveProductCandidates: async (context) => {
      timing.push(`fallback:${context.pathPattern}`);
      return [{
        title: 'Pattern Product', url: context.canonicalCandidate, productId: context.productId,
        price: '42', currency: 'CAD', providerSource: 'shopping_result',
      }];
    } }],
  });

  for (const id of ['10001', '10002', '10003']) {
    await resolver(`https://pattern-shop.example/en_ca/products/pattern-product-${id}`);
  }
  const records = Object.values(resolver.inspectState().registry);
  const productsRecord = records.find((record) => record.pathPattern.includes('/products/'));
  assert.equal(productsRecord.fields.price.strategy, 'SEARCH_FIRST');

  timing.length = 0;
  phase = 'check-products';
  await resolver('https://pattern-shop.example/en_ca/products/pattern-product-10004');
  assert.ok(timing.indexOf('direct:/en_ca/products/pattern-product-:id') < timing.indexOf('fallback:/en_ca/products/pattern-product-:id'));

  timing.length = 0;
  phase = 'check-items';
  await resolver('https://pattern-shop.example/en_ca/item/20001');
  assert.equal(timing[0], 'direct:/en_ca/item/:id');
  const itemRecord = Object.values(resolver.inspectState().registry).find((record) => record.pathPattern.includes('/item/'));
  assert.equal(itemRecord.fields.price.strategy, 'HYBRID');
});

test('#43 bounds candidates, skips unnecessary providers, times out stalled providers, and caches completed work', async () => {
  let directCalls = 0;
  let fastProviderCalls = 0;
  let stalledProviderCalls = 0;
  const resolver = createProductResolver({
    statePath: ':memory:',
    urlValidator: noNetworkValidation,
    directTimeoutMs: 100,
    providerTimeoutMs: 20,
    maximumCandidates: 5,
    directResolver: async () => {
      directCalls += 1;
      return partialDirect();
    },
    searchProviders: [
      { resolveProductCandidates: async (context) => {
        fastProviderCalls += 1;
        return [
          { title: 'Pattern Product', url: context.canonicalCandidate, productId: context.productId, price: '42', currency: 'CAD', providerSource: 'fast' },
          ...Array.from({ length: 20 }, (_, index) => ({ title: `Noise ${index}`, url: `https://noise.example/${index}`, price: '1', currency: 'USD', providerSource: 'fast' })),
        ];
      } },
      { resolveProductCandidates: async () => {
        stalledProviderCalls += 1;
        return new Promise(() => {});
      } },
    ],
  });

  const url = 'https://pattern-shop.example/en_ca/products/pattern-product-90909';
  const startedAt = Date.now();
  const first = await resolver(url);
  const elapsed = Date.now() - startedAt;
  const second = await resolver(url);

  assert.equal(first.price, '42');
  assert.ok(elapsed < 500, `resolution took ${elapsed}ms`);
  assert.equal(directCalls, 1);
  assert.equal(fastProviderCalls, 1);
  assert.equal(stalledProviderCalls, 0);
  assert.equal(second.cacheHit, true);
});

test('#43 applies a hard timeout to a stalled direct extractor before using fallback', async () => {
  let directCalls = 0;
  const resolver = createProductResolver({
    statePath: ':memory:',
    urlValidator: noNetworkValidation,
    directTimeoutMs: 15,
    providerTimeoutMs: 100,
    directResolver: async () => {
      directCalls += 1;
      return new Promise(() => {});
    },
    searchProviders: [{ resolveProductCandidates: async (context) => [{
      title: 'Timed Product', brand: 'Maker', retailer: 'Pattern Shop',
      url: context.canonicalCandidate, productId: context.productId,
      imageUrl: 'https://images.example/timed.jpg', price: '51', currency: 'CAD', providerSource: 'fallback',
    }] }],
  });

  const startedAt = Date.now();
  const result = await resolver('https://pattern-shop.example/en_ca/products/timed-product-80808');
  assert.ok(Date.now() - startedAt < 500);
  assert.equal(directCalls, 1);
  assert.equal(result.title, 'Timed Product');
  assert.equal(result.price, '51');
});
