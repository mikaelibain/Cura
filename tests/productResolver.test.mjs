import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanProductTitle, createProductResolver, parseProductUrl, verifyCandidate } from '../productResolver.mjs';

const noNetworkValidation = async () => true;

test('decomposes the H&M tracking-heavy URL without losing identity', () => {
  const originalUrl = 'https://www2.hm.com/en_ca/productpage.1338849002.html?srsltid=ABC&variant=98765';
  const parsed = parseProductUrl(originalUrl);
  assert.equal(parsed.originalUrl, originalUrl);
  assert.equal(parsed.baseDomain, 'hm.com');
  assert.equal(parsed.hostname, 'www2.hm.com');
  assert.equal(parsed.subdomain, 'www2');
  assert.equal(parsed.locale, 'en_ca');
  assert.equal(parsed.country, 'CA');
  assert.equal(parsed.currencyHint, 'CAD');
  assert.equal(parsed.productId, '1338849002');
  assert.equal(parsed.variantId, '98765');
  assert.ok(!parsed.canonicalCandidate.includes('srsltid'));
  assert.ok(parsed.canonicalCandidate.includes('variant=98765'));
  assert.ok(parsed.searchQueries[0].includes('1338849002'));
});

test('retains identity, variant, UTM, slug, SKU, and unknown query semantics correctly', () => {
  const parsed = parseProductUrl('https://small-shop.example/products/linen-wrap-dress?sku=ABC123&variant=blue-8&utm_source=newsletter&mystery=keep');
  assert.equal(parsed.sku, 'ABC123');
  assert.equal(parsed.variantId, 'blue-8');
  assert.equal(parsed.slug, 'linen wrap dress');
  assert.ok(!parsed.canonicalCandidate.includes('utm_source'));
  assert.ok(parsed.canonicalCandidate.includes('sku=ABC123'));
  assert.ok(parsed.canonicalCandidate.includes('variant=blue-8'));
  assert.ok(parsed.canonicalCandidate.includes('mystery=keep'));
  assert.ok(parsed.searchQueries[0].includes('ABC123'));
});

test('uses a query product ID even when no readable title exists', () => {
  const parsed = parseProductUrl('https://example.com/p?id=ZXCV98765');
  assert.equal(parsed.productId, 'ZXCV98765');
  assert.ok(parsed.searchQueries.some((query) => query.includes('ZXCV98765')));
});

test('candidate scoring strongly prefers exact identity and original domain', () => {
  const context = parseProductUrl('https://www2.hm.com/en_ca/productpage.1338849002.html');
  const exact = verifyCandidate({ title: 'Chiffon Halterneck Dress', url: 'https://www2.hm.com/en_ca/productpage.1338849002.html', currency: 'CAD' }, context);
  const vague = verifyCandidate({ title: 'Beige Halterneck Dress', url: 'https://unrelated.example/products/beige-dress', currency: 'USD' }, context);
  assert.equal(exact.confidence, 'HIGH');
  assert.equal(exact.exactIdentifier, true);
  assert.equal(exact.originalDomain, true);
  assert.equal(vague.confidence, 'LOW');
  assert.ok(exact.score > vague.score);
});

test('does not call fallback when direct extraction supplies every required field', async () => {
  let fallbackCalls = 0;
  const resolver = createProductResolver({
    statePath: ':memory:', urlValidator: noNetworkValidation,
    directResolver: async () => ({ title: 'Direct product', brand: 'Maker', retailer: 'Shop', imageUrl: 'https://images.example/direct.jpg', price: '42', currency: 'CAD' }),
    searchProviders: [{ resolveProductCandidates: async () => { fallbackCalls += 1; return []; } }],
  });
  const result = await resolver('https://shop.example/products/direct-12345');
  assert.equal(result.title, 'Direct product');
  assert.equal(result.price, '42');
  assert.equal(fallbackCalls, 0);
});

test('keeps direct fields and requests fallback only for missing fields', async () => {
  let requested = [];
  const resolver = createProductResolver({
    statePath: ':memory:', urlValidator: noNetworkValidation,
    directResolver: async () => ({ title: 'Linen Wrap Dress', brand: 'Atelier', retailer: 'Small Shop', imageUrl: 'https://images.example/dress.jpg', currency: 'CAD' }),
    searchProviders: [{ resolveProductCandidates: async (_context, options) => {
      requested = options.missingFields;
      return [{ title: 'Linen Wrap Dress', url: 'https://shop.example/products/linen-wrap-dress-12345', price: '89', currency: 'CAD', providerSource: 'shopping_result' }];
    } }],
  });
  const result = await resolver('https://shop.example/products/linen-wrap-dress-12345');
  assert.deepEqual(requested, ['price']);
  assert.equal(result.imageUrl, 'https://images.example/dress.jpg');
  assert.equal(result.price, '89');
  assert.equal(result.fieldSources.price, 'shopping_result');
});

test('H&M blocked-page regression resolves verified Canadian product fields generically', async () => {
  const resolver = createProductResolver({
    statePath: ':memory:', urlValidator: noNetworkValidation,
    directResolver: async () => { throw new Error('HTTP_403'); },
    searchProviders: [{ resolveProductCandidates: async () => [{
      title: 'Ladies - Light Beige/Patterned Chiffon Halterneck Dress | H&M CA',
      retailer: 'H&M',
      url: 'https://www2.hm.com/en_ca/productpage.1338849002.html',
      productId: '1338849002',
      price: '84.99',
      currency: 'CAD',
      color: 'Light Beige/Patterned',
      imageUrl: 'https://image.hm.com/assets/hm-dress.jpg',
      providerSource: 'shopping_result',
    }] }],
  });
  const originalUrl = 'https://www2.hm.com/en_ca/productpage.1338849002.html?srsltid=ANY-VALUE';
  const result = await resolver(originalUrl);
  assert.equal(result.originalUrl, originalUrl);
  assert.equal(result.productId, '1338849002');
  assert.equal(result.locale, 'en_ca');
  assert.equal(result.retailer, 'H&M');
  assert.equal(result.title, 'Chiffon Halterneck Dress');
  assert.equal(result.color, 'Light Beige/Patterned');
  assert.equal(result.price, '84.99');
  assert.equal(result.currency, 'CAD');
  assert.equal(result.imageUrl, 'https://image.hm.com/assets/hm-dress.jpg');
  assert.equal(result.priceEstimated, false);
});

test('rejects a similar wrong-retailer result and a wrong-market price', async () => {
  const resolver = createProductResolver({
    statePath: ':memory:', urlValidator: noNetworkValidation,
    directResolver: async () => { throw new Error('HTTP_403'); },
    searchProviders: [{ resolveProductCandidates: async () => [{
      title: 'Chiffon Halterneck Dress', url: 'https://unrelated.example/chiffon-halterneck-dress', price: '39.99', currency: 'USD', imageUrl: 'https://unrelated.example/image.jpg', providerSource: 'shopping_result',
    }] }],
  });
  const result = await resolver('https://www2.hm.com/en_ca/productpage.1338849002.html');
  assert.equal(result.price, '');
  assert.equal(result.imageUrl, '');
  assert.equal(result.currency, 'CAD');
});

test('manual user edits win over every automated field', async () => {
  const resolver = createProductResolver({
    statePath: ':memory:', urlValidator: noNetworkValidation,
    directResolver: async () => ({ title: 'Automatic title', brand: 'Automatic brand', retailer: 'Shop', imageUrl: 'https://images.example/auto.jpg', price: '99', currency: 'USD' }),
  });
  const result = await resolver('https://shop.example/products/automatic-12345', {
    lockedFields: ['title', 'price', 'currency', 'imageUrl'],
    existing: { title: 'My title', price: 79, currency: 'CAD', imageUrl: 'data:image/png;base64,abc' },
  });
  assert.equal(result.title, 'My title');
  assert.equal(result.price, 79);
  assert.equal(result.currency, 'CAD');
  assert.equal(result.imageUrl, 'data:image/png;base64,abc');
  assert.equal(result.fieldSources.price, 'user_edit');
});

test('product cache prevents duplicate direct and fallback resolution', async () => {
  let directCalls = 0;
  const resolver = createProductResolver({
    statePath: ':memory:', urlValidator: noNetworkValidation,
    directResolver: async () => { directCalls += 1; return { title: 'Cached', brand: 'Maker', retailer: 'Shop', imageUrl: 'https://images.example/cached.jpg', price: '10', currency: 'USD' }; },
  });
  await resolver('https://shop.example/products/cached-12345');
  const second = await resolver('https://shop.example/products/cached-12345?utm_source=again');
  assert.equal(directCalls, 1);
  assert.equal(second.cacheHit, true);
  assert.equal(second.originalUrl, 'https://shop.example/products/cached-12345?utm_source=again');
});

test('different path patterns remain distinct learning targets', () => {
  const products = parseProductUrl('https://shop.example/products/item-12345');
  const items = parseProductUrl('https://shop.example/item/12345');
  assert.notEqual(products.pathPattern, items.pathPattern);
});

test('URL intelligence still produces useful signals without a readable slug or obvious SKU', () => {
  const parsed = parseProductUrl('https://catalog.example/x/y?opaque=value');
  assert.equal(parsed.baseDomain, 'catalog.example');
  assert.equal(parsed.productId, '');
  assert.ok(parsed.searchTokens.includes('catalog.example'));
  assert.ok(parsed.searchQueries.includes(parsed.canonicalCandidate));
});

test('title cleaning removes storefront noise while retaining the product name', () => {
  assert.equal(
    cleanProductTitle('Ladies - Light Beige/Patterned Chiffon Halterneck Dress | H&M CA', { color: 'Light Beige/Patterned' }),
    'Chiffon Halterneck Dress',
  );
  assert.equal(cleanProductTitle('Amazon.ca: Hydrating Face Cream - Size: 50 ml'), 'Hydrating Face Cream');
  assert.equal(cleanProductTitle('Loose-Fit Sweatshirt Loose-Fit Sweatshirt'), 'Loose-Fit Sweatshirt');
});

test('image fallback fills only the missing image and preserves direct product data', async () => {
  const resolver = createProductResolver({
    statePath: ':memory:', urlValidator: noNetworkValidation,
    directResolver: async () => ({ title: 'Exact Serum', brand: 'Maker', retailer: 'Shop', price: '29', currency: 'CAD' }),
    searchProviders: [{ resolveProductCandidates: async (_context, options) => {
      assert.deepEqual(options.missingFields, ['imageUrl']);
      return [{ title: 'Exact Serum', url: 'https://shop.example/products/exact-serum-12345', imageUrl: 'https://images.example/serum.jpg', currency: 'CAD', providerSource: 'image_search' }];
    } }],
  });
  const result = await resolver('https://shop.example/products/exact-serum-12345');
  assert.equal(result.title, 'Exact Serum');
  assert.equal(result.price, '29');
  assert.equal(result.imageUrl, 'https://images.example/serum.jpg');
  assert.equal(result.fieldSources.imageUrl, 'image_search');
});

test('rejects retailer boilerplate titles and unverified best-guess images', async () => {
  const url = 'https://www.aritzia.com/en/product/smooth-matter-ginger-top/133120001.html';
  const resolver = createProductResolver({
    statePath: ':memory:', urlValidator: noNetworkValidation,
    directResolver: async () => ({ title: 'www.aritzia.com', imageUrl: 'https://assets.aritzia.com/image/upload/navigation_aboutus_ourhistory?wid=2100',
      currency: 'CAD', fieldSources: { title: 'rendered_retailer', imageUrl: 'retailer_metadata' } }),
    lastChanceResolver: async () => ({ imageUrl: 'https://images.example/unverified.jpg',
      fieldSources: { imageUrl: 'best_guess_image' }, fieldConfidence: { imageUrl: 'LOW' } }),
    searchProviders: [],
  });
  const result = await resolver(url);
  assert.equal(result.title, 'Smooth Matter Ginger Top');
  assert.equal(result.imageUrl, '');
  assert.equal(result.originalUrl, url);
});

test('uses the product slug when native catalog returns a retailer name and strips SHEIN’s ID marker', async () => {
  const url = 'https://www.realcanadiansuperstore.ca/en/Fructis%20Diamond%20Sleek%20Leave%20In%20Conditioner/p/21708789_EA?pc-express-book=1009';
  const resolver = createProductResolver({
    statePath: ':memory:', urlValidator: noNetworkValidation,
    directResolver: async () => { throw new Error('HTTP_403'); },
    nativeCatalogResolver: async () => ({ title: 'Real Canadian Superstore Supermarket', fieldSources: { title: 'retailer_native_catalog' } }),
    searchProviders: [],
  });
  const result = await resolver(url);
  assert.equal(result.title, 'Fructis Diamond Sleek Leave In Conditioner');
  assert.equal(parseProductUrl('https://ca.shein.com/Vellofy-Women-s-Fall-White-Top-p-514997343.html').slug, 'Vellofy Women s Fall White Top');
});

test('one field failure still lets direct extraction finish before fallback', async () => {
  let importNumber = 0;
  let secondDirectFinished = false;
  const requested = [];
  const resolver = createProductResolver({
    statePath: ':memory:', urlValidator: noNetworkValidation,
    directResolver: async () => {
      importNumber += 1;
      if (importNumber === 2) await new Promise((resolve) => setTimeout(resolve, 25));
      if (importNumber === 2) secondDirectFinished = true;
      return { title: 'Field product', brand: 'Maker', retailer: 'Shop', imageUrl: 'https://images.example/item.jpg', price: '', currency: 'CAD' };
    },
    searchProviders: [{ resolveProductCandidates: async (context, options) => {
      requested.push({ fields: options.missingFields, beforeDirectFinished: !secondDirectFinished });
      return [{ title: 'Field product', url: context.canonicalCandidate, price: '55', currency: 'CAD', providerSource: 'shopping_result' }];
    } }],
  });
  await resolver('https://shop.example/products/item-11111');
  await resolver('https://shop.example/products/item-22222');
  assert.deepEqual(requested[1].fields, ['price']);
  assert.equal(requested[1].beforeDirectFinished, false);
  const state = resolver.inspectState();
  const record = Object.values(state.registry)[0];
  assert.equal(record.fields.price.strategy, 'HYBRID');
  assert.equal(record.fields.title.strategy, 'DIRECT_FIRST');
});

test('removed products do not reduce retailer reliability', async () => {
  const resolver = createProductResolver({
    statePath: ':memory:', urlValidator: noNetworkValidation,
    directResolver: async () => { throw new Error('HTTP_404'); },
    searchProviders: [{ resolveProductCandidates: async () => [] }],
  });
  await resolver('https://shop.example/products/removed-12345');
  const record = Object.values(resolver.inspectState().registry)[0];
  assert.deepEqual(record.fields, {});
});

test('a previously unreliable field restores direct-first behavior when direct extraction works again', async () => {
  let directCalls = 0;
  let fallbackCalls = 0;
  const resolver = createProductResolver({
    statePath: ':memory:', urlValidator: noNetworkValidation,
    directResolver: async () => {
      directCalls += 1;
      if (directCalls === 1) throw new Error('HTTP_403');
      return { title: 'Recovered product', brand: 'Maker', retailer: 'Shop', imageUrl: 'https://images.example/recovered.jpg', price: '45', currency: 'USD' };
    },
    searchProviders: [{ resolveProductCandidates: async (context) => {
      fallbackCalls += 1;
      return [{ title: 'Recovered product', brand: 'Maker', retailer: 'Shop', url: context.canonicalCandidate, imageUrl: 'https://images.example/recovered.jpg', price: '45', currency: 'USD', providerSource: 'shopping_result' }];
    } }],
  });
  await resolver('https://shop.example/products/recovered-11111');
  await resolver('https://shop.example/products/recovered-22222');
  await resolver('https://shop.example/products/recovered-33333');
  await resolver('https://shop.example/products/recovered-44444');
  const fallbacksAfterRecovery = fallbackCalls;
  await resolver('https://shop.example/products/recovered-55555');
  assert.equal(fallbackCalls, fallbacksAfterRecovery);
  const record = Object.values(resolver.inspectState().registry)[0];
  assert.equal(record.fields.price.strategy, 'DIRECT_FIRST');
});
