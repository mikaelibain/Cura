import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { createProductResolver } from '../productResolver.mjs';

const noNetworkValidation = async () => true;
const completeProduct = (title = 'Unknown-store product') => ({
  title,
  brand: 'Independent Maker',
  retailer: 'Independent Shop',
  imageUrl: 'https://images.example/product.jpg',
  price: '38',
  currency: 'USD',
});

test('#2 unknown retailers use the generic importer without a supported-retailer list', async () => {
  const resolver = createProductResolver({
    statePath: ':memory:', urlValidator: noNetworkValidation,
    directResolver: async () => completeProduct(),
  });
  const result = await resolver('https://tiny-independent-shop.example/products/handmade-product-12345');
  assert.equal(result.title, 'Unknown-store product');
  assert.equal(result.price, '38');
  const serverSource = readFileSync(resolve('server.mjs'), 'utf8');
  assert.equal(/SUPPORTED_RETAILERS|protectedRetailers|retailerCategoryPrice/.test(serverSource), false);
});

test('#4 every retailer enters the same URL-intelligence resolver pipeline', async () => {
  let receivedContext;
  const resolver = createProductResolver({
    statePath: ':memory:', urlValidator: noNetworkValidation,
    directResolver: async (context) => { receivedContext = context; return completeProduct('Pipeline product'); },
  });
  await resolver('https://new-store.example/en_ca/products/pipeline-product-778899?variant=green');
  assert.equal(receivedContext.baseDomain, 'new-store.example');
  assert.equal(receivedContext.productId, '778899');
  assert.equal(receivedContext.locale, 'en_ca');
  assert.equal(receivedContext.variantId, 'green');
  assert.ok(receivedContext.searchQueries.length > 1);
});

test('#14 fallback receives decomposed targeted searches instead of leading with the original URL', async () => {
  let searches = [];
  const originalUrl = 'https://shop.example/en_ca/products/targeted-product-445566?utm_source=email';
  const resolver = createProductResolver({
    statePath: ':memory:', urlValidator: noNetworkValidation,
    directResolver: async () => { throw new Error('HTTP_403'); },
    searchProviders: [{ resolveProductCandidates: async (context) => { searches = context.searchQueries; return []; } }],
  });
  await resolver(originalUrl);
  assert.equal(searches[0], '445566');
  assert.equal(searches[1], 'shop.example 445566');
  assert.notEqual(searches[0], originalUrl);
  assert.ok(searches.some((query) => query.startsWith('site:shop.example')));
});

test('#15 resolver enforces a global candidate bound even for an overproducing provider', async () => {
  const weakCandidates = Array.from({ length: 25 }, (_, index) => ({
    title: `Unrelated result ${index}`,
    url: `https://unrelated-${index}.example/item`,
    price: String(index + 1),
    currency: 'USD',
    providerSource: 'test_search',
  }));
  const resolver = createProductResolver({
    statePath: ':memory:', urlValidator: noNetworkValidation,
    directResolver: async () => { throw new Error('HTTP_403'); },
    searchProviders: [{ resolveProductCandidates: async () => [
      ...weakCandidates,
      { title: 'Exact product', url: 'https://shop.example/products/exact-998877', productId: '998877', price: '999', currency: 'USD', providerSource: 'test_search' },
    ] }],
  });
  const result = await resolver('https://shop.example/products/exact-998877');
  assert.equal(result.price, '');
  assert.equal(result.title, 'Exact');
  assert.equal(result.fieldSources.title, 'url_slug');
});

test('#25 fallback discards ratings, reviews, shipping, and search-interface noise', async () => {
  const resolver = createProductResolver({
    statePath: ':memory:', urlValidator: noNetworkValidation,
    directResolver: async () => { throw new Error('HTTP_403'); },
    searchProviders: [{ resolveProductCandidates: async () => [{
      title: 'Clean Product | Shop',
      url: 'https://shop.example/products/clean-product-112233',
      productId: '112233',
      brand: 'Maker', retailer: 'Shop', imageUrl: 'https://images.example/clean.jpg', price: '44', currency: 'USD',
      rating: 4.9, reviews: 830, shipping: '$12 delivery', bestPrice: true, trackPrice: true,
      providerSource: 'shopping_result',
    }] }],
  });
  const result = await resolver('https://shop.example/products/clean-product-112233');
  assert.equal(result.title, 'Clean Product');
  for (const noisyField of ['rating', 'reviews', 'shipping', 'bestPrice', 'trackPrice']) assert.equal(Object.hasOwn(result, noisyField), false);
});

test('#37 retailer history contains technical behavior only', async () => {
  const resolver = createProductResolver({
    statePath: ':memory:', urlValidator: noNetworkValidation,
    directResolver: async () => completeProduct('Private-safe product'),
  });
  await resolver('https://shop.example/products/private-safe-556677');
  const registryText = JSON.stringify(resolver.inspectState().registry);
  for (const privateKey of ['userId', 'boardId', 'wishlist', 'outfit', 'notes', 'email']) assert.equal(registryText.includes(privateKey), false);
  assert.ok(registryText.includes('domain'));
  assert.ok(registryText.includes('fields'));
});

test('#50 Cura cards do not render resolver internals or search-page metadata', () => {
  const appSource = readFileSync(resolve('src', 'App.tsx'), 'utf8');
  const card = appSource.slice(appSource.indexOf('data-layout-key={`item:${item.id}`}'), appSource.indexOf('</article>', appSource.indexOf('data-layout-key={`item:${item.id}`}')));
  assert.ok(card.includes('cardProductTitle(item)'));
  for (const internalName of ['fieldSources', 'fieldConfidence', 'urlIntelligence', 'searchQueries', 'CANDIDATE_REJECTED']) {
    assert.equal(card.includes(internalName), false, internalName);
  }
});
