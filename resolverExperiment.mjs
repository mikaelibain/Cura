import { parseProductUrl } from './productResolver.mjs';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const countries = {
  CA: ['Canada', 'CAD'], US: ['United States', 'USD'], GB: ['United Kingdom', 'GBP'], UK: ['United Kingdom', 'GBP'],
  AU: ['Australia', 'AUD'], NZ: ['New Zealand', 'NZD'], DE: ['Germany', 'EUR'], FR: ['France', 'EUR'],
  IT: ['Italy', 'EUR'], ES: ['Spain', 'EUR'], NL: ['Netherlands', 'EUR'], JP: ['Japan', 'JPY'],
};
const knownLanguages = new Set(['en', 'fr', 'de', 'es', 'it', 'nl', 'ja', 'pt']);
const trackingPattern = /^(?:utm_.+|srsltid|gclid|fbclid|msclkid|dclid|gbraid|wbraid|gad_source|gad_campaignid|cmp|cmpid)$/i;
const identityPattern = /^(?:sku|skuid|sku_id|pid|product|productid|product_id|item|itemid|item_id|style|styleid|style_id|article|articleid|article_id|upc|ean|gtin)$/i;
const variantPattern = /^(?:variant|variantid|variant_id|variantcode|variant_code|color|colour|colorid|colourid|shade|shadeid|size|sizeid)$/i;
const structuralWords = new Set(['product', 'products', 'productpage', 'shop', 'category', 'categories', 'collection', 'collections', 'en', 'ca', 'us', 'uk', 'gb', 'au', 'nz', 'ip', 'women', 'womens', 'men', 'mens', 'clothing']);
const stopTokens = new Set(['the', 'and', 'for', 'with', 'from', 'www', 'com', 'html']);
const uniq = (xs) => [...new Set(xs.filter(Boolean))];
const decode = (s) => { try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return s; } };
const htmlText = (s) => String(s || '').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
  .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&nbsp;/gi, ' ')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
const unwrapBing = (raw) => {
  const decoded = htmlText(raw);
  try {
    const u = new URL(decoded);
    const target = u.searchParams.get('u') || '';
    if (/^a1[a-z\d_-]+$/i.test(target)) return Buffer.from(target.slice(2), 'base64url').toString('utf8');
    if (/^https?:/i.test(target)) return target;
  } catch {}
  return decoded;
};
const slugWords = (s) => decode(s).replace(/\.[a-z0-9]+$/i, '').replace(/(?:^|[-_.])p(?=[-_.]|$)/gi, ' ')
  .replace(/--(?=[a-z]*\d)/ig, ' ').replace(/[-_.]+/g, ' ').toLowerCase().split(/\s+/)
  .filter((w) => w && !structuralWords.has(w) && !stopTokens.has(w));
const titleCaseDomain = (domain) => ({ 'hm.com': 'H&M', 'londondrugs.com': 'London Drugs',
  'shoppersdrugmart.ca': 'Shoppers Drug Mart', 'realcanadiansuperstore.ca': 'Real Canadian Superstore',
  'sephora.com': 'Sephora', 'zara.com': 'Zara', 'simons.ca': 'Simons', 'aritzia.com': 'Aritzia',
  'walmart.ca': 'Walmart', 'fragrancebuy.ca': 'FragranceBuy' })[domain]
  || domain.split('.')[0].replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const registrableDomain = (host) => {
  const labels = host.toLowerCase().replace(/^www\d*\./, '').replace(/\.$/, '').split('.');
  if (labels.length <= 2) return labels.join('.');
  const suffix2 = labels.slice(-2).join('.');
  return /^(?:co|com|net|org|gov|ac|edu)\.[a-z]{2}$/.test(suffix2) ? labels.slice(-3).join('.') : suffix2;
};
const countryCodeFor = (url, host) => {
  const queryCountry = [...url.searchParams.entries()].find(([k]) => /^(?:country|country_switch|market)$/i.test(k))?.[1] || '';
  const hostCountry = host.match(/\.([a-z]{2})$/)?.[1] || '';
  const localePart = url.pathname.split('/').map(decode).find((s) => /^[a-z]{2}[-_][a-z]{2}$/i.test(s));
  const localeCountry = localePart?.split(/[-_]/)[1] || '';
  const pathCountry = url.pathname.split('/').map(decode).find((s) => /^(?:ca|us|uk|gb|au|nz|de|fr|it|es|nl)$/i.test(s)) || '';
  const domain = registrableDomain(host);
  const defaultCountry = ({ 'londondrugs.com': 'CA', 'aritzia.com': 'CA', 'walmart.ca': 'CA', 'simons.ca': 'CA',
    'shoppersdrugmart.ca': 'CA', 'fragrancebuy.ca': 'CA' })[domain] || '';
  const raw = (queryCountry || localeCountry || pathCountry || hostCountry || defaultCountry).toUpperCase();
  return countries[raw] ? raw : '';
};

export const buildProductFingerprint = (originalUrl) => {
  const exactOriginal = String(originalUrl ?? '');
  const url = new URL(/^https?:\/\//i.test(exactOriginal) ? exactOriginal : `https://${exactOriginal}`);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('INVALID_URL');
  const host = url.hostname.toLowerCase();
  const domain = registrableDomain(host);
  const countryCode = countryCodeFor(url, host);
  const [countryName, currencyHint] = countries[countryCode] || ['', ''];
  const rawLocale = url.pathname.split('/').map(decode).find((s) => /^(?:[a-z]{2}[-_][a-z]{2}|ca|us|uk|gb|au|nz|de|fr)$/i.test(s)) || '';
  const localeParts = rawLocale.split(/[-_]/);
  const language = knownLanguages.has(localeParts[0]?.toLowerCase()) ? localeParts[0].toLowerCase() : '';
  const pathSegments = url.pathname.split('/').filter(Boolean).map(decode);
  const queryParams = { identity: [], tracking: [], variant: [], unknown: [] };
  for (const [name, value] of url.searchParams.entries()) {
    const entry = { name, value };
    if (trackingPattern.test(name) || (name.toLowerCase() === 'source' && /^(?:google|bing|facebook|instagram|ads?|paid|search|nspt)$/i.test(value))) queryParams.tracking.push(entry);
    else if (variantPattern.test(name)) queryParams.variant.push(entry);
    else if (identityPattern.test(name)) queryParams.identity.push(entry);
    else queryParams.unknown.push({ ...entry, possibleIdentity: /^(?:v\d+|catid)$/i.test(name) });
  }
  const identifiers = [];
  const addId = (value, type, source, confidence) => {
    const clean = String(value || '').trim();
    if (!clean) return;
    const existing = identifiers.find((x) => x.value.toLowerCase() === clean.toLowerCase());
    if (existing) {
      if (confidence > existing.confidence) { existing.confidence = confidence; existing.source = source; existing.type = type; }
      return;
    }
    identifiers.push({ value: clean, type, source, confidence });
  };
  const addPathId = (raw, source, adjacent = false) => {
    const token = raw.replace(/\.[a-z0-9]+$/i, '');
    const composite = token.match(/(?:^|--)(\d{4,}-\d{4,})$/)?.[1];
    if (composite) { addId(composite, 'product_style', source, adjacent ? 0.97 : 0.88); return; }
    const prefixed = token.match(/(?:^|[-_.])(p\d{5,})$/i)?.[1];
    if (prefixed) { addId(prefixed, 'product', source, adjacent ? 0.97 : 0.9); addId(prefixed.slice(1), 'product_numeric', source, 0.82); return; }
    const named = token.match(/(?:^|[-_.])([a-z]\d{3,})$/i)?.[1];
    if (named) { addId(named, 'product', source, adjacent ? 0.96 : 0.84); return; }
    const numeric = token.match(/(?:^|[-_.])(\d{5,})$/)?.[1];
    if (numeric) addId(numeric, 'product', source, adjacent ? 0.95 : numeric.length >= 7 ? 0.86 : 0.76);
  };
  for (const segment of pathSegments) {
    addPathId(segment, /^(?:p|product|products|item|items|sku|article|style)$/i.test(pathSegments[pathSegments.indexOf(segment) - 1] || '') ? 'adjacent_path' : 'path',
      /^(?:p|product|products|item|items|sku|article|style)$/i.test(pathSegments[pathSegments.indexOf(segment) - 1] || '') || /productpage[.-]/i.test(segment));
    const found = [...segment.matchAll(/(?:^|[-_.])((?:p\d{5,}|[a-z]\d{3,}|\d{5,}|\d{4,}-\d{4,}))(?=[-_.]|$)/ig)];
    for (const match of found) addPathId(match[1], 'embedded_path', /productpage[.-]/i.test(segment));
  }
  for (const { name, value } of queryParams.identity) addId(value, name.toLowerCase().includes('sku') ? 'sku' : 'product', `query:${name}`, 0.98);
  for (const { name, value } of queryParams.unknown) if (/^catid$/i.test(name)) addId(value, 'category', `query:${name}`, 0.2);
  for (const { name, value } of queryParams.variant) {
    if (/^(?:variant|variantid|variant_id|variantcode|variant_code)$/i.test(name) && /^\d{10,}$/.test(value)) addId(value, 'variant', `query:${name}`, 0.96);
  }
  for (const { name, value } of queryParams.unknown) if (/^v\d+$/i.test(name) && /^\d{5,}$/.test(value)) addId(value, 'possible_variant', `query:${name}`, 0.54);
  const variantTokens = uniq(queryParams.variant.map(({ value }) => value));
  const colorTokens = uniq(queryParams.variant.filter(({ name }) => /colou?r|shade/i.test(name)).map(({ value }) => value));
  const sizeTokens = uniq(queryParams.variant.filter(({ name }) => /size/i.test(name)).map(({ value }) => value));
  const titleSegment = pathSegments.filter((s) => !/^(?:[a-z]{2}[-_][a-z]{2}|en|fr|de|ca|us|uk|gb|au|nz)$/i.test(s))
    .filter((s) => !/^(?:p|product|products|item|items|productpage)$/i.test(s))
    .sort((a, b) => slugWords(b).length - slugWords(a).length)[0] || '';
  const titleWithoutIds = identifiers.reduce((value, id) => {
    const variants = [id.value, ...id.value.split('-')].filter(Boolean);
    return variants.reduce((next, token) => next.replace(new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), ' '), value);
  }, titleSegment);
  const titleTokens = slugWords(titleWithoutIds);
  const idParamValues = [...queryParams.identity, ...queryParams.variant].map((p) => p.value);
  const identityUrl = new URL(url.toString()); identityUrl.hash = '';
  for (const { name } of queryParams.tracking) identityUrl.searchParams.delete(name);
  const strongestIds = identifiers.filter((id) => id.confidence >= 0.75).map((id) => id.value);
  const titleHint = titleTokens.join(' ');
  const searchTokens = uniq([domain, countryName, ...titleTokens, ...strongestIds, ...variantTokens, ...queryParams.unknown.map(({ value }) => value)]);
  const primary = identifiers.find((id) => id.type !== 'variant' && id.confidence >= 0.7)?.value || '';
  const primarySearchId = primary || identifiers.find((id) => id.type === 'variant' && id.confidence >= 0.7)?.value || '';
  return {
    originalUrl: exactOriginal, protocol: url.protocol.slice(0, -1), hostname: host, registrableDomain: domain,
    domainLabel: domain.split('.')[0],
    retailerHint: titleCaseDomain(domain), locale: { raw: rawLocale, language, countryCode, countryName, currencyHint },
    pathSegments, titleTokens, titleHint,
    identifiers, productId: primary, variantTokens, colorTokens, sizeTokens, queryParams,
    normalizedIdentityUrl: identityUrl.toString(), searchTokens,
    _queryIdentity: { primaryId: primarySearchId, productId: primary, queryIds: uniq([...strongestIds, ...idParamValues]), hasVariant: variantTokens.length > 0 },
  };
};

export const buildQueryPlan = (fingerprint) => {
  const { retailerHint, locale, titleHint, variantTokens, colorTokens } = fingerprint;
  const country = locale.countryName;
  const id = fingerprint._queryIdentity.primaryId || '';
  const brand = retailerHint;
  const strongQuery = [brand, country, 'product', id].filter(Boolean).join(' ');
  const titleQuery = [brand, country, titleHint, id].filter(Boolean).join(' ');
  const variants = uniq([...variantTokens, ...colorTokens]);
  const variantQuery = [brand, country, titleHint, id, ...variants].filter(Boolean).join(' ');
  const weakUrlIds = uniq(fingerprint.queryParams.unknown.filter((p) => /^v\d+$/i.test(p.name)).map((p) => p.value));
  const weakQuery = [brand, country, titleHint, id, weakUrlIds[0]].filter(Boolean).join(' ');
  const enrichedQuery = [brand, country, id, titleHint].filter(Boolean).join(' ');
  const plan = [strongQuery, titleQuery];
  if (variants.length) plan.push(variantQuery);
  else if (weakUrlIds.length) plan.push(weakQuery);
  plan.push(enrichedQuery);
  return plan.map((query) => query.replace(/\s+/g, ' ').trim()).slice(0, 4);
};

const candidateIds = (url) => {
  try {
    const p = parseProductUrl(url);
    return uniq([p.productId, p.sku, p.variantId, ...p.candidateIdentifiers]).map((value) => value.toLowerCase());
  } catch { return []; }
};
const destinationVariantIds = (url) => {
  try { return [...new URL(url).searchParams.entries()].filter(([name]) => variantPattern.test(name)).map(([, value]) => value); }
  catch { return []; }
};
const normalizedDestinationUrl = (input) => {
  try {
    const url = new URL(input);
    url.hash = '';
    for (const name of [...url.searchParams.keys()]) if (trackingPattern.test(name)) url.searchParams.delete(name);
    return url.toString();
  } catch { return ''; }
};
const canonicalPath = (url) => { try { return new URL(normalizedDestinationUrl(url)).pathname.toLowerCase().replace(/\/+$/, ''); } catch { return ''; } };
const titleSimilarity = (a, b) => {
  const aa = uniq(String(a || '').toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length > 2));
  const bb = new Set(String(b || '').toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length > 2));
  return aa.length ? aa.filter((x) => bb.has(x)).length / aa.length : 0;
};

export const compareProductIdentity = (fingerprint, candidate) => {
  const comparisonUrl = normalizedDestinationUrl(candidate.destinationUrl || candidate.url || '');
  let candidateDomain = '';
  try { candidateDomain = registrableDomain(new URL(comparisonUrl).hostname); } catch {}
  const ids = candidateIds(comparisonUrl);
  const targetIds = fingerprint.identifiers.filter((id) => id.confidence >= 0.7 && id.type !== 'possible_variant').map((id) => id.value.toLowerCase());
  const exactId = targetIds.some((id) => ids.includes(id) || (candidate.productIds || []).some((v) => String(v).toLowerCase() === id));
  const destinationVariants = destinationVariantIds(comparisonUrl);
  const targetVariantIds = fingerprint.variantTokens.map((x) => x.toLowerCase());
  const exactVariant = targetVariantIds.some((id) => ids.includes(id) || [...(candidate.variantIds || []), ...destinationVariants].some((v) => String(v).toLowerCase() === id));
  const candidateTargetId = ids.some((id) => targetIds.includes(id));
  const hardIdConflict = Boolean(targetIds.length && ids.some((id) => /^\w*[0-9]/.test(id)) && !candidateTargetId && candidateDomain === fingerprint.registrableDomain);
  const domainMatch = candidateDomain === fingerprint.registrableDomain;
  const pathMatch = domainMatch && canonicalPath(comparisonUrl) === canonicalPath(fingerprint.normalizedIdentityUrl);
  const targetVariants = fingerprint.variantTokens.map((x) => x.toLowerCase());
  const candidateVariants = uniq([...(candidate.variantIds || []), ...destinationVariants, ...candidateIds(comparisonUrl)]).map((x) => x.toLowerCase());
  const variantMatch = !targetVariants.length || targetVariants.some((v) => candidateVariants.includes(v) || (candidate.variantIds || []).map(String).includes(v));
  const variantConflict = targetVariants.length > 0 && candidateVariants.length > 0 && !variantMatch;
  const titleScore = titleSimilarity(candidate.title, fingerprint.titleHint);
  let score = (exactId ? 70 : 0) + (domainMatch ? 25 : 0) + (pathMatch ? 15 : 0) + Math.round(titleScore * 20) + (variantMatch ? 8 : 0);
  if (hardIdConflict || variantConflict) score = 0;
  const identityMatch = !hardIdConflict && !variantConflict && domainMatch && (exactId || pathMatch || titleScore >= 0.65);
  return { score: score + (exactVariant ? 15 : 0), exactId, exactVariant, domainMatch, pathMatch, variantMatch, hardIdConflict, variantConflict, titleScore, identityMatch,
    reason: hardIdConflict ? 'IDENTITY_CONFLICT' : variantConflict ? 'VARIANT_CONFLICT' : identityMatch ? 'IDENTITY_MATCH' : 'IDENTITY_UNVERIFIED' };
};

const parsePrice = (raw) => {
  const s = String(raw || '').replace(/\u00a0/g, ' ');
  const m = s.match(/(?:CA\$|C\$|CAD\s*\$|US\$|USD\s*\$|AU\$|NZ\$|£|€|\$)\s*(\d[\d,]*(?:\.\d{1,2})?)/i)
    || s.match(/\b(CAD|USD|GBP|EUR)\s*(\d[\d,]*(?:\.\d{1,2})?)/i);
  if (!m) return { parsedPrice: '', currency: '' };
  const currency = /^(?:CA\$|C\$|CAD)/i.test(m[0]) ? 'CAD' : /^(?:US\$|USD)/i.test(m[0]) ? 'USD'
    : /^AU\$/i.test(m[0]) ? 'AUD' : /^NZ\$/i.test(m[0]) ? 'NZD' : m[0].startsWith('£') ? 'GBP' : m[0].startsWith('€') ? 'EUR' : '';
  return { parsedPrice: m[1].replace(/,/g, ''), currency };
};
const makeCandidate = (raw, context) => {
  const destinationUrl = raw.destinationUrl || raw.url || raw.link || '';
  const normalizedDestination = normalizedDestinationUrl(destinationUrl);
  const detected = parsePrice([raw.displayedPrice, raw.price, raw.snippet].filter(Boolean).join(' '));
  let ids = [];
  try { const p = parseProductUrl(normalizedDestination || destinationUrl); ids = uniq([p.productId, p.sku, ...p.candidateIdentifiers]); } catch {}
  return { sourceType: raw.sourceType || 'web', provider: raw.provider || '', query: raw.query || '', rank: raw.rank || 0,
    title: String(raw.title || '').replace(/<[^>]*>/g, '').trim(), snippet: raw.snippet || '', displayedPrice: raw.displayedPrice || raw.price || '',
    parsedPrice: raw.parsedPrice || detected.parsedPrice, currency: raw.currency || detected.currency || raw.currencyHint || '',
    destinationUrl, normalizedDestination, domain: (() => { try { return registrableDomain(new URL(normalizedDestination).hostname); } catch { return ''; } })(),
    imageUrl: raw.imageUrl || '', retailer: raw.retailer || '',
    productIds: uniq([...(raw.productIds || []), ...ids]), variantIds: raw.variantIds || [], timestamp: raw.timestamp || new Date().toISOString(),
    providerStatus: raw.providerStatus || 'ok', ...raw };
};

export class SearXNGProvider {
  constructor(baseUrl, fetcher = fetch) { this.name = 'SearXNG'; this.baseUrl = baseUrl; this.fetcher = fetcher; this.available = true; }
  async #search(query, category, country) {
    const start = Date.now();
    try {
      const endpoint = new URL('/search', this.baseUrl);
      endpoint.searchParams.set('q', query); endpoint.searchParams.set('format', 'json'); endpoint.searchParams.set('categories', category);
      if (country) endpoint.searchParams.set('language', `en-${country.toUpperCase()}`);
      const response = await this.fetcher(endpoint, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12_000) });
      if (!response.ok) return { candidates: [], latencyMs: Date.now() - start, status: `HTTP_${response.status}` };
      const payload = await response.json();
      return { candidates: (payload.results || []).slice(0, 15).map((r, rank) => makeCandidate({ sourceType: category === 'images' ? 'image' : 'web', provider: this.name,
        rank: rank + 1, title: r.title, snippet: r.content, url: r.url || r.source, imageUrl: r.img_src || r.thumbnail, displayedPrice: r.price || '', retailer: r.engine || '' }, {})),
        latencyMs: Date.now() - start, status: 'ok' };
    } catch (error) { return { candidates: [], latencyMs: Date.now() - start, status: error.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK_ERROR' }; }
  }
  async searchWeb(query, options = {}) { return this.#search(query, 'general', options.countryCode); }
  async searchImages(query, options = {}) { return this.#search(query, 'images', options.countryCode); }
  async searchShopping(query, options = {}) { return this.#search(query, 'shopping', options.countryCode); }
}

export class BingDevSearchProvider {
  constructor(fetcher = fetch) { this.name = 'Bing development search'; this.fetcher = fetcher; }
  async #search(query, mode) {
    const started = Date.now();
    try {
      const endpoint = new URL(mode === 'image' ? 'https://www.bing.com/images/search' : 'https://www.bing.com/search');
      endpoint.searchParams.set('q', query);
      const response = await this.fetcher(endpoint, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Cura resolver experiment/1.0)', Accept: 'text/html' }, signal: AbortSignal.timeout(10_000) });
      if (!response.ok) return { candidates: [], latencyMs: Date.now() - started, status: `HTTP_${response.status}` };
      const html = await response.text();
      if (/captcha|unusual traffic|verify you are human|automated queries/i.test(html.slice(0, 50_000))) return { candidates: [], latencyMs: Date.now() - started, status: 'SEARCH_PROVIDER_BLOCKED' };
      let candidates = [];
      if (mode === 'image') candidates = [...html.matchAll(/<a[^>]+class="[^"]*\biusc\b[^"]*"[^>]+\bm="([^"]+)"/gi)].slice(0, 12).flatMap((m, i) => {
        try { const d = JSON.parse(htmlText(m[1])); return [makeCandidate({ sourceType: 'image', provider: this.name, rank: i + 1,
          title: htmlText(d.t), url: unwrapBing(d.purl), imageUrl: unwrapBing(d.murl), snippet: htmlText(d.desc || '') }, {})]; } catch { return []; }
      });
      else candidates = [...html.matchAll(/<li[^>]+class="[^"]*\bb_algo\b[^"]*"[\s\S]*?<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h2>([\s\S]*?)<\/li>/gi)].slice(0, 12).map((m, i) => makeCandidate({
        sourceType: 'web', provider: this.name, rank: i + 1, url: unwrapBing(m[1]), title: htmlText(m[2].replace(/<[^>]*>/g, '')), snippet: htmlText(m[3].replace(/<[^>]*>/g, ' ')),
        displayedPrice: (m[3].match(/(?:CA|US|AU|NZ)\$\s*[\d,.]+/) || [])[0] || '' }, {}));
      return { candidates, latencyMs: Date.now() - started, status: 'ok' };
    } catch (error) { return { candidates: [], latencyMs: Date.now() - started, status: error.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK_ERROR' }; }
  }
  searchWeb(query) { return this.#search(query, 'web'); }
  searchImages(query) { return this.#search(query, 'image'); }
}

// Structural interface for development search backends.
export class SearchProvider {
  async searchWeb(_query) { throw new Error('SEARCH_WEB_NOT_IMPLEMENTED'); }
  async searchImages(_query) { throw new Error('SEARCH_IMAGES_NOT_IMPLEMENTED'); }
}

export class GoogleDevBrowserProvider extends SearchProvider {
  constructor({ headless = process.env.HEADLESS_SEARCH !== 'false', browserName = 'chromium' } = {}) {
    super(); this.name = 'Google development browser'; this.headless = headless; this.browserName = browserName;
  }
  async #search(query, images) {
    const started = Date.now();
    let browser;
    try {
      const { chromium, firefox, webkit } = await import('playwright');
      const engine = ({ chromium, firefox, webkit })[this.browserName] || chromium;
      const localChromium = resolve(process.cwd(), '.playwright-browsers', 'chromium-1243', 'chrome-win64', 'chrome.exe');
      browser = await engine.launch({ headless: this.headless, ...(this.browserName === 'chromium' && existsSync(localChromium) ? { executablePath: localChromium } : {}) });
      const page = await browser.newPage({ locale: 'en-CA' });
      const endpoint = new URL('https://www.google.com/search');
      if (images) endpoint.searchParams.set('tbm', 'isch');
      endpoint.searchParams.set('q', query);
      await page.goto(endpoint.toString(), { waitUntil: 'domcontentloaded', timeout: 25000 });
      const body = await page.locator('body').innerText({ timeout: 8000 }).catch(() => '');
      if (/unusual traffic|not a robot|CAPTCHA|sorry\/.*automated/i.test(body))
        return { candidates: [], latencyMs: Date.now() - started, status: 'SEARCH_PROVIDER_BLOCKED' };
      const candidates = await page.evaluate((isImages) => {
        const clean = (x) => (x || '').replace(/\s+/g, ' ').trim();
        const all = [...document.querySelectorAll('a[href]')];
        const rows = [];
        if (isImages) {
          for (const img of document.querySelectorAll('img')) {
            const card = img.closest('div[data-ved], div.MjjYud, div.isv-r, a') || img.parentElement;
            const link = img.closest('a') || card?.querySelector('a[href]');
            if (!link) continue;
            let destinationUrl = link.href;
            let imageUrl = img.currentSrc || img.src || img.getAttribute('data-src') || '';
            try {
              const wrapped = new URL(destinationUrl);
              if (/google\./i.test(wrapped.hostname)) {
                destinationUrl = wrapped.searchParams.get('imgrefurl') || wrapped.searchParams.get('q') || '';
                imageUrl = wrapped.searchParams.get('imgurl') || imageUrl;
              }
            } catch {}
            if (!/^https?:/.test(destinationUrl) || !/^https?:/.test(imageUrl)) continue;
            const snippet = clean(card?.innerText || '').slice(0, 900);
            const title = clean(img.alt || link.getAttribute('aria-label') || card?.querySelector('[role="heading"]')?.textContent);
            rows.push({ sourceType: 'image', title, snippet, destinationUrl, imageUrl, rank: rows.length + 1 });
            if (rows.length >= 15) break;
          }
          return rows;
        }
        for (const a of all) {
          const href = a.href;
          if (!/^https?:/.test(href) || /google\.(?:com|ca)\/(?:search|imgres)/i.test(href)) continue;
          const container = a.closest('div.MjjYud, div.g, div[data-docid]') || a.parentElement;
          const title = clean(a.querySelector('h3')?.innerText || a.getAttribute('aria-label') || a.innerText);
          const snippet = clean(container?.innerText || '').slice(0, 900);
          const image = a.querySelector('img') || container?.querySelector('img');
          if (!title && !image?.src) continue;
          rows.push({ sourceType: 'web', title, snippet, destinationUrl: href,
            imageUrl: image?.src || image?.getAttribute('data-src') || '', rank: rows.length + 1 });
          if (rows.length >= 15) break;
        }
        return rows;
      }, images);
      const cooked = candidates.map((candidate) => {
        const priceMatch = candidate.snippet.match(/(?:CA\$|C\$|CAD\s*\$|US\$|USD\s*\$|AU\$|NZ\$|£|€|\$)\s*\d[\d,.]*(?:\.\d{1,2})?/i);
        return { ...candidate, provider: this.name, displayedPrice: priceMatch?.[0] || '' };
      });
      return { candidates: cooked, latencyMs: Date.now() - started, status: 'ok' };
    } catch (error) {
      return { candidates: [], latencyMs: Date.now() - started,
        status: /Timeout/i.test(error.name || error.message) ? 'TIMEOUT' : `BROWSER_SEARCH_ERROR: ${String(error.message || error).slice(0, 180)}` };
    } finally { await browser?.close().catch(() => {}); }
  }
  searchWeb(query) { return this.#search(query, false); }
  searchImages(query) { return this.#search(query, true); }
}

export const createExperimentSearchProvider = (env = process.env) => {
  if (env.SEARCH_PROVIDER === 'searxng' || env.SEARXNG_URL) return env.SEARXNG_URL ? new SearXNGProvider(env.SEARXNG_URL) : null;
  return new GoogleDevBrowserProvider({ headless: env.HEADLESS_SEARCH !== 'false' });
};

const learnedTitleQuery = (fp, title) => [fp.retailerHint, fp.locale.countryName, fp._queryIdentity.primaryId, title].filter(Boolean).join(' ');
const familyVariantEvidence = (fp, candidate) => !fp.variantTokens.length || fp.variantTokens.every((v) =>
  [...(candidate.variantIds || []), ...destinationVariantIds(candidate.normalizedDestination || candidate.destinationUrl || '')].map(String).includes(v)
  || candidate.snippet?.includes(v));
const clearCurrentPrice = (candidate) => candidate.parsedPrice && /^[A-Z]{3}$/.test(candidate.currency)
  && familyVariantEvidenceForCandidate(candidate)
  && !/\b(?:from|starting at|installments?|per month)\b/i.test(`${candidate.displayedPrice} ${candidate.snippet}`)
  && !/(?:\$\s*\d[\d,.]*\s*(?:-|–|—|to)\s*(?:CA\$|C\$|US\$|AU\$|NZ\$|\$)?\s*\d|\b\d[\d,.]*\s*(?:-|–|—|to)\s*\d[\d,.]*\b)/i.test(`${candidate.displayedPrice || ''} ${candidate.snippet || ''}`);
const familyVariantEvidenceForCandidate = (candidate) => !candidate.variantConflict;

export const runSearchReconstruction = async (originalUrl, { provider = createExperimentSearchProvider(), maximumQueries = 4, cleanTest = true } = {}) => {
  if (!cleanTest) throw new Error('EXPERIMENT_REQUIRES_CLEAN_TEST');
  const started = Date.now();
  const fingerprint = buildProductFingerprint(originalUrl);
  const queryPlan = buildQueryPlan(fingerprint);
  const queries = [];
  const candidates = [];
  const decisions = [];
  const executions = [];
  const attempted = new Set();
  let learnedCanonicalTitle = '';
  let learnedRefinedQuery = '';
  let providerStatus = provider ? 'available' : 'SEARCH_PROVIDER_UNAVAILABLE';
  for (let index = 0; index < maximumQueries && index < 4; index += 1) {
    let query = queryPlan[index];
    if (index === queryPlan.length - 1 && learnedCanonicalTitle) {
      query = learnedTitleQuery(fingerprint, learnedCanonicalTitle);
      learnedRefinedQuery = query;
    }
    if (!query || attempted.has(query)) continue;
    attempted.add(query); queries.push(query);
    if (!provider) { decisions.push({ query, provider: 'none', status: providerStatus }); continue; }
    const [web, images] = await Promise.all([
      provider.searchWeb(query, { countryCode: fingerprint.locale.countryCode, fingerprint }),
      provider.searchImages(query, { countryCode: fingerprint.locale.countryCode, fingerprint }),
    ]);
    executions.push({ query, provider: provider.name, webLatencyMs: web.latencyMs ?? 0, imageLatencyMs: images.latencyMs ?? 0,
      webStatus: web.status || 'ok', imageStatus: images.status || 'ok' });
    providerStatus = [web.status, images.status].filter((s) => s !== 'ok').join(',') || 'ok';
    if (web.status === 'SEARCH_PROVIDER_BLOCKED' || images.status === 'SEARCH_PROVIDER_BLOCKED') {
      providerStatus = 'SEARCH_PROVIDER_BLOCKED';
      break;
    }
    const batch = [...(web.candidates || []), ...(images.candidates || [])].map((c) => makeCandidate({ ...c, query,
      provider: c.provider || provider.name, sourceType: c.sourceType || 'web' }, fingerprint));
    for (const c of batch) {
      const match = compareProductIdentity(fingerprint, c);
      const accepted = match.identityMatch;
      candidates.push({ ...c, match, accepted, rejectionReason: accepted ? '' : match.reason });
      decisions.push({ query, provider: c.provider, sourceType: c.sourceType, rank: c.rank, destinationUrl: c.destinationUrl,
        score: match.score, accepted, reason: accepted ? 'IDENTITY_MATCH' : match.reason });
    }
    if (!learnedCanonicalTitle) {
      const titleCandidate = candidates.filter((c) => c.accepted && c.title).sort((a, b) => b.match.score - a.match.score)[0];
      if (titleCandidate) learnedCanonicalTitle = titleCandidate.title;
    }
  }
  const exact = candidates.filter((c) => c.accepted && (c.match.exactId || c.match.exactVariant) && c.match.domainMatch).sort((a, b) => b.match.score - a.match.score);
  const titleEvidence = exact.find((c) => c.title) || null;
  const variantRequired = fingerprint.variantTokens.length > 0;
  const validPrices = exact.filter((c) => clearCurrentPrice({ ...c, variantConflict: !familyVariantEvidence(fingerprint, c) }))
    .sort((a, b) => Number(b.currency === fingerprint.locale.currencyHint) - Number(a.currency === fingerprint.locale.currencyHint)
      || b.match.score - a.match.score);
  const priceEvidence = validPrices[0] || null;
  const imageEvidence = exact.find((c) => c.imageUrl) || null;
  const fields = {
    title: titleEvidence ? { value: titleEvidence.title, source: titleEvidence.provider, query: titleEvidence.query, candidateUrl: titleEvidence.destinationUrl, confidence: 'HIGH' } : null,
    price: priceEvidence ? { value: priceEvidence.parsedPrice, currency: priceEvidence.currency, source: priceEvidence.provider, query: priceEvidence.query, candidateUrl: priceEvidence.destinationUrl, confidence: 'HIGH', retrievedAt: new Date().toISOString() } : null,
    image: imageEvidence ? { value: imageEvidence.imageUrl, source: imageEvidence.provider, query: imageEvidence.query, candidateUrl: imageEvidence.destinationUrl, confidence: 'HIGH' } : null,
  };
  const evidenceGraph = {
    title: candidates.filter((c) => c.accepted && c.title).map((c) => ({ value: c.title, snippet: c.snippet, sourceType: c.sourceType,
      provider: c.provider, destinationUrl: c.destinationUrl, confidence: c.match.exactId ? 'HIGH' : 'MEDIUM', score: c.match.score })),
    price: candidates.filter((c) => c.accepted && c.parsedPrice).map((c) => ({ value: c.parsedPrice, currency: c.currency,
      snippet: c.snippet, displayedPrice: c.displayedPrice, sourceType: c.sourceType, provider: c.provider,
      destinationUrl: c.destinationUrl, variantVerified: familyVariantEvidence(fingerprint, c), eligible: clearCurrentPrice({ ...c, variantConflict: !familyVariantEvidence(fingerprint, c) }), score: c.match.score })),
    image: candidates.filter((c) => c.accepted && c.imageUrl).map((c) => ({ value: c.imageUrl, title: c.title, snippet: c.snippet,
      sourceType: c.sourceType, provider: c.provider, destinationUrl: c.destinationUrl, confidence: c.match.exactId ? 'HIGH' : 'MEDIUM', score: c.match.score })),
  };
  const status = fields.title && fields.price ? 'RESOLVED' : fields.title ? 'PARTIAL' : 'UNRESOLVED';
  const failures = [];
  if (!provider) failures.push(providerStatus);
  else if (!candidates.length) failures.push(providerStatus !== 'ok' ? providerStatus : 'NO_SEARCH_RESULTS');
  else if (!candidates.some((c) => c.accepted)) failures.push(candidates.some((c) => c.match.hardIdConflict) ? 'IDENTITY_CONFLICT' : 'NO_VERIFIED_SEARCH_MATCH');
  if (!fields.title) failures.push('TITLE_ONLY_OR_UNVERIFIED');
  if (!fields.price) failures.push(variantRequired ? 'VARIANT_UNVERIFIED_OR_PRICE_MISSING' : 'PRICE_MISSING');
  if (candidates.some((c) => c.match.hardIdConflict)) failures.push('IDENTITY_CONFLICT');
  return { originalUrl: fingerprint.originalUrl, fingerprint, queryPlan, queriesUsed: queries, candidates, decisions, evidenceGraph,
    executions, learnedCanonicalTitle, learnedRefinedQuery, fields, status,
    failures: uniq(failures), totalLatencyMs: Date.now() - started, providerStatus };
};

export const formatExperimentReport = (result) => {
  const fp = result.fingerprint;
  const ids = fp.identifiers.map((x) => `${x.value}[${x.type},${x.confidence}]`).join(', ') || 'none';
  const c = result.candidates.map((x) => `- #${x.rank} ${x.sourceType}/${x.provider} ${x.accepted ? 'ACCEPTED' : `REJECTED ${x.rejectionReason}`} score=${x.match.score}\n  title=${x.title || '—'} price=${x.parsedPrice || '—'} ${x.currency || ''}\n  destination=${x.destinationUrl || '—'}\n  ID match=${x.match.exactId || x.match.exactVariant} domain match=${x.match.domainMatch} variant match=${x.match.variantMatch}\n  image=${x.imageUrl || '—'}`).join('\n') || '- none';
  return [`URL\n${'='.repeat(48)}\noriginalUrl: ${fp.originalUrl}`,
    `FINGERPRINT\nretailer: ${fp.retailerHint}\ndomain: ${fp.registrableDomain}\ncountry: ${fp.locale.countryName || 'unknown'}\nlocale: ${fp.locale.raw || 'unknown'}\ntitleHint: ${fp.titleHint || 'none'}\nproduct IDs: ${ids}\nvariant IDs: ${fp.variantTokens.join(', ') || 'none'}\ncolor IDs: ${fp.colorTokens.join(', ') || 'none'}\ntracking params removed: ${fp.queryParams.tracking.map((x) => `${x.name}=${x.value}`).join(', ') || 'none'}\nidentity params retained: ${fp.queryParams.identity.map((x) => `${x.name}=${x.value}`).join(', ') || 'none'}\nunknown params retained: ${fp.queryParams.unknown.map((x) => `${x.name}=${x.value}`).join(', ') || 'none'}`,
    `QUERY PLAN\n${uniq(result.queryPlan).map((q, i) => `Q${i + 1}: ${q}`).join('\n')}`,
    `SEARCH EXECUTION\n${result.executions.map((x, i) => `Q${i + 1}: ${x.query}\n  ${x.provider} web=${x.webStatus} ${x.webLatencyMs}ms image=${x.imageStatus} ${x.imageLatencyMs}ms`).join('\n') || 'No provider requests'}\nprovider status: ${result.providerStatus}`,
    `CANDIDATES\n${c}`,
    `CANDIDATE SNIPPETS\n${result.candidates.map((x) => `#${x.rank} ${x.sourceType} ${x.domain || '(unknown domain)'} ${x.accepted ? 'ACCEPTED' : x.rejectionReason}\n  ${x.snippet || '(no snippet)'}`).join('\n') || 'none'}`,
    `LEARNED INFORMATION\ncanonical title: ${result.learnedCanonicalTitle || 'none'}\nrefined query: ${result.learnedRefinedQuery || 'none'}`,
    `EVIDENCE GRAPH\n${Object.entries(result.evidenceGraph || {}).map(([field, evidence]) => `${field}: ${evidence.length ? evidence.map((e) => `[${e.sourceType}/${e.provider}; ${e.confidence || (e.eligible ? 'ELIGIBLE' : 'REJECTED')} score=${e.score}] ${e.value}${e.currency ? ` ${e.currency}` : ''} — ${e.snippet || ''}`).join('\n  ') : 'none'}`).join('\n')}`,
    `FINAL EVIDENCE\ntitle: ${result.fields.title ? `${result.fields.title.value} (${result.fields.title.source}, ${result.fields.title.confidence})` : 'unresolved'}\nprice: ${result.fields.price ? `${result.fields.price.value} ${result.fields.price.currency} (${result.fields.price.source}, ${result.fields.price.confidence})` : 'unresolved'}\nimage: ${result.fields.image ? `${result.fields.image.value} (${result.fields.image.source}, ${result.fields.image.confidence})` : 'unresolved'}\nSTATUS: ${result.status}\nFailures: ${result.failures.join(', ') || 'none'}\nTOTAL LATENCY: ${result.totalLatencyMs} ms`, '='.repeat(48)].join('\n\n');
};
