import { capabilityFor } from './retailerCapabilities.mjs';
import { secureFetch, parseProductUrl } from './productResolver.mjs';

export const createNativeCatalogResolver = (extractProduct) => async (context) => {
  const capability = capabilityFor(context);
  if (!capability?.nativeSearch) return {};
  for (const query of [context.productId, context.slug].filter(Boolean)) {
    const url = capability.nativeSearch(context, query);
    const response = await secureFetch(url, { allowedTypes: ['text/html', 'application/xhtml+xml'], maximumBytes: 3_000_000, timeout: 9000 }).catch(() => null);
    if (!response?.response.ok) continue;
    const html = response.bytes.toString('utf8');
    // Prefer a same-banner product URL with the exact product identifier.
    const hrefs = [...html.matchAll(/href=["']([^"']+)["']/gi)].map((match) => match[1]);
    const candidate = hrefs.map((href) => { try { return new URL(href, url).href; } catch { return ''; } })
      .find((href) => { try { const parsed = parseProductUrl(href); return parsed.baseDomain === context.baseDomain && parsed.productId === context.productId; } catch { return false; } });
    if (!candidate) continue;
    const detail = await secureFetch(candidate, { allowedTypes: ['text/html', 'application/xhtml+xml'], maximumBytes: 3_000_000, timeout: 9000 }).catch(() => null);
    if (!detail?.response.ok) continue;
    const parsed = extractProduct(detail.bytes.toString('utf8'), detail.finalUrl);
    if (!parsed.title && !parsed.imageUrl) continue;
    // Search without proven store binding cannot establish a store-specific offer.
    const store = new URL(context.originalUrl).searchParams.get('pc-express-book');
    if (store && !new URL(detail.finalUrl).searchParams.has('pc-express-book')) {
      parsed.price = '';
      parsed.currency = '';
    }
    parsed.retailer = context.retailer;
    parsed.fieldSources = Object.fromEntries(['title', 'brand', 'imageUrl', 'price', 'currency'].filter((field) => parsed[field]).map((field) => [field, 'retailer_native_catalog']));
    return parsed;
  }
  return {};
};
