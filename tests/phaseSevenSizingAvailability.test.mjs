import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');
const resolver = await readFile(new URL('../productResolver.mjs', import.meta.url), 'utf8');

test('sizing uses an extensible structured model with general and category overrides', () => {
  for (const field of ['generalClothing', 'tops', 'bottoms', 'dresses', 'shoes']) assert.match(app, new RegExp(`${field}\\?: SizePreference`));
  assert.match(app, /type SizePreference = \{ system: SizeSystem; value: string \}/);
  assert.match(app, /sizePreferences: SizePreferences/);
});

test('legacy saved sizing is migrated without clearing existing settings', () => {
  assert.match(app, /generalClothing: loaded\.preferredSize \?/);
  assert.match(app, /tops: loaded\.topSize \?/);
  assert.match(app, /bottoms: loaded\.bottomSize \?/);
  assert.match(app, /dresses: loaded\.dressSize \?/);
  assert.match(app, /shoes: loaded\.shoeSize \?/);
});

test('the sizing UI uses predefined choices and category inheritance', () => {
  assert.match(app, /const alphaSizes = \['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL'/);
  assert.match(app, /Use general clothing size/);
  assert.match(app, /Bottoms, skirts and trousers/);
  assert.match(app, /Waist sizes \(inches\)/);
  assert.match(app, /United States \/ Canada/);
  assert.match(app, /'UK', 'EU'/);
});

test('S and Small are treated as safe aliases', () => {
  assert.match(server, /\['s', \['s', 'small'\]\]/);
  assert.match(server, /\['small', \['s', 'small'\]\]/);
});

test('numeric sizes are not guessed across international systems', () => {
  assert.match(server, /if \(targetRegion !== sourceRegion\) acceptedSizes\.clear\(\)/);
  assert.doesNotMatch(server, /const usSize = sourceRegion/);
});

test('category-specific preferences route tops, bottoms, dresses, and shoes', () => {
  assert.match(server, /isShoe \? 'shoes'/);
  assert.match(server, /\? 'dresses'/);
  assert.match(server, /\? 'bottoms'/);
  assert.match(server, /\? 'tops' : ''/);
  assert.match(server, /categoryPreference\?\.value[\s\S]*generalPreference\?\.value/);
});

test('a wrong Shopify variant can only use the requested-size sibling in the same product context', () => {
  assert.match(server, /sameNonSizeVariant/);
  assert.match(server, /sameProductContextMatches = sizeMatchingVariants\.filter/);
  assert.match(server, /selectedVariant && normalizedPreferredSize \? sameProductContextMatches/);
});

test('ambiguous or partial variant inventory is suppressed', () => {
  assert.match(server, /availabilityStates\.size === 1/);
  assert.match(server, /const matchingVariants = availabilityConsistent \? candidateVariants : \[\]/);
  assert.match(server, /availability: entireProductSoldOut \? 'OutOfStock' : matchingVariants\.length/);
});

test('an entirely sold-out product may expose reliable generic sold-out state', () => {
  assert.match(server, /const entireProductSoldOut = product\.available === false/);
  assert.match(server, /availabilityVerified: entireProductSoldOut \|\| Boolean\(matchingVariants\.length\)/);
});

test('missing preferences and unknown categories do not request personalized size availability', () => {
  assert.match(server, /const requestedSize = sizeCategory \?/);
  assert.match(app, /if \(item\.unsure \|\| !item\.availabilityVerified\) return ''/);
});

test('changing sizing invalidates stale sized-item availability and cache keys include the full profile', () => {
  assert.match(app, /isSizedProduct\(item\) \? \{ \.\.\.item, availability: '', availabilityVerified: false \}/);
  for (const field of ['generalClothing', 'tops', 'bottoms', 'dresses', 'shoes']) assert.match(resolver, new RegExp(`'${field}'`));
  assert.match(resolver, /preference\.system/);
  assert.match(resolver, /preference\.value/);
});
