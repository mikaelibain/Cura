import assert from 'node:assert/strict';
import test from 'node:test';
import { createProductResolver, parseProductUrl, verifyCandidate } from '../productResolver.mjs';

const noNetworkValidation = async () => true;

test('#12 resolves only missing fields and never discards successful direct fields', async () => {
  let requestedFields = [];
  const resolver = createProductResolver({
    statePath: ':memory:',
    urlValidator: noNetworkValidation,
    directResolver: async () => ({
      title: 'Direct Serum', brand: 'Direct Brand', retailer: 'Direct Shop',
      imageUrl: 'https://images.example/direct.jpg', currency: 'CAD',
    }),
    searchProviders: [{ resolveProductCandidates: async (_context, options) => {
      requestedFields = options.missingFields;
      return [{
        title: 'Wrong fallback title', brand: 'Wrong fallback brand',
        url: 'https://shop.example/products/direct-serum-12345',
        price: '34', currency: 'CAD', providerSource: 'shopping_result',
      }];
    } }],
  });

  const result = await resolver('https://shop.example/products/direct-serum-12345');
  assert.deepEqual(requestedFields, ['price']);
  assert.equal(result.title, 'Direct Serum');
  assert.equal(result.brand, 'Direct Brand');
  assert.equal(result.imageUrl, 'https://images.example/direct.jpg');
  assert.equal(result.price, '34');
});

test('#17 gives a convincing original-retailer result preference over a third-party result', () => {
  const context = parseProductUrl('https://shop.example/products/silk-dress-12345');
  const firstParty = verifyCandidate({
    title: 'Silk Dress', url: 'https://www.shop.example/products/silk-dress', currency: 'CAD',
  }, { ...context, currencyHint: 'CAD' });
  const thirdParty = verifyCandidate({
    title: 'Silk Dress', url: 'https://marketplace.example/items/12345', currency: 'CAD', productId: '12345',
  }, { ...context, currencyHint: 'CAD' });

  assert.equal(firstParty.originalDomain, true);
  assert.equal(firstParty.confidence, 'LOW');
  assert.ok(firstParty.score > thirdParty.score);
});

test('#18 rejects price and identity fields from an unverified listing', async () => {
  const resolver = createProductResolver({
    statePath: ':memory:',
    urlValidator: noNetworkValidation,
    directResolver: async () => { throw new Error('HTTP_403'); },
    searchProviders: [{ resolveProductCandidates: async () => [{
      title: 'Unverified Product Name', brand: 'Unverified Brand',
      url: 'https://shop.example/other-listing',
      imageUrl: 'https://images.example/unverified.jpg',
      price: '45', currency: 'CAD', providerSource: 'shopping_result',
    }] }],
  });

  const result = await resolver('https://shop.example/en_ca/p/12345');
  assert.equal(result.title, '');
  assert.equal(result.imageUrl, '');
  assert.equal(result.price, '');
  assert.equal(result.priceEstimated, false);
});

test('#33 normalizes common subdomains while retaining the exact hostname', () => {
  const bare = parseProductUrl('https://shop.example/products/12345');
  const www = parseProductUrl('https://www.shop.example/products/12345');
  const www2 = parseProductUrl('https://www2.shop.example/products/12345');
  const countrySuffix = parseProductUrl('https://m.store.example.co.jp/products/12345');

  assert.equal(bare.baseDomain, 'shop.example');
  assert.equal(www.baseDomain, bare.baseDomain);
  assert.equal(www2.baseDomain, bare.baseDomain);
  assert.equal(www2.hostname, 'www2.shop.example');
  assert.equal(www2.subdomain, 'www2');
  assert.equal(countrySuffix.baseDomain, 'example.co.jp');
  assert.equal(countrySuffix.hostname, 'm.store.example.co.jp');
});

test('#40 manual user edits also win when automated metadata comes from cache', async () => {
  let directCalls = 0;
  const resolver = createProductResolver({
    statePath: ':memory:',
    urlValidator: noNetworkValidation,
    directResolver: async () => {
      directCalls += 1;
      return {
        title: 'Automatic title', brand: 'Automatic brand', retailer: 'Shop',
        imageUrl: 'https://images.example/automatic.jpg', price: '99', currency: 'USD',
      };
    },
  });
  const url = 'https://shop.example/products/cache-lock-12345';
  await resolver(url);
  const refreshed = await resolver(url, {
    lockedFields: ['title', 'brand', 'price', 'currency', 'imageUrl'],
    existing: {
      title: 'My title', brand: 'My brand', price: 79, currency: 'CAD',
      imageUrl: 'data:image/png;base64,user-image',
    },
  });

  assert.equal(directCalls, 1);
  assert.equal(refreshed.cacheHit, true);
  assert.equal(refreshed.title, 'My title');
  assert.equal(refreshed.brand, 'My brand');
  assert.equal(refreshed.price, 79);
  assert.equal(refreshed.currency, 'CAD');
  assert.equal(refreshed.imageUrl, 'data:image/png;base64,user-image');
  assert.equal(refreshed.fieldSources.imageUrl, 'user_edit');
});
