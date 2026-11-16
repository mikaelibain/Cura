# Major retailer compatibility — pass 1

Status requires a live full API response with identity, title, image, price, and currency. `PARTIAL` means at least one required product or offer field is missing. No fixture alone establishes live support.

| Retailer | Exact regression URL | Fixture | Static | Rendered | Native catalog | Full API (25 Sep 2026) | Frontend | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SHEIN Canada | [514997343](https://ca.shein.com/Vellofy-Women-s-Fall-White-Draped-Twist-Long-Sleeve-Top-Slim-Fit-With-Flowy-Sash-Elegant-Shirt-For-Back-To-School-Dating-Party-p-514997343.html?detailBusinessFrom=0-2&imgRatio=3-4&mallCode=1) | stage test | generic shell | no product fields in this environment | unavailable | URL title only; no image/price | untested | PARTIAL |
| Real Canadian Superstore | [21708789_EA](https://www.realcanadiansuperstore.ca/en/Fructis%20Diamond%20Sleek%20Leave%20In%20Conditioner/p/21708789_EA?pc-express-book=1009) | identity test | unavailable | unavailable | no verified candidate | title only; no image/price | untested | PARTIAL |
| Sephora Canada | [P458591](https://www.sephora.com/ca/en/product/kerastase-genesis-anti-hair-fall-fortifying-serum-P458591?skuId=2358794) | existing suite | unavailable | unavailable | n/a | title/image/CAD; no price | untested | PARTIAL |
| Shoppers Drug Mart | [BB_055451435154](https://www.shoppersdrugmart.ca/tresemme-serum-keratin-smooth-shine-97ml/p/BB_055451435154?variantCode=055451435154) | existing suite | unavailable | unavailable | unavailable | title/CAD; no image/price | untested | PARTIAL |
| Walmart Canada | [6000208962043](https://www.walmart.ca/en/ip/EP-GLOSSING-SH-250/6000208962043?selectedSellerId=0&wl13=1031) | existing suite | product data | not needed | n/a | title, two images, CAD 11.98 | untested | FULL |
| H&M Canada | [1338299003](https://www2.hm.com/en_ca/productpage.1338299003.html) | existing suite | untested | untested | n/a | untested this pass | untested | UNTESTED |
| Aritzia Canada | [133120001](https://www.aritzia.com/en/product/smooth-matter%E2%84%A2-ginger-top/133120001.html) | existing suite | untested | untested | n/a | untested this pass | untested | UNTESTED |
| London Drugs | [L2717921](https://www.londondrugs.com/products/loreal-paris-hair-expertise-glycolic-gloss-rinse-off-gloss-injection-200ml/p/L2717921) | existing suite | untested | untested | n/a | untested this pass | untested | UNTESTED |
| Lululemon | [control](https://shop.lululemon.com/en-ca/p/hotty-hot-short-hr-long/e15cmdjmrc?color=75743&sz=4) | existing suite | untested | untested | n/a | untested this pass | untested | UNTESTED |
| Macy's | MACY'S EXACT REGRESSION URL REQUIRED | none | untested | untested | untested | untested | untested | UNTESTED |

The API results above came from `POST /api/extract-product` on a fresh local server with `force: true`; no frontend action was run. Public catalog indexing shows the Superstore item in retailer search, but the resolver did not verify a same-banner, same-store offer during this pass. No Superstore price was accepted.

Architecture: URL identity → shared record → static extraction → bounded Playwright rendered extraction → retailer-native catalog search for configured families → existing SerpAPI/Google Web/Shopping/indexed providers → URL fallback. Each stage fills missing fields. Product fields are stored separately from `priceInfo` offer fields, which include retailer, market, store, seller, source, and verification time. Full shared records use the existing six-hour metadata cache and one-hour price freshness; partial records retry after five minutes. Browser launch can add up to about 23 seconds on an incomplete resolution.

The rendered stage reads the live DOM, JSON-LD, meta tags, product images, and public script state through the existing parser. It blocks media, fonts, and known analytics requests, and closes the browser. It does not attempt challenge bypass. Native catalog search is configured for the Loblaw family; only exact same-banner product links are accepted, and a store-specific URL never inherits a generic catalog price.
