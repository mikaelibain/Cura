import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createProductResolver, DuckDuckGoSearchProvider, parseProductUrl } from '../productResolver.mjs';
import { SearchRotation } from '../server/resolver/rotation.mjs';
import { retailerFromProductUrl } from '../src/commerceRegistry.ts';

const canada = 'https://www2.hm.com/en_ca/productpage.1338299003.html?srsltid=TRACKED';
const foreign = 'https://www2.hm.com/en_gb/productpage.1338299003.html';
const image = 'https://image.hm.com/assets/product-1338299003.jpg';
const noNetworkValidation = async () => true;

test('www, www2, and bare H&M hosts resolve to H&M without a fabricated numeric-page title', async () => {
  for (const hostname of ['hm.com', 'www.hm.com', 'www2.hm.com']) {
    const url = `https://${hostname}/en_ca/productpage.1338299003.html`;
    const parsed = parseProductUrl(url);
    assert.equal(parsed.retailer, 'H&M');
    assert.equal(retailerFromProductUrl(url), 'H&M');
    assert.equal(parsed.productId, '1338299003');
    const resolver = createProductResolver({ statePath: ':memory:', urlValidator: noNetworkValidation,
      directResolver: async () => { throw new Error('HTTP_403'); } });
    const result = await resolver(url);
    assert.equal(result.title, '');
    assert.equal(result.retailer, 'H&M');
  }
});

test('the second exact Canada article recovers a verified title and H&M image without foreign price', async () => {
  const original = 'https://www2.hm.com/en_ca/productpage.1349191002.html?srsltid=AU7gw4XWA1MtWaWgR_86B1Q7oJ3QssIUgnctRClGUix3MQ5YekIkXkU4bf8';
  const sameArticle = 'https://www2.hm.com/en_us/productpage.1349191002.html';
  const productImage = 'https://image.hm.com/assets/hm/test-product.jpg';
  const resolver = createProductResolver({ statePath: ':memory:', urlValidator: noNetworkValidation,
    directResolver: async () => { throw new Error('HTTP_403'); },
    searchProviders: [
      { kind: 'direct-google', resolveProductCandidates: async () => [] },
      { kind: 'indexed-search', resolveProductCandidates: async () => [
        { title: 'Tie-detail halterneck dress | H&M US', url: sameArticle, providerSource: 'indexed_search', price: '40', currency: 'USD' },
        { title: 'Tie-detail halterneck dress | H&M US', url: sameArticle, providerSource: 'indexed_image', imageUrl: productImage },
      ] },
    ],
  });
  const result = await resolver(original);
  assert.match(result.title, /Tie-detail halterneck dress/);
  assert.equal(result.imageUrl, productImage);
  assert.equal(result.price, '');
  assert.equal(result.currency, 'CAD');
  assert.equal(result.productId, '1349191002');
  assert.equal(result.originalUrl, original);
});

test('old Www2 product cache is invalidated and replaced by verified exact-article fields', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'cura-hm-old-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const statePath = join(directory, 'state.json');
  const normalized = parseProductUrl(canada).normalizedUrl;
  const key = `${createHash('sha256').update(normalized).digest('hex')}::size::||||||||`;
  writeFileSync(statePath, JSON.stringify({ version: 1, registry: {}, products: { [key]: {
    resolverVersion: 3, product: { title: 'Www2 product', retailer: 'Www2', imageUrl: '', price: '', currency: 'CAD', fieldSources: { title: 'url_slug' } },
    expiresAt: new Date(Date.now() + 60_000).toISOString(), nextEnrichmentAt: new Date(Date.now() + 60_000).toISOString(),
  } } }));
  const instance = createProductResolver({ statePath, urlValidator: noNetworkValidation,
    directResolver: async () => { throw new Error('HTTP_403'); },
    searchProviders: [{ kind: 'indexed-search', resolveProductCandidates: async () => [
      { title: 'Asymmetric dual-fabric dress', url: foreign, imageUrl: image, providerSource: 'indexed_image' },
    ] }],
  });
  const result = await instance(canada);
  assert.equal(result.title, 'Asymmetric dual-fabric dress');
  assert.equal(result.imageUrl, image);
  assert.equal(result.retailer, 'H&M');
  assert.equal(Object.values(JSON.parse(readFileSync(statePath)).products).find((entry) => entry.product?.imageUrl === image)?.product.title, 'Asymmetric dual-fabric dress');
});

test('Google JS shell falls through to free indexed exact-article result and cross-locale page media', async () => {
  const calls = [];
  const resolver = createProductResolver({ statePath: ':memory:', urlValidator: noNetworkValidation,
    directResolver: async (context) => {
      calls.push(`direct:${context.locale}`);
      if (context.country === 'CA') throw new Error('HTTP_403');
      return { title: 'Asymmetric dual-fabric dress', retailer: 'H&M', brand: 'H&M',
        imageUrl: image, imageUrls: [image, 'https://image.hm.com/assets/detail.jpg'], price: '19.99', currency: 'GBP' };
    },
    searchProviders: [
      { kind: 'direct-google', resolveProductCandidates: async () => { calls.push('google:js-shell'); return []; } },
      { kind: 'indexed', resolveProductCandidates: async () => { calls.push('indexed'); return [
        { url: 'https://www2.hm.com/en_gb/productpage.9999999999.html', title: 'Wrong dress', providerSource: 'indexed_search' },
        { url: foreign, title: 'Asymmetric dual-fabric dress | H&M GB', price: '19.99', currency: 'GBP', providerSource: 'indexed_search' },
      ]; } },
    ],
  });
  const result = await resolver(canada);
  assert.deepEqual(calls, ['direct:en_ca', 'google:js-shell', 'indexed', 'direct:en_gb']);
  assert.equal(result.title, 'Asymmetric dual-fabric dress');
  assert.equal(result.imageUrl, image);
  assert.equal(result.imageUrls.length, 2);
  assert.equal(result.price, '');
  assert.equal(result.currency, 'CAD');
  assert.equal(result.fieldSources.title, 'hm_cross_locale_page');
  assert.equal(result.fieldSources.imageUrl, 'hm_cross_locale_page');
  assert.equal(result.originalUrl, canada);
});

test('exact-article Canadian indexed offer can fill CAD price after foreign identity recovery', async () => {
  const resolver = createProductResolver({ statePath: ':memory:', urlValidator: noNetworkValidation,
    directResolver: async (context) => context.country === 'CA' ? Promise.reject(new Error('HTTP_403'))
      : { title: 'Asymmetric dual-fabric dress', imageUrl: image, price: '19.99', currency: 'GBP' },
    searchProviders: [{ kind: 'indexed', resolveProductCandidates: async () => [
      { url: foreign, title: 'Asymmetric dual-fabric dress', price: '19.99', currency: 'GBP', providerSource: 'indexed_search' },
      { url: 'https://www2.hm.com/en_ca/productpage.1338299003.html', title: 'Asymmetric dual-fabric dress', price: '34.99', currency: 'CAD', providerSource: 'indexed_search' },
    ] }],
  });
  const result = await resolver(canada);
  assert.equal(result.price, '34.99');
  assert.equal(result.currency, 'CAD');
  assert.equal(result.imageUrl, image);
  assert.equal(result.fieldSources.price, 'indexed_search');
});

test('frontend maps H&M host before creating an item and repairs old Www2 product labels', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const registry = readFileSync(new URL('../src/commerceRegistry.ts', import.meta.url), 'utf8');
  assert.match(app, /retailerFromProductUrl\(url\)/);
  assert.match(app, /!item\.titleManual && \/\^\(\?:www/);
  assert.match(registry, /domain === 'hm'\) return 'H&M'/);
  assert.doesNotMatch(app, /host\.split\('\.'\)\[0\]/);
});

test('production search registers Tavily then Firecrawl and retains later exact-article candidates', async () => {
  const attempts = [];
  const provider = new SearchRotation({ quota: { canSpend: () => true, spend: () => true }, providers: [
    { name: 'Tavily', kind: 'tavily_search', search: async (query) => { attempts.push(['Tavily', query]); return [
      { title: 'Wrong dress', url: 'https://www2.hm.com/en_gb/productpage.9999999999.html' },
      { title: 'Asymmetric dual-fabric dress', url: foreign },
    ]; } },
    { name: 'Firecrawl', kind: 'firecrawl_search', search: async (query) => { attempts.push(['Firecrawl', query]); return []; } },
  ] });
  const candidates = await provider.resolveProductCandidates(parseProductUrl(canada));
  assert.ok(candidates.length >= 2);
  assert.equal(candidates[1].url, foreign);
  assert.match(candidates[1].title, /Asymmetric dual-fabric dress/);
  assert.deepEqual(attempts.map(([name]) => name), ['Tavily', 'Tavily']);
  assert.equal(new Set(attempts.map(([, query]) => query)).size, 2);
  const server = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  assert.match(server, /resolverConfig\.tavilyKey \? \[new TavilyProvider\(resolverConfig\.tavilyKey\)\]/);
  // A shared instance serves web backup and the separate image source.
  assert.match(server, /firecrawlProvider = resolverConfig\.firecrawlKey \? new FirecrawlProvider\(resolverConfig\.firecrawlKey\)/);
  assert.match(server, /firecrawlProvider \? \[firecrawlProvider\] : \[\]/);
  assert.match(server, /searchProviders: \[searchRotation\]/);
});

test('public indexed image results retain only H&M-hosted images tied to the exact article URL', async () => {
  const html = `<a class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent(foreign)}">Asymmetric dual-fabric dress | H&amp;M GB</a>`;
  const provider = new DuckDuckGoSearchProvider(async (endpoint) => {
    if (endpoint.pathname === '/i.js') return { ok: true, json: async () => ({ results: [
      { title: 'Wrong dress', url: 'https://www2.hm.com/en_gb/productpage.9999999999.html', image: 'https://image.hm.com/wrong.jpg' },
      { title: 'Correct dress', url: foreign, image },
      { title: 'Untrusted image', url: foreign, image: 'https://other.example/similar.jpg' },
    ] }) };
    if (endpoint.pathname === '/') return { ok: true, text: async () => '<script>vqd="12345-678"</script>' };
    return { ok: true, text: async () => html };
  });
  const candidates = await provider.resolveProductCandidates(parseProductUrl(canada));
  assert.deepEqual(candidates.filter((candidate) => candidate.imageUrl).map((candidate) => candidate.imageUrl), [image]);
});
