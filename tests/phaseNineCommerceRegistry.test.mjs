import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  brandRegistry,
  categoryMetadata,
  commerceLookupKey,
  createCommerceIndex,
  marketplaceRegistry,
  normalizeBrandDisplay,
  normalizeCommerceDisplay,
  normalizeMarketplaceDisplay,
  normalizeRetailerDisplay,
  retailerRegistry,
} from '../src/commerceRegistry.ts';

test('known brand spellings normalize to their official display form', () => {
  for (const value of ['Bananarepublic', 'BANANAREPUBLIC', 'banana republic', 'BananaRepublic']) {
    assert.equal(normalizeBrandDisplay(value), 'Banana Republic');
  }
  assert.equal(normalizeBrandDisplay('charlottetilbury'), 'Charlotte Tilbury');
  assert.equal(normalizeBrandDisplay('larocheposay'), 'La Roche-Posay');
  assert.equal(normalizeBrandDisplay('victoriassecret'), "Victoria's Secret");
});

test('lookup is strict after deterministic key normalization and never fuzzy', () => {
  assert.equal(commerceLookupKey(" Victoria’s Secret "), 'victoriassecret');
  assert.equal(normalizeBrandDisplay('Banana Republix'), 'Banana Republix');
  assert.equal(normalizeBrandDisplay('Rare Beautie'), 'Rare Beautie');
  assert.equal(normalizeBrandDisplay('  Unknown Maker  '), 'Unknown Maker');
});

test('brand, retailer, and marketplace identities stay separate', () => {
  assert.deepEqual(normalizeCommerceDisplay({ brand: 'rarebeauty', retailer: 'amazon' }), {
    brand: 'Rare Beauty',
    retailer: 'Amazon',
  });
  assert.deepEqual(normalizeCommerceDisplay({ brand: 'charlottetilbury', retailer: 'sephora' }), {
    brand: 'Charlotte Tilbury',
    retailer: 'Sephora',
  });
  assert.equal(normalizeBrandDisplay('sephora'), 'sephora');
  assert.equal(normalizeMarketplaceDisplay('amazon'), 'Amazon');
});

test('registries are separate data sources and indexing scales without component rules', () => {
  assert.ok(brandRegistry.length > 0);
  assert.ok(retailerRegistry.length > 0);
  assert.ok(marketplaceRegistry.length > 0);
  assert.deepEqual(categoryMetadata, []);
  const records = Array.from({ length: 5_000 }, (_, index) => ({ id: `brand-${index}`, displayName: `Brand ${index}` }));
  const index = createCommerceIndex(records);
  assert.equal(index.size, 5_000);
  assert.equal(index.get(commerceLookupKey('BRAND 4999'))?.displayName, 'Brand 4999');
  assert.equal(normalizeRetailerDisplay('Independent Shop'), 'Independent Shop');
});

test('resolver fallbacks do not assign a selling source to the brand field', async () => {
  const [resolver, server] = await Promise.all([
    readFile(new URL('../productResolver.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../server.mjs', import.meta.url), 'utf8'),
  ]);
  assert.doesNotMatch(resolver, /retailer, brand: retailer/);
  assert.doesNotMatch(server, /knownProduct\.brand, brandFromUrl\(pageUrl\)/);
  assert.match(server, /brand: brand,\s+retailer,/);
});
