# Product image resolution report — September 30, 2026

Implemented dedicated Firecrawl image search. Final unit suite: **280 tests, 280 pass, 0 fail**. TypeScript/Vite build succeeded. H&M and London Drugs both returned verified images. The repository's 10-case stress run completed, but provider coverage was limited by the unchanged daily quota.

## Files changed

- `server/resolver/images.mjs`: image query planning, candidate validation, safe asset checks, persistent cache, process locks and in-flight deduplication.
- `server/resolver/providers/firecrawl.mjs`: separate `searchImages` REST method and response normalization.
- `server/resolver/quota.mjs`: separate web/image call counters, disk reload and serialized quota updates.
- `productResolver.mjs`: image-stage integration, image provenance merge/priority, user-image protection and image-only isolation.
- `server.mjs`: shared Firecrawl instance and image-resolver registration.
- `resolver-test.mjs`: `--image-only`, separate web/image diagnostics and image provenance output.
- `resolver-test-suite.mjs`: full per-product results/traces and image/call-count summary.
- `tests/productImageResolution.test.mjs`: nine new behavioral tests.
- `tests/hmIndexedFallback.test.mjs`: registration assertion updated for the shared Firecrawl instance; Tavily-first behavior remains tested.

## Architecture and API

Cache → direct retailer extraction → Tavily web search → conditional Firecrawl web backup → dedicated image resolution if no trustworthy image exists → partial/manual result when offer evidence remains missing.

Web search remains limited to two queries. Image resolution makes at most one additional image query per lookup, labeled `IMAGE_SEARCH`. Existing verified direct and user images skip image search. Image-only mode skips retailer extraction and excludes price from web enrichment. Search-only mode permits image binary validation but never fetches retailer HTML/catalog/rendered pages.

The image request uses the existing backend key, no CLI or browser:

```json
{
  "query": "site:londondrugs.com \"L0012328\" \"LANCOME TONIQUE CONFORT 200ML\"",
  "sources": [{ "type": "images" }],
  "limit": 8
}
```

Endpoint: `POST https://api.firecrawl.dev/v2/search`. Observed live REST response:

```text
success
data.images[]:
  title, imageUrl, imageWidth, imageHeight, url, position
creditsUsed: 2
id
```

`url` is normalized to `sourcePageUrl`; `imageWidth`/`imageHeight` to dimensions. Missing optional fields remain absent. No image URL is invented.

## Validation, provenance and priority

- Exact retailer-local product ID must match on the same retailer; matching third-party local IDs are insufficient.
- Exact cross-language/cross-country article matches may supply images. Offer price/currency are untouched.
- Third-party images require exact UPC/GTIN/EAN evidence. Manufacturer fallback without a global ID requires a matching manufacturer domain and verified brand/title tokens including size, with no unresolved selected variant.
- Explicit URL variant/color conflicts are rejected. A generic exact-product image may be used with `variantVerified=false`.
- Category pages, logos, banners, icons, placeholders, invalid protocols and tiny assets are rejected.
- Identity-approved assets pass the existing SSRF-safe redirect-aware fetcher, HTTP/content-type checks and raster dimensions checks. Unsupported raster formats are conservatively rejected.
- User images win. Direct/native images outrank image search. Same-retailer images outrank cross-locale, manufacturer and other-retailer global-ID matches.
- Internal `imageInfo` records provider, source page, identity basis, market, variant verification, timestamp and dimensions. Cards do not render these internals. Unknown markets are stored as unknown, not assumed Canadian.

## Cache and quota

Successful image results persist for 30 days under `data/image-cache/resolution`, using the existing resolver schema version and normalized product/variant identity. Tracking-equivalent URLs reuse the same result. Successful empty searches have a five-minute retry window; provider failures are not negative-cached.

In-process promises and per-identity filesystem locks coalesce lookups. Separate processes sharing the same cache directory reuse results; this is not a distributed lock across separate storage volumes.

Image requests reserve two Firecrawl quota units and increment `firecrawlImageCalls`. Web calls have separate counters. The live API confirmed two credits for each image request. `resolver:clear-test-data` preserves provider counters. No quota cap or prior counter was reset.

## First two live checks

| Product | Title | Image | Confidence | Price | Currency | Status | Web calls | Image calls |
|---|---|---|---|---|---|---|---:|---:|
| H&M 1337767006 | Women's Bright purple Cowl-Neck Dress | Yes, verified retailer | HIGH | Missing | CAD | PARTIAL | 2 Tavily + 1 Firecrawl | 1 |
| London Drugs L0012328 | LANCOME TONIQUE CONFORT 200ML | Yes, verified retailer | HIGH | Missing | CAD | PARTIAL | 2 Tavily | 1 |

H&M exact selected image, 2333×3500:

https://image.hm.com/assets/hm/ae/36/ae363cc6e88cdd332686b6a9c2255d903a0f92b1.jpg

Source: exact Canadian H&M article page. Eight image candidates passed identity checks; no image was rejected in this live check. The Canadian candidate was preferred to cross-locale candidates. Selected-variant verification is false because no selected variant was independently established.

H&M web query 1 returned eight Tavily results but zero usable exact-product candidates. Firecrawl web backup ran with `PRIMARY_ZERO_USABLE_CANDIDATES`. Query 2 returned six usable Tavily candidates and skipped Firecrawl web backup. The final title source in this run was `firecrawl_search`.

London Drugs exact selected image, 800×800:

https://cdn-tp2.mozu.com/28945-m4/cms/files/L0012328.jpg

Source: exact original London Drugs product page. Two image results pointed to the same product image; both passed identity checks. No image was rejected. Tavily remained the title source and Firecrawl web backup was skipped.

Exact query, provider, candidate, provenance and field traces are in `image-hm-trace.log` and `image-london-drugs-trace.log`.

## Repository stress list

The available script contains **10 URLs**, not 20. No additional list was supplied during this run. All ten were submitted through the same production resolver. The daily quota reached 50/50 during Sephora; later missing images are not evidence of exhausted search coverage.

| Retailer / product ID | Returned title | Image / source / confidence | Price | Status | Web / image calls |
|---|---|---|---|---|---|
| H&M / 1338849002 | Halterneckkjole i chiffon - Lys beige/Mønstret - DAME | Yes / firecrawl_image_search / HIGH | No | PARTIAL | 2 / 1 |
| London Drugs / L2717921 | L'Oreal Paris Hair Expertise Glycolic Gloss Rinse-Off ... | Yes / firecrawl_image_search / HIGH | No | PARTIAL | 2 / 1 |
| Sephora / P464315 | Versace Eros Pour Homme Eau De Parfum | No | No | UNRESOLVED | 2 / 0 |
| Zara / p00695250 | Printed Oversized Cargo Pants | No | No | UNRESOLVED | 0 / 0 |
| Simons / 21595-229751 | Sheer Scalloped Lace Chiffon Maxi Dress | No | No | UNRESOLVED | 0 / 0 |
| H&M / 1362965001 | Missing | No | No | UNRESOLVED | 0 / 0 |
| Aritzia / 123919 | Original Contour Ravish Dress | No | No | UNRESOLVED | 0 / 0 |
| Shoppers / R029 | Revlon Super Lustrous Lipstick | No | No | UNRESOLVED | 0 / 0 |
| FragranceBuy / missing | Khadlajisland Man | No | No | UNRESOLVED | 0 / 0 |
| Walmart / 6000208962043 | EP GLOSSING SH 250 | Yes / retailer_metadata / HIGH | CAD 11.98 | RESOLVED | 0 / 0 |

Unresolved titles above are URL-derived hints, not verified product titles. Full selected URLs and per-product diagnostics are in `image-stress-trace.log`.

## Credits, verification and remaining work

- Four Firecrawl image requests across both acceptance checks and stress run: **8 API-reported image credits**.
- Ten Tavily web calls and one Firecrawl web backup call during this task's live runs.
- Prior quota was 31; final quota is 50. Historical web accounting counts requests; new image requests reserve the documented two credits each.
- Tests: **280 passed, 0 failed**. `npm run build`: successful. Tests rerun after build.
- Full provider coverage of the remaining stress products requires daily quota renewal or explicit approval to raise the cap. The unchanged cap prevented those paid searches.
- Manufacturer fallback is deliberately conservative; unsupported image formats and images with insufficient identity evidence remain empty.

Logs: `test-image-stage.log`, `build-image-stage.log`, `image-hm-trace.log`, `image-london-drugs-trace.log`, `image-stress-trace.log`.
