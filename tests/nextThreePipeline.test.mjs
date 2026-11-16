import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearResolverDiagnostics,
  createProductResolver,
  getResolverDiagnostics,
} from '../productResolver.mjs';
import { extractProduct } from '../server.mjs';

const noNetworkValidation = async () => true;

test('#1 runs one generic pipeline through URL parsing, direct extraction, fallback, merge, cache, and history', async () => {
  clearResolverDiagnostics();
  let directCalls = 0;
  let fallbackCalls = 0;
  const resolver = createProductResolver({
    statePath: ':memory:',
    urlValidator: noNetworkValidation,
    directResolver: async () => {
      directCalls += 1;
      return {
        title: 'Pipeline Moisturizer', brand: 'Cura Labs', retailer: 'New Shop',
        imageUrl: 'https://images.example/moisturizer.jpg', currency: 'CAD',
      };
    },
    searchProviders: [{ resolveProductCandidates: async () => {
      fallbackCalls += 1;
      return [{
        title: 'Pipeline Moisturizer', brand: 'Cura Labs', retailer: 'New Shop',
        url: 'https://new-shop.example/en_ca/products/pipeline-moisturizer-778899',
        productId: '778899', price: '28', currency: 'CAD', providerSource: 'shopping_result',
      }];
    } }],
  });
  const url = 'https://new-shop.example/en_ca/products/pipeline-moisturizer-778899?utm_source=email';
  const first = await resolver(url);
  const second = await resolver(url);

  assert.equal(first.title, 'Pipeline Moisturizer');
  assert.equal(first.price, '28');
  assert.equal(first.originalUrl, url);
  assert.equal(second.cacheHit, true);
  assert.equal(directCalls, 1);
  assert.equal(fallbackCalls, 1);
  assert.ok(Object.keys(resolver.inspectState().registry).length === 1);
  const events = getResolverDiagnostics().map(({ event }) => event);
  for (const event of ['URL_PARSED', 'DIRECT_STARTED', 'FALLBACK_STARTED', 'CANDIDATE_VERIFIED', 'FIELD_MERGED', 'RESOLUTION_COMPLETE', 'CACHE_HIT']) {
    assert.ok(events.includes(event), event);
  }
});

test('#11 extracts direct product fields independently from structured retailer metadata', () => {
  const html = `
    <html><head>
      <meta property="og:image" content="https://images.example/fallback.jpg">
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Product",
          "name": "Barrier Repair Cream",
          "brand": { "@type": "Brand", "name": "Derm Labs" },
          "image": ["https://images.example/cream.jpg"],
          "color": "White",
          "size": "50 ml",
          "offers": {
            "@type": "Offer",
            "price": "24.99",
            "priceCurrency": "CAD",
            "availability": "https://schema.org/InStock"
          }
        }
      </script>
    </head><body></body></html>`;
  const result = extractProduct(html, 'https://small-store.example/en_ca/products/barrier-cream');

  assert.equal(result.title, 'Barrier Repair Cream');
  assert.equal(result.brand, 'Derm Labs');
  assert.equal(result.imageUrl, 'https://images.example/cream.jpg');
  assert.ok(result.imageUrls.includes('https://images.example/cream.jpg'));
  assert.equal(result.price, '24.99');
  assert.equal(result.currency, 'CAD');
  assert.equal(result.availability, 'https://schema.org/InStock');
  assert.deepEqual(result.colors, ['White']);
  assert.deepEqual(result.sizes, ['50 ml']);
});

test('#16 verifies every fallback candidate and merges only the verified product', async () => {
  const resolver = createProductResolver({
    statePath: ':memory:',
    urlValidator: noNetworkValidation,
    directResolver: async () => { throw new Error('HTTP_403'); },
    searchProviders: [{ resolveProductCandidates: async () => [
      {
        title: 'Similar Serum', url: 'https://unrelated.example/similar-serum',
        imageUrl: 'https://unrelated.example/wrong.jpg', price: '9', currency: 'USD',
        providerSource: 'shopping_result',
      },
      {
        title: 'Exact Serum', brand: 'Exact Labs', retailer: 'Exact Shop',
        url: 'https://exact-shop.example/en_ca/products/exact-serum-667788',
        productId: '667788', imageUrl: 'https://images.example/exact.jpg',
        price: '39', currency: 'CAD', providerSource: 'shopping_result',
      },
    ] }],
  });

  const result = await resolver('https://exact-shop.example/en_ca/products/exact-serum-667788');
  assert.equal(result.title, 'Exact Serum');
  assert.equal(result.imageUrl, 'https://images.example/exact.jpg');
  assert.equal(result.price, '39');
  assert.equal(result.currency, 'CAD');
  assert.equal(result.imageUrls.includes('https://unrelated.example/wrong.jpg'), false);
});
