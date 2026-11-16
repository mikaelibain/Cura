import { parseProductUrl, validatePublicUrl } from '../../productResolver.mjs';
import { validateImageCandidate } from './images.mjs';

const array = (v) => v == null ? [] : Array.isArray(v) ? v : [v];
const walk = (v, visit) => { if (!v || typeof v !== 'object') return; visit(v); for (const child of Object.values(v)) walk(child, visit); };
const code = (v) => ({ '$': '', 'CA$': 'CAD', 'C$': 'CAD', 'US$': 'USD', '£': 'GBP', '€': 'EUR' })[String(v ?? '').toUpperCase()] ?? String(v ?? '').toUpperCase();
const amount = (v) => /^\d+(?:,\d{3})*(?:\.\d{1,2})?$/.test(String(v ?? '').trim()) && Number(String(v).replaceAll(',', '')) > 0 ? String(Number(String(v).replaceAll(',', ''))) : '';
const old = /was|regular|compare|msrp|rrp|listprice|original|save/i;

// Raw provider content is scoped to this parser; only extracted fields leave it.
export function parseExactPage(data, context) {
  const sourcePageUrl = data.metadata?.url || data.metadata?.sourceURL || context.normalizedUrl;
  const empty = (reason) => ({ price: '', currency: '', rejectionReason: reason, priceLookupOutcome: 'PRICE_NOT_FOUND' });
  let source;
  try { source = parseProductUrl(sourcePageUrl); } catch { return empty('IDENTITY_UNVERIFIED'); }
  if (!context.countryAssumed && !source.countryAssumed && context.country !== source.country) return empty('FOREIGN_MARKET_PRICE');
  if (source.normalizedUrl !== context.normalizedUrl) return empty('IDENTITY_UNVERIFIED');
  const html = String(data.rawHtml ?? '');
  const decode = (v) => String(v ?? '').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;/g, "'");
  const attrs = (tag) => Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map((m) => [m[1].toLowerCase(), decode(m[2])]));
  const meta = {};
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) { const a = attrs(m[0]); meta[a.property || a.name] = a.content; }
  const canonical = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => attrs(m[0])).find((a) => a.rel === 'canonical')?.href || data.metadata?.canonicalUrl || '';
  const sameProduct = (url) => {
    try {
      const c = parseProductUrl(new URL(url, sourcePageUrl).href);
      return c.baseDomain === context.baseDomain && c.path === context.path
        && (!c.colorId || !context.colorId || c.colorId === context.colorId)
        && (!c.productId || !context.productId || c.productId === context.productId);
    } catch { return false; }
  };
  const products = [], states = [];
  for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (!/application\/(?:ld\+)?json|__NEXT_DATA__/i.test(script[1])) continue;
    try {
      const parsed = JSON.parse(script[2]);
      if (/application\/ld\+json/i.test(script[1])) walk(parsed, (node) => {
        if (array(node['@type']).some((type) => /^(Product|ProductGroup)$/.test(type))) products.push(node);
      });
      else states.push(parsed);
    } catch { /* malformed scripts cannot supply evidence */ }
  }
  const id = String(context.productId || context.sku || '').toLowerCase();
  const tied = (node) => ['productId', 'productID', 'id', 'sku', 'mpn'].some((key) => id && String(node[key] ?? '').toLowerCase() === id);
  const nodeUrls = (node) => [node.url, ...array(node.offers).map((offer) => offer.url)].filter(Boolean);
  const eligible = products.filter((node) => nodeUrls(node).every(sameProduct)
    && (!context.sizeId || !node.size || String(node.size).toLowerCase() === context.sizeId.toLowerCase())
    && (!context.colorId || !node.colorId || String(node.colorId) === context.colorId));
  const matching = eligible.filter(tied);
  const pageVariants = eligible.filter((node) => nodeUrls(node).length && nodeUrls(node).every(sameProduct));
  const selected = matching.length ? matching : pageVariants.length ? pageVariants : eligible.length === 1 ? eligible : [];
  if (selected.length === 1 && ['productId', 'productID', 'sku'].some((key) => {
    const expected = key === 'sku' ? context.sku : context.productId;
    return expected && selected[0][key] != null && String(selected[0][key]).toLowerCase() !== String(expected).toLowerCase();
  })) return empty('PRODUCT_ID_CONFLICT');
  const embeddedProducts = [];
  for (const state of states) walk(state, (node) => {
    if (tied(node) || (!id && (node.productId || node.productID || node.sku) && (node.name || node.title)
      && (node.image || node.images || node.offers) && (!node.url || sameProduct(node.url)))) embeddedProducts.push(node);
  });
  const product = selected[0] || (embeddedProducts.length === 1 ? embeddedProducts[0] : undefined);
  const heading = decode(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]*>/g, '')).trim();
  const result = { ...empty('PRICE_NOT_FOUND'), title: String(selected[0]?.name || heading || meta['og:title'] || data.metadata?.ogTitle || product?.name || product?.title || ''),
    canonicalUrl: canonical, identityBasis: 'exact_url_same_market', fieldSources: {}, rejectedFields: [] };
  for (const key of ['productID', 'productId', 'sku', 'mpn', 'gtin', 'gtin8', 'gtin12', 'gtin13', 'gtin14']) {
    if (product?.[key] != null && typeof product[key] !== 'object') {
      result[key === 'productID' ? 'productId' : key] = String(product[key]);
      result.productId ||= String(product[key]);
    }
  }
  if (selected.length > 1) {
    result.productId = context.productId || '';
    if (new Set(selected.map((node) => node.sku)).size > 1) delete result.sku;
  }
  if (!result.productId && canonical) {
    try {
      const declared = parseProductUrl(new URL(canonical, sourcePageUrl).href);
      if (declared.baseDomain === source.baseDomain && declared.country === source.country
        && (!context.productId || declared.productId === context.productId)) result.productId = declared.productId || '';
    } catch { /* A malformed canonical cannot teach identity. */ }
  }
  result.selectedColor = String(product?.selectedColor?.id || product?.selectedColor || product?.colorId || '');
  if (typeof product?.color === 'string') result.color = product.color;
  const imageValues = [...array(product?.image), ...array(product?.images), meta['og:image'], data.metadata?.ogImage];
  result.imageUrls = [];
  for (const value of imageValues) {
    const raw = typeof value === 'string' ? value : value?.url || value?.contentUrl || value?.src;
    if (!raw) continue;
    let image;
    try { image = new URL(raw, sourcePageUrl).href; } catch { continue; }
    const match = validateImageCandidate({ sourcePageUrl, imageUrl: image, title: result.title }, context,
      { title: result.title, fieldConfidence: { title: 'HIGH' } });
    if (result.selectedColor && context.colorId && result.selectedColor !== context.colorId) { result.rejectedFields.push({ field: 'imageUrl', reason: 'COLOR_CONFLICT' }); continue; }
    if (match.accepted) {
      result.imageUrls.push(image);
      if (!result.imageUrl) { result.imageUrl = image; result.imageInfo = { ...match, variantVerified: Boolean(result.selectedColor && result.selectedColor === context.colorId), sourcePageUrl, provider: 'Firecrawl' }; }
    } else result.rejectedFields.push({ field: 'imageUrl', reason: match.reason });
  }
  const currencies = new Set();
  for (const node of selected) walk(node.offers, (offer) => { if (offer.priceCurrency) currencies.add(code(offer.priceCurrency)); });
  const finish = (offers) => {
    const valid = offers.filter((o) => amount(o.price));
    if ([...currencies, ...valid.map((o) => code(o.currency))].some((c) => c && ((!context.countryAssumed && c !== context.currencyHint)
      || (!source.countryAssumed && c !== source.currencyHint)))) return empty('FOREIGN_MARKET_PRICE');
    const unique = new Map(valid.map((o) => [`${amount(o.price)}:${code(o.currency)}`, o]));
    if (unique.size > 1) return empty('PRICE_AMBIGUOUS');
    const offer = [...unique.values()][0];
    if (!offer) return null;
    const currency = code(offer.currency);
    if (!/^[A-Z]{3}$/.test(currency)) return empty('CURRENCY_UNVERIFIED');
    return { price: amount(offer.price), currency, priceLookupOutcome: 'PRICE_FOUND', rejectionReason: '',
      priceInfo: { amount: amount(offer.price), currency, provider: 'firecrawl_scrape', sourcePageUrl,
        identityBasis: 'exact_url_same_market', sellerVerified: true, marketVerified: true, currentOfferVerified: true,
        offerType: 'CURRENT_PRICE', verifiedAt: new Date().toISOString() } };
  };
  const offers = [];
  for (const node of selected) for (const offer of array(node.offers)) {
    if (offer.lowPrice != null || offer.highPrice != null || /AggregateOffer/.test(offer['@type'] ?? '')) continue;
    const specs = array(offer.priceSpecification).filter((s) => !old.test(String(s.priceType ?? s.name ?? '')));
    const sale = specs.filter((s) => /sale|current/i.test(String(s.priceType ?? s.name ?? '')));
    for (const value of sale.length ? sale : offer.price != null ? [offer] : specs) {
      if (!old.test(String(value.priceType ?? ''))) offers.push({ price: value.price, currency: value.priceCurrency || offer.priceCurrency });
    }
  }
  let parsed = finish(offers);
  if (!parsed) {
    const embedded = [];
    for (const state of states) walk(state, (node) => {
      if (tied(node) || node === product) {
        const candidates = node.offers ? array(node.offers) : [node];
        for (const offer of candidates) {
          if (offer.lowPrice != null || offer.highPrice != null || old.test(String(offer.priceType ?? ''))) continue;
          embedded.push({ price: offer.price?.value ?? offer.price?.amount ?? offer.price,
            currency: offer.priceCurrency || offer.currency || offer.price?.currency || node.priceCurrency || node.currency });
        }
      }
    });
    parsed = finish(embedded);
  }
  if (!parsed) {
    const plain = (html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<(del|s|strike)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&dollar;/gi, '$') + '\n' + String(data.markdown ?? '')).replace(/[*_]/g, '');
    const labeled = [];
    const pattern = /\b(our\s+price|current\s+price|sale\s+price|now|price)\s*[:：]?\s*(CA\$|C\$|US\$|CAD|USD|GBP|EUR|AUD|NZD|\$|£|€)?\s*(\d+(?:,\d{3})*(?:\.\d{1,2})?)(?:\s*(CAD|USD|GBP|EUR|AUD|NZD))?/gi;
    for (const m of plain.matchAll(pattern)) {
      const before = plain.slice(Math.max(0, m.index - 55), m.index).split(/[\n.!;,$\d]/).pop();
      const after = plain.slice(m.index + m[0].length, m.index + m[0].length + 65);
      if (/was|regular|compare|msrp|save|shipping|orders?\s+over|installment|payments?|promo/i.test(before)
        || /^\s*(?:[-–—]|to\b|\/\s*(?:mo|month)|per\s+month|shipping|installments?|promo|on\s+orders|when\s+you|with\s+(?:klarna|afterpay|affirm|coupon|code))/i.test(after)) continue;
      labeled.push({ price: m[3], currency: code(m[4] || m[2]) || (currencies.size === 1 ? [...currencies][0] : !source.countryAssumed ? source.currencyHint : '') });
    }
    parsed = finish(labeled);
  }
  Object.assign(result, parsed ?? empty('PRICE_NOT_FOUND'));
  result.imageUrls = [...new Set(result.imageUrls)];
  const requested = ['variantId', 'colorId', 'sizeId'].filter((key) => context[key]);
  const variantVerified = requested.every((key) => String(product?.[key]
    ?? (key === 'colorId' ? result.selectedColor : key === 'sizeId' ? product?.size : product?.sku) ?? '').toLowerCase() === String(context[key]).toLowerCase());
  // A single product-level offer is usable across sizes/colors only when the
  // page does not expose variant-dependent offers. Otherwise require selection.
  const variantDependent = products.length > 1 || Boolean(product?.hasVariant || product?.variants);
  if (requested.length && variantDependent && !variantVerified) Object.assign(result, empty('VARIANT_NOT_VERIFIED'), { priceInfo: undefined });
  result.variantVerified = variantVerified;
  const availability = [...new Set(selected.flatMap((node) => array(node.offers).map((offer) => offer.availability)).filter(Boolean))];
  if (availability.length === 1 && (!requested.length || variantVerified)) result.availability = availability[0];
  if (result.rejectionReason) result.rejectedFields.push({ field: 'price', reason: result.rejectionReason });
  result.exactPageTrace = { provider: 'firecrawl_scrape', httpStatus: data.metadata?.statusCode ?? 200,
    finalPageUrl: sourcePageUrl, market: source.country, locale: source.locale, canonicalUrl: canonical,
    learnedProductId: result.productId || '', sku: result.sku || '', selectedColor: result.selectedColor,
    title: result.title, imageCount: result.imageUrls.length, selectedImage: result.imageUrl || '',
    price: result.price, currency: result.currency, rejectedFields: result.rejectedFields, creditsUsed: data.creditsUsed ?? data.metadata?.creditsUsed };
  for (const field of ['title', 'imageUrl', 'price', 'currency']) if (result[field]) result.fieldSources[field] = 'firecrawl_scrape';
  return result;
}

export const createExactPageResolver = ({ provider, quota, urlValidator = validatePublicUrl }) => async (context) => {
  await urlValidator(context.normalizedUrl);
  if (!provider) throw new Error('NOT_CONFIGURED');
  if (Date.now() < (provider.scrapeRetryAt ?? 0)) throw new Error('PROVIDER_COOLDOWN');
  if (!quota.spend('firecrawl', 1, 'scrape')) throw new Error('LOCAL_QUOTA');
  const data = await provider.scrape(context.normalizedUrl);
  const finalUrl = data.metadata?.url || data.metadata?.sourceURL;
  if (finalUrl) await urlValidator(finalUrl);
  const result = parseExactPage(data, context);
  result.exactPageTrace ??= { provider: 'firecrawl_scrape', httpStatus: data.metadata?.statusCode ?? 200,
    finalPageUrl: finalUrl || context.normalizedUrl, title: '', imageCount: 0, selectedImage: '', price: '', currency: '',
    learnedProductId: '', rejectedFields: [{ field: 'page', reason: result.rejectionReason }], creditsUsed: data.metadata?.creditsUsed };
  return result;
};
