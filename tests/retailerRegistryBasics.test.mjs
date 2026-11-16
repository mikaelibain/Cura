import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createProductResolver } from '../productResolver.mjs';

const noNetworkValidation = async () => true;
const url = 'https://first-ever-shop.example/en_ca/products/repair-serum-445566';

test('#26 maintains durable server-side retailer resolution history with domain, host, locale, path, fields, and timestamps', async (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'cura-retailer-registry-'));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const statePath = join(directory, 'resolver-state.json');
  const resolver = createProductResolver({
    statePath,
    urlValidator: noNetworkValidation,
    directResolver: async () => ({
      title: 'Repair Serum', brand: 'Lab', retailer: 'First Shop',
      imageUrl: 'https://images.example/serum.jpg', price: '25', currency: 'CAD',
    }),
  });
  await resolver(url);

  const record = Object.values(resolver.inspectState().registry)[0];
  assert.equal(record.domain, 'first-ever-shop.example');
  assert.deepEqual(record.hostnamePatterns, ['first-ever-shop.example']);
  assert.deepEqual(record.localePatterns, ['en_ca']);
  assert.deepEqual(record.pathPatterns, ['/en_ca/products/repair-serum-:id']);
  assert.ok(record.firstSeenAt);
  assert.ok(record.lastUpdatedAt);
  for (const field of ['title', 'brand', 'retailer', 'imageUrl', 'price', 'currency']) assert.ok(record.fields[field]);

  const reloaded = createProductResolver({
    statePath,
    urlValidator: noNetworkValidation,
    directResolver: async () => ({}),
  });
  assert.equal(Object.keys(reloaded.inspectState().registry).length, 1);
});

test('#27 learns direct and fallback reliability independently for every field', async () => {
  const resolver = createProductResolver({
    statePath: ':memory:',
    urlValidator: noNetworkValidation,
    directResolver: async () => ({
      title: 'Repair Serum', brand: 'Lab', retailer: 'First Shop',
      imageUrl: 'https://images.example/serum.jpg', currency: 'CAD',
    }),
    searchProviders: [{ resolveProductCandidates: async () => [{
      title: 'Repair Serum', url, productId: '445566', price: '25', currency: 'CAD',
      providerSource: 'shopping_result',
    }] }],
  });
  await resolver(url);

  const fields = Object.values(resolver.inspectState().registry)[0].fields;
  assert.equal(fields.title.directSuccesses, 1);
  assert.equal(fields.title.fallbackAttempts, 0);
  assert.equal(fields.title.strategy, 'DIRECT_FIRST');
  assert.equal(fields.price.directSuccesses, 0);
  assert.equal(fields.price.fallbackAttempts, 1);
  assert.equal(fields.price.fallbackSuccesses, 1);
  assert.equal(fields.price.strategy, 'HYBRID');
});

test('#28 resolves and learns from a completely new retailer without prior registry configuration', async () => {
  let directContexts = 0;
  let fallbackRequests = [];
  const resolver = createProductResolver({
    statePath: ':memory:',
    urlValidator: noNetworkValidation,
    directResolver: async (context) => {
      directContexts += 1;
      assert.equal(context.baseDomain, 'first-ever-shop.example');
      return {
        title: 'Repair Serum', brand: 'Lab', retailer: 'First Shop',
        imageUrl: 'https://images.example/serum.jpg', currency: 'CAD',
      };
    },
    searchProviders: [{ resolveProductCandidates: async (_context, options) => {
      fallbackRequests = options.missingFields;
      return [{ title: 'Repair Serum', url, productId: '445566', price: '25', currency: 'CAD', providerSource: 'shopping_result' }];
    } }],
  });

  assert.equal(Object.keys(resolver.inspectState().registry).length, 0);
  const result = await resolver(url);
  assert.equal(directContexts, 1);
  assert.deepEqual(fallbackRequests, ['price']);
  assert.equal(result.title, 'Repair Serum');
  assert.equal(result.imageUrl, 'https://images.example/serum.jpg');
  assert.equal(result.price, '25');
  assert.equal(Object.keys(resolver.inspectState().registry).length, 1);
});
