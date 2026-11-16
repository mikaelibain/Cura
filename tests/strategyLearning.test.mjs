import assert from 'node:assert/strict';
import test from 'node:test';
import { createProductResolver } from '../productResolver.mjs';

const noNetworkValidation = async () => true;
const product = (suffix) => `https://strategy-shop.example/en_ca/products/serum-${suffix}`;
const directWithoutPrice = async () => ({
  title: 'Strategy Serum', brand: 'Lab', retailer: 'Strategy Shop',
  imageUrl: 'https://images.example/serum.jpg', currency: 'CAD',
});

const fieldHistory = (resolver, field) => Object.values(resolver.inspectState().registry)[0].fields[field];

test('#30 repeated direct failures with verified fallback successes promote only that field to SEARCH_FIRST', async () => {
  const resolver = createProductResolver({
    statePath: ':memory:',
    urlValidator: noNetworkValidation,
    directResolver: directWithoutPrice,
    searchProviders: [{ resolveProductCandidates: async (context) => [{
      title: 'Strategy Serum', url: context.canonicalCandidate,
      productId: context.productId, price: '31', currency: 'CAD', providerSource: 'shopping_result',
    }] }],
  });

  await resolver(product('10001'));
  assert.equal(fieldHistory(resolver, 'price').strategy, 'HYBRID');
  await resolver(product('10002'));
  assert.equal(fieldHistory(resolver, 'price').strategy, 'HYBRID');
  await resolver(product('10003'));

  const title = fieldHistory(resolver, 'title');
  const price = fieldHistory(resolver, 'price');
  assert.equal(price.directAttempts, 3);
  assert.equal(price.directSuccesses, 0);
  assert.equal(price.fallbackAttempts, 3);
  assert.equal(price.fallbackSuccesses, 3);
  assert.equal(price.strategy, 'SEARCH_FIRST');
  assert.equal(title.strategy, 'DIRECT_FIRST');
  assert.equal(title.fallbackAttempts, 0);
});

test('#31 derives UNKNOWN, DIRECT_FIRST, HYBRID, SEARCH_FIRST, and DIRECT_UNRELIABLE from evidence', async () => {
  const unknownResolver = createProductResolver({
    statePath: ':memory:', urlValidator: noNetworkValidation, directResolver: directWithoutPrice,
  });
  assert.equal(Object.keys(unknownResolver.inspectState().registry).length, 0);

  const reliableResolver = createProductResolver({
    statePath: ':memory:', urlValidator: noNetworkValidation,
    directResolver: async () => ({ ...await directWithoutPrice(), price: '31' }),
  });
  await reliableResolver(product('20001'));
  assert.equal(fieldHistory(reliableResolver, 'price').strategy, 'DIRECT_FIRST');

  const hybridResolver = createProductResolver({
    statePath: ':memory:', urlValidator: noNetworkValidation,
    directResolver: directWithoutPrice,
    searchProviders: [{ resolveProductCandidates: async (context) => [{
      title: 'Strategy Serum', url: context.canonicalCandidate,
      productId: context.productId, price: '31', currency: 'CAD', providerSource: 'shopping_result',
    }] }],
  });
  await hybridResolver(product('30001'));
  assert.equal(fieldHistory(hybridResolver, 'price').strategy, 'HYBRID');

  await hybridResolver(product('30002'));
  await hybridResolver(product('30003'));
  assert.equal(fieldHistory(hybridResolver, 'price').strategy, 'SEARCH_FIRST');

  const unreliableResolver = createProductResolver({
    statePath: ':memory:', urlValidator: noNetworkValidation,
    directResolver: directWithoutPrice,
    searchProviders: [{ resolveProductCandidates: async () => [] }],
  });
  await unreliableResolver(product('40001'));
  await unreliableResolver(product('40002'));
  await unreliableResolver(product('40003'));
  assert.equal(fieldHistory(unreliableResolver, 'price').strategy, 'DIRECT_UNRELIABLE');
});
