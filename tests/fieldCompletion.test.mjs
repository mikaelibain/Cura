import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createProductResolver, DirectGoogleSearchProvider, parseProductUrl, RESOLVER_VERSION, verifyCandidate } from '../productResolver.mjs';
import { SearchRotation } from '../server/resolver/rotation.mjs';
import { extractProduct } from '../server.mjs';

const walmart = 'https://www.walmart.ca/en/ip/EP-GLOSSING-SH-250/6000208962043?selectedSellerId=0&wl13=1031&cmpid=SEM_CA_609_S9C9I4A0U7_22365417720_186052645374&utm_id=SEM_CA_609_S9C9I4A0U7_22365417720_186052645374&utm_medium=paid_search&utm_source=google&utm_campaign=always_on&gclsrc=aw.ds&gad_source=1&gad_campaignid=22365417720&gbraid=0AAAAADv6L0QY2MXYuM3x0LuM3WP8ksXK5&gclid=Cj0KCQjwlNPVBhCMARIsAPZ5RqhaEO8LdD6hLNEfLCyIl-5TO5FtWcUSj9lMGdjb9YhmIYunqvifsboaAjg3EALw_wcB';
const aritzia = 'https://www.aritzia.com/en/product/smooth-matter™-ginger-top/133120001.html';
const sephora = 'https://www.sephora.com/ca/en/product/multi-peptide-serum-for-hair-density-P442831?country_switch=ca&lang=en&skuId=2210722&om_mmc=ppc-GG_1166603274_58574464968_aud-2466386477163:pla-430665346244_2210722_257729463352_9000671_c&gclsrc=aw.ds&gad_source=1&gad_campaignid=1166603274&gbraid=0AAAAADnIXb2wNG6rO29NR3Y0xRYwwmq_m&gclid=Cj0KCQjwlNPVBhCMARIsAPZ5Rqi9xHPbM3Keozp8hmhvZpyjv-9oT_M3B8JpcVM-26f7mB9c9CuH4HsaAvZXEALw_wcB';
const shoppers = 'https://www.shoppersdrugmart.ca/tresemme-serum-keratin-smooth-shine-97ml/p/BB_055451435154?variantCode=055451435154';
const london = 'https://www.londondrugs.com/products/loreal-paris-hair-expertise-glycolic-gloss-rinse-off-gloss-injection-200ml/p/L2717921';
const lululemon = 'https://shop.lululemon.com/en-ca/p/hotty-hot-short-hr-long/e15cmdjmrc?cid=Google_SHOP-AIMAX_CA_NAT_EN_X_NB-SHOP_2INTENT_OMNI_GEN-TEST_Y26_DM_ag-SHOP-AIMAX_G_CA_EN_DM_X_GEN-TEST_NO_ARITZIA&color=75743&sz=4';
const noNetworkValidation = async () => true;
const card = (url, title, image = '', price = '') => `<a href="${url}">${image ? `<img src="${image}">` : ''}<h3>${title}</h3></a>${price}`;

test('real regression URL identities preserve commerce context and remove only ads', () => {
  const w = parseProductUrl(walmart);
  assert.equal(w.originalUrl, walmart);
  assert.equal(w.normalizedUrl, 'https://www.walmart.ca/en/ip/EP-GLOSSING-SH-250/6000208962043?selectedSellerId=0&wl13=1031');
  assert.equal(w.retailer, 'Walmart Canada');
  assert.equal(w.productId, '6000208962043');
  assert.equal(w.currencyHint, 'CAD');
  const a = parseProductUrl(aritzia);
  assert.equal(a.productId, '133120001');
  assert.equal(a.currencyHint, 'CAD');
  assert.equal(a.normalizedUrl, parseProductUrl(aritzia.replace('™', '%E2%84%A2')).normalizedUrl);
  const s = parseProductUrl(sephora);
  assert.equal(s.productId, 'P442831');
  assert.equal(s.sku, '2210722');
  assert.equal(s.locale, 'en_ca');
  assert.equal(s.normalizedUrl, 'https://www.sephora.com/ca/en/product/multi-peptide-serum-for-hair-density-P442831?country_switch=ca&lang=en&skuId=2210722');
  assert.equal(parseProductUrl(shoppers).productId, '055451435154');
  assert.equal(parseProductUrl(shoppers).retailer, 'Shoppers Drug Mart');
  assert.equal(parseProductUrl(shoppers).variantId, '055451435154');
  assert.equal(parseProductUrl(london).productId, 'L2717921');
  assert.equal(parseProductUrl(london).retailer, 'London Drugs');
  assert.equal(parseProductUrl(london).currencyHint, 'CAD');
  assert.equal(parseProductUrl('https://store.example/p/123456?source=seller&source=google').normalizedUrl, 'https://store.example/p/123456?source=seller');
});

test('normal Walmart HTML containing a recaptcha CSP still yields structured image and price', () => {
  const html = '<meta http-equiv="Content-Security-Policy" content="script-src www.recaptcha.net">'
    + '<script type="application/ld+json">{"@type":"Product","name":"Glossing Shampoo","sku":"6000208962043","gtin12":"71249689684","image":["https://i5.walmartimages.ca/product.jpg"],"offers":{"price":"13.94","priceCurrency":"CAD"}}</script>';
  const result = extractProduct(html, walmart);
  assert.equal(result.title, 'Glossing Shampoo');
  assert.equal(result.imageUrl, 'https://i5.walmartimages.ca/product.jpg');
  assert.equal(result.price, '13.94');
  assert.equal(result.currency, 'CAD');
  assert.equal(result.upc, '71249689684');
  assert.equal(result.imageUrls.length, 1);
});

test('title-only direct and SerpAPI results continue to Google for missing image and price', async () => {
  const url = 'https://www2.hm.com/en_ca/productpage.1338299003.html';
  let serpCalls = 0;
  const serp = { kind: 'serpapi', state: 'available', resolveProductCandidates: async () => {
    serpCalls += 1;
    return [{ url, title: 'Direct title repeated', providerSource: 'search_result' }];
  } };
  const calls = [];
  const google = new DirectGoogleSearchProvider(async (endpoint) => {
    calls.push(endpoint.searchParams.get('tbm') || 'web');
    return { ok: true, text: async () => endpoint.searchParams.get('tbm') === 'shop'
      ? card(url, 'Shopping title', 'https://image.hm.com/dress.jpg', 'CA$34.99') : '<html>No indexed web cards</html>' };
  });
  const resolver = createProductResolver({ statePath: ':memory:', urlValidator: noNetworkValidation,
    directResolver: async () => ({ title: 'Verified direct title', retailer: 'H&M', brand: 'H&M', currency: 'CAD' }), searchProviders: [serp, google] });
  const result = await resolver(url);
  assert.equal(serpCalls, 1);
  assert.deepEqual(calls, ['web', 'web', 'shop']);
  assert.equal(result.title, 'Verified direct title');
  assert.equal(result.imageUrl, 'https://image.hm.com/dress.jpg');
  assert.equal(result.price, '34.99');
  assert.equal(result.currency, 'CAD');
});

test('search rotation uses at most two queries while completing image and price after a title', async () => {
  const url = 'https://shop.example/products/linen-dress-123456';
  const calls = [];
  const context = parseProductUrl(url);
  const firstQuery = `site:${context.baseDomain} "${context.productId}" "${context.slug}"`;
  const provider = new SearchRotation({
    quota: { canSpend: () => true, spend: () => true },
    providers: [
      { name: 'Tavily', kind: 'tavily_search', search: async (query) => {
        calls.push(['Tavily', query]);
        return query === firstQuery ? [{ title: 'Linen Dress', url }] : [{ title: 'Linen Dress', url, image: 'https://images.example/dress.jpg', snippet: 'CAD 34.99' }];
      } },
      { name: 'Firecrawl', kind: 'firecrawl_search', search: async (query) => { calls.push(['Firecrawl', query]); return []; } },
    ],
  });
  const candidates = await provider.resolveProductCandidates(context, { missingFields: ['imageUrl', 'price'] });
  assert.equal(new Set(calls.map(([, query]) => query)).size, 2);
  assert.deepEqual(calls.map(([name]) => name), ['Tavily', 'Tavily']);
  assert.match(calls[1][1], /\"\$\"/);
  assert.ok(candidates.some((candidate) => candidate.url === url && candidate.imageUrl && candidate.price === '34.99'));
});

test('seller, SKU, and market mismatches cannot supply retailer price', () => {
  const w = parseProductUrl(walmart);
  assert.equal(verifyCandidate({ url: 'https://www.walmart.ca/en/ip/EP-GLOSSING-SH-250/6000208962043?selectedSellerId=99', currency: 'CAD' }, w).sellerMatch, false);
  const s = parseProductUrl(sephora);
  assert.equal(verifyCandidate({ url: 'https://www.sephora.com/ca/en/product/multi-peptide-serum-for-hair-density-P442831?skuId=9999999', currency: 'CAD' }, s).confidence, 'LOW');
  assert.equal(verifyCandidate({ url: 'https://www.sephora.com/us/en/product/multi-peptide-serum-for-hair-density-P442831?skuId=2210722', currency: 'USD' }, s).confidence, 'LOW');
});

test('different Walmart seller can supply a verified image but not the selected seller price', async () => {
  const candidateUrl = 'https://www.walmart.ca/en/ip/EP-GLOSSING-SH-250/6000208962043?selectedSellerId=99&wl13=1031';
  const resolver = createProductResolver({ statePath: ':memory:', urlValidator: noNetworkValidation,
    directResolver: async () => ({ title: 'Glossing Shampoo', retailer: 'Walmart Canada', currency: 'CAD' }),
    searchProviders: [{ resolveProductCandidates: async () => [{ url: candidateUrl, title: 'Glossing Shampoo', imageUrl: 'https://i5.walmartimages.ca/product.jpg', price: '9.99', currency: 'CAD', providerSource: 'shopping_result' }] }],
  });
  const result = await resolver(walmart);
  assert.equal(result.imageUrl, 'https://i5.walmartimages.ca/product.jpg');
  assert.equal(result.price, '');
});

test('Sephora US exact product can supply an image while its USD price is rejected for Canada', async () => {
  const us = 'https://www.sephora.com/us/en/product/multi-peptide-serum-for-hair-density-P442831?skuId=2210722';
  const google = new DirectGoogleSearchProvider(async (endpoint) => ({ ok: true, text: async () => endpoint.searchParams.get('tbm') === 'shop'
    ? card(us, 'Multi-Peptide Serum for Hair Density', 'https://www.sephora.com/product-image.jpg', 'US$24.00')
    : card(us, 'Multi-Peptide Serum for Hair Density | Sephora') }));
  const resolver = createProductResolver({ statePath: ':memory:', urlValidator: noNetworkValidation,
    directResolver: async () => ({ title: 'Multi-Peptide Serum for Hair Density', retailer: 'Sephora', currency: 'CAD' }),
    searchProviders: [google],
  });
  const result = await resolver(sephora);
  assert.equal(result.title, 'Multi-Peptide Serum for Hair Density');
  assert.equal(result.imageUrl, 'https://www.sephora.com/product-image.jpg');
  assert.equal(result.price, '');
  assert.equal(result.currency, 'CAD');
});

test('exact global identifier permits an image from another retailer but not its price', async () => {
  const resolver = createProductResolver({ statePath: ':memory:', urlValidator: noNetworkValidation,
    directResolver: async () => ({ title: 'Verified product', retailer: 'Walmart Canada', upc: '71249689684', currency: 'CAD' }),
    searchProviders: [{ resolveProductCandidates: async () => [{ url: 'https://manufacturer.example/product/other-route', upc: '71249689684', imageUrl: 'https://manufacturer.example/product.jpg', price: '99.00', currency: 'CAD', providerSource: 'manufacturer_image' }] }],
  });
  const result = await resolver(walmart);
  assert.equal(result.title, 'Verified product');
  assert.equal(result.imageUrl, 'https://manufacturer.example/product.jpg');
  assert.equal(result.price, '');
});

test('old title-only cache is enriched; complete Lululemon control still avoids search', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cura-field-cache-'));
  const statePath = join(directory, 'resolution.json');
  try {
    const normalized = parseProductUrl(aritzia).normalizedUrl;
    const key = `${createHash('sha256').update(normalized).digest('hex')}::size::||||||||`;
    writeFileSync(statePath, JSON.stringify({ version: 1, registry: {}, products: { [key]: { product: { title: 'Old title', retailer: 'Aritzia', imageUrl: '', price: '', currency: 'CAD' }, expiresAt: new Date(Date.now() + 6 * 60 * 60_000).toISOString() } } }));
    let directCalls = 0;
    const resolver = createProductResolver({ statePath, urlValidator: noNetworkValidation,
      directResolver: async () => { directCalls += 1; return { title: 'Smooth Matter™ Ginger Top', retailer: 'Aritzia', brand: 'Aritzia', imageUrl: 'https://assets.aritzia.com/top.jpg', price: '58', currency: 'CAD' }; } });
    const result = await resolver(aritzia);
    assert.equal(directCalls, 1);
    assert.equal(result.price, '58');
    assert.equal(result.imageUrl, 'https://assets.aritzia.com/top.jpg');
    assert.equal(Object.values(JSON.parse(readFileSync(statePath)).products).find((entry) => entry.product?.price === '58')?.resolverVersion, RESOLVER_VERSION);

    let searches = 0;
    const control = createProductResolver({ statePath: ':memory:', urlValidator: noNetworkValidation,
      directResolver: async (context) => ({ ...extractProduct('<script type="application/ld+json">{"@type":"Product","name":"Hotty Hot High-Rise Lined Short","brand":"lululemon","image":"https://images.lululemon.com/is/image/lululemon/LW7DCNS_075743_1","offers":{"price":"39","priceCurrency":"CAD"}}</script>', context.originalUrl), retailer: 'Lululemon' }),
      searchProviders: [{ resolveProductCandidates: async () => { searches += 1; return []; } }],
    });
    // Product-level JSON-LD does not verify a selected colour/size offer.
    const kept = await control(lululemon.split('?')[0]);
    assert.equal(kept.title, 'Hotty Hot High-Rise Lined Short');
    assert.equal(kept.imageUrl, 'https://images.lululemon.com/is/image/lululemon/LW7DCNS_075743_1');
    assert.equal(kept.price, '39');
    assert.equal(searches, 0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
