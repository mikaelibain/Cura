import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createImageCache } from '../imageCache.mjs';
import { createProductResolver, parseProductUrl, validatePublicUrl } from '../productResolver.mjs';

const noNetworkValidation = async () => true;

test('durable image cache fetches once and reuses validated bytes', async (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'cura-image-cache-'));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  let fetches = 0;
  const events = [];
  const cache = createImageCache({
    directory,
    onEvent: (event) => events.push(event),
    fetchImage: async () => {
      fetches += 1;
      return { bytes: Buffer.from('test-image'), contentType: 'image/png' };
    },
  });
  const first = await cache.resolve('https://images.example/product.png');
  const second = await cache.resolve('https://images.example/product.png');
  assert.equal(first.cacheHit, false);
  assert.equal(second.cacheHit, true);
  assert.equal(second.bytes.toString(), 'test-image');
  assert.equal(fetches, 1);
  assert.deepEqual(events, ['IMAGE_PROXIED', 'IMAGE_CACHE_HIT']);
});

test('image cache refuses non-image content and oversized bodies', async (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'cura-image-cache-validation-'));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const wrongType = createImageCache({ directory, fetchImage: async () => ({ bytes: Buffer.from('html'), contentType: 'text/html' }) });
  await assert.rejects(() => wrongType.resolve('https://images.example/not-an-image'), /INVALID_IMAGE/);
  const tooLarge = createImageCache({ directory, maximumBytes: 3, fetchImage: async () => ({ bytes: Buffer.from('large'), contentType: 'image/png' }) });
  await assert.rejects(() => tooLarge.resolve('https://images.example/large.png'), /INVALID_IMAGE/);
});

test('public URL validation rejects unsafe protocols, credentials, and private hosts', async () => {
  await assert.rejects(() => validatePublicUrl('file:///etc/passwd'), /INVALID_URL/);
  await assert.rejects(() => validatePublicUrl('https://user:secret@example.com/product'), /INVALID_URL/);
  await assert.rejects(() => validatePublicUrl('http://127.0.0.1:8787/private'), /PRIVATE_ADDRESS/);
  await assert.rejects(() => validatePublicUrl('http://192.168.1.20/product'), /PRIVATE_ADDRESS/);
  await assert.rejects(() => validatePublicUrl('http://[::1]/product'), /PRIVATE_ADDRESS/);
});

test('technical retailer history persists across resolver instances without user data', async (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'cura-registry-'));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const statePath = join(directory, 'resolver-state.json');
  const provider = { resolveProductCandidates: async (urlContext) => [{
    title: 'Shared product', brand: 'Maker', retailer: 'Shop', url: urlContext.canonicalCandidate,
    imageUrl: 'https://images.example/shared.jpg', price: '25', currency: 'USD', providerSource: 'shopping_result',
  }] };
  const firstResolver = createProductResolver({
    statePath, urlValidator: noNetworkValidation,
    directResolver: async () => { throw new Error('HTTP_403'); },
    searchProviders: [provider],
  });
  await firstResolver('https://shop.example/products/shared-11111');
  const secondResolver = createProductResolver({
    statePath, urlValidator: noNetworkValidation,
    directResolver: async () => { throw new Error('HTTP_403'); },
    searchProviders: [provider],
  });
  await secondResolver('https://shop.example/products/shared-22222');
  const persisted = JSON.parse(readFileSync(statePath, 'utf8'));
  const record = Object.values(persisted.registry)[0];
  assert.equal(record.fields.price.attempts, 2);
  assert.equal(JSON.stringify(persisted).includes('userId'), false);
  assert.equal(JSON.stringify(persisted).includes('boardId'), false);
  assert.equal(JSON.stringify(persisted).includes('notes'), false);
});

test('exact retailer and product identity wins when fallback prices conflict', async () => {
  const resolver = createProductResolver({
    statePath: ':memory:', urlValidator: noNetworkValidation,
    directResolver: async () => { throw new Error('HTTP_403'); },
    searchProviders: [{ resolveProductCandidates: async () => [
      { title: 'Silk Dress', url: 'https://unrelated.example/products/silk-dress', price: '20', currency: 'CAD', providerSource: 'shopping_result' },
      { title: 'Silk Dress', url: 'https://shop.example/products/silk-dress-98765', productId: '98765', price: '90', currency: 'CAD', providerSource: 'shopping_result' },
    ] }],
  });
  const result = await resolver('https://shop.example/products/silk-dress-98765');
  assert.equal(result.price, '90');
  assert.equal(result.fieldConfidence.price, 'HIGH');
});

test('H&M regression ignores tracking-token changes and keeps exact product identity', async () => {
  let providerCalls = 0;
  const resolver = createProductResolver({
    statePath: ':memory:', urlValidator: noNetworkValidation,
    directResolver: async () => { throw new Error('HTTP_403'); },
    searchProviders: [{ resolveProductCandidates: async () => {
      providerCalls += 1;
      return [{
        title: 'Ladies - Light Beige/Patterned Chiffon Halterneck Dress | H&M CA', retailer: 'H&M',
        url: 'https://www2.hm.com/en_ca/productpage.1338849002.html', productId: '1338849002',
        price: '84.99', currency: 'CAD', color: 'Light Beige/Patterned',
        imageUrl: 'https://image.hm.com/assets/chiffon-dress.jpg', providerSource: 'shopping_result',
      }];
    } }],
  });
  const first = await resolver('https://www2.hm.com/en_ca/productpage.1338849002.html?srsltid=FIRST');
  const second = await resolver('https://www2.hm.com/en_ca/productpage.1338849002.html?srsltid=SECOND');
  assert.equal(first.title, 'Chiffon Halterneck Dress');
  assert.equal(first.price, '84.99');
  assert.equal(first.currency, 'CAD');
  assert.equal(first.imageUrl, 'https://image.hm.com/assets/chiffon-dress.jpg');
  assert.equal(second.productId, '1338849002');
  assert.equal(second.cacheHit, true);
  assert.equal(providerCalls, 1);
  assert.equal(parseProductUrl(second.originalUrl).productId, '1338849002');
});
