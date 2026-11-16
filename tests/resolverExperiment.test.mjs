import assert from 'node:assert/strict';
import test from 'node:test';
import { BingDevSearchProvider, buildProductFingerprint, buildQueryPlan, compareProductIdentity, runSearchReconstruction } from '../resolverExperiment.mjs';
import { createProductResolver, RESOLVER_SCHEMA_VERSION } from '../productResolver.mjs';
import { parseProductUrl } from '../productResolver.mjs';
import { buildSearchQueries } from '../server/resolver/matcher.mjs';

const examples = [
  ['https://www2.hm.com/en_ca/productpage.1338849002.html?srsltid=XYZ', 'hm.com', 'Canada', '1338849002', ''],
  ['https://www2.hm.com/en_ca/productpage.1362965001.html', 'hm.com', 'Canada', '1362965001', ''],
  ['https://www.londondrugs.com/products/loreal-paris-hair-expertise-glycolic-gloss-rinse-off-gloss-injection-200ml/p/L2717921?utm_source=google&utm_medium=productfeed&utm_campaign=surfaces', 'londondrugs.com', 'Canada', 'L2717921', 'loreal paris hair expertise glycolic gloss rinse off gloss injection 200ml'],
  ['https://www.sephora.com/ca/en/product/versace-eros-pour-homme-eau-de-parfum-P464315', 'sephora.com', 'Canada', 'P464315', 'versace eros pour homme eau de parfum'],
  ['https://www.simons.ca/en/women-clothing/dresses/long/sheer-scalloped-lace-chiffon-maxi-dress--21595-229751?catId=6680&colourId=12', 'simons.ca', 'Canada', '21595-229751', 'sheer scalloped lace chiffon maxi dress'],
  ['https://www.aritzia.com/en/product/original-contour-ravish-dress/123919.html?color=18891', 'aritzia.com', 'Canada', '123919', 'original contour ravish dress'],
  ['https://www.shoppersdrugmart.ca/revlon-super-lustrous-lipstick/p/R029?variantCode=091000009025&source=nspt', 'shoppersdrugmart.ca', 'Canada', 'R029', 'revlon super lustrous lipstick'],
  ['https://fragrancebuy.ca/products/khadlajisland-man?variant=41421785333822', 'fragrancebuy.ca', 'Canada', '', 'khadlajisland man'],
  ['https://www.zara.com/ca/en/printed-oversized-cargo-pants-p00695250.html?v1=597452403&v2=2491343', 'zara.com', 'Canada', 'p00695250', 'printed oversized cargo pants'],
];

test('fingerprints reconstruct all requested URL-only identity examples without mutating originals', () => {
  for (const [url, domain, country, id, title] of examples) {
    const fp = buildProductFingerprint(url);
    assert.equal(fp.originalUrl, url);
    assert.equal(fp.registrableDomain, domain);
    assert.equal(fp.locale.countryName, country);
    if (id) assert.ok(fp.identifiers.some((x) => x.value.toLowerCase() === id.toLowerCase()), `${url} missing ${id}`);
    if (title) assert.equal(fp.titleHint, title);
  }
  const hm = buildProductFingerprint(examples[0][0]);
  assert.equal(hm.queryParams.tracking[0].name, 'srsltid');
  const productionQueries = buildSearchQueries(parseProductUrl(examples[0][0]));
  assert.ok(productionQueries.length <= 2);
  assert.match(productionQueries[0], /^site:hm\.com "1338849002"/);
  assert.equal(hm.originalUrl, examples[0][0]);
});

test('identity query classification retains variant, color, category, and ambiguous Zara IDs', () => {
  const zara = buildProductFingerprint(examples.at(-1)[0]);
  assert.deepEqual(zara.queryParams.unknown.filter((p) => /^v\d/.test(p.name)).map((p) => p.value), ['597452403', '2491343']);
  assert.ok(buildQueryPlan(zara).some((query) => query.includes('597452403')));
  const simons = buildProductFingerprint(examples[4][0]);
  assert.deepEqual(simons.colorTokens, ['12']);
  assert.equal(simons.queryParams.unknown.find((p) => p.name === 'catId')?.value, '6680');
  assert.ok(simons.identifiers.some((x) => x.value === '6680' && x.type === 'category' && x.confidence < 0.5));
  const shopper = buildProductFingerprint(examples[6][0]);
  assert.deepEqual(shopper.variantTokens, ['091000009025']);
  assert.equal(shopper.queryParams.tracking[0].name, 'source');
  const aritzia = buildProductFingerprint(examples[5][0]);
  const colorMatch = compareProductIdentity(aritzia, { destinationUrl: examples[5][0], title: aritzia.titleHint });
  const wrongColor = compareProductIdentity(aritzia, { destinationUrl: examples[5][0].replace('18891', '18892'), title: aritzia.titleHint });
  assert.equal(colorMatch.variantMatch, true);
  assert.equal(wrongColor.identityMatch, false);
});

test('hard product-ID conflicts are rejected despite same domain and matching title', () => {
  const fp = buildProductFingerprint('https://www.zara.com/ca/en/printed-oversized-cargo-pants-p00695250.html?v1=597452403');
  const match = compareProductIdentity(fp, { title: 'Printed Oversized Cargo Pants', destinationUrl: 'https://www.zara.com/ca/en/printed-oversized-cargo-pants-p06929615.html' });
  assert.equal(match.hardIdConflict, true);
  assert.equal(match.identityMatch, false);
  assert.equal(match.reason, 'IDENTITY_CONFLICT');
});

test('Bing redirect destinations are decoded before identity comparison', async () => {
  const target = 'https://www2.hm.com/en_ca/productpage.1338849002.html?srsltid=other';
  const wrapper = `https://www.bing.com/ck/a?u=a1${Buffer.from(target).toString('base64url')}`;
  const provider = new BingDevSearchProvider(async () => ({ ok: true,
    text: async () => `<li class="b_algo"><h2><a href="${wrapper}">Women's Chiffon Dress</a></h2><p>Indexed listing</p></li>` }));
  const result = await provider.searchWeb('hm.com Canada product 1338849002');
  assert.equal(result.candidates[0].destinationUrl, target);
});

test('search-only runs web and images in parallel, learns title, and spends at most four queries', async () => {
  const events = [];
  let active = 0;
  let concurrent = 0;
  const provider = {
    name: 'fixture search',
    async searchWeb(query) {
      active += 1; concurrent = Math.max(concurrent, active); events.push(['web', query]);
      await new Promise((r) => setTimeout(r, 5)); active -= 1;
      return { status: 'ok', candidates: query.includes('1338849002') ? [{ title: "Women's Light beige Chiffon Halterneck Dress", destinationUrl: 'https://www2.hm.com/en_ca/productpage.1338849002.html', rank: 1, provider: 'fixture web' }] : [] };
    },
    async searchImages(query) {
      active += 1; concurrent = Math.max(concurrent, active); events.push(['image', query]);
      await new Promise((r) => setTimeout(r, 5)); active -= 1;
      return { status: 'ok', candidates: [] };
    },
  };
  const result = await runSearchReconstruction(examples[0][0], { provider, cleanTest: true });
  assert.equal(concurrent, 2);
  assert.equal(result.learnedCanonicalTitle, "Women's Light beige Chiffon Halterneck Dress");
  assert.ok(result.queriesUsed.some((q) => q.includes('Women')));
  assert.ok(result.queriesUsed.length <= 4);
  assert.ok(events.some(([type]) => type === 'image'));
  assert.equal(result.status, 'PARTIAL');
});

test('clean resolver mode repeats identical URLs without reusing or persisting cache evidence', async () => {
  const calls = { direct: 0, search: 0 };
  const resolver = createProductResolver({ cleanTest: true, statePath: 'data/product-resolution-state.json', urlValidator: async () => true,
    directResolver: async () => { calls.direct += 1; throw new Error('HTTP_403'); },
    searchProviders: [{ resolveProductCandidates: async () => { calls.search += 1; return []; } }] });
  const url = 'https://www2.hm.com/en_ca/productpage.1338849002.html';
  const first = await resolver(url); const second = await resolver(url);
  assert.equal(calls.direct, 2);
  assert.equal(calls.search, 2);
  assert.equal(first.cacheHit, false); assert.equal(second.cacheHit, false);
  assert.deepEqual(resolver.inspectState().products, {});
  assert.deepEqual(resolver.inspectState().registry, {});
  assert.ok(RESOLVER_SCHEMA_VERSION >= 4);
});
