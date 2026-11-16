process.env.RESOLVER_CLEAN_TEST = 'true';

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith('--')));
const supported = new Set(['--search-only', '--image-only', '--price-only', '--direct-only', '--no-cache', '--verbose']);
const urls = args.filter((arg) => !arg.startsWith('--'));
const unknown = [...flags].filter((flag) => !supported.has(flag));
if (unknown.length || !urls.length || [...flags].filter((flag) => ['--image-only', '--price-only', '--search-only', '--direct-only'].includes(flag)).length > 1) {
  console.error('Usage: npm run resolver:test -- [--price-only | --image-only | --search-only | --direct-only] [--no-cache] [--verbose] <URL>');
  if (unknown.length) console.error(`Unsupported flags: ${unknown.join(', ')}`);
  process.exitCode = 2;
} else {
  const [{ resolveProduct }, { parseProductUrl, getResolverDiagnostics }] = await Promise.all([
    import('./server.mjs'), import('./productResolver.mjs'),
  ]);
  for (const url of urls) {
    try {
      const fingerprint = parseProductUrl(url);
      const before = getResolverDiagnostics().length;
      const item = await resolveProduct(url, {
        force: flags.has('--no-cache'),
        searchOnly: flags.has('--search-only'),
        directOnly: flags.has('--direct-only'),
        imageOnly: flags.has('--image-only'),
        priceOnly: flags.has('--price-only'),
      });
      const trace = getResolverDiagnostics().slice(before);
      console.log(`\nURL: ${url}`);
      console.log(`MODE: ${flags.has('--price-only') ? 'PRICE-ONLY' : flags.has('--image-only') ? 'IMAGE-ONLY' : flags.has('--search-only') ? 'SEARCH-ONLY' : flags.has('--direct-only') ? 'DIRECT-ONLY' : 'PRODUCTION RESOLVER'}`);
      console.log('PRODUCT FINGERPRINT:');
      console.log(JSON.stringify({
        originalUrl: fingerprint.originalUrl,
        normalizedUrl: fingerprint.normalizedUrl,
        domain: fingerprint.domain,
        retailer: fingerprint.retailer,
        country: fingerprint.country,
        countryAssumed: fingerprint.countryAssumed,
        locale: fingerprint.locale,
        productId: fingerprint.productId,
        sku: fingerprint.sku,
        variantId: fingerprint.variantId,
        colorId: fingerprint.colorId,
        sizeId: fingerprint.sizeId,
        titleHint: fingerprint.titleHint,
        cacheKey: fingerprint.cacheKey,
      }, null, 2));
      if (flags.has('--verbose')) {
        console.log('TRACE:');
        console.log(JSON.stringify(trace, null, 2));
      } else {
        console.log(`TRACE EVENTS: ${trace.map((entry) => entry.event).join(' -> ') || '(none)'}`);
      }
      console.log('EXACT PAGE ENRICHMENT TRACE:');
      console.log(JSON.stringify(trace.filter((entry) => entry.event.startsWith('EXACT_PAGE_ENRICHMENT')), null, 2));
      if (trace.some((entry) => entry.event.startsWith('SEARCH_'))) {
      console.log('WEB SEARCH TRACE:');
      console.log(JSON.stringify({
        queries: trace.filter((entry) => entry.event === 'SEARCH_QUERY').map(({ queryIndex, query }) => ({ queryIndex, query })),
        providerAttempts: trace.filter((entry) => ['SEARCH_PROVIDER_ATTEMPT', 'SEARCH_PROVIDER_RESULT', 'SEARCH_PROVIDER_FAILURE', 'SEARCH_PROVIDER_SKIPPED'].includes(entry.event)).map(({ event, provider, role, queryIndex, status, candidateCount, verifiedCandidates, identityRelevantCandidates, imageCandidates, reason }) => ({ event, provider, role, queryIndex, status, candidateCount, verifiedCandidates, identityRelevantCandidates, imageCandidates, reason })),
        candidateCount: trace.filter((entry) => entry.event === 'CANDIDATE_FOUND').length,
        candidateVerifications: trace.filter((entry) => entry.event === 'CANDIDATE_VERIFIED').map(({ candidateUrl, provider, reason, acceptedFields, score }) => ({ candidateUrl, provider, reason, acceptedFields, score })),
        candidateRejections: trace.filter((entry) => entry.event === 'CANDIDATE_REJECTED').map(({ candidateUrl, provider, reason, score }) => ({ candidateUrl, provider, reason, score })),
      }, null, 2));
      }
      if (trace.some((entry) => entry.event.startsWith('IMAGE_'))) {
      console.log('IMAGE SEARCH TRACE:');
      console.log(JSON.stringify(trace.filter((entry) => entry.event.startsWith('IMAGE_')), null, 2));
      }
      if (trace.some((entry) => entry.event.startsWith('PRICE_'))) {
      console.log('PRICE RESOLUTION TRACE:');
      console.log(JSON.stringify({
        queries: trace.filter((entry) => entry.event === 'SEARCH_QUERY').map(({ queryIndex, query }) => ({ queryIndex, query })),
        lookup: trace.filter((entry) => entry.event === 'PRICE_LOOKUP_STATE'),
        candidates: trace.filter((entry) => entry.event === 'PRICE_CANDIDATE'),
        provenance: item.priceInfo ?? null,
      }, null, 2));
      }
      console.log('PROVIDER CALLS:');
      console.log(JSON.stringify({ scrape: trace.filter((e) => e.event === 'EXACT_PAGE_ENRICHMENT_RESULT' && e.httpStatus).length, web: trace.filter((e) => e.event === 'SEARCH_PROVIDER_ATTEMPT').length, image: trace.filter((e) => e.event === 'IMAGE_PROVIDER_ATTEMPT').length, reportedScrapeCredits: trace.reduce((sum,e) => sum + (e.event === 'EXACT_PAGE_ENRICHMENT_RESULT' ? Number(e.creditsUsed || 0) : 0), 0) }, null, 2));
      console.log('RESULT:');
      console.log(JSON.stringify({
        resolutionStatus: item.resolutionStatus,
        originalUrl: item.originalUrl,
        title: item.title,
        price: item.price,
        currency: item.currency,
        currencyAssumed: item.currencyAssumed,
        priceStale: item.priceStale,
        priceInfo: item.priceInfo,
        priceLookupOutcome: item.priceLookupOutcome,
        imageUrl: item.imageUrl,
        imageInfo: item.imageInfo,
        retailer: item.retailer,
        productId: item.productId,
        variant: item.variant,
        color: item.color,
        size: item.size,
        fieldSources: item.fieldSources,
        fieldConfidence: item.fieldConfidence,
        cacheHit: item.cacheHit,
      }, null, 2));
    } catch (error) {
      console.error(`URL: ${url}\nUNRESOLVED: ${error instanceof Error ? error.message : 'Resolution failed'}`);
      process.exitCode = 1;
    }
  }
}
