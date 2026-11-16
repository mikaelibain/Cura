import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductResolver, parseProductUrl } from '../productResolver.mjs';
import { capabilityFor } from '../retailerCapabilities.mjs';

const shein = 'https://ca.shein.com/Example-Top-p-514997343.html';
const superstore = 'https://www.realcanadiansuperstore.ca/en/Example/p/21708789_EA?pc-express-book=1009';

test('identity retains Loblaw unit suffix and commercial store context', () => {
  const context = parseProductUrl(superstore);
  assert.equal(context.productId, '21708789_EA');
  assert.equal(context.retailer, 'Real Canadian Superstore');
  assert.match(context.normalizedUrl, /pc-express-book=1009/);
  assert.equal(capabilityFor(context).priceScope, 'store_or_region');
});

test('rendered completion stops before native and external search', async () => {
  let nativeCalls = 0;
  let searchCalls = 0;
  const resolver = createProductResolver({ statePath: ':memory:', urlValidator: async () => {},
    directResolver: async () => ({ title: 'Example Top' }),
    renderedResolver: async () => ({ imageUrl: 'https://img.example/top.jpg', imageUrls: ['https://img.example/top.jpg'], price: '19.99', currency: 'CAD', fieldSources: { imageUrl: 'rendered_retailer_gallery', price: 'rendered_retailer', currency: 'rendered_retailer' } }),
    nativeCatalogResolver: async () => { nativeCalls++; return {}; },
    searchProviders: [{ resolveProductCandidates: async () => { searchCalls++; return []; } }],
  });
  const result = await resolver(shein);
  assert.equal(result.price, '19.99');
  assert.equal(result.fieldSources.imageUrl, 'rendered_retailer_gallery');
  assert.equal(nativeCalls, 0);
  assert.equal(searchCalls, 0);
});
