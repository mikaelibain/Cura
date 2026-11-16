# Product URL resolution

`productResolver.mjs` owns URL identity, candidate verification, cache reads and writes, field provenance, and manual-field locks. `server.mjs` wires it to the retailer extractor and the search rotation. The browser keeps the exact pasted URL as the card click target.

## Resolution order

1. Parse and validate the pasted URL without network access.
2. Look up a schema-versioned product record.
3. Fetch the retailer page and independently extract JSON-LD, OpenGraph, embedded product data, and Shopify product data where available.
4. If the result still lacks useful fields, issue at most two targeted text queries through Tavily, then Firecrawl when Tavily is unavailable or has no sufficiently strong result.
5. Verify each candidate against retailer domain, product identifiers, market, and explicit variant/color/size values. Merge only fields supported by accepted evidence.
6. Return `RESOLVED`, `PARTIAL`, or `UNRESOLVED`; the original URL is preserved for every state.

Google HTML scraping, the Google development browser, SerpAPI product search, Brave, Bing, and DuckDuckGo are not in the product resolver's production provider list. SerpAPI remains in the separate user-reviewed image matching feature.

## Fingerprint and cache

`parseProductUrl()` does no network work. It retains the exact `originalUrl`, strips known tracking parameters from `normalizedUrl`, preserves identity, variant, locale, and unknown query parameters, and derives retailer, country, locale, product IDs, variant IDs, title tokens, and a cache key. The product cache key favors domain + product ID + variant and includes `RESOLVER_SCHEMA_VERSION` on records so older provider failures cannot suppress the current resolver.

## Provider configuration and quota

The server reads `TAVILY_API_KEY`, `FIRECRAWL_API_KEY`, `TAVILY_MONTHLY_CAP`, `FIRECRAWL_MONTHLY_CAP`, `SEARCH_DAILY_CAP`, `RESOLVER_SCHEMA_VERSION`, and `DEFAULT_COUNTRY` from `process.env`. Search calls use persistent local quota records in `data/resolver-quota.json`; `resolver:clear-test-data` does not remove those counters. Provider errors have temporary cooldowns and never fail card creation. API keys are not sent to the browser or written to diagnostics.

Copy `.env.example` to `.env` and add credentials locally. `.env` is ignored by Git.

## Price and provenance

Direct retailer extraction has priority. A search-result price is considered only when candidate identity is strong, currency fits the target market, and explicit variant information does not conflict or remain unverified. Ambiguous or multiple prices are omitted. Bare `$` uses the URL's market currency only as an assumption and is marked `currencyAssumed`; no currency conversion or estimated price is performed.

Fields retain independent `fieldSources` and `fieldConfidence` values. Existing `titleManual`, `priceManual`, and `isUserImage` locks are applied after resolution so automatic enrichment does not overwrite user edits. A missing field stays empty and can be entered manually.

## Resolver command

`npm run resolver:test -- <URL>` calls the same production `resolveProduct()` used by `/api/extract-product`. `--search-only` skips retailer extraction; `--direct-only` skips search; `--no-cache` forces a fresh resolution; `--verbose` prints the event trace. Test mode does not read or write product-cache records, but provider quota accounting remains persistent.
