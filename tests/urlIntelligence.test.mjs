import assert from 'node:assert/strict';
import test from 'node:test';
import { parseProductUrl } from '../productResolver.mjs';

test('#3 preserves the authoritative pasted URL while creating a separate canonical URL', () => {
  const original = 'https://shop.example/en_ca/products/silk-dress?variant=blue%208&utm_source=email#details';
  const parsed = parseProductUrl(original);
  assert.equal(parsed.originalUrl, original);
  assert.notEqual(parsed.canonicalCandidate, original);
  assert.ok(parsed.canonicalCandidate.includes('variant=blue+8'));
  assert.ok(!parsed.canonicalCandidate.includes('utm_source'));
});

test('#5 decomposes protocol, host, base domain, subdomain, locale, path, filename, and market', () => {
  const parsed = parseProductUrl('https://ca.store.example.co.uk/en_gb/women/dresses/linen-dress-123456.html?variant=navy');
  assert.equal(parsed.protocol, 'https');
  assert.equal(parsed.hostname, 'ca.store.example.co.uk');
  assert.equal(parsed.baseDomain, 'example.co.uk');
  assert.equal(parsed.subdomain, 'ca.store');
  assert.equal(parsed.locale, 'en_gb');
  assert.equal(parsed.language, 'en');
  assert.equal(parsed.country, 'GB');
  assert.equal(parsed.currencyHint, 'GBP');
  assert.equal(parsed.filename, 'linen-dress-123456.html');
  assert.deepEqual(parsed.categoryHints, ['women', 'dresses']);
});

test('#6 extracts identifiers from paths, filenames, queries, and fragments', () => {
  const cases = [
    ['https://shop.example/product/123456', '123456', '', ''],
    ['https://shop.example/products/linen-dress-654321.html', '654321', '', ''],
    ['https://shop.example/item?productId=ABC98765', 'ABC98765', '', ''],
    ['https://shop.example/p/basic?sku=SKU-778899', 'SKU-778899', 'SKU-778899', ''],
    ['https://shop.example/p/basic#productId=FRAG12345&variant=navy-8', 'FRAG12345', '', 'navy-8'],
  ];
  for (const [url, productId, sku, variantId] of cases) {
    const parsed = parseProductUrl(url);
    assert.equal(parsed.productId, productId, url);
    assert.equal(parsed.sku, sku, url);
    assert.equal(parsed.variantId, variantId, url);
    assert.ok(parsed.candidateIdentifiers.includes(productId), url);
  }
});

test('#7 makes SKU or exact product identity the primary search signal', () => {
  const sku = parseProductUrl('https://shop.example/products/vague-name?sku=EXACT-SKU-909090');
  const product = parseProductUrl('https://shop.example/products/vague-name-808080');
  assert.equal(sku.searchQueries[0], 'EXACT-SKU-909090');
  assert.equal(product.searchQueries[0], '808080');
});

test('#8 classifies and removes only tracking parameters', () => {
  const parsed = parseProductUrl('https://shop.example/p/123456?utm_campaign=sale&gclid=TRACK&sku=SKU123&variant=red&locale=en_ca&mystery=keep');
  const classes = Object.fromEntries(parsed.queryParameters.map((entry) => [entry.name, entry.classification]));
  assert.equal(classes.utm_campaign, 'TRACKING');
  assert.equal(classes.gclid, 'TRACKING');
  assert.equal(classes.sku, 'PRODUCT_IDENTITY');
  assert.equal(classes.variant, 'VARIANT');
  assert.equal(classes.locale, 'LOCALE');
  assert.equal(classes.mystery, 'UNKNOWN');
  assert.ok(!parsed.canonicalCandidate.includes('utm_campaign'));
  assert.ok(!parsed.canonicalCandidate.includes('gclid'));
  assert.ok(parsed.canonicalCandidate.includes('sku=SKU123'));
  assert.ok(parsed.canonicalCandidate.includes('variant=red'));
  assert.ok(parsed.canonicalCandidate.includes('mystery=keep'));
});

test('#9 generates several unique search representations from strong URL signals', () => {
  const parsed = parseProductUrl('https://shop.example/en_ca/products/linen-wrap-dress-123456?variant=navy');
  assert.equal(new Set(parsed.searchQueries).size, parsed.searchQueries.length);
  assert.ok(parsed.searchQueries.includes('123456'));
  assert.ok(parsed.searchQueries.includes('shop.example 123456'));
  assert.ok(parsed.searchQueries.includes('Shop 123456'));
  assert.ok(parsed.searchQueries.includes('site:shop.example 123456'));
  assert.ok(parsed.searchQueries.includes(parsed.canonicalCandidate));
  assert.ok(parsed.searchTokens.includes('linen'));
  assert.ok(parsed.searchTokens.includes('123456'));
});

test('#10 orders searches from exact identity to domain, retailer, canonical path, then title', () => {
  const parsed = parseProductUrl('https://shop.example/products/linen-wrap-dress-123456');
  assert.deepEqual(parsed.searchQueries.slice(0, 5), [
    '123456',
    'shop.example 123456',
    'Shop 123456',
    'site:shop.example 123456',
    parsed.canonicalCandidate,
  ]);
  assert.equal(parsed.searchQueries.at(-1), 'Shop "linen wrap dress"');
});
