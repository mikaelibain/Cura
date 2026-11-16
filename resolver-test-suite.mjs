process.env.RESOLVER_CLEAN_TEST = 'true';

const cases = [
  ['H&M', 'https://www2.hm.com/en_ca/productpage.1338849002.html?srsltid=AfmBOorH-Hyd_IbR8zO3esdemm7USG2xZospyl7CmnBDQerjY4DTCLjrNxg'],
  ['London Drugs', 'https://www.londondrugs.com/products/loreal-paris-hair-expertise-glycolic-gloss-rinse-off-gloss-injection-200ml/p/L2717921?utm_source=google&utm_medium=productfeed&utm_campaign=surfaces'],
  ['Sephora', 'https://www.sephora.com/ca/en/product/versace-eros-pour-homme-eau-de-parfum-P464315'],
  ['Zara', 'https://www.zara.com/ca/en/printed-oversized-cargo-pants-p00695250.html?v1=597452403&v2=2491343'],
  ['Simons', 'https://www.simons.ca/en/women-clothing/dresses/long/sheer-scalloped-lace-chiffon-maxi-dress--21595-229751?catId=6680&colourId=12'],
  ['H&M', 'https://www2.hm.com/en_ca/productpage.1362965001.html'],
  ['Aritzia', 'https://www.aritzia.com/en/product/original-contour-ravish-dress/123919.html?color=18891'],
  ['Shoppers Drug Mart', 'https://www.shoppersdrugmart.ca/revlon-super-lustrous-lipstick/p/R029?variantCode=091000009025&source=nspt'],
  ['FragranceBuy', 'https://fragrancebuy.ca/products/khadlajisland-man?variant=41421785333822'],
  ['Walmart regression', 'https://www.walmart.ca/en/ip/EP-GLOSSING-SH-250/6000208962043?selectedSellerId=0'],
];

const [{ resolveProduct }, { parseProductUrl, getResolverDiagnostics }] = await Promise.all([
  import('./server.mjs'), import('./productResolver.mjs'),
]);
const searchOnly = process.argv.includes('--search-only');
const summary = [];
for (const [retailer, url] of cases) {
  try {
    const fingerprint = parseProductUrl(url);
    const before = getResolverDiagnostics().length;
    const result = await resolveProduct(url, { force: true, searchOnly });
    const trace = getResolverDiagnostics().slice(before);
    summary.push({ retailer, productId: fingerprint.productId, title: result.title, price: result.price,
      currency: result.currency, nameSource: result.fieldSources?.title ?? '', priceSource: result.fieldSources?.price ?? '',
      imageFound: Boolean(result.imageUrl), imageUrl: result.imageUrl, imageSource: result.fieldSources?.imageUrl ?? '',
      imageConfidence: result.fieldConfidence?.imageUrl ?? '', priceFound: Boolean(result.price), status: result.resolutionStatus,
      webProviderCalls: trace.filter((entry) => entry.event === 'SEARCH_PROVIDER_ATTEMPT').length,
      imageProviderCalls: trace.filter((entry) => entry.event === 'IMAGE_PROVIDER_ATTEMPT').length });
    console.log(JSON.stringify({ retailer, url, result, trace }, null, 2));
  } catch (error) {
    summary.push({ retailer, status: 'UNRESOLVED', error: error instanceof Error ? error.message : 'Resolution failed' });
  }
}
console.table(summary);
console.log('STRESS SUMMARY JSON:');
console.log(JSON.stringify(summary, null, 2));
