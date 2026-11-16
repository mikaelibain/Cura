import assert from 'node:assert/strict';
import test from 'node:test';
import { clearResolverDiagnostics, createProductResolver, getResolverDiagnostics, parseProductUrl, verifyCandidate } from '../productResolver.mjs';
import { isProductMediaUrl, normalizeSearchCandidate } from '../server/resolver/matcher.mjs';
import { SearchRotation } from '../server/resolver/rotation.mjs';

const hmUrl = 'https://www2.hm.com/en_ca/productpage.1337767006.html';
const frUrl = 'https://www2.hm.com/fr_ca/productpage.1337767006.html';
const usUrl = 'https://www2.hm.com/en_us/productpage.1337767006.html';
const image = 'https://image.hm.com/product-1337767006.jpg';
const quota = () => ({ canSpend: () => true, spend: () => true });

test('Tavily keeps a usable partial result, learns a title for query two, and saves Firecrawl credits', async () => {
  clearResolverDiagnostics();
  const context = parseProductUrl(hmUrl);
  const calls = [];
  const rotation = new SearchRotation({ quota: quota(), providers: [
    { name: 'Tavily', kind: 'tavily_search', search: async (query) => {
      calls.push(['Tavily', query]);
      return calls.length === 1 ? [{ title: "Women's Bright purple Cowl-Neck Dress", url: frUrl }]
        : [{ title: "Women's Bright purple Cowl-Neck Dress", url: frUrl, image, snippet: 'CAD 39.99' }];
    } },
    { name: 'Firecrawl', kind: 'firecrawl_search', search: async (query) => { calls.push(['Firecrawl', query]); return []; } },
  ] });
  const candidates = await rotation.resolveProductCandidates(context, { missingFields: ['title', 'imageUrl', 'price'], attemptId: 'rotation-test' });
  assert.deepEqual(calls.map(([name]) => name), ['Tavily', 'Firecrawl', 'Tavily']);
  assert.equal(calls[0][1], 'site:hm.com "1337767006"');
  assert.equal(calls[2][1], 'site:hm.com "1337767006" "Women\'s Bright purple Cowl-Neck Dress" "$"');
  assert.equal(candidates.length, 2);
  assert.equal(getResolverDiagnostics().filter((entry) => entry.event === 'SEARCH_PROVIDER_SKIPPED' && entry.reason === 'PRIMARY_RETURNED_USABLE_CANDIDATES').length, 1);
  assert.ok(getResolverDiagnostics().some((entry) => entry.event === 'SEARCH_PROVIDER_RESULT' && entry.role === 'PRIMARY' && entry.verifiedCandidates === 1));
});

test('Firecrawl is backup for failed, empty, irrelevant, or unavailable Tavily results', async () => {
  for (const scenario of ['HTTP_429', 'EMPTY', 'IRRELEVANT', 'QUOTA', 'COOLDOWN']) {
    clearResolverDiagnostics();
    const calls = [];
    const rotation = new SearchRotation({ quota: {
      canSpend: (provider) => scenario !== 'QUOTA' || provider !== 'tavily', spend: () => true,
    }, providers: [
      { name: 'Tavily', kind: 'tavily_search', retryAt: scenario === 'COOLDOWN' ? Date.now() + 60_000 : 0, search: async () => {
        calls.push('Tavily');
        if (scenario === 'HTTP_429') throw Object.assign(new Error('HTTP_429'), { status: 429 });
        if (scenario === 'IRRELEVANT') return [{ title: 'Other product', url: 'https://other.example/p/999999' }];
        return [];
      } },
      { name: 'Firecrawl', kind: 'firecrawl_search', search: async () => { calls.push('Firecrawl'); return [
        { title: 'Exact H&M dress', url: hmUrl, image, snippet: 'CAD 39.99' },
      ]; } },
    ] });
    const candidates = await rotation.resolveProductCandidates(parseProductUrl(hmUrl), { missingFields: ['title', 'imageUrl', 'price'] });
    assert.equal(calls.at(-1), 'Firecrawl', scenario);
    assert.ok(candidates.some((candidate) => candidate.url === hmUrl), scenario);
    const attempt = getResolverDiagnostics().find((entry) => entry.event === 'SEARCH_PROVIDER_ATTEMPT' && entry.provider === 'Firecrawl');
    assert.equal(attempt.role, 'BACKUP', scenario);
    assert.match(attempt.reason, /^PRIMARY_/, scenario);
  }
});

test('Canadian French exact article is high identity; foreign article cannot supply CAD price', async () => {
  const context = parseProductUrl(hmUrl);
  const french = verifyCandidate({ title: 'Cowl-Neck Dress', url: frUrl, currency: 'CAD' }, context);
  const american = verifyCandidate({ title: 'Cowl-Neck Dress', url: usUrl, currency: 'USD' }, context);
  const unknownMarket = verifyCandidate({ title: 'Cowl-Neck Dress', url: 'https://www2.hm.com/en_asia3/productpage.1337767006.html', currency: 'CAD' }, context);
  assert.equal(french.confidence, 'HIGH');
  assert.equal(french.localeMatch, true);
  assert.equal(american.confidence, 'LOW');
  assert.equal(american.exactIdentifier, true);
  assert.equal(unknownMarket.localeMatch, false);
  assert.equal(unknownMarket.confidence, 'LOW');

  let retailerCalls = 0;
  const resolver = createProductResolver({ statePath: ':memory:', urlValidator: async () => true,
    directResolver: async () => { retailerCalls++; throw new Error('direct fetch forbidden'); },
    renderedResolver: async () => { retailerCalls++; throw new Error('rendered fetch forbidden'); },
    nativeCatalogResolver: async () => { retailerCalls++; throw new Error('native fetch forbidden'); },
    lastChanceResolver: async () => { retailerCalls++; throw new Error('image fallback forbidden'); },
    searchProviders: [{ resolveProductCandidates: async () => [
      { url: usUrl, title: 'Cowl-Neck Dress', imageUrl: image, price: '29', currency: 'USD', providerSource: 'tavily_search' },
    ] }],
  });
  clearResolverDiagnostics();
  const result = await resolver(hmUrl, { searchOnly: true });
  assert.equal(retailerCalls, 0);
  assert.equal(result.title, 'Cowl-Neck Dress');
  assert.equal(result.imageUrl, image);
  assert.equal(result.price, '');
  assert.equal(result.currency, 'CAD');
  assert.equal(result.resolutionStatus, 'PARTIAL');
  const events = getResolverDiagnostics().map((entry) => entry.event);
  for (const forbidden of ['DIRECT_STARTED', 'RENDERED_RESULT', 'NATIVE_SEARCH_RESULT', 'HM_CROSS_LOCALE_PAGE']) assert.equal(events.includes(forbidden), false, forbidden);
});

test('Canadian French exact article can supply a verified CAD offer without retailer fetching', async () => {
  let directCalls = 0;
  const resolver = createProductResolver({ statePath: ':memory:', urlValidator: async () => true,
    directResolver: async () => { directCalls++; throw new Error('direct fetch forbidden'); },
    searchProviders: [{ resolveProductCandidates: async () => [
      { url: frUrl, title: 'Cowl-Neck Dress', imageUrl: image, price: '39.99', currency: 'CAD', providerSource: 'tavily_search' },
    ] }],
  });
  const result = await resolver(hmUrl, { searchOnly: true });
  assert.equal(directCalls, 0);
  assert.equal(result.title, 'Cowl-Neck Dress');
  assert.equal(result.imageUrl, image);
  assert.equal(result.price, '39.99');
  assert.equal(result.currency, 'CAD');
});

test('search media uses product images and discards favicon and logo URLs', () => {
  const context = parseProductUrl(hmUrl);
  const provider = { name: 'Tavily', kind: 'tavily_search' };
  assert.equal(isProductMediaUrl('https://www2.hm.com/favicon.ico'), false);
  assert.equal(normalizeSearchCandidate({ url: hmUrl, title: 'Dress', image: 'https://www2.hm.com/favicon.ico', thumbnail: image }, context, provider).imageUrl, image);
  assert.equal(normalizeSearchCandidate({ url: hmUrl, title: 'Dress', image: 'https://www2.hm.com/logo.png' }, context, provider).imageUrl, '');
});
