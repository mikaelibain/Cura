import assert from 'node:assert/strict';
import test from 'node:test';
import { BraveSearchProvider, createProductResolver, parseProductUrl } from '../productResolver.mjs';

const noNetworkValidation = async () => true;

test('Canadian path markets and ad parameters are parsed without polluting product identity', () => {
  const parsed = parseProductUrl('https://www.hollisterco.com/shop/ca/p/icon-polo-63486381?seq=03&source=googleshopping&cmp=campaign&gclsrc=aw.ds&gad_source=1&gad_campaignid=2&gbraid=token&gclid=click');
  assert.equal(parsed.productId, '63486381');
  assert.equal(parsed.country, 'CA');
  assert.equal(parsed.currencyHint, 'CAD');
  for (const parameter of ['source', 'cmp', 'gclsrc', 'gad_source', 'gad_campaignid', 'gbraid', 'gclid']) {
    assert.equal(parsed.canonicalCandidate.includes(`${parameter}=`), false, parameter);
  }
  assert.equal(parsed.canonicalCandidate.includes('seq=03'), true);
});

test('indexed fallback resolves identity and price, then verifies a title-based product image', async () => {
  const productUrl = 'https://www.aritzia.com/en/product/capture-satin-skirt/129755.html?color=35023';
  const webHtml = `<div class="snippet">
    <a href="${productUrl}">
      <div class="desktop-small-semibold t-secondary">Aritzia</div>
      <div class="title search-snippet-title" title="Capture Satin Skirt | Aritzia CA">Capture Satin Skirt</div>
    </a>
    <div class="product-review"><strong>Price:</strong> <span>CA$128.00</span></div>
  </div>`;
  const imageHtml = `{title:"Capture Satin Skirt | Aritzia CA",url:"${productUrl}",source:"aritzia.com",thumbnail:{src:"proxy",original:"https://assets.aritzia.com/image/upload/crop/129755_35023.jpg"},properties:{}}`;
  const requestedUrls = [];
  const fetcher = async (url) => {
    requestedUrls.push(url.toString());
    return { ok: true, text: async () => url.pathname === '/images' ? imageHtml : webHtml };
  };
  const resolver = createProductResolver({
    statePath: ':memory:',
    urlValidator: noNetworkValidation,
    directResolver: async () => { throw new Error('HTTP_403'); },
    searchProviders: [new BraveSearchProvider(fetcher)],
  });

  const result = await resolver(productUrl, { preferredCurrency: 'CAD' });
  assert.equal(result.title, 'Capture Satin Skirt');
  assert.equal(result.price, '128.00');
  assert.equal(result.currency, 'CAD');
  assert.equal(result.imageUrl, 'https://assets.aritzia.com/image/upload/crop/129755_35023.jpg');
  assert.ok(requestedUrls.some((url) => url.includes('/search?')));
  assert.ok(requestedUrls.some((url) => url.includes('/images?')));
});

test('preferred currency supplies market context when the URL itself is ambiguous', async () => {
  let seenContext;
  const resolver = createProductResolver({
    statePath: ':memory:',
    urlValidator: noNetworkValidation,
    directResolver: async (context) => {
      seenContext = context;
      return { title: 'Product', brand: 'Brand', retailer: 'Shop', imageUrl: 'https://images.example/item.jpg', price: '10', currency: 'CAD' };
    },
  });
  await resolver('https://shop.example/en/product/12345', { preferredCurrency: 'CAD' });
  assert.equal(seenContext.currencyHint, 'CAD');
  assert.equal(seenContext.country, 'CA');
});
