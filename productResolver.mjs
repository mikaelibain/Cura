import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const defaultStatePath = resolve(moduleDirectory, 'data', 'product-resolution-state.json');
const requiredFields = ['title', 'brand', 'retailer', 'imageUrl', 'price', 'currency'];
const schemaVersionFromEnv = Number(process.env.RESOLVER_SCHEMA_VERSION ?? 3);
export const RESOLVER_SCHEMA_VERSION = Number.isSafeInteger(schemaVersionFromEnv) && schemaVersionFromEnv > 4 ? schemaVersionFromEnv : 4;
export const RESOLVER_VERSION = RESOLVER_SCHEMA_VERSION;
export const RESOLVER_CLEAN_TEST = true;
const sharedFields = [...requiredFields, 'color', 'variant', 'size', 'availability'];
const identityParameterNames = /^(?:id|pid|product|productid|product_id|sku|skuid|sku_id|style|styleid|style_id|article|articleid|article_id|item|itemid|item_id|upc|gtin|gtin\d*|ean)$/i;
const variantParameterNames = /^(?:variant|variantid|variant_id|variantcode|variant_code|v\d+|colour|color|colourid|colorid|shade|shadeid|size|sizeid)$/i;
const localeParameterNames = /^(?:locale|lang|language|country|country_switch|market)$/i;
const trackingParameterNames = /^(?:utm_.+|gclid|gclsrc|dclid|fbclid|msclkid|srsltid|gbraid|wbraid|gad_source|gad_campaignid|cmp|cmpid|om_mmc|mc_.+|_ga|_gl|ref|ref_.+|campaign|campaignid|affiliate|affiliateid|affid|irclickid|clickid|tdp)$/i;
const ignoredSearchTokens = new Set(['www', 'www2', 'com', 'net', 'org', 'html', 'htm', 'product', 'products', 'item', 'items', 'shop', 'store']);
const recentDiagnostics = [];

const text = (value) => typeof value === 'string' ? value.trim() : typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
const unique = (values) => [...new Set(values.map(text).filter(Boolean))];
const weakProductTitle = (value) => /^(?:(?:www\d*|shop|store|m|mobile|hm|h&m|sephora|productpage)\s+)?product$/i.test(text(value))
  || /^(?:www\.)?[a-z0-9-]+\.(?:com|ca|co\.uk|net|org)$/i.test(text(value))
  || /^(?:real canadian superstore(?: supermarket)?|shoppers drug mart|london drugs|shein)$/i.test(text(value))
  || /^(?:online shopping|online grocery|home page|homepage|supermarket)$/i.test(text(value))
  || /^(?:www\d*|shop|store|m|mobile|productpage|\d{5,})$/i.test(text(value))
  || /women.s\s*&\s*men.s clothing/i.test(text(value));
const normalizePrice = (value) => {
  const raw = typeof value === 'object' && value !== null
    ? text(value.extracted_value ?? value.value ?? value.amount ?? value.price)
    : text(value);
  const matched = raw.replace(/\u00a0/g, ' ').match(/(?:^|[^\d])(\d[\d,]*(?:\.\d{1,2})?)(?:[^\d]|$)/)?.[1];
  return matched ? matched.replace(/,/g, '') : '';
};

const decode = (value) => {
  try { return decodeURIComponent(value); } catch { return value; }
};

const titleCaseDomain = (baseDomain) => {
  const label = baseDomain.split('.')[0];
  if (label.toLowerCase() === 'hm') return 'H&M';
  return label.replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
};

const baseDomainFor = (hostname) => {
  const parts = hostname.toLowerCase().replace(/\.$/, '').split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const countrySuffix = parts.at(-1)?.length === 2 && /^(?:co|com|net|org|gov|ac|edu)$/.test(parts.at(-2) ?? '');
  return parts.slice(countrySuffix ? -3 : -2).join('.');
};

const currencyForCountry = (country) => ({
  CA: 'CAD', US: 'USD', GB: 'GBP', UK: 'GBP', AU: 'AUD', NZ: 'NZD', JP: 'JPY', CH: 'CHF',
  DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', IE: 'EUR', AT: 'EUR', BE: 'EUR', FI: 'EUR', PT: 'EUR',
}[country] ?? '');

const classifyParameter = (name, value = '') => trackingParameterNames.test(name) || (name.toLowerCase() === 'source' && /^(?:google|googleshopping|bing|facebook|instagram|ad|paid|search)$/i.test(value)) ? 'TRACKING'
  : identityParameterNames.test(name) ? 'PRODUCT_IDENTITY'
    : variantParameterNames.test(name) ? 'VARIANT'
      : localeParameterNames.test(name) ? 'LOCALE'
        : 'UNKNOWN';

const pathPatternFor = (segments) => '/' + segments.map((segment) => {
  if (/\d{5,}/.test(segment)) return segment.replace(/[a-z]*\d{5,}[a-z\d-]*/ig, ':id');
  return segment.length > 48 ? ':slug' : segment.toLowerCase();
}).join('/');

export const parseProductUrl = (input) => {
  const originalUrl = String(input ?? '');
  const parsed = new URL(/^https?:\/\//i.test(originalUrl) ? originalUrl : `https://${originalUrl}`);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('INVALID_URL');
  const hostname = parsed.hostname.toLowerCase();
  const baseDomain = baseDomainFor(hostname);
  const subdomain = hostname === baseDomain ? '' : hostname.slice(0, -(baseDomain.length + 1));
  const pathSegments = parsed.pathname.split('/').filter(Boolean).map(decode);
  const filename = pathSegments.at(-1) ?? '';
  const localeSegment = pathSegments.find((segment) => /^[a-z]{2}[-_][a-z]{2}$/i.test(segment)) ?? '';
  const languageSegment = pathSegments.find((segment) => /^(?:en|fr|es|de|it|nl|pt|ja)$/i.test(segment)) ?? '';
  const marketSegment = pathSegments.find((segment) => /^(?:ca|us|gb|uk|au|nz|jp|de|fr|es|it|nl|ie|at|be|fi|pt)$/i.test(segment)) ?? '';
  const fragmentSearch = parsed.hash.includes('=') ? new URLSearchParams(parsed.hash.slice(1).replace(/^\?/, '')) : new URLSearchParams();
  const queryLocale = [...parsed.searchParams.entries(), ...fragmentSearch.entries()].find(([name]) => /^(?:locale|lang|language)$/i.test(name))?.[1] ?? '';
  const queryCountry = [...parsed.searchParams.entries(), ...fragmentSearch.entries()].find(([name]) => /^(?:country|country_switch|market)$/i.test(name))?.[1] ?? '';
  const localeValue = (localeSegment || queryLocale || languageSegment).replace('-', '_').toLowerCase();
  const [rawLanguage = '', rawCountry = ''] = localeValue.split('_');
  const language = rawLanguage.length === 2 && !/^(?:ca|us|gb|uk|au|nz)$/i.test(rawLanguage) ? rawLanguage : '';
  const routeCountry = (baseDomain === 'aritzia.com' && /^\/en\/product\//i.test(parsed.pathname)) || baseDomain === 'londondrugs.com' ? 'ca' : '';
  const countrySubdomain = hostname.slice(0, -(baseDomain.length + 1)).split('.')[0];
  const country = (rawCountry || queryCountry || marketSegment || (baseDomain === 'macys.com' ? 'us' : '') || (hostname.endsWith('.ca') ? 'ca' : '')
    || (/^(?:ca|us|gb|uk|au|nz|jp)$/i.test(countrySubdomain) ? countrySubdomain : '') || routeCountry).toUpperCase();
  const locale = language && country ? `${language}_${country.toLowerCase()}` : localeValue;
  const currencyHint = currencyForCountry(country)
    || (hostname.endsWith('.ca') ? 'CAD' : hostname.endsWith('.co.uk') ? 'GBP' : hostname.endsWith('.com.au') ? 'AUD' : '');

  const parameters = [...parsed.searchParams.entries()].map(([name, value]) => ({ name, value, classification: classifyParameter(name, value) }));
  const fragmentParameters = [...fragmentSearch.entries()].map(([name, value]) => ({ name, value, classification: classifyParameter(name, value) }));
  const allParameters = [...parameters, ...fragmentParameters];
  const identityParameters = allParameters.filter((entry) => entry.classification === 'PRODUCT_IDENTITY');
  const variantParameters = allParameters.filter((entry) => entry.classification === 'VARIANT');
  const directPathIdentifiers = [...parsed.pathname.matchAll(/(?:^|\/)(?:products?|items?|style|sku|p)\/([^/?#]+)/ig)]
    .map((match) => match[1].replace(/\.[a-z0-9]+$/i, ''))
    .map((candidate) => candidate.match(/(?:^|[-_.])([a-z]*\d{5,}[a-z\d-]*)$/i)?.[1] ?? candidate)
    .filter((candidate) => !candidate.includes('-') || /\d{5,}/.test(candidate));
  const pathIdentifierMatches = unique([
    ...[...parsed.pathname.matchAll(/productpage[.\/-]([a-z0-9-]{5,})/ig)].map((match) => match[1]),
    ...[...parsed.pathname.matchAll(/(?:^|[-_.\/])([a-z]*\d{5,}[a-z\d-]*)(?=[-_.\/]|$)/ig)].map((match) => match[1]),
    ...directPathIdentifiers,
  ]);
  const candidateIdentifiers = unique([...identityParameters.map((entry) => entry.value), ...pathIdentifierMatches]);
  const namedIdentity = (pattern) => identityParameters.find((entry) => pattern.test(entry.name))?.value ?? '';
  const productId = namedIdentity(/^(?:id|pid|product|productid|product_id|item|itemid|item_id)$/i)
    || (baseDomain === 'realcanadiansuperstore.ca' ? parsed.pathname.match(/\/p\/([0-9]+_[A-Z]+)/i)?.[1] : '')
    || parsed.pathname.match(/productpage[.\/-]([a-z0-9-]{5,})/i)?.[1]
    || pathIdentifierMatches.find((identifier) => /\d{5,}/.test(identifier)) || candidateIdentifiers[0] || '';
  const sku = namedIdentity(/^sku(?:id|_id)?$/i) || '';
  const upc = namedIdentity(/^upc$/i) || '';
  const gtin = namedIdentity(/^gtin\d*$/i) || '';
  const ean = namedIdentity(/^ean$/i) || '';
  const styleId = namedIdentity(/^style/i) || '';
  const variantId = variantParameters.find((entry) => /^variant/i.test(entry.name) || (baseDomain === 'zara.com' && /^v1$/i.test(entry.name)))?.value ?? '';
  const colorId = variantParameters.find((entry) => /^(?:colour|color|colourid|colorid|shade|shadeid)$/i.test(entry.name)
    || (baseDomain === 'zara.com' && /^v2$/i.test(entry.name)))?.value ?? '';
  const sizeId = variantParameters.find((entry) => /^size(?:id)?$/i.test(entry.name))?.value ?? '';

  const slug = pathSegments
    .map((segment) => candidateIdentifiers.reduce((candidate, identifier) => candidate.replace(identifier, ''), segment))
    .map((segment) => segment.replace(/\.[a-z0-9]+$/i, '').replace(/(?:^|[-_.])p(?=[-_.]|$)/gi, ' ').replace(/[-_.]+/g, ' ').trim())
    .filter((segment) => !/^[a-z]{2}[-_ ][a-z]{2}$/i.test(segment))
    .filter((segment) => !ignoredSearchTokens.has(segment.toLowerCase()) && segment.toLowerCase() !== 'productpage')
    .filter((segment) => /[a-z]{3}/i.test(segment))
    .sort((left, right) => right.length - left.length)[0] ?? '';

  const canonical = new URL(parsed.toString());
  try { canonical.pathname = encodeURI(decodeURI(canonical.pathname)); } catch { /* Retain the browser's safe path encoding. */ }
  canonical.search = '';
  [...parameters, ...fragmentParameters].filter((entry) => entry.classification !== 'TRACKING').forEach(({ name, value }) => canonical.searchParams.append(name, value));
  canonical.hash = '';
  const retailer = ({ 'walmart.ca': 'Walmart Canada', 'shoppersdrugmart.ca': 'Shoppers Drug Mart', 'londondrugs.com': 'London Drugs', 'realcanadiansuperstore.ca': 'Real Canadian Superstore', 'macys.com': "Macy's" })[baseDomain] ?? titleCaseDomain(baseDomain);
  const searchTokens = unique([
    retailer,
    baseDomain,
    locale,
    productId,
    sku,
    upc,
    gtin,
    ean,
    styleId,
    ...candidateIdentifiers,
    ...slug.split(/\s+/).filter((token) => token.length > 2),
  ]);
  const strongestIdentifier = sku || productId || styleId || candidateIdentifiers[0] || '';
  const searchQueries = unique([
    strongestIdentifier,
    strongestIdentifier && `${baseDomain} ${strongestIdentifier}`,
    strongestIdentifier && `${retailer} ${strongestIdentifier}`,
    strongestIdentifier && `site:${baseDomain} ${strongestIdentifier}`,
    canonical.toString(),
    slug && `${retailer} "${slug}"`,
  ]).slice(0, 6);

  const assumedCountry = !country;
  const configuredCountry = String(process.env.DEFAULT_COUNTRY || 'ca').trim();
  const effectiveCountry = country || (/^[a-z]{2}$/i.test(configuredCountry) ? configuredCountry : 'ca').toUpperCase();
  const identities = unique([productId, sku, upc, gtin, ean, styleId, ...candidateIdentifiers]);
  return {
    originalUrl,
    domain: baseDomain,
    protocol: parsed.protocol.replace(':', ''),
    hostname,
    baseDomain,
    subdomain,
    locale,
    language,
    country: effectiveCountry,
    countryCode: effectiveCountry,
    countryAssumed: assumedCountry,
    currencyHint: currencyHint || currencyForCountry(effectiveCountry),
    path: parsed.pathname.replace(/^\//, ''),
    pathSegments,
    filename,
    queryParameters: parameters,
    fragmentParameters,
    fragment: parsed.hash,
    productId,
    primaryId: strongestIdentifier,
    identifiers: identities,
    sku,
    upc,
    gtin,
    ean,
    styleId,
    variantId,
    colorId,
    sizeId,
    slug,
    titleHint: slug,
    titleTokens: unique(slug.toLowerCase().split(/\s+/).filter((token) => token.length > 2)),
    trackingParametersRemoved: parameters.filter((entry) => entry.classification === 'TRACKING').map(({ name, value }) => ({ name, value })),
    unknownQueryParameters: parameters.filter((entry) => entry.classification === 'UNKNOWN'),
    categoryHints: pathSegments.filter((segment) => !candidateIdentifiers.some((identifier) => segment.includes(identifier)))
      .filter((segment) => /women|men|beauty|skin|hair|dress|shoe|bag|makeup/i.test(segment)),
    retailer,
    normalizedUrl: canonical.toString(),
    canonicalCandidate: canonical.toString(),
    candidateIdentifiers,
    searchTokens,
    searchQueries,
    pathPattern: pathPatternFor(pathSegments),
    cacheKey: `${baseDomain}|${productId || sku || styleId || candidateIdentifiers[0] || parsed.pathname.toLowerCase()}|${variantParameters.map((p) => `${p.name}=${p.value}`).join('&')}|${parameters.filter((p) => p.classification === 'UNKNOWN').map((p) => `${p.name}=${p.value}`).join('&')}`,
  };
};

const privateAddress = (address) => {
  const normalized = address.toLowerCase().replace(/^::ffff:/, '');
  if (isIP(normalized) === 4) {
    const [a, b] = normalized.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  return normalized === '::1' || normalized === '::' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb');
};

export const createPublicUrlValidator = ({ dnsLookup = lookup } = {}) => async (value) => {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f\\]/.test(value) || value.length > 2_048) throw new Error('INVALID_URL');
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('INVALID_URL');
  if (parsed.username || parsed.password) throw new Error('INVALID_URL');
  const hostname = parsed.hostname.toLowerCase();
  if (!hostname || hostname.length > 253 || hostname.split('.').some((label) => !label || label.length > 63) || hostname.includes('..')) throw new Error('INVALID_URL');
  if (hostname === 'localhost' || ['.localhost', '.local', '.internal', '.home', '.test'].some((suffix) => hostname.endsWith(suffix))) throw new Error('PRIVATE_ADDRESS');
  if (isIP(hostname)) {
    if (privateAddress(hostname)) throw new Error('PRIVATE_ADDRESS');
    if (parsed.port && !((parsed.protocol === 'http:' && parsed.port === '80') || (parsed.protocol === 'https:' && parsed.port === '443'))) throw new Error('INVALID_URL');
    return parsed;
  }
  if (parsed.port && !((parsed.protocol === 'http:' && parsed.port === '80') || (parsed.protocol === 'https:' && parsed.port === '443'))) throw new Error('INVALID_URL');
  const addresses = await dnsLookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => privateAddress(address))) throw new Error('PRIVATE_ADDRESS');
  return parsed;
};

export const validatePublicUrl = createPublicUrlValidator();

const limitedBytes = async (response, maximumBytes) => {
  const announced = Number(response.headers.get('content-length') ?? 0);
  if (announced > maximumBytes) throw new Error('RESPONSE_TOO_LARGE');
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new Error('RESPONSE_TOO_LARGE');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
};

export const secureFetch = async (input, options = {}) => {
  const {
    maximumBytes = 3_000_000, allowedTypes = [], timeout = 12_000, maximumRedirects = 4,
    urlValidator = validatePublicUrl, fetcher = fetch, ...fetchOptions
  } = options;
  let current = (await urlValidator(input)).toString();
  for (let redirects = 0; redirects <= maximumRedirects; redirects += 1) {
    const response = await fetcher(current, { ...fetchOptions, redirect: 'manual', signal: AbortSignal.timeout(timeout) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirects === maximumRedirects) throw new Error('TOO_MANY_REDIRECTS');
      const location = response.headers.get('location');
      if (!location) throw new Error('INVALID_REDIRECT');
      current = (await urlValidator(new URL(location, current).toString())).toString();
      continue;
    }
    const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
    if (allowedTypes.length && !allowedTypes.some((type) => contentType.startsWith(type))) throw new Error('UNEXPECTED_CONTENT_TYPE');
    const bytes = await limitedBytes(response, maximumBytes);
    return { response, bytes, finalUrl: current, contentType };
  }
  throw new Error('TOO_MANY_REDIRECTS');
};

const words = (value) => unique(text(value).toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2 && !['the', 'and', 'for', 'with', 'from', 'product', 'online', 'shop'].includes(word)));
const titleSimilarity = (left, right) => {
  const a = words(left);
  const b = new Set(words(right));
  return a.length ? a.filter((word) => b.has(word)).length / a.length : 0;
};

export const cleanProductTitle = (value, candidate = {}) => {
  let result = decodeHtmlText(text(value))
    .replace(/^amazon\.[^:]+:\s*/i, '')
    .replace(/^(?:ladies|women'?s|men'?s|kids?)\s*[-:|]\s*/i, '')
    .replace(/\s*[-|]\s*size\s*:?[ ]*[a-z0-9./ -]+$/i, '')
    .replace(/\s*(?:[-|]\s*)?(?:best price|track price|free shipping|shop online).*$/i, '')
    .replace(/\s*[|]\s*[^|]{1,35}$/i, '')
    .replace(/\s+(?:CA|USA|UK|Canada|United States)$/i, '')
    .trim();
  const colour = text(candidate.color ?? candidate.colour);
  if (colour && result.toLowerCase().startsWith(colour.toLowerCase())) result = result.slice(colour.length).replace(/^\s*[-:/]\s*/, '').trim();
  const duplicate = result.match(/^(.{9,}?)\s+\1$/i);
  if (duplicate) result = duplicate[1].trim();
  return result;
};

export const verifyCandidate = (candidate, context) => {
  const candidateUrl = text(candidate.url ?? candidate.link);
  let parsedCandidate;
  try { parsedCandidate = parseProductUrl(candidateUrl); } catch { /* A result without a destination cannot establish product identity. */ }
  const originalDomain = Boolean(parsedCandidate && parsedCandidate.baseDomain === context.baseDomain);
  const identifiers = unique([context.productId, context.sku, context.styleId, ...context.candidateIdentifiers]).map((value) => value.toLowerCase());
  const candidateIdentifiers = unique([candidate.productId, candidate.sku, parsedCandidate?.productId, parsedCandidate?.sku, ...(parsedCandidate?.candidateIdentifiers ?? [])]).map((value) => value.toLowerCase());
  const evidenceText = `${candidate.title ?? ''} ${candidate.snippet ?? ''} ${candidateUrl}`.toLowerCase();
  const exactIdentifier = identifiers.some((identifier) => candidateIdentifiers.includes(identifier) || evidenceText.includes(identifier));
  const conflictingIdentifier = Boolean(identifiers.length && candidateIdentifiers.length && !exactIdentifier);
  const exactCanonical = Boolean(originalDomain && parsedCandidate?.normalizedUrl === context.normalizedUrl);
  const samePath = Boolean(originalDomain && parsedCandidate?.path.replace(/\/$/, '').toLowerCase() === context.path.replace(/\/$/, '').toLowerCase());
  const variantConflict = Boolean(context.variantId && parsedCandidate?.variantId && context.variantId !== parsedCandidate.variantId);
  const colorConflict = Boolean(context.colorId && parsedCandidate?.colorId && context.colorId !== parsedCandidate.colorId);
  const sizeConflict = Boolean(context.sizeId && parsedCandidate?.sizeId && context.sizeId !== parsedCandidate.sizeId);
  const skuConflict = Boolean(context.sku && parsedCandidate?.sku && context.sku.toLowerCase() !== parsedCandidate.sku.toLowerCase());
  const originalSeller = new URL(context.normalizedUrl).searchParams.get('selectedSellerId');
  const candidateSeller = parsedCandidate ? new URL(parsedCandidate.normalizedUrl).searchParams.get('selectedSellerId') : null;
  const sellerMatch = !originalSeller || originalSeller === candidateSeller;
  const similarity = context.knownTitle || context.slug ? titleSimilarity(candidate.title, context.knownTitle || context.slug) : 0;
  const candidateCurrency = text(candidate.currency).toUpperCase();
  const currencyMatch = context.countryAssumed || !context.currencyHint || !candidateCurrency || candidateCurrency === context.currencyHint;
  // Language differences do not change the offer market (en_ca and fr_ca).
  const pathMarketMismatch = Boolean(!context.countryAssumed && parsedCandidate
    && (parsedCandidate.countryAssumed || (context.country && parsedCandidate.country && context.country !== parsedCandidate.country)));
  const localeMismatch = pathMarketMismatch;
  let score = 0;
  if (exactIdentifier) score += 55;
  if (exactCanonical) score += 65;
  else if (samePath) score += 40;
  // Prefer the original retailer strongly enough that a third-party page which
  // merely repeats an identifier cannot outrank a convincing first-party page.
  if (originalDomain) score += 36;
  score += Math.round(similarity * 24);
  if (originalDomain && similarity >= 0.6) score += 30;
  if (text(candidate.brand).toLowerCase() === context.retailer.toLowerCase()) score += 10;
  if (currencyMatch) score += 7;
  if (localeMismatch) score -= 35;
  else if (!currencyMatch) score -= 15;
  if (conflictingIdentifier) score -= 100;
  if (variantConflict || colorConflict || sizeConflict || skuConflict) score -= 100;
  const confidence = !originalDomain || conflictingIdentifier || variantConflict || colorConflict || sizeConflict || skuConflict || localeMismatch ? 'LOW'
    : (exactCanonical || exactIdentifier || samePath) && score >= 55 ? 'HIGH' : 'LOW';
  return { score, confidence, exactIdentifier, exactCanonical, originalDomain, currencyMatch, similarity, conflictingIdentifier, variantConflict: variantConflict || colorConflict || sizeConflict || skuConflict, localeMatch: !localeMismatch, sellerMatch };
};

const candidateFromShopping = (result) => ({
  title: text(result.title),
  brand: text(result.brand),
  retailer: text(result.source ?? result.merchant),
  url: unwrapGoogleDestination(text(result.link ?? result.merchant_link ?? result.product_link)),
  price: normalizePrice(result.extracted_price ?? result.price ?? result.price_info),
  currency: text(result.currency).toUpperCase(),
  imageUrl: text(result.thumbnail ?? result.image),
  sku: text(result.sku), upc: text(result.upc), gtin: text(result.gtin), ean: text(result.ean),
  color: text(result.color ?? result.colour),
  availability: typeof result.in_stock === 'boolean' ? result.in_stock ? 'InStock' : 'OutOfStock' : '',
  providerSource: 'shopping_result',
});

const candidateFromOrganic = (result) => {
  const detected = result.rich_snippet?.top?.detected_extensions ?? result.rich_snippet?.bottom?.detected_extensions ?? {};
  const snippetPrice = text(result.snippet).match(/(?:price\s*:?\s*)?(CA|US|AU|NZ)?\$\s*(\d[\d,]*(?:\.\d{1,2})?)/i);
  return {
    ...captionIdentity(result.title, result.source),
    retailer: text(result.source),
    url: unwrapGoogleDestination(text(result.link)),
    price: normalizePrice(detected.price ?? snippetPrice?.[2]),
    currency: text(detected.currency).toUpperCase() || ({ CA: 'CAD', US: 'USD', AU: 'AUD', NZ: 'NZD' })[snippetPrice?.[1]?.toUpperCase()] || '',
    imageUrl: text(result.thumbnail),
    sku: text(result.sku) || skuInSnippet(result.snippet), upc: text(result.upc), gtin: text(result.gtin), ean: text(result.ean),
    snippet: text(result.snippet),
    color: '',
    availability: '',
    providerSource: 'search_result',
  };
};

const targetedQueries = (context) => {
  const identifier = context.productId || context.sku || context.styleId || context.candidateIdentifiers[0];
  if (context.baseDomain === 'sephora.com') {
    const title = text(context.slug).replace(/\s+/g, ' ').trim();
    const brand = title.split(/\s+/).slice(0, 1).join(' ');
    const exactUrl = context.normalizedUrl;
    return unique([
      context.productId && `site:sephora.com "${context.productId}"`,
      context.sku && `site:sephora.com "${context.sku}"`,
      title && `site:sephora.com "${title}"`,
      title && `"${brand}" "${title}" Sephora`,
      exactUrl,
    ]).slice(0, 5);
  }
  if (context.baseDomain === 'macys.com' && context.productId) {
    const productTitle = text(context.knownTitle || context.slug).replace(/\s+/g, ' ').trim();
    const brand = productTitle.split(/\s+/)[0] || '';
    return unique([
      `site:macys.com/shop/product "${context.productId}"`,
      `site:macys.com "${context.productId}" "${brand}"`,
      `site:macys.com "${productTitle}"`,
    ]);
  }
  const marketPath = context.pathSegments[0]?.toLowerCase() === context.country?.toLowerCase()
    ? `/${context.pathSegments.slice(0, 2).join('/')}`
    : /^[a-z]{2}[-_][a-z]{2}$/i.test(context.pathSegments[0] ?? '') ? `/${context.pathSegments[0]}` : '';
  return identifier ? unique([
    `site:${context.baseDomain}${marketPath} "${identifier}"${context.sku && context.sku !== identifier ? ` "${context.sku}"` : ''}`,
    `site:${context.baseDomain} "${identifier}"`,
  ]) : context.searchQueries.slice(0, 2);
};

const skuInSnippet = (value) => text(value).match(/\b(?:item|sku)\s*(?:#|no\.?|number|id|:)?\s*(\d{5,})\b/i)?.[1] ?? '';

const captionIdentity = (value, retailer = '') => {
  const caption = decodeHtmlText(value);
  const suffix = caption.match(/^(.+?)\s+-\s+([^|]{2,45})(?:\s*\|.*)?$/);
  const brand = suffix && suffix[2].toLowerCase() !== text(retailer).toLowerCase() ? suffix[2].trim() : '';
  return { title: cleanProductTitle(brand ? suffix[1] : caption), brand };
};

const shoppingQueries = (context, title, brand = '') => {
  const region = ({ CA: 'Canada', US: 'United States', GB: 'United Kingdom', AU: 'Australia' })[context.country] || context.country || '';
  const identity = unique([title, brand]).join(' ');
  return unique([
    `${region} ${context.retailer} ${identity}`.trim(),
    context.sku && `${title} ${brand} ${context.sku}`.trim(),
    context.productId && `${title} ${brand} ${context.productId}`.trim(),
    `${title} ${brand}`.trim(),
  ]);
};

export class SerpApiSearchProvider {
  constructor(apiKey, fetcher = fetch, clock = () => Date.now()) {
    this.apiKey = apiKey;
    this.fetcher = fetcher;
    this.clock = clock;
    this.state = apiKey ? 'available' : 'configuration_error';
    this.retryAt = 0;
    this.lastFailureReason = '';
    this.kind = 'serpapi';
    this.name = 'SerpAPI';
  }

  health() { return { name: this.name, configured: Boolean(this.apiKey), state: this.state, reason: this.lastFailureReason }; }

  async resolveProductCandidates(context, { missingFields = ['title', 'imageUrl', 'price'], attemptId = 'provider-health' } = {}) {
    if (!this.apiKey || this.clock() < this.retryAt) return [];
    this.state = 'available';
    this.lastFailureReason = '';
    const queries = targetedQueries(context);
    const country = context.country ? context.country.toLowerCase() : context.currencyHint === 'CAD' ? 'ca' : 'us';
    const candidates = [];
    const addCandidates = (items) => candidates.push(...items.map((candidate) => {
      if (candidate.currency || !candidate.price) return candidate;
      try {
        const parsed = parseProductUrl(candidate.url);
        if (parsed.baseDomain === context.baseDomain) return { ...candidate, currency: parsed.currencyHint || context.currencyHint };
      } catch {}
      return candidate;
    }));
    for (let index = 0; index < queries.length; index += 1) {
      addCandidates(await this.#request('google', queries[index], country, index, attemptId));
      if (this.state !== 'available') return uniqueCandidates(candidates);
      if (candidates.some((candidate) => verifyGoogleIdentity(candidate, context).identityMatch)) break;
    }
    const verified = candidates.find((candidate) => verifyGoogleIdentity(candidate, context).identityMatch);
    const title = verified?.title || context.knownTitle || '';
    const brand = verified?.brand || context.knownBrand || '';
    if (title && missingFields.some((field) => ['imageUrl', 'price', 'currency'].includes(field))) {
      const queriesForShopping = shoppingQueries(context, title, brand);
      for (let index = 0; index < queriesForShopping.length; index += 1) {
        addCandidates(await this.#request('google_shopping', queriesForShopping[index], country, index, attemptId));
        if (this.state !== 'available') break;
        const sameRetailer = candidates.filter((candidate) => candidate.providerSource === 'shopping_result'
          && verifyGoogleIdentity(candidate, context).identityMatch);
        if (sameRetailer.some((candidate) => candidate.imageUrl && candidate.price && (!context.currencyHint || candidate.currency === context.currencyHint))) break;
      }
    }
    return uniqueCandidates(candidates).slice(0, 15);
  }

  async #request(engine, query, country, queryIndex, attemptId) {
    try {
      const endpoint = new URL('https://serpapi.com/search.json');
      endpoint.searchParams.set('engine', engine);
      endpoint.searchParams.set('q', query);
      endpoint.searchParams.set('gl', country || 'us');
      endpoint.searchParams.set('api_key', this.apiKey);
      diagnostics(attemptId, 'INDEXED_PROVIDER_REQUEST', { provider: this.name, engine, query, state: this.state });
      const response = await this.fetcher(endpoint, { signal: AbortSignal.timeout(9_000) });
      if (!response.ok) {
        let errorMessage = '';
        try { errorMessage = text((await response.json())?.error); } catch { /* Some failures are not JSON. */ }
        const state = /quota|credits|(?:run|ran) out of searches|searches left|limit.*reached/i.test(errorMessage) ? 'quota_exhausted'
          : response.status === 429 ? 'rate_limited' : [400, 401, 403].includes(response.status) ? 'configuration_error' : 'temporary_error';
        this.#fail(state, `HTTP_${response.status}${errorMessage ? `: ${errorMessage.slice(0, 180)}` : ''}`);
        diagnostics(attemptId, 'INDEXED_PROVIDER_STATUS', { provider: this.name, engine, query, status: response.status, state: this.state, reason: this.lastFailureReason, candidateCount: 0 });
        return [];
      }
      const result = await response.json();
      if (result.error) {
        const message = text(result.error);
        const state = /quota|credits|(?:run|ran) out of searches|searches left|limit.*reached/i.test(message) ? 'quota_exhausted'
          : /invalid api|api key|authentication/i.test(message) ? 'configuration_error'
            : /rate limit|too many/i.test(message) ? 'rate_limited' : 'temporary_error';
        this.#fail(state, message.slice(0, 180));
        return [];
      }
      if (!result || typeof result !== 'object') { this.#fail('temporary_error', 'INVALID_JSON_RESULT'); return []; }
      const entries = engine === 'google_shopping' ? result.shopping_results : result.organic_results;
      const organic = (Array.isArray(entries) ? entries.slice(0, 5) : []).map(engine === 'google_shopping' ? candidateFromShopping : candidateFromOrganic);
      // Google may return an AI Overview with cited sources. Treat its text as
      // a discovery hint only; downstream URL identity checks must verify the
      // cited retailer URL before its price can be used as an offer.
      const overview = engine === 'google' ? googleAiOverviewCandidates(result.ai_overview, queryIndex) : [];
      const normalized = [...organic, ...overview].map((candidate) => ({ ...candidate, provider: this.name, queryIndex }));
      diagnostics(attemptId, 'INDEXED_PROVIDER_STATUS', { provider: this.name, engine, query, status: response.status, state: this.state, candidateCount: normalized.length });
      return normalized;
    } catch (error) {
      this.#fail(error?.name === 'TimeoutError' ? 'rate_limited' : 'temporary_error', text(error?.message) || 'FETCH_FAILED');
      diagnostics(attemptId, 'INDEXED_PROVIDER_STATUS', { provider: this.name, engine, query, status: 0, state: this.state, reason: this.lastFailureReason, candidateCount: 0 });
      return [];
    }
  }

  #fail(state, reason = '') {
    this.state = state;
    this.lastFailureReason = reason;
    this.retryAt = this.clock() + (state === 'quota_exhausted' ? 60 * 60_000 : state === 'configuration_error' ? 15 * 60_000 : state === 'rate_limited' ? 5 * 60_000 : 60_000);
  }
}

const indexedSearchQueries = (context) => {
  const identifier = context.productId || context.sku || context.styleId || context.candidateIdentifiers[0] || '';
  if (context.baseDomain === 'macys.com' && context.productId) {
    const title = text(context.knownTitle || context.slug).replace(/\s+/g, ' ').trim();
    const brand = title.split(/\s+/)[0] || '';
    return unique([
      `site:macys.com/shop/product "${context.productId}"`,
      `site:macys.com "${context.productId}" "${brand}"`,
      `site:macys.com "${title}"`,
    ]);
  }
  return unique([
    identifier && `site:${context.baseDomain} "${identifier}"`,
    identifier && `site:${context.baseDomain} "${identifier}" "${context.slug}"`,
    `site:${context.baseDomain} "${context.knownTitle || context.slug}"`,
  ]);
};

// Brave Search API is an independent, API-backed indexed web provider. It is
// enabled only when BRAVE_SEARCH_API_KEY is configured; no consumer HTML is
// scraped by this provider.
export class BraveSearchApiProvider {
  constructor(apiKey, fetcher = fetch, clock = () => Date.now()) {
    this.apiKey = apiKey;
    this.fetcher = fetcher;
    this.clock = clock;
    this.name = 'Brave Search API';
    this.kind = 'indexed-search-api';
    this.state = apiKey ? 'available' : 'configuration_error';
    this.retryAt = 0;
    this.lastFailureReason = '';
  }

  health() { return { name: this.name, configured: Boolean(this.apiKey), state: this.state, reason: this.lastFailureReason }; }

  async resolveProductCandidates(context, { attemptId = 'provider-health' } = {}) {
    if (!this.apiKey || this.clock() < this.retryAt) {
      diagnostics(attemptId, 'INDEXED_PROVIDER_SKIPPED', { provider: this.name, state: this.state, reason: this.lastFailureReason || 'NOT_CONFIGURED_OR_COOLDOWN' });
      return [];
    }
    const output = [];
    const country = (context.country || 'US').toLowerCase();
    for (const [queryIndex, query] of indexedSearchQueries(context).entries()) {
      try {
        const endpoint = new URL('https://api.search.brave.com/res/v1/web/search');
        endpoint.searchParams.set('q', query);
        endpoint.searchParams.set('country', country);
        endpoint.searchParams.set('search_lang', context.language || 'en');
        endpoint.searchParams.set('count', '10');
        diagnostics(attemptId, 'INDEXED_PROVIDER_REQUEST', { provider: this.name, engine: 'web', query, state: this.state });
        const response = await this.fetcher(endpoint, {
          headers: { 'Accept': 'application/json', 'X-Subscription-Token': this.apiKey },
          signal: AbortSignal.timeout(9_000),
        });
        if (!response.ok) {
          let message = '';
          try { const problem = await response.json(); message = text(problem?.message ?? problem?.error); } catch {}
          this.#fail(response.status === 429 ? 'rate_limited' : [401, 403].includes(response.status) ? 'configuration_error' : response.status === 402 ? 'quota_exhausted' : 'temporary_error', `HTTP_${response.status}${message ? `: ${message.slice(0, 140)}` : ''}`);
          diagnostics(attemptId, 'INDEXED_PROVIDER_STATUS', { provider: this.name, engine: 'web', query, status: response.status, state: this.state, reason: this.lastFailureReason, candidateCount: 0 });
          return output;
        }
        const payload = await response.json();
        const results = Array.isArray(payload?.web?.results) ? payload.web.results : [];
        const candidates = results.slice(0, 10).map((item) => {
          const url = text(item.url);
          let parsed;
          try { parsed = parseProductUrl(url); } catch {}
          const title = decodeHtmlText(item.title);
          const snippet = decodeHtmlText([item.description, ...(Array.isArray(item.extra_snippets) ? item.extra_snippets : [])].filter(Boolean).join(' '));
          const priceMatch = snippet.match(/\b(CA|US|AU|NZ)\$\s*(\d[\d,]*(?:\.\d{1,2})?)|\b(USD|CAD|GBP|EUR)\s*(\d[\d,]*(?:\.\d{1,2})?)|\$\s*(\d[\d,]*(?:\.\d{1,2})?)/i);
          const price = priceMatch ? normalizePrice(priceMatch[2] || priceMatch[5] || priceMatch[6]) : '';
          const currency = priceMatch
            ? currencyFromSymbol(priceMatch[1] || (priceMatch[3] ? `${priceMatch[3]}` : ''), parsed?.currencyHint || (parsed?.baseDomain === context.baseDomain ? context.currencyHint : ''))
            : '';
          return {
            url, title, retailer: parsed?.retailer || text(item.profile?.long_name),
            brand: '', productId: parsed?.productId || '', sku: parsed?.sku || '', upc: '', gtin: '',
            imageUrl: text(item.thumbnail?.src), price, currency, snippet,
            provider: this.name, providerSource: 'brave_api_web', queryIndex,
          };
        });
        output.push(...candidates);
        this.state = 'available';
        this.lastFailureReason = '';
        diagnostics(attemptId, 'INDEXED_PROVIDER_STATUS', { provider: this.name, engine: 'web', query, status: response.status, state: this.state, candidateCount: candidates.length,
          candidates: candidates.map((candidate) => ({ url: candidate.url, productId: candidate.productId, title: candidate.title, hasImage: Boolean(candidate.imageUrl), hasPrice: Boolean(candidate.price) })) });
        if (candidates.some((candidate) => verifyCandidate(candidate, context).exactIdentifier)) break;
      } catch (error) {
        this.#fail(error?.name === 'TimeoutError' ? 'rate_limited' : 'temporary_error', text(error?.message) || 'FETCH_FAILED');
        diagnostics(attemptId, error?.name === 'TimeoutError' ? 'PROVIDER_TIMEOUT' : 'PROVIDER_ERROR', { provider: this.name, query, reason: this.lastFailureReason, failureClass: this.state });
        break;
      }
    }
    return uniqueCandidates(output);
  }

  #fail(state, reason) {
    this.state = state;
    this.lastFailureReason = reason;
    this.retryAt = this.clock() + (state === 'quota_exhausted' ? 60 * 60_000 : state === 'configuration_error' ? 15 * 60_000 : state === 'rate_limited' ? 5 * 60_000 : 60_000);
  }
}

const googleAiOverviewCandidates = (overview, queryIndex = 0) => {
  if (!overview || typeof overview !== 'object') return [];
  const refs = Array.isArray(overview.references) ? overview.references : [];
  const textBlocks = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    const content = text(node.snippet ?? node.text ?? node.content);
    const indexes = Array.isArray(node.reference_indexes) ? node.reference_indexes : [];
    if (content && indexes.length) textBlocks.push({ content, indexes });
    for (const [key, value] of Object.entries(node)) if (!['snippet', 'text', 'content', 'reference_indexes'].includes(key)) visit(value);
  };
  visit(overview.text_blocks ?? overview);
  const output = [];
  for (const block of textBlocks) {
    const priceMatch = block.content.match(/(?:CA\s*)?\$\s*(\d[\d,]*(?:\.\d{1,2})?)/i);
    if (!priceMatch) continue;
    for (const refIndex of block.indexes) {
      const ref = refs[Number(refIndex)];
      const url = text(ref?.link ?? ref?.url);
      if (!url) continue;
      output.push({
        title: text(ref.title), retailer: text(ref.source ?? ref.title), url,
        price: normalizePrice(priceMatch[1]), currency: /\bCA\s*\$/i.test(block.content) ? 'CAD' : (() => { try { return parseProductUrl(url).currencyHint; } catch { return ''; } })(),
        snippet: block.content, providerSource: 'google_ai_overview', queryIndex,
      });
    }
  }
  return output;
};

// Sephora's public product-image assets are keyed by the selected SKU. Verify
// that the asset is a substantial image before associating it with the item;
// an absent SKU or a 404 never becomes a placeholder product image.
export class SephoraSkuImageProvider {
  constructor(fetcher = fetch) { this.fetcher = fetcher; this.kind = 'retailer-image'; }

  async resolveProductCandidates(context, { missingFields = [] } = {}) {
    if (context.baseDomain !== 'sephora.com' || !context.sku || !missingFields.includes('imageUrl')) return [];
    const imageUrl = `https://www.sephora.com/productimages/sku/s${encodeURIComponent(context.sku)}-main-zoom.jpg`;
    try {
      const response = await this.fetcher(imageUrl, { signal: AbortSignal.timeout(8_000) });
      const contentType = text(response.headers?.get('content-type')).toLowerCase();
      const length = Number(response.headers?.get('content-length') ?? 0);
      if (!response.ok || !contentType.startsWith('image/jpeg') || (length && length < 5_000)) return [];
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length < 5_000 || bytes.length > 3_000_000 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return [];
      return [{ url: context.normalizedUrl, retailer: context.retailer, productId: context.productId, sku: context.sku,
        imageUrl, providerSource: 'retailer_sku_asset' }];
    } catch { return []; }
  }
}

export class DirectGoogleSearchProvider {
  constructor(fetcher = fetch) { this.fetcher = fetcher; this.kind = 'direct-google'; this.name = 'Direct Google HTML'; this.mode = 'best_effort'; this.state = 'available'; this.lastFailureReason = ''; this.cache = new Map(); }

  health() { return { name: this.name, enabled: true, mode: this.mode, state: this.state, reason: this.lastFailureReason }; }

  async resolveProductCandidates(context, { attemptId = 'direct-google', cleanTest = false } = {}) {
    const key = context.normalizedUrl;
    const cached = cleanTest ? null : this.cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.candidates;
    const queries = targetedQueries(context);
    let webCandidates = [];
    for (const query of queries.slice(0, context.baseDomain === 'sephora.com' ? 4 : 2)) {
      diagnostics(attemptId, 'GOOGLE_HOP1_QUERY', { query });
      webCandidates = uniqueCandidates([...webCandidates, ...this.#parseCandidates(await this.#search(context, query, '', attemptId), context, 'direct_google_web')]);
      if (webCandidates.some((candidate) => verifyGoogleIdentity(candidate, context).identityMatch)) break;
    }
    const verified = webCandidates.map((candidate, index) => ({ candidate, index, verification: verifyGoogleIdentity(candidate, context) }))
      .find(({ verification }) => verification.identityMatch);
    diagnostics(attemptId, 'GOOGLE_HOP1_RESULT', { candidates: webCandidates.length, selected: verified ? verified.index + 1 : 0, productIdMatch: verified?.verification.exactIdentifier ?? false });
    const candidates = [...webCandidates];
    const title = verified ? verified.candidate.title : cleanProductTitle(context.knownTitle);
    const brand = verified?.candidate.brand || context.knownBrand || '';
    if (title && (verified || context.knownTitle)) {
      for (const shoppingQuery of shoppingQueries(context, title, brand)) {
        diagnostics(attemptId, 'GOOGLE_HOP2_QUERY', { query: shoppingQuery });
        const shopping = await this.#search(context, shoppingQuery, 'shop', attemptId);
        const shoppingCandidates = await this.#resolveShoppingDestinations(this.#parseCandidates(shopping, context, 'direct_google_shopping'), context);
        const accepted = shoppingCandidates.map((candidate, index) => ({ candidate, index, verification: verifyGoogleIdentity(candidate, context) }))
          .filter(({ verification }) => verification.identityMatch);
        diagnostics(attemptId, 'GOOGLE_HOP2_RESULT', {
          candidates: shoppingCandidates.length,
          selected: accepted.length ? accepted[0].index + 1 : 0,
          productIdMatch: accepted[0]?.verification.exactIdentifier ?? false,
          localeMatch: accepted[0]?.verification.localeMatch ?? false,
          fieldsAccepted: accepted.length ? ['title', ...(accepted[0].candidate.imageUrl ? ['image'] : []), ...(accepted[0].verification.localeMatch && accepted[0].candidate.price ? ['price', 'currency'] : [])] : [],
        });
        candidates.push(...accepted.map(({ candidate }) => candidate));
        if (accepted.some(({ candidate, verification }) => candidate.imageUrl && candidate.price && verification.localeMatch)) break;
      }
    }
    const result = uniqueCandidates(candidates).slice(0, 15);
    if (!cleanTest) this.cache.set(key, { candidates: result, expires: Date.now() + (result.length ? 30 * 60_000 : 5 * 60_000) });
    return result;
  }

  async #search(context, query, mode, attemptId = 'direct-google') {
    if (!query) return '';
    try {
      const endpoint = new URL('https://www.google.com/search');
      endpoint.searchParams.set('q', query);
      endpoint.searchParams.set('num', '10');
      endpoint.searchParams.set('gl', (context.country || 'US').toLowerCase());
      if (mode) endpoint.searchParams.set('tbm', mode);
      const response = await this.fetcher(endpoint, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': `${context.language || 'en'}-${context.country || 'US'},en;q=0.8` }, signal: AbortSignal.timeout(8_000) });
      if (!response.ok) {
        diagnostics(attemptId, 'GOOGLE_SEARCH_RESPONSE', { query, status: response.status, reason: `HTTP_${response.status}` });
        return '';
      }
      const html = await response.text();
      const blocked = /captcha|unusual traffic|consent\.google|before you continue|automated queries/i.test(html.slice(0, 40_000));
      const headingCount = [...html.matchAll(/<h3\b/gi)].length;
      this.state = blocked || !headingCount ? 'unavailable' : 'available';
      this.lastFailureReason = blocked ? 'SEARCH_CHALLENGE_OR_CONSENT' : !headingCount ? 'NO_RESULT_CARDS_OR_JS_SHELL' : '';
      diagnostics(attemptId, 'GOOGLE_SEARCH_RESPONSE', { query, status: response.status, bytes: html.length,
        headingCount, state: this.state, reason: this.lastFailureReason });
      return blocked ? '' : html;
    } catch (error) {
      this.state = error?.name === 'TimeoutError' ? 'rate_limited' : 'temporary_error';
      this.lastFailureReason = text(error?.message) || 'FETCH_FAILED';
      diagnostics(attemptId, error?.name === 'TimeoutError' ? 'PROVIDER_TIMEOUT' : 'PROVIDER_ERROR', { provider: this.name, query, reason: this.lastFailureReason, state: this.state });
      return '';
    }
  }

  async #resolveShoppingDestinations(candidates, context) {
    const resolved = [];
    for (const candidate of candidates.slice(0, 10)) {
      let destination;
      try { destination = new URL(candidate.url); } catch { continue; }
      if (baseDomainFor(destination.hostname) !== 'google.com') { resolved.push(candidate); continue; }
      if (!/^\/(?:shopping\/product|product)\//.test(destination.pathname)) continue;
      // A public Google product-details page may contain ordinary merchant
      // links. Follow only that page; challenges and redirects are not bypassed.
      try {
        const response = await this.fetcher(destination, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': `${context.language || 'en'}-${context.country || 'US'},en;q=0.8` }, signal: AbortSignal.timeout(8_000) });
        if (!response.ok) continue;
        const html = await response.text();
        if (/captcha|unusual traffic|consent\.google|before you continue|automated queries/i.test(html.slice(0, 40_000))) continue;
        const merchantUrl = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)]
          .map((match) => unwrapGoogleDestination(match[1]))
          .find((url) => url && verifyGoogleIdentity({ url }, context).identityMatch);
        if (merchantUrl) {
          const market = parseProductUrl(merchantUrl);
          const currency = candidate.currency || (market.country && market.country === context.country ? market.currencyHint : '');
          resolved.push({ ...candidate, url: merchantUrl, currency });
        }
      } catch { /* Public detail page was unavailable. */ }
    }
    return resolved;
  }

  #parseCandidates(html, context, source) {
    const results = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>[\s\S]{0,1600}?<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)].slice(0, 15);
    return results.flatMap((match, index) => {
      const destination = unwrapGoogleDestination(match[1]);
      if (!destination || (baseDomainFor(new URL(destination).hostname) === 'google.com'
        && (source !== 'direct_google_shopping' || !/^\/(?:shopping\/product|product)\//.test(new URL(destination).pathname)))) return [];
      const detail = html.slice(match.index, Math.min(results[index + 1]?.index ?? html.length, match.index + 2400));
      const image = decodeHtmlText(detail.match(/<img\b[^>]*(?:data-src|src)=["']([^"']+)["']/i)?.[1] ?? '');
      const priceMatch = source === 'direct_google_shopping' || source === 'direct_google_web'
        ? decodeHtmlText(detail).match(/\b(CA|US|AU|NZ)\$\s*(\d[\d,]*(?:\.\d{1,2})?)|\b(CAD|USD|GBP|EUR)\s*(\d[\d,]*(?:\.\d{1,2})?)|([£€])\s*(\d[\d,]*(?:\.\d{1,2})?)|\$\s*(\d[\d,]*(?:\.\d{1,2})?)/i)
        : null;
      const candidateMarket = parseProductUrl(destination);
      const inferredCurrency = candidateMarket.baseDomain === context.baseDomain && candidateMarket.country && candidateMarket.country === context.country ? candidateMarket.currencyHint : '';
      const currency = priceMatch ? ({ CA: 'CAD', US: 'USD', AU: 'AUD', NZ: 'NZD', '£': 'GBP', '€': 'EUR' })[(priceMatch[1] || priceMatch[5] || '').toUpperCase()] || (priceMatch[3] || '').toUpperCase() || (priceMatch[7] ? inferredCurrency : '') : '';
      const snippet = decodeHtmlText(detail);
      return [{ ...captionIdentity(match[2], context.retailer), url: destination, retailer: candidateMarket.retailer,
        price: priceMatch ? normalizePrice(priceMatch[2] || priceMatch[4] || priceMatch[6] || priceMatch[7]) : '', currency,
        imageUrl: validProductImage(image) ? image : '', sku: skuInSnippet(snippet), snippet: snippet.slice(0, 400), providerSource: source }];
    });
  }
}

const unwrapGoogleDestination = (value) => {
  try {
    let url = new URL(decodeHtmlText(value), 'https://www.google.com');
    for (let depth = 0; depth < 2 && baseDomainFor(url.hostname) === 'google.com'; depth += 1) {
      const target = url.searchParams.get('q') || url.searchParams.get('url') || url.searchParams.get('u');
      if (!target || !/^https?:\/\//i.test(target)) break;
      url = new URL(target);
    }
    return /^https?:$/.test(url.protocol) ? url.toString() : '';
  } catch { return ''; }
};

const verifyGoogleIdentity = (candidate, context) => {
  const verification = verifyCandidate(candidate, context);
  let parsed;
  try { parsed = parseProductUrl(candidate.url); } catch { return { ...verification, identityMatch: false, localeMatch: false }; }
  const identityMatch = verification.originalDomain && !verification.conflictingIdentifier && !verification.variantConflict
    && (verification.exactIdentifier || verification.exactCanonical);
  const localeMatch = identityMatch && verification.localeMatch;
  return { ...verification, identityMatch, localeMatch };
};

const decodeHtmlText = (value) => text(value)
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/&#(x[0-9a-f]+|\d+);/gi, (entity, code) => {
    const point = code[0].toLowerCase() === 'x' ? Number.parseInt(code.slice(1), 16) : Number.parseInt(code, 10);
    return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
  })
  .replace(/&nbsp;/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const bingDestination = (value) => {
  try {
    const url = new URL(value);
    if (!url.hostname.endsWith('bing.com')) return url.toString();
    const encoded = url.searchParams.get('u') ?? '';
    if (!encoded.startsWith('a1')) return url.toString();
    const decoded = Buffer.from(encoded.slice(2).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return /^https?:\/\//i.test(decoded) ? decoded : url.toString();
  } catch { return value; }
};

const decodeJavaScriptString = (value) => {
  try { return JSON.parse(`"${value}"`); } catch { return decodeHtmlText(value); }
};

const currencyFromSymbol = (symbol, fallback = '') => {
  const normalized = text(symbol).toUpperCase();
  if (normalized.startsWith('CA')) return 'CAD';
  if (normalized.startsWith('US')) return 'USD';
  if (normalized.startsWith('AU')) return 'AUD';
  if (normalized.startsWith('NZ')) return 'NZD';
  if (normalized === '€') return 'EUR';
  if (normalized === '£') return 'GBP';
  return fallback;
};

export class BraveSearchProvider {
  constructor(fetcher = fetch) { this.fetcher = fetcher; }

  async resolveProductCandidates(context) {
    const identifier = context.sku || context.productId || context.styleId || '';
    const queries = unique([
      identifier && `site:${context.baseDomain} "${identifier}"`,
      identifier && `site:${context.baseDomain}/productpage "${identifier}"`,
      [context.baseDomain, context.slug, identifier].filter(Boolean).join(' '),
      [context.retailer, identifier && `"${identifier}"`, context.slug].filter(Boolean).join(' '),
    ]).slice(0, 4);
    const webCandidates = [];
    for (let index = 0; index < queries.length; index += 1) {
      const results = await this.#web(queries[index], context, index);
      webCandidates.push(...results);
      if (results.some((candidate) => {
        const verification = verifyCandidate(candidate, context);
        return verification.confidence === 'HIGH' && (verification.exactIdentifier || verification.exactCanonical);
      })) break;
    }
    const uniqueWeb = uniqueCandidates(webCandidates);
    const bestIdentity = uniqueWeb
      .map((candidate) => ({ candidate, verification: verifyCandidate(candidate, context) }))
      .filter(({ verification }) => verification.confidence === 'HIGH')
      .sort((left, right) => right.verification.score - left.verification.score)[0]?.candidate;
    if (!bestIdentity) return uniqueWeb;
    const cleanTitle = cleanProductTitle(bestIdentity.title, bestIdentity);
    const imageCandidates = await this.#images(`${context.retailer} ${cleanTitle} ${identifier}`);
    return uniqueCandidates([...uniqueWeb, ...imageCandidates]);
  }

  async #web(query, context, queryIndex) {
    try {
      const endpoint = new URL('https://search.brave.com/search');
      endpoint.searchParams.set('q', query);
      endpoint.searchParams.set('source', 'web');
      endpoint.searchParams.set('country', context.country?.toLowerCase() || 'ca');
      const response = await this.fetcher(endpoint, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Cura indexed product resolver/1.0)', 'Accept-Language': `${context.language || 'en'}-${context.country || 'CA'},en;q=0.8` },
        signal: AbortSignal.timeout(9_000),
      });
      if (!response.ok) return [];
      const html = await response.text();
      if (/request has been flagged as being suspicious|schedule a captcha/i.test(html)) return [];
      const titles = [...html.matchAll(/<div[^>]+class="[^"]*search-snippet-title[^"]*"[^>]+title="([^"]+)"[^>]*>/gi)];
      return titles.flatMap((match, index) => {
        const previousBoundary = index ? titles[index - 1].index : 0;
        const prefix = html.slice(Math.max(previousBoundary, match.index - 7_000), match.index);
        const hrefs = [...prefix.matchAll(/<a[^>]+href="(https?:\/\/[^"#]+)"/gi)];
        const url = decodeHtmlText(hrefs.at(-1)?.[1] ?? '');
        if (!url) return [];
        const nextBoundary = titles[index + 1]?.index ?? Math.min(html.length, match.index + 7_000);
        const blockText = decodeHtmlText(html.slice(match.index, nextBoundary));
        const sourceMatches = [...prefix.matchAll(/class="[^"]*desktop-small-semibold[^"]*"[^>]*>([^<]+)</gi)];
        const retailer = decodeHtmlText(sourceMatches.at(-1)?.[1] ?? '');
        const priceMatch = blockText.match(/(?:\bprice\s*:?\s*)((?:CA|US|AU|NZ)?\$|€|£)\s*(\d[\d,]*(?:\.\d{1,2})?)/i)
          ?? blockText.match(/((?:CA|US|AU|NZ)\$|€|£)\s*(\d[\d,]*(?:\.\d{1,2})?)/i);
        const currency = priceMatch ? currencyFromSymbol(priceMatch[1], context.currencyHint) : '';
        const base = {
          title: decodeHtmlText(match[1]), retailer, brand: '', url,
          price: priceMatch ? normalizePrice(priceMatch[2]) : '', currency,
          imageUrl: '', color: '', availability: '', providerSource: 'indexed_search', queryIndex,
        };
        if (currency && context.currencyHint && currency !== context.currencyHint) return [{ ...base, price: '', currency: '' }, base];
        return [base];
      });
    } catch { return []; }
  }

  async #images(query) {
    try {
      const endpoint = new URL('https://search.brave.com/images');
      endpoint.searchParams.set('q', query);
      endpoint.searchParams.set('source', 'web');
      const response = await this.fetcher(endpoint, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Cura product image resolver/1.0)' },
        signal: AbortSignal.timeout(9_000),
      });
      if (!response.ok) return [];
      const html = await response.text();
      if (/request has been flagged as being suspicious|schedule a captcha/i.test(html)) return [];
      return [...html.matchAll(/\{title:"((?:\\.|[^"])*)",url:"(https?:[^" ]+)"[\s\S]{0,6000}?thumbnail:\{[\s\S]{0,1800}?original:"(https?:[^" ]+)"/g)]
        .slice(0, 12)
        .map((match) => ({
          title: decodeJavaScriptString(match[1]),
          url: decodeJavaScriptString(match[2]),
          imageUrl: decodeJavaScriptString(match[3]),
          price: '', currency: '', color: '', availability: '', providerSource: 'image_search',
        }))
        .filter((candidate) => /^https?:\/\//i.test(candidate.url) && /^https?:\/\//i.test(candidate.imageUrl));
    } catch { return []; }
  }
}

export class DuckDuckGoSearchProvider {
  constructor(fetcher = fetch) { this.fetcher = fetcher; this.kind = 'indexed-search'; }

  async resolveProductCandidates(context) {
    const identifier = context.sku || context.productId || context.styleId;
    const queries = unique([identifier && `site:${context.baseDomain} "${identifier}"`,
      identifier && `${context.retailer} "${identifier}"`,
      context.knownTitle && `${context.retailer} "${context.knownTitle}" "${identifier}"`]).slice(0, 3);
    const candidates = [];
    for (const query of queries) {
      try {
        const endpoint = new URL('https://html.duckduckgo.com/html/');
        endpoint.searchParams.set('q', query);
        const response = await this.fetcher(endpoint, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': `${context.language || 'en'}-${context.country || 'US'},en;q=0.8` }, signal: AbortSignal.timeout(8_000) });
        if (!response.ok) continue;
        const html = await response.text();
        if (/captcha|automated requests|unusual traffic/i.test(html.slice(0, 20_000))) continue;
        const anchors = [...html.matchAll(/<a\b[^>]*class=["'][^"']*\bresult__a\b[^"']*["'][^>]*>[\s\S]*?<\/a>/gi)].slice(0, 12);
        for (const [index, anchor] of anchors.entries()) {
          const href = anchor[0].match(/\bhref=["']([^"']+)["']/i)?.[1];
          let url;
          try {
            const wrapped = new URL(decodeHtmlText(href), endpoint);
            url = wrapped.searchParams.get('uddg') || wrapped.toString();
            if (!/^https?:\/\//i.test(url)) continue;
          } catch { continue; }
          const block = html.slice(anchor.index, anchors[index + 1]?.index ?? anchor.index + 3000);
          const snippet = decodeHtmlText(block.match(/class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? '');
          const priceMatch = snippet.match(/\b(CA|US|AU|NZ)\$\s*(\d[\d,]*(?:\.\d{1,2})?)/i);
          candidates.push({ title: decodeHtmlText(anchor[0]), url, retailer: '', snippet,
            price: priceMatch ? normalizePrice(priceMatch[2]) : '', currency: priceMatch ? currencyFromSymbol(`${priceMatch[1]}$`) : '',
            imageUrl: '', providerSource: 'indexed_search' });
        }
      } catch { /* Public search was unavailable; continue to other providers. */ }
      if (candidates.some((candidate) => verifyGoogleIdentity(candidate, context).identityMatch)) break;
    }
    const exact = candidates.find((candidate) => verifyGoogleIdentity(candidate, context).identityMatch);
    const verifiedTitle = exact?.title || context.knownTitle;
    const images = context.baseDomain === 'hm.com' && context.productId && verifiedTitle
      ? await this.#images(`${context.retailer} ${cleanProductTitle(verifiedTitle)} ${identifier}`, context) : [];
    return uniqueCandidates([...candidates, ...images]).slice(0, 20);
  }

  async #images(query, context) {
    try {
      const pageUrl = new URL('https://duckduckgo.com/');
      pageUrl.searchParams.set('q', query);
      pageUrl.searchParams.set('iax', 'images');
      pageUrl.searchParams.set('ia', 'images');
      const headers = { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': `${context.language || 'en'}-${context.country || 'US'},en;q=0.8` };
      const page = await this.fetcher(pageUrl, { headers, signal: AbortSignal.timeout(8_000) });
      if (!page.ok) return [];
      const html = await page.text();
      if (/captcha|unusual traffic/i.test(html.slice(0, 20_000))) return [];
      const vqd = html.match(/vqd[=:]["']?([\d-]+)/)?.[1] || html.match(/vqd=([\d-]+)/)?.[1];
      if (!vqd) return [];
      const endpoint = new URL('https://duckduckgo.com/i.js');
      endpoint.searchParams.set('l', `${(context.country || 'ca').toLowerCase()}-${context.language || 'en'}`);
      endpoint.searchParams.set('o', 'json');
      endpoint.searchParams.set('q', query);
      endpoint.searchParams.set('vqd', vqd);
      const response = await this.fetcher(endpoint, { headers: { ...headers, Referer: 'https://duckduckgo.com/' }, signal: AbortSignal.timeout(8_000) });
      if (!response.ok) return [];
      const data = await response.json();
      return (Array.isArray(data?.results) ? data.results : []).slice(0, 100).flatMap((item) => {
        try {
          const original = parseProductUrl(item.url);
          const image = new URL(item.image);
          if (original.baseDomain !== 'hm.com' || original.productId !== context.productId
            || baseDomainFor(image.hostname) !== 'hm.com' || !validProductImage(item.image)) return [];
          return [{ title: decodeHtmlText(item.title), url: original.normalizedUrl, retailer: 'H&M',
            imageUrl: image.toString(), price: '', currency: '', providerSource: 'indexed_image' }];
        } catch { return []; }
      }).slice(0, 10);
    } catch { return []; }
  }
}

export class BingSearchProvider {
  async resolveProductCandidates(context) {
    const identifier = context.sku || context.productId || context.styleId;
    const initialQueries = unique([identifier && `site:${context.baseDomain} "${identifier}"`,
      identifier && `site:${context.baseDomain}/productpage "${identifier}"`, ...context.searchQueries]).slice(0, 4);
    const initial = uniqueCandidates((await Promise.all(initialQueries.map((query, index) => this.#web(query, context, index)))).flat());
    const bestIdentity = initial
      .map((candidate) => ({ candidate, verification: verifyCandidate(candidate, context) }))
      .sort((left, right) => right.verification.score - left.verification.score)[0];
    if (!bestIdentity || bestIdentity.verification.confidence === 'LOW') return initial;
    const title = cleanProductTitle(bestIdentity.candidate.title, bestIdentity.candidate);
    const refinementQueries = unique([
      `${context.retailer} "${title}" price`,
      `site:${context.baseDomain} "${title}"`,
    ]);
    const [refined, images] = await Promise.all([
      Promise.all(refinementQueries.map((query, index) => this.#web(query, context, initialQueries.length + index))).then((groups) => groups.flat()),
      this.#images(`${context.retailer} ${title} ${context.productId}`),
    ]);
    return uniqueCandidates([...initial, ...refined, ...images]).slice(0, 15);
  }

  async #web(query, context, queryIndex) {
    try {
      const endpoint = new URL('https://www.bing.com/search');
      endpoint.searchParams.set('q', query);
      endpoint.searchParams.set('cc', context.country?.toLowerCase() || 'us');
      endpoint.searchParams.set('setlang', context.language || 'en');
      const response = await fetch(endpoint, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Cura product resolver/1.0)', 'Accept-Language': `${context.language || 'en'}-${context.country || 'US'},en;q=0.8` },
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) return [];
      const html = await response.text();
      return [...html.matchAll(/<li[^>]+class="[^"]*\bb_algo\b[^"]*"[\s\S]*?<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h2>([\s\S]*?)<\/li>/gi)]
        .slice(0, 5)
        .map((match) => {
          const remainder = match[3];
          const snippet = decodeHtmlText(remainder.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? remainder);
          const priced = snippet.match(/\b(CA|US|AU|NZ)\$\s*(\d[\d,]*(?:\.\d{1,2})?)/i);
          return {
            ...captionIdentity(match[2], context.retailer),
            retailer: '',
            url: bingDestination(decodeHtmlText(match[1])),
            price: priced ? normalizePrice(priced[2]) : '',
            currency: priced ? currencyFromSymbol(priced[1]) : '',
            imageUrl: '',
            sku: skuInSnippet(snippet), snippet,
            color: '',
            availability: '',
            providerSource: 'bing_search',
            queryIndex,
          };
        });
    } catch { return []; }
  }

  async #images(query) {
    try {
      const endpoint = new URL('https://www.bing.com/images/search');
      endpoint.searchParams.set('q', query);
      const response = await fetch(endpoint, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Cura product resolver/1.0)' }, signal: AbortSignal.timeout(8_000) });
      if (!response.ok) return [];
      const html = await response.text();
      return [...html.matchAll(/<a[^>]*class="[^"]*\biusc\b[^"]*"[^>]*\bm="([^"]+)"/gi)].slice(0, 8).flatMap((match) => {
        try {
          const item = JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
          const imageUrl = text(item.murl);
          return /^https?:\/\//i.test(imageUrl) ? [{
            title: text(item.t), retailer: '', url: text(item.purl), price: '', currency: '', imageUrl, color: '', availability: '', providerSource: 'image_search',
          }] : [];
        } catch { return []; }
      });
    } catch { return []; }
  }
}

const uniqueCandidates = (candidates) => {
  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = `${candidate.url}|${candidate.title}|${candidate.price}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const normalizeProviderCandidate = (candidate, provider) => {
  const url = text(candidate?.url ?? candidate?.link ?? candidate?.destination);
  let parsed;
  try { parsed = parseProductUrl(url); } catch {}
  return {
    ...candidate,
    url,
    title: text(candidate?.title ?? candidate?.name),
    retailer: text(candidate?.retailer ?? candidate?.merchant ?? candidate?.source),
    brand: text(candidate?.brand),
    productId: text(candidate?.productId ?? candidate?.webId ?? parsed?.productId),
    sku: text(candidate?.sku ?? parsed?.sku),
    upc: text(candidate?.upc),
    gtin: text(candidate?.gtin),
    imageUrl: text(candidate?.imageUrl ?? candidate?.thumbnail?.src ?? candidate?.thumbnail),
    price: normalizePrice(candidate?.price),
    currency: text(candidate?.currency).toUpperCase(),
    snippet: text(candidate?.snippet ?? candidate?.description),
    provider: text(candidate?.provider ?? provider?.name ?? provider?.kind ?? provider?.constructor?.name),
    providerSource: text(candidate?.providerSource ?? provider?.kind ?? provider?.name ?? 'indexed_search'),
  };
};

const roundRobinCandidates = (groups, maximum) => {
  const selected = [];
  const largest = Math.max(0, ...groups.map((group) => group.length));
  for (let index = 0; index < largest && selected.length < maximum; index += 1) {
    for (const group of groups) {
      if (group[index]) selected.push(group[index]);
      if (selected.length === maximum) break;
    }
  }
  return uniqueCandidates(selected).slice(0, maximum);
};

const withTimeout = (operation, timeoutMs) => new Promise((resolvePromise, rejectPromise) => {
  const timer = setTimeout(() => rejectPromise(new Error('TIMEOUT')), timeoutMs);
  Promise.resolve(operation).then(
    (value) => { clearTimeout(timer); resolvePromise(value); },
    (error) => { clearTimeout(timer); rejectPromise(error); },
  );
});

const emptyState = () => ({ version: 1, registry: {}, products: {}, domains: {}, negative: {} });
const loadState = (statePath) => {
  try {
    if (!existsSync(statePath)) return emptyState();
    const parsed = JSON.parse(readFileSync(statePath, 'utf8'));
    return parsed?.version === 1 ? parsed : emptyState();
  } catch { return emptyState(); }
};

const stateKey = (context) => `${context.baseDomain}|${context.hostname}|${context.locale}|${context.pathPattern}`;
const productKey = (context) => `item:v${RESOLVER_SCHEMA_VERSION}:` + createHash('sha256').update(context.cacheKey || context.canonicalCandidate).digest('hex');
const legacyProductKey = (context) => `${createHash('sha256').update(context.normalizedUrl).digest('hex')}::size::||||||||`;
const now = () => new Date().toISOString();
const strategyFor = (stats) => {
  if (!stats || stats.attempts < 1) return 'UNKNOWN';
  const directRate = stats.directSuccesses / Math.max(1, stats.directAttempts);
  const fallbackRate = stats.fallbackSuccesses / Math.max(1, stats.fallbackAttempts);
  if (directRate >= 0.7) return 'DIRECT_FIRST';
  // One miss changes scheduling immediately, but stronger states require a
  // repeated pattern so a temporary retailer failure is not over-learned.
  if (stats.directAttempts < 3) return 'HYBRID';
  if (directRate < 0.2 && fallbackRate >= 0.6) return 'SEARCH_FIRST';
  if (directRate < 0.35 && fallbackRate < 0.35) return 'DIRECT_UNRELIABLE';
  return 'HYBRID';
};

const diagnostics = (attemptId, event, detail = {}) => {
  const entry = { at: now(), attemptId, event, ...detail };
  recentDiagnostics.push(entry);
  if (recentDiagnostics.length > 300) recentDiagnostics.splice(0, recentDiagnostics.length - 300);
  if (process.env.DEBUG_RESOLVER === '1') console.info(JSON.stringify(entry));
};

export const recordResolverEvent = (event, detail = {}) => diagnostics(crypto.randomUUID(), event, detail);
export const clearResolverDiagnostics = () => { recentDiagnostics.length = 0; };

const failureClass = (error) => {
  const message = text(error?.message).toUpperCase();
  if (message.includes('404') || message.includes('410') || message.includes('PRODUCT_REMOVED')) return 'PRODUCT_REMOVED';
  const blockedStatus = message.match(/HTTP[_ ]?(401|403|407|429|451|503)/);
  if (blockedStatus) return `HTTP_${blockedStatus[1]}`;
  if (message.includes('TIMEOUT') || error?.name === 'TimeoutError') return 'TIMEOUT';
  if (message.includes('PRIVATE') || message.includes('INVALID_URL')) return 'INVALID_URL';
  if (message.includes('BLOCK') || message.includes('CHALLENGE')) return 'BOT_CHALLENGE';
  if (message.includes('CONTENT')) return 'UNEXPECTED_CONTENT_TYPE';
  return 'NETWORK_ERROR';
};

const hasValue = (field, value) => field === 'imageUrl' ? validProductImage(value)
  : field === 'price' ? Boolean(normalizePrice(value) && Number(normalizePrice(value)) > 0)
    : field === 'title' ? Boolean(text(value) && !weakProductTitle(value) && !/^(?:preview|price) unavailable$/i.test(text(value)))
      : Boolean(text(value) && !/^(?:preview|price) unavailable$/i.test(text(value)));

const fieldValue = (product, field) => field === 'retailer' ? text(product?.retailer ?? product?.store) : text(product?.[field]);
const resolvedField = (product, field) => hasValue(field, fieldValue(product ?? {}, field))
  && !(field === 'title' && ['url_slug', 'url_domain'].includes(product?.fieldSources?.title))
  && !(field === 'brand' && product?.fieldSources?.brand === 'url_domain');
const resolutionStatusFor = (product) => {
  const trustedTitle = Boolean(product?.title && product?.fieldSources?.title !== 'url_slug' && product?.fieldConfidence?.title !== 'LOW');
  const freshPrice = Number(normalizePrice(product?.price)) > 0 && /^[A-Z]{3}$/.test(text(product?.currency)) && !product?.priceStale;
  return trustedTitle && freshPrice ? 'RESOLVED' : trustedTitle || product?.imageUrl || freshPrice ? 'PARTIAL' : 'UNRESOLVED';
};

const applyField = (target, field, value, source, confidence) => {
  if (!hasValue(field, value)) return false;
  target[field] = field === 'title' ? cleanProductTitle(value, target) : value;
  target.fieldSources[field] = source;
  target.fieldConfidence[field] = confidence;
  return true;
};

const mediumConfidenceFields = new Set(['currency', 'retailer', 'brand', 'availability']);
const canMergeFallbackField = (field, confidence) => confidence === 'HIGH'
  || (confidence === 'MEDIUM' && (mediumConfidenceFields.has(field) || field === 'title' || field === 'imageUrl'));
const validProductImage = (value) => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !/(?:^|[\/_.-])(?:favicon|logo|placeholder|banner|sprite|icon|navigation|aboutus|ourhistory)(?:[\/_.-]|$)/i.test(url.pathname);
  } catch { return false; }
};

const sourceStrength = (source, field, value) => {
  if (source === 'user_edit') return 0; // User values belong only on Items.
  if (/retailer_first_party_(?:api|structured)/.test(source)) return 120;
  if (source === 'best_guess_image') return 20;
  if (source === 'firecrawl_image_search') return 75;
  if (source === 'firecrawl_scrape') return 100;
  if (source === 'retailer_search_brand') return 65;
  if (/^direct_google_/.test(source)) return 70;
  if (/^(?:rendered_retailer|retailer_page|retailer_|direct_jsonld|direct_metadata|jsonld|shopify|next_data|nuxt|hm_cross_locale_page)/.test(source) || /_adapter$/.test(source)) return 100;
  if (/^(?:shopping_result|search_result|google_ai_overview|serpapi|tavily_search|firecrawl_search)/.test(source)) return 80;
  if (/^(?:indexed_search|indexed_image|bing_search|manufacturer_image)/.test(source)) return 60;
  if (/^(?:url_|image_search)/.test(source)) return 15;
  if (!source && field === 'title' && /^(?:www\d*|shop|[a-z]+) product$/i.test(text(value))) return 5;
  return 45; // Legacy records did not retain field provenance consistently.
};

const priceMarketMatches = (record, context) => {
  const prior = record?.priceInfo;
  if (!prior) return true;
  if (prior.market && context.country && prior.market !== context.country) return false;
  if (prior.retailer && context.retailer && prior.retailer.toLowerCase() !== context.retailer.toLowerCase()) return false;
  if (prior.seller && context.sellerId && prior.seller !== context.sellerId) return false;
  const store = new URL(context.normalizedUrl).searchParams.get('pc-express-book') ?? '';
  if (prior.store && prior.store !== store) return false;
  return true;
};

// A shared record is a field-level verified resolution, never a canvas Item.
// A newer price from the same strength may replace an older price; other fields
// change only when stronger evidence is available.
export const upsertResolvedProduct = (existing, incoming, context, verifiedAt = now(), priceTtlMs = 60 * 60_000) => {
  const previous = existing?.product ?? {};
  const product = { title: '', brand: '', retailer: '', imageUrl: '', price: '', currency: '',
    color: '', variant: '', size: '', availability: '', priceEstimated: false, priceReference: '',
    ...previous, fieldSources: { ...previous.fieldSources }, fieldConfidence: { ...previous.fieldConfidence }, imageUrls: [...(previous.imageUrls ?? [])] };
  const discardEstimatedPreviousOffer = product.priceEstimated && previous.fieldSources?.price !== 'user_edit';
  const discardUnverifiedGuess = previous.fieldSources?.imageUrl === 'best_guess_image' || previous.fieldConfidence?.imageUrl === 'LOW';
  if (discardUnverifiedGuess && previous.fieldSources?.imageUrl !== 'user_edit') {
    product.imageUrl = '';
    product.imageUrls = [];
    delete product.fieldSources.imageUrl;
    delete product.fieldConfidence.imageUrl;
  }
  if (discardEstimatedPreviousOffer) {
    product.price = '';
    product.currency = '';
    product.priceEstimated = false;
    product.priceReference = '';
    product.estimateLow = '';
    product.estimateHigh = '';
    delete product.fieldSources.price;
    delete product.fieldSources.currency;
    delete product.fieldConfidence.price;
    delete product.fieldConfidence.currency;
  }
  if (weakProductTitle(product.title) && previous.fieldSources?.title !== 'user_edit') {
    product.title = '';
    delete product.fieldSources.title;
    delete product.fieldConfidence.title;
  }
  for (const field of ['retailer', 'brand']) {
    if (/^(?:www\d*|shop|store|m|mobile)$/i.test(text(product[field])) && previous.fieldSources?.[field] !== 'user_edit') {
      product[field] = '';
      delete product.fieldSources[field];
      delete product.fieldConfidence[field];
    }
  }
  const fieldMetadata = { ...(existing?.fieldMetadata ?? {}) };
  if (discardEstimatedPreviousOffer) { delete fieldMetadata.price; delete fieldMetadata.currency; }
  let priceAccepted = false;
  for (const field of sharedFields) {
    const value = fieldValue(incoming, field);
    if (!hasValue(field, value) || incoming.fieldSources?.[field] === 'user_edit') continue;
    if (field === 'price' && (incoming.priceEstimated || /(?:category|price)_?estimate/i.test(text(incoming.fieldSources?.price)))) continue;
    if (field === 'title' && weakProductTitle(value)) continue;
    if (field === 'imageUrl' && !validProductImage(value)) continue;
    if (field === 'price' && (!text(incoming.currency) || (!context.countryAssumed && context.currencyHint && text(incoming.currency) !== context.currencyHint))) continue;
    if (field === 'currency' && product.price) continue;
    const oldValue = fieldValue(product, field);
    const oldSource = fieldMetadata[field]?.source ?? previous.fieldSources?.[field] ?? '';
    const newSource = incoming.fieldSources?.[field] ?? '';
    const imageRank = (info) => ({ verified_retailer: 4, verified_same_product_cross_locale: 3, verified_manufacturer: 2, verified_exact_product_other_retailer: 1 })[info?.identityBasis] ?? 0;
    const oldRank = sourceStrength(oldSource, field, oldValue) + (field === 'imageUrl' && oldSource === 'firecrawl_image_search' ? imageRank(previous.imageInfo) : 0);
    const newRank = sourceStrength(newSource, field, value) + (field === 'imageUrl' && newSource === 'firecrawl_image_search' ? imageRank(incoming.imageInfo) : 0);
    const oldPriceStale = field === 'price' && (!existing?.priceInfo?.verifiedAt || Date.now() - Date.parse(existing.priceInfo.verifiedAt) >= priceTtlMs);
    const newerObservation = !existing?.priceInfo?.verifiedAt || Date.parse(verifiedAt) >= Date.parse(existing.priceInfo.verifiedAt);
    const refreshedSlug = field === 'title' && oldSource === 'url_slug' && newSource === 'url_slug' && value !== oldValue;
    const replace = !hasValue(field, oldValue) || newRank > oldRank || refreshedSlug || (field === 'price' && newerObservation && priceMarketMatches(existing, context)
      && (newRank === oldRank || (oldPriceStale && newRank >= 60)));
    if (!replace) continue;
    product[field] = value;
    if (field === 'imageUrl') product.imageInfo = incoming.imageInfo;
    product.fieldSources[field] = newSource;
    product.fieldConfidence[field] = incoming.fieldConfidence?.[field] ?? 'MEDIUM';
    fieldMetadata[field] = { source: newSource, confidence: product.fieldConfidence[field], verifiedAt, resolverVersion: RESOLVER_VERSION };
    if (field === 'price') priceAccepted = true;
  }
  if (priceAccepted) {
    product.currency = incoming.currency;
    product.currencyAssumed = Boolean(incoming.currencyAssumed);
    product.variantVerified = Boolean(incoming.variantVerified);
    product.fieldSources.currency = incoming.fieldSources?.currency ?? incoming.fieldSources?.price ?? '';
    product.fieldConfidence.currency = incoming.fieldConfidence?.currency ?? 'HIGH';
    fieldMetadata.currency = { source: product.fieldSources.currency, confidence: product.fieldConfidence.currency, verifiedAt, resolverVersion: RESOLVER_VERSION };
    product.priceEstimated = Boolean(incoming.priceEstimated);
    product.priceReference = incoming.priceReference ?? '';
    product.estimateLow = incoming.estimateLow ?? '';
    product.estimateHigh = incoming.estimateHigh ?? '';
  }
  product.imageIsGuess = product.fieldSources.imageUrl === 'best_guess_image';
  product.imageUrls = unique([product.imageUrl, ...product.imageUrls, ...(incoming.imageUrls ?? [])].filter(validProductImage));
  // Retailer belongs to the original offer URL. A search result's source label
  // can be a manufacturer even when its destination is the retailer page.
  product.retailer = context.retailer;
  product.fieldSources.retailer = 'url_domain';
  product.fieldConfidence.retailer = 'HIGH';
  fieldMetadata.retailer = { source: 'url_domain', confidence: 'HIGH', verifiedAt, resolverVersion: RESOLVER_VERSION };
  for (const field of ['productId', 'sku', 'upc', 'gtin', 'ean', 'styleId', 'variantId', 'locale', 'country']) product[field] ||= incoming[field] ?? context[field] ?? '';
  product.originalUrl = context.canonicalCandidate;
  product.normalizedUrl = context.normalizedUrl;
  product.canonicalUrl = context.canonicalCandidate;
  product.matchedCandidateUrl = incoming.matchedCandidateUrl || previous.matchedCandidateUrl || '';
  product.metadataSource = product.fieldSources.title || product.fieldSources.imageUrl || product.fieldSources.price || 'url_domain';
  const priceSource = product.fieldSources.price;
  const sellerId = new URL(context.normalizedUrl).searchParams.get('selectedSellerId') ?? '';
  const store = new URL(context.normalizedUrl).searchParams.get('pc-express-book') ?? '';
  const priceInfo = product.price && product.currency ? {
    ...(existing?.priceInfo ?? {}), ...(incoming.priceInfo ?? {}),
    amount: product.price, currency: product.currency, retailer: context.retailer,
    market: context.country, seller: sellerId, store,
    verifiedAt: fieldMetadata.price?.verifiedAt ?? existing?.priceInfo?.verifiedAt ?? existing?.resolvedAt ?? '',
    source: priceSource, currencyAssumed: Boolean(incoming.currencyAssumed),
    variantVerified: Boolean(incoming.variantVerified), updatedAt: verifiedAt,
  } : null;
  return {
    canonicalUrl: context.canonicalCandidate, domain: context.baseDomain, productId: context.productId,
    identity: { normalizedUrl: context.normalizedUrl, retailer: context.retailer, market: context.country,
      productId: context.productId, sku: context.sku, upc: context.upc, gtin: context.gtin, ean: context.ean,
      variantId: context.variantId, sellerId },
    product, fieldMetadata, priceInfo, resolverVersion: RESOLVER_VERSION,
    resolvedAt: verifiedAt, expiresAt: existing?.expiresAt ?? verifiedAt,
  };
};

const reconcileSharedRecords = (current, legacy, context, priceTtlMs) => {
  if (!current) return legacy;
  if (!legacy || current === legacy) return current;
  const merged = upsertResolvedProduct(current, legacy.product ?? {}, context, legacy.resolvedAt ?? now(), priceTtlMs);
  merged.expiresAt = new Date(Math.max(Date.parse(current.expiresAt) || 0, Date.parse(legacy.expiresAt) || 0)).toISOString();
  merged.nextEnrichmentAt = current.nextEnrichmentAt ?? legacy.nextEnrichmentAt;
  return merged;
};

const applyUserLocks = (product, options) => {
  const lockedFields = new Set(Array.isArray(options.lockedFields) ? options.lockedFields : []);
  const existing = options.existing && typeof options.existing === 'object' ? options.existing : {};
  for (const field of lockedFields) {
    if (!Object.hasOwn(existing, field)) continue;
    product[field] = existing[field];
    product.fieldSources = { ...product.fieldSources, [field]: 'user_edit' };
    product.fieldConfidence = { ...product.fieldConfidence, [field]: 'HIGH' };
    if (field === 'price') product.priceStale = false;
  }
  if (lockedFields.has('price') && product.price) {
    const editedAt = now();
    product.currencyAssumed = false;
    product.priceInfo = { ...(product.priceInfo ?? {}), amount: product.price, currency: product.currency, source: 'user',
      verifiedAt: editedAt, updatedAt: editedAt, currencyAssumed: false, variantVerified: true };
  }
  product.resolutionStatus = resolutionStatusFor(product);
  return product;
};

const recordRegistry = (state, context, directProduct, fallbackProduct, directFailure, fallbackAttemptedFields) => {
  const key = stateKey(context);
  const record = state.registry[key] ?? {
    domain: context.baseDomain,
    hostnamePattern: context.hostname,
    hostnamePatterns: [context.hostname],
    localePattern: context.locale,
    localePatterns: context.locale ? [context.locale] : [],
    pathPattern: context.pathPattern,
    pathPatterns: [context.pathPattern],
    fields: {},
    firstSeenAt: now(),
    lastUpdatedAt: now(),
  };
  record.hostnamePatterns = unique([...(record.hostnamePatterns ?? []), context.hostname]);
  record.localePatterns = unique([...(record.localePatterns ?? []), context.locale]);
  record.pathPatterns = unique([...(record.pathPatterns ?? []), context.pathPattern]);
  if (directFailure === 'PRODUCT_REMOVED' || directFailure === 'INVALID_URL') {
    record.lastUpdatedAt = now();
    state.registry[key] = record;
    return;
  }
  for (const field of requiredFields) {
    const stats = record.fields[field] ?? { attempts: 0, directAttempts: 0, directSuccesses: 0, fallbackAttempts: 0, fallbackSuccesses: 0, failureClasses: {}, strategy: 'UNKNOWN', probeCounter: 0 };
    stats.attempts += 1;
    stats.directAttempts += 1;
    if (hasValue(field, fieldValue(directProduct, field))) stats.directSuccesses += 1;
    if (fallbackAttemptedFields.has(field)) {
      stats.fallbackAttempts += 1;
      if (hasValue(field, fieldValue(fallbackProduct, field))) stats.fallbackSuccesses += 1;
    }
    const missingFieldFailure = field === 'price' ? 'PRICE_NOT_PRESENT'
      : field === 'imageUrl' ? 'IMAGE_NOT_PRESENT'
        : 'MISSING_STRUCTURED_DATA';
    const classifiedFailure = directFailure || (!hasValue(field, fieldValue(directProduct, field)) ? missingFieldFailure : '');
    if (classifiedFailure && !['PRODUCT_REMOVED', 'INVALID_URL'].includes(classifiedFailure)) stats.failureClasses[classifiedFailure] = (stats.failureClasses[classifiedFailure] ?? 0) + 1;
    stats.strategy = strategyFor(stats);
    stats.probeCounter = (stats.probeCounter + 1) % 10;
    stats.lastAttemptAt = now();
    record.fields[field] = stats;
  }
  record.lastUpdatedAt = now();
  state.registry[key] = record;
};

const saveState = (statePath, state) => {
  try {
    mkdirSync(dirname(statePath), { recursive: true });
    const temporaryPath = `${statePath}.${process.pid}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify(state, null, 2), 'utf8');
    renameSync(temporaryPath, statePath);
  } catch (error) {
    diagnostics('state', 'STATE_SAVE_FAILED', { message: text(error?.message) });
  }
};

export const createProductResolver = ({
  directResolver,
  exactPageResolver,
  renderedResolver = async () => ({}),
  nativeCatalogResolver = async () => ({}),
  lastChanceResolver = async () => ({}),
  searchProviders = [],
  imageResolver,
  statePath = defaultStatePath,
  cacheTtlMs = 6 * 60 * 60 * 1000,
  priceTtlMs = 60 * 60 * 1000,
  partialRetryMs = 5 * 60 * 1000,
  urlValidator = validatePublicUrl,
  directTimeoutMs = 13_000,
  providerTimeoutMs = 10_000,
  maximumCandidates = 25,
  cleanTest = process.env.RESOLVER_CLEAN_TEST === 'true',
}) => {
  const persistState = statePath !== ':memory:' && !cleanTest;
    const state = persistState ? loadState(statePath) : emptyState();
    state.domains ??= {};
    state.negative ??= {};
  const inFlight = new Map();

  const fallback = async (context, missingFields, attemptId, { searchOnly = false } = {}) => {
    diagnostics(attemptId, 'FALLBACK_STARTED', { missingFields });
    let searchOutcome = 'unavailable';
    const providerGroups = [];
    let priceLookupOutcome = 'PRICE_LOOKUP_UNAVAILABLE';
    const sameHmArticle = (candidate) => {
      if (context.baseDomain !== 'hm.com' || !context.productId) return false;
      try {
        const parsed = parseProductUrl(candidate.url);
        return parsed.baseDomain === 'hm.com' && parsed.productId === context.productId;
      } catch { return false; }
    };
    const verify = (candidate) => candidate.providerSource?.startsWith('direct_google_') || sameHmArticle(candidate)
      ? verifyGoogleIdentity(candidate, context) : verifyCandidate(candidate, context);
    const exactGlobalId = (candidate) => ['upc', 'gtin', 'ean'].some((field) => context[field] && text(candidate[field]) && context[field] === text(candidate[field]));
    const fieldDecision = (candidate, verification, field) => {
      if (field === 'price' || field === 'currency') {
        if (verification.conflictingIdentifier) return 'PRODUCT_ID_CONFLICT';
        if (verification.variantConflict) return 'VARIANT_CONFLICT';
        if (!verification.originalDomain) return 'OTHER_SELLER';
        if (!verification.exactIdentifier && !verification.exactCanonical) return 'IDENTITY_UNVERIFIED';
        if (!verification.localeMatch) return 'FOREIGN_MARKET_PRICE';
        const offerMarket = parseProductUrl(candidate.url);
        if (!context.countryAssumed && !offerMarket.countryAssumed && offerMarket.country !== context.country) return 'FOREIGN_MARKET_PRICE';
      }
      if (!hasValue(field, fieldValue(candidate, field))) {
        if (field === 'price' && candidate.rejectionReason && candidate.rejectionReason !== 'PRICE_NOT_FOUND') return candidate.rejectionReason;
        return 'MISSING_FIELD';
      }
      const retailerMatch = candidate.providerSource?.startsWith('direct_google_') || sameHmArticle(candidate)
        ? verification.identityMatch : verification.confidence === 'HIGH';
      if (field === 'imageUrl' && exactGlobalId(candidate) && validProductImage(candidate.imageUrl)) return 'ACCEPTED_EXACT_GLOBAL_ID';
      if (!retailerMatch) return verification.conflictingIdentifier ? 'PRODUCT_ID_CONFLICT'
        : verification.variantConflict ? 'VARIANT_CONFLICT' : verification.originalDomain ? 'IDENTITY_UNVERIFIED' : 'RETAILER_MISMATCH';
      if (field === 'retailer' && text(candidate.retailer).toLowerCase() !== context.retailer.toLowerCase()) return 'RETAILER_LABEL_MISMATCH';
      if (field !== 'price' && field !== 'currency') return 'ACCEPTED';
      const candidateUrl = parseProductUrl(candidate.url);
      if (!verification.sellerMatch) return 'SELLER_MISMATCH';
      if (context.selectedSku && candidateUrl.sku && candidateUrl.sku !== context.selectedSku) return 'SKU_MISMATCH';
      if (context.selectedSku && text(candidate.sku) && text(candidate.sku) !== context.selectedSku) return 'SKU_MISMATCH';
      const exactRetailerIdentity = verification.originalDomain && verification.exactIdentifier && verification.localeMatch;
      if (context.selectedSku && text(candidate.sku) && text(candidate.sku) !== context.selectedSku) return 'SKU_MISMATCH';
      if (context.selectedSku && candidateUrl.sku && candidateUrl.sku !== context.selectedSku) return 'SKU_MISMATCH';
      if (context.selectedSku && !exactRetailerIdentity && ['direct_google_web', 'direct_google_shopping', 'search_result', 'shopping_result', 'google_ai_overview', 'bing_search', 'indexed_search'].includes(candidate.providerSource)
        && !text(candidate.sku) && !candidateUrl.sku) return 'SKU_NOT_VERIFIED';
      if (context.variantId && candidateUrl.variantId && candidateUrl.variantId !== context.variantId) return 'VARIANT_MISMATCH';
      if (context.variantId && !candidateUrl.variantId) return 'VARIANT_NOT_VERIFIED';
      if (context.colorId && candidateUrl.colorId && candidateUrl.colorId !== context.colorId) return 'COLOR_MISMATCH';
      if (context.colorId && !candidateUrl.colorId) return 'COLOR_NOT_VERIFIED';
      if (context.sizeId && candidateUrl.sizeId && candidateUrl.sizeId !== context.sizeId) return 'SIZE_MISMATCH';
      if (context.sizeId && !candidateUrl.sizeId) return 'SIZE_NOT_VERIFIED';
      if (field === 'price' && Number(candidate.price) <= 0) return 'ZERO_OR_INVALID_PRICE';
      if (field === 'price' && candidate.rejectionReason && candidate.rejectionReason !== 'PRICE_NOT_FOUND') return candidate.rejectionReason;
      if (context.currencyHint && !context.countryAssumed && text(candidate.currency).toUpperCase() !== context.currencyHint) return 'CURRENCY_MISMATCH_OR_MISSING';
      if ((candidate.providerSource?.startsWith('direct_google_') || sameHmArticle(candidate)) && !verification.localeMatch) return 'MARKET_MISMATCH';
      return 'ACCEPTED';
    };
    const fieldAllowed = (candidate, verification, field) => fieldDecision(candidate, verification, field).startsWith('ACCEPTED');
    for (const provider of searchProviders) {
      const providerName = provider.kind || provider.constructor.name;
      const alreadyFound = providerGroups.flat();
      const outstanding = missingFields.filter((field) => !alreadyFound.some((candidate) => fieldAllowed(candidate, verify(candidate), field)));
      if (!outstanding.length) {
        diagnostics(attemptId, 'PROVIDER_REJECT', { provider: provider.name || providerName, reason: 'ALL_REQUESTED_FIELDS_ALREADY_VERIFIED', fields: missingFields });
        continue;
      }
      diagnostics(attemptId, 'PROVIDER_START', { provider: providerName, missingFields });
      const priorIdentity = providerGroups.flat().find((candidate) => {
        const verification = verify(candidate);
        return hasValue('title', candidate.title) && (verification.identityMatch || verification.confidence === 'HIGH');
      });
      context.knownTitle ||= priorIdentity?.title || '';
      context.knownBrand ||= priorIdentity?.brand || '';
      if (provider.kind === 'direct-google') {
        const prior = providerGroups.flat();
        const outstanding = missingFields.filter((field) => ['title', 'imageUrl', 'price'].includes(field)
          && !prior.some((candidate) => fieldAllowed(candidate, verify(candidate), field)));
        if (!outstanding.length) {
          diagnostics(attemptId, 'PROVIDER_REJECT', { provider: providerName, reason: 'ALL_REQUESTED_FIELDS_ALREADY_VERIFIED', fields: missingFields });
          continue;
        }
        context.knownTitle ||= prior.find((candidate) => fieldAllowed(candidate, verify(candidate), 'title'))?.title || '';
        diagnostics(attemptId, 'FIELD_COMPLETION', { resultState: 'partial', continuingFor: outstanding, direct: missingFields });
      }
      try {
        const candidates = await withTimeout(
          Promise.resolve().then(() => provider.resolveProductCandidates(context, { missingFields: outstanding, attemptId, cleanTest })),
          providerTimeoutMs,
        );
        if (candidates?.searchOutcome) searchOutcome = candidates.searchOutcome;
        else if (Array.isArray(candidates)) searchOutcome = candidates.length ? 'results' : 'empty';
        if (candidates?.priceLookupOutcome) priceLookupOutcome = candidates.priceLookupOutcome;
        else if (Array.isArray(candidates)) priceLookupOutcome = 'PRICE_NOT_FOUND';
        const normalizedCandidates = Array.isArray(candidates) ? candidates.map((candidate) => normalizeProviderCandidate(candidate, provider)) : [];
        providerGroups.push(normalizedCandidates.slice(0, maximumCandidates));
        diagnostics(attemptId, 'PROVIDER_RESULT', { provider: providerName, candidateCount: Array.isArray(candidates) ? candidates.length : 0,
          fields: normalizedCandidates.length ? requiredFields.filter((field) => normalizedCandidates.some((candidate) => hasValue(field, fieldValue(candidate, field)))) : [] });
        if (!Array.isArray(candidates) || candidates.length === 0) diagnostics(attemptId, 'PROVIDER_REJECT', { provider: providerName, reason: 'NO_CANDIDATES' });
        if (provider.kind === 'serpapi') diagnostics(attemptId, 'SERPAPI_STATE', { state: provider.state, reason: provider.lastFailureReason,
          fallback: provider.state === 'available' ? '' : 'direct-google' });
      } catch (error) {
        const timeout = failureClass(error) === 'TIMEOUT';
        diagnostics(attemptId, timeout ? 'PROVIDER_TIMEOUT' : 'PROVIDER_ERROR', {
          provider: providerName, reason: text(error?.message) || failureClass(error), failureClass: failureClass(error),
        });
        providerGroups.push([]);
      }
    }
    const candidates = roundRobinCandidates(providerGroups, maximumCandidates);
    candidates.forEach((candidate) => diagnostics(attemptId, 'CANDIDATE_FOUND', { source: candidate.providerSource }));
    const verified = candidates.map((candidate) => ({ candidate, verification: verify(candidate), globalImageOnly: exactGlobalId(candidate) }))
      .sort((left, right) => right.verification.score - left.verification.score);
    for (const { candidate, verification } of verified) {
      if (candidate.price || candidate.providerPrice || candidate.rejectionReason && candidate.rejectionReason !== 'PRICE_NOT_FOUND') {
        const reason = fieldDecision(candidate, verification, 'price');
        const accepted = reason === 'ACCEPTED';
        diagnostics(attemptId, 'PRICE_CANDIDATE', { provider: candidate.provider, source: candidate.providerSource,
          sourcePageUrl: candidate.url, retailer: verification.originalDomain ? context.retailer : candidate.retailer,
          productId: candidate.productId || '', identity: verification.conflictingIdentifier ? 'PRODUCT_ID_CONFLICT' : verification.exactIdentifier ? 'EXACT_PRODUCT' : verification.exactCanonical ? 'EXACT_PAGE' : 'IDENTITY_UNVERIFIED',
          market: verification.localeMatch ? context.country : 'FOREIGN', price: candidate.price || '', currency: candidate.currency || '',
          offerType: candidate.offerType || 'CURRENT_PRICE', accepted, confidence: accepted && verification.confidence === 'HIGH' ? 'HIGH' : 'LOW', reason: accepted ? 'CURRENT_EXACT_MARKET_OFFER' : reason });
      }
    }
    if (process.env.DEBUG_RESOLVER === '1') for (const { candidate, verification } of verified) {
      for (const field of missingFields) diagnostics(attemptId, 'CANDIDATE_FIELD_DECISION', {
        provider: candidate.providerSource, field, decision: fieldDecision(candidate, verification, field),
        candidateUrl: candidate.url, candidateValue: field === 'imageUrl' ? Boolean(candidate.imageUrl) : fieldValue(candidate, field),
        productIdMatch: verification.exactIdentifier, domainMatch: verification.originalDomain,
      });
    }
    verified.forEach(({ candidate, verification, globalImageOnly }) => diagnostics(attemptId,
      globalImageOnly || ((candidate.providerSource?.startsWith('direct_google_') || sameHmArticle(candidate))
        ? verification.identityMatch : verification.confidence !== 'LOW') ? 'CANDIDATE_VERIFIED' : 'CANDIDATE_REJECTED', {
      score: verification.score,
      source: candidate.providerSource,
      provider: candidate.provider,
      candidateUrl: candidate.url,
      candidateProductId: candidate.productId,
      domainMatch: verification.originalDomain,
      productIdMatch: verification.exactIdentifier,
      acceptedFields: missingFields.filter((field) => fieldAllowed(candidate, verification, field)),
      reason: globalImageOnly ? 'EXACT_GLOBAL_IDENTIFIER_IMAGE_ONLY'
        : sameHmArticle(candidate) && verification.identityMatch && !verification.localeMatch
          ? 'EXACT_ARTICLE_FOREIGN_MARKET_TITLE_IMAGE_ONLY'
          : verification.confidence === 'LOW'
            ? verification.conflictingIdentifier ? 'PRODUCT_ID_CONFLICT' : verification.variantConflict ? 'VARIANT_CONFLICT'
              : !verification.originalDomain ? 'RETAILER_MISMATCH' : 'IDENTITY_UNVERIFIED' : 'IDENTITY_VERIFIED',
    }));
    const accepted = verified.filter(({ candidate, verification, globalImageOnly }) => globalImageOnly || (candidate.providerSource?.startsWith('direct_google_') || sameHmArticle(candidate)
      ? verification.identityMatch : verification.confidence !== 'LOW'));
    if (!accepted.length) return { searchOutcome, priceLookupOutcome: searchOutcome === 'unavailable' ? 'PRICE_LOOKUP_UNAVAILABLE' : priceLookupOutcome };
    // An indexed H&M article in another locale can expose the product page
    // even when the Canadian page is blocked. Reuse identity and media only.
    if (!searchOnly && context.baseDomain === 'hm.com' && missingFields.some((field) => ['title', 'imageUrl'].includes(field))) {
      const fetched = new Set();
      for (const { candidate, verification } of accepted) {
        if (fetched.size >= 2 || !sameHmArticle(candidate) || verification.localeMatch || fetched.has(candidate.url)) continue;
        fetched.add(candidate.url);
        try {
          const page = await withTimeout(Promise.resolve().then(() => directResolver(parseProductUrl(candidate.url))), directTimeoutMs);
          if (page?.title && !weakProductTitle(page.title)) {
            candidate.title = page.title;
            candidate.fieldSources = { ...candidate.fieldSources, title: 'hm_cross_locale_page' };
          }
          const images = unique([page?.imageUrl, ...(page?.imageUrls ?? [])].filter(validProductImage));
          if (images.length) {
            candidate.imageUrl = images[0];
            candidate.imageUrls = images;
            candidate.fieldSources = { ...candidate.fieldSources, imageUrl: 'hm_cross_locale_page' };
          }
          diagnostics(attemptId, 'HM_CROSS_LOCALE_PAGE', { result: 'success', title: Boolean(page?.title), image: Boolean(images.length) });
        } catch (error) { diagnostics(attemptId, 'HM_CROSS_LOCALE_PAGE', { result: failureClass(error) }); }
      }
    }
    diagnostics(attemptId, 'CANDIDATE_SELECTED', { candidateCount: candidates.length, selectedCandidate: candidates.indexOf(accepted[0].candidate) + 1, productIdMatch: accepted[0].verification.exactIdentifier, domainMatch: accepted[0].verification.originalDomain });
    const result = { fieldSources: {}, fieldConfidence: {}, matchedCandidateUrl: accepted[0].candidate.url, searchOutcome, priceLookupOutcome };
    // Colour must be available before title cleanup so a leading colour label
    // can be removed without changing the underlying candidate data.
    const requestedFields = new Set(['color', ...missingFields]);
    for (const field of requestedFields) {
      const sourcePriority = field === 'title'
        ? { search_result: 70, shopping_result: 65, direct_google_web: 60, direct_google_shopping: 55, indexed_search: 45, bing_search: 40, image_search: 30 }
        : { retailer_sku_asset: 95, search_result: 75, direct_google_web: 70, shopping_result: 65, direct_google_shopping: 60, indexed_image: 50, indexed_search: 45, bing_search: 40, image_search: 30 };
      const fieldCandidates = [...accepted].sort((a, b) => (sourcePriority[b.candidate.providerSource] ?? 0) - (sourcePriority[a.candidate.providerSource] ?? 0)
        || b.verification.score - a.verification.score);
      const match = fieldCandidates.find(({ candidate, verification, globalImageOnly }) => (!globalImageOnly || field === 'imageUrl') && fieldAllowed(candidate, verification, field));
      if (!match) continue;
      const value = fieldValue(match.candidate, field);
      const confidence = match.globalImageOnly || match.verification.identityMatch ? 'HIGH' : match.verification.confidence;
      if (field === 'imageUrl' && !validProductImage(value)) continue;
      if (!canMergeFallbackField(field, confidence)) continue;
      if (field === 'price' && confidence === 'MEDIUM') result.priceEstimated = true;
      applyField(result, field, value, match.candidate.fieldSources?.[field] ?? match.candidate.providerSource, confidence);
      if (field === 'price') {
        result.currencyAssumed = Boolean(match.candidate.currencyAssumed);
        result.variantVerified = !context.variantId && !context.colorId && !context.sizeId
          || Boolean(match.verification.exactIdentifier && match.verification.localeMatch && match.verification.originalDomain);
        result.priceInfo = { amount: value, currency: match.candidate.currency, provider: match.candidate.provider,
          sourcePageUrl: match.candidate.url, identityBasis: 'exact_product_same_market', sellerVerified: true,
          marketVerified: true, currentOfferVerified: true, offerType: match.candidate.offerType || 'CURRENT_PRICE',
          verifiedAt: now(), currencyAssumed: Boolean(match.candidate.currencyAssumed), variantVerified: result.variantVerified };
        result.priceLookupOutcome = 'PRICE_FOUND';
      }
    }
    const imageUrls = unique(accepted.filter(({ candidate, verification }) => fieldAllowed(candidate, verification, 'imageUrl'))
      .flatMap(({ candidate }) => [candidate.imageUrl, ...(candidate.imageUrls ?? [])]).filter(validProductImage));
    if (imageUrls.length) result.imageUrls = imageUrls;
    result.priceReference = result.price
      ? result.priceEstimated ? 'Estimated from a verified product listing' : 'Verified product listing price'
      : '';
    diagnostics(attemptId, 'PRICE_LOOKUP_STATE', { status: result.priceLookupOutcome, priceFound: Boolean(result.price) });
    return result;
  };

  const resolveProductCore = async (rawUrl, options = {}) => {
    const attemptId = crypto.randomUUID();
    const attemptStartedAt = now();
    let context;
    try {
      context = parseProductUrl(rawUrl);
      const preferredCurrency = text(options.preferredCurrency).toUpperCase();
      context.preferredSize = text(options.preferredSize);
      context.sizePreferences = options.sizePreferences && typeof options.sizePreferences === 'object' ? options.sizePreferences : {};
      if (!context.currencyHint && /^[A-Z]{3}$/.test(preferredCurrency)) {
        context.currencyHint = preferredCurrency;
        context.country = ({ CAD: 'CA', USD: 'US', GBP: 'GB', AUD: 'AU', NZD: 'NZ', JPY: 'JP' })[preferredCurrency] ?? context.country;
      }
      await urlValidator(context.normalizedUrl);
    } catch (error) {
      diagnostics(attemptId, 'RESOLUTION_FAILED', { failureClass: failureClass(error) });
      throw new Error('Please provide a public http(s) product link.');
    }
    diagnostics(attemptId, 'URL_PARSED', { domain: context.baseDomain, hostname: context.hostname, pathPattern: context.pathPattern,
      productId: context.productId, sku: context.sku, locale: context.locale,
      ...(process.env.DEBUG_RESOLVER === '1' ? { originalUrl: context.originalUrl, normalizedUrl: context.normalizedUrl } : {}) });
    const sizeProfileKey = ['generalClothing', 'tops', 'bottoms', 'dresses', 'shoes', 'top', 'bottom', 'dress', 'shoe']
      .map((field) => {
        const preference = context.sizePreferences?.[field];
        return preference && typeof preference === 'object'
          ? `${text(preference.system).toLowerCase()}:${text(preference.value).toLowerCase()}`
          : text(preference).toLowerCase();
      })
      .join('|');
    const key = `${productKey(context)}${context.preferredSize || sizeProfileKey ? `::size:${context.preferredSize.toLowerCase()}:${sizeProfileKey}` : ''}`;
    const fieldCompleteness = (product) => ({
      identityComplete: Boolean(context.retailer && (context.productId || context.sku || context.upc || context.gtin || context.ean)),
      metadataComplete: hasValue('title', fieldValue(product, 'title')) && hasValue('imageUrl', fieldValue(product, 'imageUrl')),
      offerComplete: hasValue('price', fieldValue(product, 'price')) && /^[A-Z]{3}$/.test(text(product?.currency))
        && Boolean(context.retailer && context.country),
    });
    // The JSON product store is authoritative. This process's loaded copy is
    // only a cache: another process or a maintenance task may have enriched it.
    if (persistState) {
      const persisted = loadState(statePath);
      state.products = persisted.products;
    }
    const legacyKey = legacyProductKey(context);
    const storedCached = reconcileSharedRecords(state.products[key], state.products[legacyKey], context, priceTtlMs);
    const cached = !options.searchOnly ? storedCached : undefined;
    const legacyVersion = Boolean(cached && cached.resolverVersion !== RESOLVER_SCHEMA_VERSION);
    const negative = state.negative[key];
    if (!options.force && !options.searchOnly && !options.directOnly && negative?.resolverVersion === RESOLVER_SCHEMA_VERSION && Date.now() < Date.parse(negative.expiresAt)) {
      diagnostics(attemptId, 'NEGATIVE_CACHE_HIT', { domain: context.baseDomain });
      return applyUserLocks({ originalUrl: context.originalUrl, normalizedUrl: context.normalizedUrl,
        canonicalUrl: context.canonicalCandidate, retailer: context.retailer, productId: context.productId,
        currency: context.currencyHint, resolutionStatus: 'UNRESOLVED', fieldSources: { retailer: 'url_domain', currency: 'url_locale' },
        fieldConfidence: { retailer: 'HIGH', currency: 'HIGH' }, priceLookupOutcome: 'PRICE_NOT_FOUND', urlIntelligence: context, cacheHit: true }, options);
    }
    const cachedWeakTitle = Boolean(cached?.product && weakProductTitle(cached.product.title) && cached.product.fieldSources?.title !== 'user_edit');
    if (cachedWeakTitle) {
      cached.product.title = '';
      delete cached.fieldMetadata?.title;
      delete cached.product.fieldSources?.title;
      delete cached.product.fieldConfidence?.title;
    }
    const cachedCoreComplete = ['title', 'imageUrl', 'price', 'currency'].every((field) => resolvedField(cached?.product, field));
    const priceFresh = Boolean(cached?.priceInfo?.verifiedAt && Date.now() - Date.parse(cached.priceInfo.verifiedAt) < priceTtlMs);
    if (!options.force && !options.searchOnly && !options.directOnly && !legacyVersion && cached?.resolverVersion === RESOLVER_VERSION && cachedCoreComplete && priceFresh && Date.now() < Date.parse(cached.expiresAt)) {
      diagnostics(attemptId, 'CACHE_HIT', { domain: context.baseDomain });
      return applyUserLocks({
        ...cached.product,
        priceInfo: cached.priceInfo ?? null,
        resolutionStatus: resolutionStatusFor(cached.product),
        originalUrl: context.originalUrl,
        normalizedUrl: context.normalizedUrl,
        canonicalUrl: context.canonicalCandidate,
        urlIntelligence: context,
        cacheHit: true,
      }, options);
    }
    if (!options.force && !options.searchOnly && !options.directOnly && !legacyVersion && !cachedWeakTitle && cached?.resolverVersion === RESOLVER_VERSION && !cachedCoreComplete && Date.now() < Date.parse(cached.nextEnrichmentAt) && Date.now() < Date.parse(cached.expiresAt)) {
      diagnostics(attemptId, 'CACHE_PARTIAL_COOLDOWN', { domain: context.baseDomain });
      return applyUserLocks({ ...cached.product,
        priceInfo: cached.priceInfo ?? null,
        priceStale: Boolean(cached.product.price && !priceFresh),
        resolutionStatus: resolutionStatusFor({ ...cached.product, priceStale: Boolean(cached.product.price && !priceFresh) }),
        originalUrl: context.originalUrl, urlIntelligence: context, cacheHit: true }, options);
    }
    diagnostics(attemptId, 'CACHE_MISS', { domain: context.baseDomain, reason: cached ? 'incomplete_stale_or_old_version' : 'new_product' });

    let directProduct = {};
    let directFailure = '';
    const fallbackAttemptedFields = new Set();
    const domainHealth = state.domains[context.baseDomain] ?? { attempts: [], strikes: 0, cooldownUntil: 0, probeInFlight: false };
    state.domains[context.baseDomain] = domainHealth;
    const cooldownActive = Date.now() < domainHealth.cooldownUntil;
    const directProbeAllowed = !cooldownActive && (!domainHealth.cooldownUntil || !domainHealth.probeInFlight);
    const directAttempt = async () => {
      if (!directProbeAllowed) {
        diagnostics(attemptId, 'DIRECT_SKIPPED_DOMAIN_COOLDOWN', { domain: context.baseDomain, cooldownUntil: domainHealth.cooldownUntil });
        return directProduct;
      }
      const wasProbe = Boolean(domainHealth.cooldownUntil);
      if (wasProbe) domainHealth.probeInFlight = true;
      diagnostics(attemptId, 'DIRECT_STARTED');
      try {
        const result = await withTimeout(
          Promise.resolve().then(() => directResolver(context)),
          directTimeoutMs,
        );
        // Validation may clear an offer; never change an extractor's shared object.
        directProduct = { ...(result ?? {}), fieldSources: { ...(result?.fieldSources ?? {}) },
          fieldConfidence: { ...(result?.fieldConfidence ?? {}) }, imageUrls: [...(result?.imageUrls ?? [])] };
        if (directProduct.price && !context.countryAssumed && context.currencyHint && directProduct.currency && text(directProduct.currency).toUpperCase() !== context.currencyHint) {
          diagnostics(attemptId, 'DIRECT_PRICE_REJECTED', { reason: 'CURRENCY_MISMATCH', currency: text(directProduct.currency).toUpperCase(), expected: context.currencyHint });
          directProduct.price = '';
          directProduct.currency = '';
        }
        if (directProduct.price && directProduct.currencyAssumed && context.countryAssumed) {
          diagnostics(attemptId, 'DIRECT_PRICE_REJECTED', { reason: 'CURRENCY_UNVERIFIED' });
          directProduct.price = '';
          directProduct.currency = '';
        }
        if (directProduct.price && (context.variantId || context.colorId || context.sizeId) && !directProduct.variantVerified) {
          diagnostics(attemptId, 'DIRECT_PRICE_REJECTED', { reason: 'VARIANT_NOT_VERIFIED' });
          directProduct.price = '';
        }
        for (const field of requiredFields) diagnostics(attemptId, hasValue(field, fieldValue(directProduct, field)) ? 'DIRECT_FIELD_FOUND' : 'DIRECT_FIELD_MISSING', { field });
      } catch (error) {
        directFailure = failureClass(error);
        diagnostics(attemptId, directFailure === 'HTTP_403' || directFailure === 'BOT_CHALLENGE' ? 'DIRECT_BLOCKED' : 'DIRECT_FAILED', { failureClass: directFailure });
      }
      const directUseful = Boolean(directProduct.title || directProduct.imageUrl || directProduct.price);
      domainHealth.attempts = [...(domainHealth.attempts ?? []), { success: directUseful, at: now() }].slice(-10);
      domainHealth.probeInFlight = false;
      if (directUseful) {
        domainHealth.strikes = 0;
        domainHealth.cooldownUntil = 0;
        domainHealth.attempts = [];
      } else {
        if (wasProbe) domainHealth.strikes = Math.min(3, (domainHealth.strikes ?? 1) + 1);
        const failures = domainHealth.attempts.filter((entry) => !entry.success).length;
        if (domainHealth.attempts.length >= 4 && failures / domainHealth.attempts.length >= 0.75) {
          domainHealth.strikes = Math.max(1, domainHealth.strikes ?? 0);
          const cooldownMs = [24, 72, 168][Math.min(2, domainHealth.strikes - 1)] * 60 * 60_000;
          domainHealth.cooldownUntil = Date.now() + cooldownMs;
        }
      }
      return directProduct;
    };

    let fallbackProduct = {};
    if (!options.searchOnly) await directAttempt();
    let exactPageOutcome;
    if (exactPageResolver && !options.searchOnly && !options.directOnly
      && ['title', 'imageUrl', 'price', 'currency'].some((field) => !resolvedField(directProduct, field)
        && !((field !== 'price' || priceFresh) && resolvedField(cached?.product, field)))) {
      diagnostics(attemptId, 'EXACT_PAGE_ENRICHMENT_STARTED', { provider: 'firecrawl_scrape' });
      try {
        const scraped = await withTimeout(Promise.resolve().then(() => exactPageResolver(context)), 23_000);
        exactPageOutcome = scraped.priceLookupOutcome;
        for (const field of ['productId', 'sku', 'gtin', 'mpn', 'color', 'availability', 'variantVerified']) if (scraped[field]) directProduct[field] ||= scraped[field];
        directProduct.exactPageTrace = scraped.exactPageTrace;
        for (const field of ['title', 'imageUrl', 'price', 'currency']) {
          if (!resolvedField(directProduct, field) && resolvedField(scraped, field)) {
            directProduct[field] = scraped[field];
            directProduct.fieldSources = { ...directProduct.fieldSources, [field]: 'firecrawl_scrape' };
            if (field === 'price') { directProduct.priceInfo = scraped.priceInfo; directProduct.currency = scraped.currency; directProduct.fieldSources.currency = 'firecrawl_scrape'; }
            if (field === 'imageUrl') { directProduct.imageUrls = scraped.imageUrls; directProduct.imageInfo = scraped.imageInfo; }
          }
        }
        diagnostics(attemptId, 'EXACT_PAGE_ENRICHMENT_RESULT', { status: exactPageOutcome, reason: scraped.rejectionReason,
          ...scraped.exactPageTrace, title: scraped.title, image: Boolean(scraped.imageUrl), price: scraped.price });
      } catch (error) {
        exactPageOutcome = 'PRICE_LOOKUP_UNAVAILABLE';
        diagnostics(attemptId, 'EXACT_PAGE_ENRICHMENT_RESULT', { status: exactPageOutcome, reason: error.message, httpStatus: error.status, provider: 'firecrawl_scrape' });
      }
    }
    directProduct.currencyAssumed = Boolean(directProduct.currencyAssumed || (directProduct.price && directProduct.fieldSources?.currency === 'url_locale'));
    const incomplete = (product) => ['title', 'imageUrl', 'price', 'currency'].some((field) => !resolvedField(product, field));
    if (!options.searchOnly && incomplete(directProduct)) {
      for (const [stage, resolver] of [['RENDERED', renderedResolver], ['NATIVE_SEARCH', nativeCatalogResolver]]) {
        if (!incomplete(directProduct)) break;
        diagnostics(attemptId, 'PROVIDER_START', { provider: stage.toLowerCase(), reason: 'DIRECT_FIELDS_INCOMPLETE' });
        try {
          const enriched = await withTimeout(Promise.resolve().then(() => resolver(context)), stage === 'RENDERED' ? 23000 : 19000);
          for (const field of [...requiredFields, 'color', 'size', 'availability']) {
            if (resolvedField(enriched, field)) {
              const oldSource = directProduct.fieldSources?.[field] || (directProduct[field] ? 'retailer_structured_data' : '');
              const newSource = enriched.fieldSources?.[field] ?? stage.toLowerCase();
              const mayReplace = !resolvedField(directProduct, field) || sourceStrength(newSource, field, enriched[field]) > sourceStrength(oldSource, field, directProduct[field]);
              if (!mayReplace) continue;
              directProduct[field] = enriched[field];
              directProduct.fieldSources = { ...directProduct.fieldSources, [field]: newSource };
            }
          }
          directProduct.imageUrls = unique([...(directProduct.imageUrls ?? []), ...(enriched?.imageUrls ?? [])]);
          for (const field of ['sku', 'upc', 'gtin', 'ean', 'productId']) directProduct[field] ||= enriched?.[field] || '';
          diagnostics(attemptId, `${stage}_RESULT`, { title: Boolean(enriched?.title), image: Boolean(enriched?.imageUrl), imageCount: enriched?.imageUrls?.length ?? 0, price: Boolean(enriched?.price), currency: enriched?.currency ?? '' });
        } catch (error) {
          const timeout = failureClass(error) === 'TIMEOUT';
          diagnostics(attemptId, timeout ? 'PROVIDER_TIMEOUT' : 'PROVIDER_ERROR', { provider: stage.toLowerCase(),
            reason: text(error?.message) || failureClass(error), failureClass: failureClass(error) });
          diagnostics(attemptId, `${stage}_FAILED`, { failureClass: failureClass(error) });
        }
      }
    }
    context.selectedSku = context.sku;
    context.productId ||= text(directProduct.productId);
    context.sku ||= text(directProduct.sku);
    context.knownTitle = text(directProduct.title || (resolvedField(cached?.product, 'title') ? cached?.product?.title : ''));
    context.knownBrand = text(directProduct.brand || (resolvedField(cached?.product, 'brand') ? cached?.product?.brand : ''));
    for (const field of ['upc', 'gtin', 'ean']) context[field] ||= text(directProduct[field]);
    if (!options.searchOnly) diagnostics(attemptId, 'DIRECT_FIELD_STATE', { title: Boolean(directProduct.title), image: Boolean(directProduct.imageUrl), price: Boolean(directProduct.price), productId: Boolean(context.productId || directProduct.productId), sku: Boolean(context.sku || directProduct.sku) });
    diagnostics(attemptId, 'FIELD_COMPLETENESS', fieldCompleteness(directProduct));
    const combinedResolved = (field) => resolvedField(directProduct, field) || (field !== 'price' || priceFresh) && resolvedField(cached?.product, field);
    const coreMissing = ['title', 'imageUrl', 'price'].some((field) => !combinedResolved(field));
    if (coreMissing && !options.directOnly) {
      const missing = requiredFields.filter((field) => !combinedResolved(field));
      diagnostics(attemptId, 'RESOLUTION_FIELD_STATE', { retailer: context.retailer, productId: context.productId, sku: context.sku, resultState: 'partial', title: Boolean(directProduct.title), image: Boolean(directProduct.imageUrl), price: Boolean(directProduct.price), continuingFor: missing });
      missing.forEach((field) => fallbackAttemptedFields.add(field));
      const resolverMissing = options.imageOnly ? missing.filter((field) => !['price', 'currency'].includes(field))
        : options.priceOnly ? missing.filter((field) => field !== 'imageUrl') : missing;
      fallbackProduct = await fallback(context, resolverMissing, attemptId, { searchOnly: options.searchOnly });
      const lastChanceMissing = resolverMissing.filter((field) => !resolvedField(fallbackProduct, field));
      if (!options.searchOnly && lastChanceMissing.includes('imageUrl')) {
        diagnostics(attemptId, 'PROVIDER_START', { provider: 'retailer-image-fallback', missingFields: lastChanceMissing });
        try {
          const enriched = await withTimeout(Promise.resolve().then(() => lastChanceResolver(context, lastChanceMissing, directProduct)), 14_000);
          for (const field of ['brand', 'imageUrl', 'price']) {
            if (!lastChanceMissing.includes(field) || !resolvedField(enriched, field) || resolvedField(fallbackProduct, field)) continue;
            const confidence = enriched.fieldConfidence?.[field] ?? (field === 'brand' ? 'MEDIUM' : field === 'price' ? 'LOW' : 'LOW');
            if (!canMergeFallbackField(field, confidence)) {
              diagnostics(attemptId, 'PROVIDER_REJECT', { provider: 'retailer-image-fallback', field, reason: 'LOW_CONFIDENCE_UNVERIFIED', confidence });
              continue;
            }
            if (field === 'price' && (enriched.priceEstimated || enriched.fieldConfidence?.price !== 'HIGH')) {
              diagnostics(attemptId, 'PROVIDER_REJECT', { provider: 'retailer-image-fallback', field, reason: 'PRICE_NOT_VERIFIED_OFFER' });
              continue;
            }
            fallbackProduct[field] = enriched[field];
            fallbackProduct.fieldSources = { ...fallbackProduct.fieldSources, [field]: enriched.fieldSources?.[field] ?? (field === 'brand' ? 'retailer_search_brand' : 'retailer_search_estimate') };
            fallbackProduct.fieldConfidence = { ...fallbackProduct.fieldConfidence, [field]: enriched.fieldConfidence?.[field] ?? (field === 'imageUrl' ? 'LOW' : 'MEDIUM') };
          }
          fallbackProduct.imageUrls = unique([...(fallbackProduct.imageUrls ?? []), ...(enriched.imageUrls ?? [])]);
          fallbackProduct.priceEstimated = Boolean(enriched.priceEstimated);
          fallbackProduct.estimateLow = enriched.estimateLow ?? '';
          fallbackProduct.estimateHigh = enriched.estimateHigh ?? '';
          fallbackProduct.priceReference = enriched.priceReference ?? '';
          fallbackProduct.imageIsGuess = Boolean(enriched.imageIsGuess);
          if (lastChanceMissing.includes('price') && enriched.price && /^[A-Z]{3}$/.test(text(enriched.currency))) {
            fallbackProduct.currency = enriched.currency;
            fallbackProduct.fieldSources = { ...fallbackProduct.fieldSources, currency: 'retailer_price_estimate' };
            fallbackProduct.fieldConfidence = { ...fallbackProduct.fieldConfidence, currency: 'MEDIUM' };
          }
          diagnostics(attemptId, 'PROVIDER_RESULT', { provider: 'retailer-image-fallback', fields: lastChanceMissing.filter((field) => resolvedField(enriched, field)),
            priceEstimated: Boolean(enriched.priceEstimated), imageIsGuess: Boolean(enriched.imageIsGuess) });
          for (const field of lastChanceMissing) if (!resolvedField(enriched, field)) diagnostics(attemptId, 'PROVIDER_REJECT', {
            provider: 'retailer-image-fallback', field, reason: field === 'price' ? 'NO_VERIFIED_OFFER' : 'NO_RELEVANT_IMAGE',
          });
        } catch (error) {
          const timedOut = failureClass(error) === 'TIMEOUT';
          diagnostics(attemptId, timedOut ? 'PROVIDER_TIMEOUT' : 'PROVIDER_ERROR', { provider: 'retailer-image-fallback',
            reason: text(error?.message) || failureClass(error), failureClass: failureClass(error) });
        }
      }
    }

    const final = {
      title: '', brand: '', retailer: '', imageUrl: '', imageUrls: [], price: '', currency: '',
      color: '', variant: '', size: '', availability: '', fieldSources: {}, fieldConfidence: {},
      originalUrl: context.originalUrl,
      normalizedUrl: context.normalizedUrl,
      canonicalUrl: context.canonicalCandidate,
      productId: context.productId || text(directProduct.productId),
      sku: context.sku || text(directProduct.sku),
      upc: context.upc || '',
      gtin: context.gtin || '',
      ean: context.ean || '',
      styleId: context.styleId,
      variantId: context.variantId,
      locale: context.locale,
      country: context.country,
      priceEstimated: false,
      currencyAssumed: false,
      priceReference: '',
      estimateLow: '',
      estimateHigh: '',
      imageIsGuess: false,
      matchedCandidateUrl: fallbackProduct.matchedCandidateUrl ?? '',
      metadataSource: '',
    };
    for (const field of [...requiredFields, 'color', 'variant', 'size', 'availability']) {
      const directValue = fieldValue(directProduct, field);
      const fallbackValue = fieldValue(fallbackProduct, field);
      if (applyField(final, field, directValue, directProduct.fieldSources?.[field] ?? 'retailer_page', 'HIGH')) {
        if (field === 'price') {
          final.currencyAssumed = Boolean(directProduct.currencyAssumed);
          final.variantVerified = Boolean(directProduct.variantVerified);
        }
        diagnostics(attemptId, 'FIELD_MERGED', { field, source: final.fieldSources[field] });
      }
      else {
        const fallbackConfidence = fallbackProduct.fieldConfidence?.[field] ?? 'MEDIUM';
        if (canMergeFallbackField(field, fallbackConfidence, fallbackProduct.fieldSources?.[field])
          && applyField(final, field, fallbackValue, fallbackProduct.fieldSources?.[field] ?? 'search_result', fallbackConfidence)) {
          if (field === 'price') {
            final.currencyAssumed = Boolean(fallbackProduct.currencyAssumed);
            final.variantVerified = Boolean(fallbackProduct.variantVerified);
          }
          diagnostics(attemptId, 'FIELD_MERGED', { field, source: final.fieldSources[field] });
        }
      }
    }
    if (!final.retailer) {
      final.retailer = context.retailer;
      final.fieldSources.retailer = 'url_domain';
      final.fieldConfidence.retailer = 'HIGH';
    }
    if (!final.title && context.slug && context.slug.split(/\s+/).some((word) => word.length >= 3)) {
      final.title = context.slug.replace(/\b\w/g, (letter) => letter.toUpperCase());
      final.fieldSources.title = 'url_slug';
      final.fieldConfidence.title = 'LOW';
    }
    if (!final.brand) {
      final.brand = final.retailer;
      final.fieldSources.brand = 'url_domain';
      final.fieldConfidence.brand = 'MEDIUM';
    }
    if (!final.currency) {
      final.currency = context.currencyHint;
      if (final.currency) {
        final.fieldSources.currency = 'url_locale';
        final.fieldConfidence.currency = 'HIGH';
      }
    }
    if (!/^[A-Z]{3}$/.test(final.currency)) {
      final.currency = context.currencyHint || '';
      if (final.currency) {
        final.fieldSources.currency = 'url_locale';
        final.fieldConfidence.currency = 'HIGH';
      }
    }
    final.imageUrls = unique([...(directProduct.imageUrls ?? []), ...(fallbackProduct.imageUrls ?? []), final.imageUrl].filter((value) => /^https?:\/\//i.test(value)));
    final.priceEstimated = !directProduct.price && Boolean(fallbackProduct.priceEstimated);
    final.priceReference = directProduct.price ? '' : text(fallbackProduct.priceReference);
    final.estimateLow = directProduct.price ? '' : text(fallbackProduct.estimateLow);
    final.estimateHigh = directProduct.price ? '' : text(fallbackProduct.estimateHigh);
    final.imageIsGuess = !directProduct.imageUrl && Boolean(fallbackProduct.imageIsGuess);
    final.metadataSource = final.fieldSources.title || final.fieldSources.imageUrl || final.fieldSources.price || 'url_domain';

    final.imageInfo = directProduct.imageInfo ?? fallbackProduct.imageInfo;
    final.priceInfo = directProduct.priceInfo ?? fallbackProduct.priceInfo;
    if (final.price && final.currency && !final.priceInfo) final.priceInfo = {
      amount: final.price, currency: final.currency, provider: final.fieldSources.price, sourcePageUrl: context.normalizedUrl,
      identityBasis: 'exact_product_same_market', sellerVerified: true, marketVerified: !context.countryAssumed,
      currentOfferVerified: true, offerType: 'CURRENT_PRICE', verifiedAt: attemptStartedAt,
      currencyAssumed: Boolean(final.currencyAssumed), variantVerified: Boolean(final.variantVerified),
    };
    if (!options.priceOnly && (!final.imageUrl || final.imageIsGuess || final.fieldConfidence.imageUrl === 'LOW') && imageResolver && !options.directOnly && !options.skipImageSearch) {
      try {
        const found = await imageResolver.resolve(context, { ...final, imageUrl: '' }, { attemptId });
        if (found?.imageUrl) {
          applyField(final, 'imageUrl', found.imageUrl, 'firecrawl_image_search', found.confidence);
          final.imageInfo = found.imageInfo;
          final.imageIsGuess = false;
          final.imageUrls = unique([...final.imageUrls, found.imageUrl]);
        }
      } catch (error) { diagnostics(attemptId, 'IMAGE_PROVIDER_FAILURE', { reason: text(error?.message) }); }
    }
    if (options.imageOnly) { final.price = ''; delete final.fieldSources.price; delete final.fieldConfidence.price; }
    if (!cleanTest) recordRegistry(state, context, directProduct, fallbackProduct, directFailure, fallbackAttemptedFields);
    const completeness = requiredFields.filter((field) => hasValue(field, fieldValue(final, field))).length;
    diagnostics(attemptId, 'FINAL_FIELD_STATE', { title: Boolean(final.title), image: Boolean(final.imageUrl), price: Boolean(final.price), currency: final.currency, titleSource: final.fieldSources.title, imageSource: final.fieldSources.imageUrl, priceSource: final.fieldSources.price });
    diagnostics(attemptId, 'FIELD_COMPLETENESS', fieldCompleteness(final));
    diagnostics(attemptId, completeness === requiredFields.length ? 'RESOLUTION_COMPLETE' : completeness ? 'RESOLUTION_PARTIAL' : 'RESOLUTION_FAILED', { completeness });
    // Re-read before write-back as enrichment may have landed during network
    // resolution. Merge with that record so a slow, weaker response cannot
    // replace newer persistent fields.
    const latestState = persistState ? loadState(statePath) : null;
    const latestCandidate = reconcileSharedRecords(latestState?.products[key], latestState?.products[legacyKey], context, priceTtlMs) ?? cached;
    const latestRecord = latestCandidate;
    const cacheable = !cleanTest && Boolean(final.title || final.imageUrl || final.price || latestRecord);
    const lookupOutcome = final.price ? 'PRICE_FOUND' : exactPageOutcome === 'PRICE_LOOKUP_UNAVAILABLE'
      || (searchProviders.length && fallbackProduct.priceLookupOutcome === 'PRICE_LOOKUP_UNAVAILABLE')
      ? 'PRICE_LOOKUP_UNAVAILABLE' : exactPageOutcome ?? fallbackProduct.priceLookupOutcome ?? 'PRICE_LOOKUP_UNAVAILABLE';
    final.priceLookupOutcome = lookupOutcome;
    if (final.title || final.imageUrl || final.price) delete state.negative[key];
    if (!cleanTest && !latestRecord?.product?.title && !latestRecord?.product?.imageUrl && !latestRecord?.product?.price
      && !final.title && !final.imageUrl && !final.price && lookupOutcome === 'PRICE_NOT_FOUND') {
      state.negative[key] = { resolverVersion: RESOLVER_SCHEMA_VERSION, expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() };
    }
    let sharedProduct = final;
    if (cacheable) {
      const merged = upsertResolvedProduct(latestRecord, final, context, attemptStartedAt, priceTtlMs);
      merged.expiresAt = new Date(Date.now() + (merged.product.title && merged.product.imageUrl && merged.product.price && merged.product.currency ? cacheTtlMs : Math.min(cacheTtlMs, 5 * 60_000))).toISOString();
      merged.product.priceLookupOutcome = lookupOutcome;
      merged.nextEnrichmentAt = new Date(Date.now() + (lookupOutcome === 'PRICE_LOOKUP_UNAVAILABLE' ? 0 : Math.min(partialRetryMs, 5 * 60_000))).toISOString();
      state.products = { ...(latestState?.products ?? state.products), [key]: merged };
      if (legacyKey !== key) delete state.products[legacyKey];
      sharedProduct = merged.product;
      diagnostics(attemptId, 'SHARED_PRODUCT_UPSERT', { domain: context.baseDomain, fields: Object.keys(merged.fieldMetadata), resolverVersion: RESOLVER_VERSION });
    } else if (latestState) state.products = latestState.products;
    if (persistState) saveState(statePath, state);
    const hasFreshPrice = Boolean(directProduct.price || fallbackProduct.price || (priceFresh && cached?.product.price));
    const priceStale = Boolean(sharedProduct.price && !hasFreshPrice);
    const status = resolutionStatusFor({ ...sharedProduct, priceStale });
    const storedPriceInfo = state.products[key]?.priceInfo ?? cached?.priceInfo;
    const priceInfo = sharedProduct.price ? storedPriceInfo ?? {
      ...(sharedProduct.priceInfo ?? {}), amount: sharedProduct.price, currency: sharedProduct.currency, retailer: context.retailer, market: context.country,
      verifiedAt: attemptStartedAt, updatedAt: attemptStartedAt, source: sharedProduct.fieldSources?.price ?? '',
      currencyAssumed: Boolean(sharedProduct.currencyAssumed), variantVerified: Boolean(sharedProduct.variantVerified),
    } : null;
    return applyUserLocks({ ...sharedProduct, priceInfo, priceStale, priceLookupOutcome: hasFreshPrice ? 'PRICE_FOUND' : lookupOutcome, resolutionStatus: status, originalUrl: context.originalUrl, urlIntelligence: context, cacheHit: false }, options);
  };
  const resolveProduct = async (rawUrl, options = {}) => {
    if (options.imageOnly) options = { ...options, searchOnly: true };
    const skipImageSearch = Boolean(options.existing?.imageUrl && options.lockedFields?.includes('imageUrl'));
    // A single process can receive two submissions for the same normalized
    // product concurrently. Coalesce the lookup, then apply each Item's locks
    // and exact pasted URL only to that caller's response.
    let context;
    try { context = parseProductUrl(rawUrl); }
    catch { throw new Error('Please provide a public http(s) product link.'); }
    const requestKey = JSON.stringify([context.cacheKey || context.normalizedUrl, options.preferredCurrency ?? '', options.preferredSize ?? '', options.sizePreferences ?? {}, Boolean(options.searchOnly), Boolean(options.directOnly), Boolean(options.imageOnly), Boolean(options.priceOnly), skipImageSearch]);
    let pending = inFlight.get(requestKey);
    if (cleanTest) pending = undefined;
    if (!pending) {
      const sharedOptions = { ...options, skipImageSearch, lockedFields: [], existing: undefined };
      pending = resolveProductCore(rawUrl, sharedOptions);
      inFlight.set(requestKey, pending);
      pending.finally(() => { if (inFlight.get(requestKey) === pending) inFlight.delete(requestKey); }).catch(() => {});
    }
    let resolved = await pending;
    const rejectedImages = (options.rejectedImages ?? []).filter((url) => typeof url === 'string').slice(0, 20);
    if (rejectedImages.includes(resolved.imageUrl) && !options.lockedFields?.includes('imageUrl')) {
      const imageUrls = (resolved.imageUrls ?? []).filter((url) => !rejectedImages.includes(url));
      resolved = { ...resolved, imageUrl: imageUrls[0] || '', imageUrls };
      if (!resolved.imageUrl && imageResolver) {
        const found = await imageResolver.resolve(resolved.urlIntelligence || context, resolved, { rejectedImages });
        if (found?.imageUrl) resolved = { ...resolved, ...found, imageUrls: [found.imageUrl] };
      }
    }
    return applyUserLocks({ ...resolved, fieldSources: { ...resolved.fieldSources }, fieldConfidence: { ...resolved.fieldConfidence }, originalUrl: context.originalUrl }, options);
  };
  resolveProduct.inspectState = () => structuredClone(state);
  return resolveProduct;
};

export const getResolverDiagnostics = () => [...recentDiagnostics];
