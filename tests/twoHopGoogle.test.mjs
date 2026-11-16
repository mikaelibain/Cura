import assert from 'node:assert/strict';
import test from 'node:test';
import { createProductResolver, DirectGoogleSearchProvider, getResolverDiagnostics, parseProductUrl, clearResolverDiagnostics } from '../productResolver.mjs';

const firstUrl = 'https://www2.hm.com/en_ca/productpage.1349191002.html?srsltid=AU7gw4XWA1MtWaWgR_86B1Q7oJ3QssIUgnctRClGUix3MQ5YekIkXkU4bf8';
const secondUrl = 'https://www2.hm.com/en_ca/productpage.1338299003.html?srsltid=AU7gw4VtUkJeU7H5P_GkKQvbDnwObW_p2qoXwoMD43DFqTHD0W7ORocMmds';
const card = (href, title, image = '', tail = '') => `<a href="${href}">${image ? `<img src="${image}">` : ''}<h3>${title}</h3></a>${tail}`;
const resolverWith = (fetcher, providers = []) => createProductResolver({
  statePath: ':memory:', urlValidator: async () => true,
  directResolver: async () => { throw new Error('HTTP_403'); },
  searchProviders: [...providers, new DirectGoogleSearchProvider(fetcher)],
});

test('two-hop Google verifies a later H&M web caption, then accepts same-market Shopping image and price', async () => {
  clearResolverDiagnostics();
  const original = parseProductUrl(firstUrl);
  const correct = `${original.normalizedUrl}?utm_source=google`;
  const calls = [];
  const fetcher = async (endpoint) => {
    calls.push({ query: endpoint.searchParams.get('q'), mode: endpoint.searchParams.get('tbm') });
    return { ok: true, text: async () => endpoint.searchParams.get('tbm') === 'shop'
      ? card('https://www2.hm.com/en_ca/productpage.9999999999.html', 'Wrong dress', 'https://images.example/wrong.jpg', 'CA$9.99')
        + card(`/url?url=${encodeURIComponent(correct)}`, 'Tie-detail halterneck dress', 'https://images.example/shop-correct.jpg', 'CA$68.00')
      : card('https://www2.hm.com/en_ca/productpage.9999999999.html', 'Wrong dress')
        + card(`/url?q=${encodeURIComponent(correct)}`, "Women's Peach pink/Floral Tie-detail halterneck dress | H&M", 'https://images.example/web-correct.jpg') };
  };
  const result = await resolverWith(fetcher)(firstUrl);
  assert.equal(calls.length, 2);
  assert.match(calls[0].query, /1349191002/);
  assert.match(calls[1].query, /Peach pink\/Floral Tie-detail halterneck dress/);
  assert.equal(calls[1].mode, 'shop');
  assert.equal(result.title, "Women's Peach pink/Floral Tie-detail halterneck dress");
  assert.equal(result.imageUrl, 'https://images.example/web-correct.jpg');
  assert.equal(result.price, '68.00');
  assert.equal(result.currency, 'CAD');
  assert.equal(result.originalUrl, firstUrl);
  assert.equal(result.normalizedUrl, original.normalizedUrl);
  assert.equal(result.productId, '1349191002');
  assert.equal(result.matchedCandidateUrl, correct);
  const diagnostics = getResolverDiagnostics();
  assert.equal(diagnostics.find((entry) => entry.event === 'GOOGLE_HOP1_RESULT')?.selected, 2);
  assert.equal(diagnostics.find((entry) => entry.event === 'GOOGLE_HOP2_RESULT')?.selected, 2);
});

test('same H&M article in a foreign market can supply title and image but never Canadian price', async () => {
  const foreign = 'https://www2.hm.com/en_gb/productpage.1338299003.html';
  const fetcher = async (endpoint) => ({ ok: true, text: async () => endpoint.searchParams.get('tbm') === 'shop'
    ? card(foreign, 'Asymmetric dual-fabric dress', 'https://image.hm.com/foreign.jpg', '£19.99')
    : card(foreign, 'Asymmetric dual-fabric dress | H&M GB') });
  const result = await resolverWith(fetcher, [{ kind: 'serpapi', state: 'quota_exhausted', resolveProductCandidates: async () => [] }])(secondUrl);
  assert.equal(result.title, 'Asymmetric dual-fabric dress');
  assert.equal(result.imageUrl, 'https://image.hm.com/foreign.jpg');
  assert.equal(result.price, '');
  assert.equal(result.currency, 'CAD');
  assert.equal(result.originalUrl, secondUrl);
  assert.equal(result.productId, '1338299003');
});

test('verified web caption remains useful when Shopping is unavailable, and Google challenge is graceful', async () => {
  const correct = parseProductUrl(firstUrl).normalizedUrl;
  const web = card(correct, 'Tie-detail halterneck dress | H&M');
  const withoutShopping = await resolverWith(async (endpoint) => ({ ok: endpoint.searchParams.get('tbm') !== 'shop', text: async () => web }))(firstUrl);
  assert.equal(withoutShopping.title, 'Tie-detail halterneck dress');
  assert.equal(withoutShopping.price, '');
  const blocked = await resolverWith(async () => ({ ok: true, text: async () => 'unusual traffic CAPTCHA' }))(firstUrl);
  assert.equal(blocked.productId, '1349191002');
  assert.equal(blocked.price, '');
  assert.equal(blocked.originalUrl, firstUrl);
});

test('two-hop fallback preserves manual price and image', async () => {
  const correct = parseProductUrl(firstUrl).normalizedUrl;
  const fetcher = async (endpoint) => ({ ok: true, text: async () => endpoint.searchParams.get('tbm') === 'shop'
    ? card(correct, 'Tie-detail halterneck dress', 'https://images.example/shop.jpg', 'CA$68.00')
    : card(correct, 'Tie-detail halterneck dress | H&M') });
  const result = await resolverWith(fetcher)(firstUrl, { lockedFields: ['price', 'imageUrl'], existing: { price: '55', imageUrl: 'data:image/png;base64,user' } });
  assert.equal(result.price, '55');
  assert.equal(result.imageUrl, 'data:image/png;base64,user');
});

test('public Google product details yield only a verified merchant destination', async () => {
  const correct = parseProductUrl(firstUrl).normalizedUrl;
  const calls = [];
  const fetcher = async (endpoint) => {
    calls.push(endpoint.toString());
    const html = endpoint.pathname.startsWith('/shopping/product/')
      ? `<a href="/url?url=${encodeURIComponent('https://www2.hm.com/en_ca/productpage.9999999999.html')}">Wrong merchant</a><a href="/url?url=${encodeURIComponent(correct)}">H&M</a>`
      : endpoint.searchParams.get('tbm') === 'shop'
        ? card('/shopping/product/123456', 'Tie-detail halterneck dress', 'https://images.example/product.jpg', 'CA$68.00')
        : card(correct, 'Tie-detail halterneck dress | H&M');
    return { ok: true, text: async () => html };
  };
  const result = await resolverWith(fetcher)(firstUrl);
  assert.equal(calls.length, 3);
  assert.equal(result.price, '68.00');
  assert.equal(result.imageUrl, 'https://images.example/product.jpg');
  assert.equal(result.matchedCandidateUrl, correct);
});

test('wrong-product Shopping result cannot contribute image or price', async () => {
  const correct = parseProductUrl(firstUrl).normalizedUrl;
  const fetcher = async (endpoint) => ({ ok: true, text: async () => endpoint.searchParams.get('tbm') === 'shop'
    ? card('https://www2.hm.com/en_ca/productpage.9999999999.html', 'Similar dress', 'https://images.example/wrong.jpg', 'CA$9.99')
    : card(correct, 'Tie-detail halterneck dress | H&M') });
  const result = await resolverWith(fetcher)(firstUrl);
  assert.equal(result.title, 'Tie-detail halterneck dress');
  assert.equal(result.imageUrl, '');
  assert.equal(result.price, '');
});

test('Sephora Web identity retains brand, thumbnail, SKU evidence and Canadian price before natural Shopping discovery', async () => {
  const url = 'https://www.sephora.com/ca/en/product/multi-peptide-serum-for-hair-density-P442831?country_switch=ca&lang=en&skuId=2210722&gclid=ad';
  const landing = 'https://www.sephora.com/ca/en/product/multi-peptide-serum-for-hair-density-P442831';
  const calls = [];
  const fetcher = async (endpoint) => {
    const query = endpoint.searchParams.get('q');
    const mode = endpoint.searchParams.get('tbm');
    calls.push({ query, mode });
    return { ok: true, text: async () => mode === 'shop'
      ? card('https://theordinary.com/en-ca/product/serum/999999', 'Multi-Peptide Serum for Hair Density', 'https://images.example/manufacturer.jpg', 'CA$25.27')
        + card(landing, 'Multi-Peptide Serum for Hair Density', 'https://images.example/sephora-shop.jpg', 'Item 2210722 CA$31.20')
      : card(landing, 'Multi-Peptide Serum for Hair Density - The Ordinary', 'https://images.example/sephora-web.jpg', 'Item 2210722 CA$31.20') };
  };
  const result = await resolverWith(fetcher)(url);
  assert.equal(calls[0].query, 'site:sephora.com "P442831"');
  assert.equal(calls[1].query, 'Canada Sephora Multi-Peptide Serum for Hair Density The Ordinary');
  assert.equal(calls[1].mode, 'shop');
  assert.equal(result.title, 'Multi-Peptide Serum for Hair Density');
  assert.equal(result.brand, 'The Ordinary');
  assert.equal(result.retailer, 'Sephora');
  assert.equal(result.imageUrl, 'https://images.example/sephora-web.jpg');
  assert.equal(result.price, '31.20');
  assert.equal(result.currency, 'CAD');
  assert.equal(result.fieldSources.price, 'direct_google_web');
  assert.equal(result.originalUrl, url);
});

test('Shopping query relaxes while price still requires the original Shoppers offer', async () => {
  const url = 'https://www.shoppersdrugmart.ca/en/product/test-serum/055451435154';
  const calls = [];
  const fetcher = async (endpoint) => {
    const query = endpoint.searchParams.get('q');
    calls.push(query);
    const mode = endpoint.searchParams.get('tbm');
    return { ok: true, text: async () => !mode
      ? card(url, 'Test Serum - Test Brand', 'https://images.example/shoppers-web.jpg')
      : query.includes('055451435154')
        ? card(url, 'Test Serum', 'https://images.example/shoppers-shop.jpg', 'CA$19.99')
        : card('https://www.walmart.ca/en/ip/test-serum/055451435154', 'Test Serum', 'https://images.example/walmart.jpg', 'CA$9.99') };
  };
  const result = await resolverWith(fetcher)(url);
  assert.equal(calls[1], 'Canada Shoppers Drug Mart Test Serum Test Brand');
  assert.ok(calls.some((query) => query.includes('055451435154') && !query.startsWith('site:')));
  assert.equal(result.price, '19.99');
  assert.equal(result.imageUrl, 'https://images.example/shoppers-web.jpg');
});

test('SHEIN uses the same Web bootstrap and natural Shopping query', async () => {
  const url = 'https://ca.shein.com/Floral-Dress-p-12345678.html';
  const calls = [];
  const fetcher = async (endpoint) => {
    calls.push({ query: endpoint.searchParams.get('q'), mode: endpoint.searchParams.get('tbm') });
    return { ok: true, text: async () => endpoint.searchParams.get('tbm') === 'shop'
      ? card(url, 'Floral Dress', 'https://images.example/shein-shop.jpg', 'CA$22.00')
      : card(url, 'Floral Dress | SHEIN', 'https://images.example/shein-web.jpg') };
  };
  const result = await resolverWith(fetcher)(url);
  assert.match(calls[0].query, /site:shein\.com "12345678"/);
  assert.equal(calls[1].query, 'Canada Shein Floral Dress');
  assert.equal(result.imageUrl, 'https://images.example/shein-web.jpg');
  assert.equal(result.price, '22.00');
});
