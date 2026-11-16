import express from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProductResolver, parseProductUrl, recordResolverEvent, secureFetch, validatePublicUrl } from './productResolver.mjs';
import { createImageCache } from './imageCache.mjs';
import { createImageModerationService, createReportStore, createUrlSafetyService, GoogleVisionSafeSearchProvider, GoogleWebRiskProvider } from './safety.mjs';
import { resolverConfig } from './server/resolver/config.mjs';
import { SearchQuota } from './server/resolver/quota.mjs';
import { TavilyProvider } from './server/resolver/providers/tavily.mjs';
import { FirecrawlProvider } from './server/resolver/providers/firecrawl.mjs';
import { createExactPageResolver } from './server/resolver/exactPage.mjs';
import { ProductImageResolver } from './server/resolver/images.mjs';
import { SearchRotation } from './server/resolver/rotation.mjs';

const app = express();
const port = Number(process.env.PORT ?? 8787);
const serpApiKey = process.env.SERPAPI_KEY;
const urlSafety = createUrlSafetyService({ validate: validatePublicUrl, canonicalize: (url) => parseProductUrl(url).canonicalCandidate, provider: process.env.GOOGLE_WEB_RISK_API_KEY ? new GoogleWebRiskProvider(process.env.GOOGLE_WEB_RISK_API_KEY) : null });
const imageModeration = createImageModerationService({ provider: process.env.GOOGLE_VISION_API_KEY ? new GoogleVisionSafeSearchProvider(process.env.GOOGLE_VISION_API_KEY) : null });
const reportStore = createReportStore();
const browserHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  'Accept-Language': 'en-CA,en-US;q=0.9,en;q=0.8',
};

app.use(express.json({ limit: '4mb' }));

let exchangeRateCache = null;
let exchangeRateCacheExpiresAt = 0;

app.get('/api/exchange-rates', async (_request, response) => {
  if (exchangeRateCache && Date.now() < exchangeRateCacheExpiresAt) return response.json(exchangeRateCache);
  try {
    const upstream = await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(8_000) });
    if (!upstream.ok) throw new Error(`Exchange-rate service returned ${upstream.status}`);
    const data = await upstream.json();
    if (data?.result !== 'success' || !data.rates || typeof data.rates !== 'object') throw new Error('Invalid exchange-rate response');
    const rates = Object.fromEntries(Object.entries(data.rates).filter(([, value]) => typeof value === 'number' && Number.isFinite(value) && value > 0));
    exchangeRateCache = { base: 'USD', rates, updatedAt: data.time_last_update_utc ?? new Date().toISOString() };
    exchangeRateCacheExpiresAt = Date.now() + 12 * 60 * 60 * 1000;
    return response.json(exchangeRateCache);
  } catch (error) {
    if (exchangeRateCache) return response.json(exchangeRateCache);
    return response.status(503).json({ error: error instanceof Error ? error.message : 'Exchange rates unavailable' });
  }
});

const allowedUrl = (value) => {
  try {
    const url = new URL(value);
    const blockedHosts = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);
    const privateIpv4 = /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/;
    return (url.protocol === 'https:' || url.protocol === 'http:') && !blockedHosts.has(url.hostname) && !privateIpv4.test(url.hostname);
  } catch {
    return false;
  }
};

const asText = (value) => (
  typeof value === 'string' ? value.trim()
    : typeof value === 'number' && Number.isFinite(value) ? String(value)
      : ''
);

const firstString = (...values) => values.map(asText).find(Boolean) ?? '';

const decodeHtml = (value) => asText(value)
  .replace(/&amp;/gi, '&')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/&#(x[0-9a-f]+|\d+);/gi, (entity, code) => {
    const point = code[0].toLowerCase() === 'x' ? Number.parseInt(code.slice(1), 16) : Number.parseInt(code, 10);
    return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
  })
  .replace(/&nbsp;/gi, ' ');

const stripTags = (value) => decodeHtml(asText(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' '));

const tagAttribute = (tag, attribute) => {
  const escaped = attribute.replace(/[|\\{}()[\]^$+*?.-]/g, '\\$&');
  const matcher = new RegExp("\\b" + escaped + "\\s*=\\s*([\"'])(.*?)\\1", 'i');
  return tag.match(matcher)?.[2] ?? '';
};

const tags = (html, name) => [...html.matchAll(new RegExp('<' + name + '\\b[^>]*>', 'gi'))].map((match) => match[0]);

const flattenObjects = (value) => {
  if (Array.isArray(value)) return value.flatMap(flattenObjects);
  if (!value || typeof value !== 'object') return [];
  return [value, ...Object.values(value).flatMap(flattenObjects)];
};

const productType = (value) => asList(value?.['@type']).some((type) => ['product', 'productgroup'].includes(type.toLowerCase()));

const looksLikeChallengePage = (html) => /<(?:title|h1)\b[^>]*>\s*(?:access denied|just a moment|robot check|verify you are human|captcha|are you a robot)/i.test(html.slice(0, 30_000))
  || (html.length < 8_000 && /(?:<body[^>]*>[\s\S]*?)(?:access denied|verify you are human|unusual traffic|challenge page|are you a robot|complete the captcha)/i.test(html) && !/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>/i.test(html));

const isHmUrl = (value) => {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === 'hm.com' || hostname.endsWith('.hm.com');
  } catch {
    return false;
  }
};

// H&M has used several application-state shapes over time. Keep this adapter
// deliberately structural: it keys off article/product fields, never a
// particular article number, and safely ignores malformed scripts.
const extractHmProduct = (html, pageUrl) => {
  if (!isHmUrl(pageUrl)) return null;
  let identity;
  try { identity = parseProductUrl(pageUrl); } catch { return null; }
  const articleId = identity.productId;
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  const values = scripts.flatMap(([, attributes, body]) => {
    if (!/(?:application\/json|application\/ld\+json)/i.test(attributes) && !/(?:__NEXT_DATA__|preloaded|initial|state|product)/i.test(attributes)) return [];
    try {
      const parsed = JSON.parse(decodeHtml(body.trim()));
      return flattenObjects(parsed);
    } catch {
      return [];
    }
  });
  const idFields = ['articleCode', 'articleNumber', 'articleNo', 'articleId', 'productId', 'productCode', 'sku', 'id'];
  const candidates = values.filter((value) => {
    if (!value || typeof value !== 'object') return false;
    const ids = idFields.map((field) => asText(value[field])).filter(Boolean);
    const hasIdentity = articleId && ids.includes(articleId);
    const hasProductShape = (value.name || value.title) && (value.price || value.priceValue || value.image || value.images || value.galleryImages);
    return hasIdentity || hasProductShape && (value.articleCode || value.articleNumber || value.productCode);
  });
  const candidate = candidates.sort((left, right) => {
    const score = (value) => {
      const ids = idFields.map((field) => asText(value[field]));
      return (articleId && ids.includes(articleId) ? 100 : 0) + (value.name || value.title ? 10 : 0) + (value.price || value.priceValue ? 5 : 0);
    };
    return score(right) - score(left);
  })[0];
  if (!candidate) return null;
  const imageValues = [candidate.image, candidate.imageUrl, candidate.imageURL, candidate.featuredImage, candidate.images, candidate.galleryImages]
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .map((value) => typeof value === 'object' ? value?.url ?? value?.src ?? value?.imageUrl : value)
    .map(asText)
    .filter(Boolean)
    .flatMap((value) => { try { return [new URL(value, pageUrl).toString()]; } catch { return []; } })
    .filter(allowedUrl);
  const offer = candidate.offers?.[0] ?? candidate.offer ?? candidate.priceInfo ?? {};
  const rawPrice = firstString(
    candidate.price, candidate.priceValue, candidate.currentPrice,
    candidate.price?.value, candidate.price?.amount, candidate.price?.formatted,
    offer.price, offer.value, offer.amount, offer.formatted,
  );
  const explicitCurrency = firstString(candidate.currency, candidate.priceCurrency, offer.currency, offer.priceCurrency);
  const currency = firstString(explicitCurrency, identity.currencyHint);
  const id = firstString(candidate.articleCode, candidate.articleNumber, candidate.articleNo, candidate.articleId, candidate.productId, candidate.productCode, candidate.sku, articleId);
  return {
    title: decodeHtml(firstString(candidate.name, candidate.title, candidate.productName)),
    brand: decodeHtml(firstString(candidate.brand?.name, candidate.brand, candidate.label, 'H&M')),
    productId: id,
    articleId: id,
    sku: firstString(candidate.sku, id),
    imageUrls: [...new Set(imageValues)],
    imageUrl: imageValues[0] ?? '',
    price: normalizePrice(rawPrice),
    currency: currency.toUpperCase(),
    currencyAssumed: Boolean(rawPrice && !explicitCurrency && identity.currencyHint),
    source: 'hm_adapter',
  };
};

const normalizePrice = (...values) => {
  const raw = firstString(...values.map((value) => (
    typeof value === 'object' && value !== null
      ? firstString(value.extracted_value, value.value, value.amount, value.price, value.current)
      : value
  )));
  const number = raw.match(/(?:^|[^\d])(\d[\d,]*(?:\.\d{1,2})?)(?:[^\d]|$)/)?.[1];
  return number ? number.replace(/,/g, '') : '';
};

const titleFromUrl = (value) => {
  try {
    const url = new URL(value);
    const hmProduct = url.pathname.match(/productpage\.(\d+)\.html/i);
    if (hmProduct) return `H&M product ${hmProduct[1]}`;
    const parts = url.pathname.split('/').filter(Boolean);
    const ignoreList = new Set([
      'en', 'us', 'ca', 'uk', 'eu', 'en-ca', 'en-us', 'en-gb', 'fr-ca', 'fr-fr',
      'p', 'c', 'product', 'products', 'item', 'items', 'shop', 'clothing',
      'women', 'men', '_', 'jackets-and-hoodies-jackets'
    ]);
    const candidates = parts.filter((part) => {
      const clean = part.toLowerCase();
      if (ignoreList.has(clean)) return false;
      if (/^(?:[a-z]{2}(?:[-_][a-z]{2})?)$/i.test(part)) return false;
      if (/^\d+(?:\.html)?$/i.test(part)) return false;
      if (/^prod\d+/i.test(part)) return false;
      return true;
    });
    const slugCandidate = candidates.find((part) => part.includes('-') || part.includes('_')) ?? candidates[0] ?? '';
    if (!slugCandidate) return '';
    const raw = decodeURIComponent(slugCandidate).replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').replace(/\s+P\d{5,}$/i, '');
    return decodeHtml(raw.replace(/\b\w/g, (letter) => letter.toUpperCase()));
  } catch {
    return '';
  }
};

const bingImageFallback = async (query, preferredHost = '') => {
  try {
    const searchUrl = new URL('https://www.bing.com/images/search');
    searchUrl.searchParams.set('q', query);
    const response = await fetch(searchUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Cura product preview/1.0)' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return '';
    const html = await response.text();
    const candidates = [...html.matchAll(/<a[^>]*class="[^"]*\biusc\b[^"]*"[^>]*\bm="([^"]+)"/gi)]
      .flatMap((match) => {
        try {
          const result = JSON.parse(decodeHtml(match[1]));
          const imageUrl = asText(result.murl);
          return allowedUrl(imageUrl) ? [{ imageUrl, pageUrl: asText(result.purl), title: asText(result.t) }] : [];
        } catch {
          return [];
        }
      });
    const title = query.replace(new RegExp(brandFromUrl(`https://${preferredHost}`).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), '').trim();
    const relevant = candidates.find((candidate) => relatedProduct(candidate.title, candidate.pageUrl, title, preferredHost));
    return relevant?.imageUrl ?? '';
  } catch {
    return '';
  }
};

const brandFromUrl = (value) => {
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (/(?:^|\.)hm\.com$/.test(host)) return 'H&M';
    const cleanHost = host.replace(/^(?:www\.|shop\.|store\.|us\.|ca\.|uk\.|eu\.|m\.)+/i, '');
    const brandName = cleanHost.split('.')[0];
    if (brandName === 'lululemon') return 'Lululemon';
    if (brandName === 'aritzia') return 'Aritzia';
    if (brandName === 'shoppersdrugmart') return 'Shoppers Drug Mart';
    if (brandName === 'sephora') return 'Sephora';
    return brandName.replace(/\b\w/g, (letter) => letter.toUpperCase());
  } catch {
    return '';
  }
};

// A deliberately broad range is more honest than an invented exact price when
// neither the retailer page nor a matching search listing exposes one.
const categoryPriceEstimate = (title, host) => {
  const name = asText(title).toLowerCase();
  const category = [
    [/\b(perfume|fragrance|cologne|parfum|eau de|body mist)\b/, 35, 250, 'Fragrance'],
    [/\b(hair dryer|blow dryer|curling iron|straightener|flat iron|hair styler)\b/, 35, 350, 'Hair styling tool'],
    [/\b(shampoo|conditioner|hair mask|hair oil|scalp|hair treatment|hair serum|rinse.off|leave.in|hair spray)\b/, 8, 65, 'Haircare'],
    [/\b(serum|cleanser|moisturi[sz]er|sunscreen|retinol|toner|face cream|exfoliant|skin care|skincare|eye cream)\b/, 10, 110, 'Skincare'],
    [/\b(lipstick|lip gloss|lip oil|mascara|eyeliner|blush|bronzer|concealer|foundation|makeup|eyeshadow|palette|primer|setting spray)\b/, 8, 100, 'Makeup'],
    [/\b(dress|gown|jumpsuit|romper)\b/, 40, 350, 'Dress'],
    [/\b(coat|jacket|blazer|outerwear|parka)\b/, 50, 550, 'Outerwear'],
    [/\b(skirt|pants?|trousers?|jeans?|shorts?|leggings?)\b/, 25, 220, 'Bottoms'],
    [/\b(top|shirt|blouse|tee|sweater|cardigan|hoodie|tank)\b/, 18, 200, 'Top'],
    [/\b(shoes?|boots?|sneakers?|heels?|sandals?|loafers?)\b/, 30, 300, 'Shoes'],
    [/\b(handbag|purse|tote|crossbody|backpack|clutch|bag)\b/, 25, 450, 'Bag'],
    [/\b(earrings?|necklace|bracelet|ring|jewelry|jewellery|sunglasses|watch)\b/, 10, 300, 'Accessory'],
    [/\b(candle|diffuser|room spray)\b/, 8, 90, 'Home fragrance'],
    [/\b(bedding|duvet|pillow|sheet set|blanket|throw)\b/, 20, 250, 'Home textile'],
    [/\b(headphones?|earbuds?|speaker|keyboard|mouse|monitor|laptop|tablet)\b/, 30, 900, 'Electronics'],
  ].find(([pattern]) => pattern.test(name));
  const [, categoryLow = 10, categoryHigh = 250, label = 'General product'] = category ?? [/.*/, 10, 250, 'General product'];
  const highEnd = /\b(dior|chanel|gucci|prada|herm[eè]s|saint laurent|tom ford|louis vuitton|loewe)\b/i.test(`${title} ${host}`);
  const multiplier = highEnd ? 2 : 1;
  const low = Math.round(categoryLow * multiplier);
  const high = Math.round(categoryHigh * multiplier);
  return {
    price: String(Math.round((low + high) / 2)),
    estimateLow: String(low),
    estimateHigh: String(high),
    priceEstimated: true,
    priceReference: `${label} price estimate (listing price unavailable)`,
  };
};

const currencyFromUrl = (url) => {
  try {
    const text = String(url).toLowerCase();
    if (text.includes('/en-ca/') || text.includes('/en_ca/') || text.includes('/ca/') || text.includes('.ca/') || text.includes('londondrugs.com/')) return 'CAD';
    if (text.includes('/en-gb/') || text.includes('.co.uk/')) return 'GBP';
    if (text.includes('/en-eu/') || text.includes('/fr/') || text.includes('/de/') || text.includes('.eu/')) return 'EUR';
    if (text.includes('/en-au/') || text.includes('.com.au/')) return 'AUD';
  } catch {}
  return 'USD';
};

const shoppingResultLink = (result, value) => {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const nonShoppingHost = host.startsWith('pinterest.')
      || ['instagram.com', 'facebook.com', 'tiktok.com', 'youtube.com', 'reddit.com', 'twitter.com', 'x.com', 'tumblr.com']
        .some((domain) => host === domain || host.endsWith(`.${domain}`));
    if (nonShoppingHost) return false;

    const marketplace = /(amazon\.|ebay\.|etsy\.|poshmark\.|depop\.|mercari\.|grailed\.|vestiairecollective\.|therealreal\.|vinted\.|shopgoodwill\.|paypayfleamarket\.yahoo\.|item\.fril\.|rakuten\.|shopping\.yahoo\.|zozo\.)/i.test(host);
    const productPath = /\/(?:products?|item|items|itm|listing|listings|dp|gp\/product|p)\//i.test(url.pathname);
    const hasCommerceData = Boolean(normalizePrice(result.price?.extracted_value, result.price, result.extracted_price, result.price_info))
      || typeof result.in_stock === 'boolean'
      || Boolean(asText(result.merchant));
    return marketplace || productPath || hasCommerceData;
  } catch {
    return false;
  }
};

const visualCategoryTerms = (piece) => piece.includes('top')
  ? ['top', 'shirt', 'blouse', 'sweater', 'cardigan', 'knit', 'pullover', 'tee', 'jumper', 'トップス', 'ブラウス', 'シャツ', 'ニット', '블라우스', '셔츠', 'camisa', 'chemise', 'bluse']
  : piece.includes('skirt') ? ['skirt', 'スカート', '치마', 'falda', 'jupe', 'rock']
    : piece.includes('pant') || piece.includes('jean') || piece.includes('trouser') ? ['pant', 'trouser', 'jean', 'パンツ', '바지', 'pantalon', 'hose']
      : piece.includes('short') ? ['short', 'ショートパンツ', '반바지', 'pantalón corto', 'shorts']
        : piece.includes('bottom') ? ['skirt', 'pant', 'trouser', 'jean', 'short', 'スカート', 'パンツ', '바지', '치마', 'falda', 'pantalon', 'jupe', 'hose']
          : piece.includes('shoe') ? ['shoe', 'heel', 'pump', 'sandal', 'boot', 'sneaker', 'loafer', '靴', 'シューズ', 'パンプス', 'サンダル', 'ブーツ', '구두', '신발', 'zapato', 'chaussure', 'schuh', 'scarpa']
      : piece.includes('bag') ? ['bag', 'purse', 'tote', 'handbag', 'satchel', 'clutch', 'バッグ', '鞄', 'かばん', '가방', 'bolso', 'sac', 'tasche', 'borsa']
        : piece.includes('outer') ? ['jacket', 'coat', 'blazer', 'outerwear', 'ジャケット', 'コート', '재킷', '코트', 'chaqueta', 'manteau', 'jacke']
          : piece.includes('dress') || piece.includes('jumpsuit') ? ['dress', 'gown', 'jumpsuit', 'romper', 'ワンピース', 'ドレス', '원피스', 'vestido', 'robe', 'kleid', 'abito']
            : piece.includes('access') ? ['earring', 'necklace', 'bracelet', 'watch', 'belt', 'scarf', 'glasses', 'sunglasses', 'イヤリング', 'ネックレス', 'ベルト', 'スカーフ', '목걸이', 'cinturón', 'ceinture']
              : [];

const matchesVisualCategory = (result, terms) => {
  if (!terms.length) return true;
  const title = result.title.toLowerCase()
    .replace(/^amazon\.[^:]+:\s*/i, '')
    .replace(/\s*:\s*clothing\s*,?\s*shoes?\s*(?:&|and)\s*jewelry.*$/i, '')
    .replace(/\s*[-|]\s*(?:amazon|walmart|ebay|etsy).*$/i, '');
  return terms.some((term) => /[^\x00-\x7F]/.test(term)
    ? title.includes(term)
    : new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(title));
};

const visualSearchQuery = (piece) => piece.includes('shoe') ? 'shoes heels pumps sandals boots sneakers loafers'
  : piece.includes('bag') ? 'handbag purse tote clutch bag'
    : piece.includes('pant') || piece.includes('jean') ? 'pants jeans trousers'
      : piece.includes('skirt') ? 'skirt'
        : piece.includes('short') ? 'shorts'
          : piece;

const relatedProduct = (resultTitle, resultUrl, title, host) => {
  const terms = [...new Set(asText(title).toLowerCase().split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !['the', 'and', 'for', 'with', 'www', 'com'].includes(word)))];
  if (!terms.length) return false;
  const text = `${resultTitle} ${resultUrl}`.toLowerCase();
  const matches = terms.filter((term) => text.includes(term)).length;
  return matches >= Math.min(terms.length, Math.max(2, Math.ceil(terms.length * 0.7)));
};

const shoppingRelevance = (resultTitle, title) => {
  const meaningful = (value) => [...new Set(asText(value).toLowerCase().replace(/(\d)\s+(ml|oz|g)\b/g, '$1$2')
    .split(/[^a-z0-9]+/).filter((word) => word.length > 2 && !['the', 'and', 'for', 'with', 'from', 'product', 'shop', 'buy', 'online'].includes(word)))];
  const expected = meaningful(title);
  if (!expected.length) return 0;
  const actual = new Set(meaningful(resultTitle));
  const volume = expected.filter((word) => /^\d+(?:ml|oz|g)$/.test(word));
  if (volume.length && !volume.every((word) => actual.has(word))) return 0;
  return expected.filter((word) => actual.has(word)).length / expected.length;
};

const googleShoppingReference = async (pageUrl, title, brand) => {
  if (!serpApiKey) return null;
  try {
    const host = new URL(pageUrl).hostname.replace(/^www\./, '');
    const search = new URL('https://serpapi.com/search.json');
    search.searchParams.set('engine', 'google_shopping');
    search.searchParams.set('q', title);
    search.searchParams.set('gl', currencyFromUrl(pageUrl) === 'CAD' ? 'ca' : 'us');
    search.searchParams.set('api_key', serpApiKey);
    const response = await fetch(search, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;
    const data = await response.json();
    const matches = (Array.isArray(data.shopping_results) ? data.shopping_results : [])
      .map((item) => ({ item, relevance: shoppingRelevance(item.title, title) }))
      .filter(({ item, relevance }) => relevance >= 0.6 && normalizePrice(item.extracted_price, item.price, item.price_info))
      .sort((left, right) => {
        const retailer = (value) => `${value.source} ${value.link}`.toLowerCase().includes(host.split('.')[0]);
        return Number(retailer(right.item)) - Number(retailer(left.item)) || right.relevance - left.relevance;
      });
    const match = matches[0]?.item;
    if (!match) return null;
    const imageUrl = firstString(match.thumbnail, match.image);
    const sameRetailer = `${match.source} ${match.link}`.toLowerCase().includes(host.split('.')[0]);
    let exactProduct = false;
    try {
      const targetIdentity = parseProductUrl(pageUrl);
      const resultIdentity = parseProductUrl(asText(match.link));
      exactProduct = sameRetailer && targetIdentity.baseDomain === resultIdentity.baseDomain
        && [targetIdentity.productId, targetIdentity.sku].filter(Boolean).some((id) =>
          [resultIdentity.productId, resultIdentity.sku, ...resultIdentity.candidateIdentifiers].includes(id));
    } catch {}
    return {
      title: firstString(match.title, title), brand,
      price: normalizePrice(match.extracted_price, match.price, match.price_info),
      currency: /^(?:CAD|USD|EUR|GBP|AUD|JPY|CHF)$/i.test(asText(match.currency)) ? asText(match.currency).toUpperCase() : currencyFromUrl(pageUrl),
      imageUrl: allowedUrl(imageUrl) ? imageUrl : '',
      imageUrls: allowedUrl(imageUrl) ? [imageUrl] : [],
      priceEstimated: !exactProduct,
      priceReference: exactProduct ? 'Exact retailer product listing' : sameRetailer ? 'Related retailer listing estimate' : 'Comparable Google Shopping price estimate',
      exactProduct,
    };
  } catch { return null; }
};

const officialSearchPrice = async (pageUrl) => {
  if (!serpApiKey) return null;
  try {
    const target = new URL(pageUrl);
    const targetIdentity = parseProductUrl(pageUrl);
    const search = new URL('https://serpapi.com/search.json');
    search.searchParams.set('engine', 'google');
    search.searchParams.set('q', `site:${target.hostname}${target.pathname} price`);
    search.searchParams.set('gl', currencyFromUrl(pageUrl) === 'CAD' ? 'ca' : 'us');
    search.searchParams.set('api_key', serpApiKey);
    const response = await fetch(search, { signal: AbortSignal.timeout(9_000) });
    if (!response.ok) return null;
    const data = await response.json();
    const exact = (Array.isArray(data.organic_results) ? data.organic_results : []).find((result) => {
      try {
        const candidateIdentity = parseProductUrl(result.link);
        return candidateIdentity.baseDomain === targetIdentity.baseDomain
          && [targetIdentity.productId, targetIdentity.sku].filter(Boolean).some((id) =>
            [candidateIdentity.productId, candidateIdentity.sku, ...candidateIdentity.candidateIdentifiers].includes(id));
      } catch { return false; }
    });
    const price = normalizePrice(
      exact?.rich_snippet?.top?.detected_extensions?.price,
      exact?.rich_snippet?.bottom?.detected_extensions?.price,
      exact?.snippet?.match(/(?:our|current|sale)\s+price\s*:?\s*(?:CA|C)?\$\s*(\d[\d,.]*)/i)?.[1],
    );
    if (!exact) return null;
    const indexedTitle = decodeHtml(asText(exact.title).replace(/\s*[|–-]\s*H&M.*$/i, '').trim());
    const indexedImage = firstString(exact.thumbnail);
    return {
      title: indexedTitle,
      price,
      currency: currencyFromUrl(pageUrl),
      imageUrl: allowedUrl(indexedImage) ? indexedImage : '',
      imageUrls: allowedUrl(indexedImage) ? [indexedImage] : [],
      priceEstimated: false,
      priceReference: price ? 'Exact retailer product listing' : '',
      exactProduct: Boolean(price),
    };
  } catch { return null; }
};

const duckDuckGoImageFallback = async (query) => {
  try {
    const searchUrl = 'https://duckduckgo.com/?q=' + encodeURIComponent(query);
    const pageRes = await fetch(searchUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(8000),
    });
    if (!pageRes.ok) return [];
    const pageText = await pageRes.text();
    const vqd = pageText.match(/vqd=([^&"']+)/)?.[1] || pageText.match(/vqd="([^"]+)"/)?.[1];
    if (!vqd) return [];
    const imgRes = await fetch(`https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(query)}&vqd=${vqd}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(8000),
    });
    if (!imgRes.ok) return [];
    const data = await imgRes.json();
    return (Array.isArray(data.results) ? data.results : []).filter((r) => allowedUrl(r?.image));
  } catch {
    return [];
  }
};

const findProductImageFallback = async (query, brand, title, preferredHost = '') => {
  const keywords = `${brand} ${title}`.toLowerCase().split(/\s+/).filter((k) => k.length > 2);
  const isJacket = /(jacket|coat|hoodie|outerwear)/i.test(title);
  const isPants = /(pant|legging|tight|trouser|bottom)/i.test(title);

  const ddgResults = await duckDuckGoImageFallback(query);
  if (ddgResults.length) {
    const filtered = ddgResults.filter((r) => {
      const text = `${r.title} ${r.image}`.toLowerCase();
      if (isJacket && (text.includes('legging') || text.includes('pant') || text.includes('tight') || text.includes('bra'))) return false;
      if (isPants && text.includes('jacket')) return false;
      return relatedProduct(r.title, firstString(r.url, r.image), title, preferredHost);
    });

    const official = filtered.find((r) => r.image.includes('images.lululemon.com') || r.image.includes('assets.aritzia.com') || r.image.includes('scene7.com') || r.image.includes('lystit.com'));
    if (official) return { imageUrl: official.image, imageUrls: filtered.slice(0, 8).map((r) => r.image) };

    const matchingTitle = filtered.find((r) => keywords.some((kw) => r.title.toLowerCase().includes(kw)));
    if (matchingTitle) return { imageUrl: matchingTitle.image, imageUrls: filtered.slice(0, 8).map((r) => r.image) };
  }

  const bingImg = await bingImageFallback(query, preferredHost);
  return bingImg ? { imageUrl: bingImg, imageUrls: [bingImg] } : { imageUrl: '', imageUrls: [] };
};

const blockedRetailerFallback = async (pageUrl, needsImage = true, knownProduct = {}) => {
  const knownBrand = firstString(knownProduct.brand);
  const retailer = parseProductUrl(pageUrl).retailer || brandFromUrl(pageUrl);
  const title = firstString(knownProduct.title, titleFromUrl(pageUrl));
  const brand = knownBrand && knownBrand.toLowerCase() !== retailer.toLowerCase()
    ? knownBrand : title.match(/^([A-Za-z][A-Za-z0-9-]{2,})\s+/)?.[1] ?? '';
  const inferredBrand = knownBrand && knownBrand.toLowerCase() !== retailer.toLowerCase()
    ? knownBrand : title.match(/^([A-Za-z][A-Za-z0-9-]{2,})\s+/)?.[1] ?? '';
  const host = new URL(pageUrl).hostname.replace(/^www\./i, '');
  const currency = currencyFromUrl(pageUrl);

  const colorParam = new URL(pageUrl).searchParams.get('color') || '';
  const query = [brand || retailer, title, colorParam && !/^\d+$/.test(colorParam) ? colorParam : ''].filter(Boolean).join(' ');
  const imageQuery = [brand, title].filter(Boolean).join(' ');

  const base = {
    title: title || 'Saved product',
    brand: brand,
    retailer,
    imageUrl: '',
    imageUrls: [],
    price: '',
    estimateLow: '',
    estimateHigh: '',
    priceEstimated: false,
    currency: currency,
    availability: 'Normal availability',
    stockCount: '',
    colors: [],
    sizes: [],
    priceReference: '',
    imageFallbackTried: true,
  };

  const imageFallback = needsImage
    ? Promise.race([
      findProductImageFallback(imageQuery, brand, title, host),
      new Promise((resolvePromise) => setTimeout(() => resolvePromise({ imageUrl: '', imageUrls: [] }), 9_000)),
    ])
    : Promise.resolve({ imageUrl: '', imageUrls: [] });
  const images = await imageFallback;
  return {
    ...base,
    brand: knownBrand && knownBrand.toLowerCase() !== retailer.toLowerCase() ? knownBrand : inferredBrand,
    imageUrl: images.imageUrl,
    imageUrls: images.imageUrls,
    price: '',
    currency: base.currency,
    estimateLow: '',
    estimateHigh: '',
    priceEstimated: false,
    priceReference: '',
    imageIsGuess: Boolean(images.imageUrl),
    imageSource: images.imageUrl ? 'best_guess_image' : '',
  };
};

/* Disabled Roboflow segmentation implementation (kept out of the running app).
const normalisePoints = (value) => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((point) => {
    const x = Array.isArray(point) ? Number(point[0]) : Number(point?.x);
    const y = Array.isArray(point) ? Number(point[1]) : Number(point?.y);
    return Number.isFinite(x) && Number.isFinite(y) ? [{ x, y }] : [];
  });
};

// Workflows can name their output block freely. Find the first prediction list
// with segmentation polygons instead of depending on a generated output name.
const findSegmentationPredictions = (value) => {
  if (Array.isArray(value)) {
    if (value.some((entry) => normalisePoints(entry?.points).length >= 3)) return value;
    for (const entry of value) {
      const found = findSegmentationPredictions(entry);
      if (found.length) return found;
    }
    return [];
  }
  if (value && typeof value === 'object') {
    for (const nested of Object.values(value)) {
      const found = findSegmentationPredictions(nested);
      if (found.length) return found;
    }
  }
  return [];
};

const callRoboflowWorkflow = async (body) => {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const result = await fetch(roboflowWorkflowUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${roboflowApiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const data = await result.json().catch(() => ({}));
      if (result.ok) return data;
      const message = firstString(data?.message, data?.error, data?.detail, 'Outfit detection failed.');
      if (result.status < 500 || attempt === 1) throw new Error(message);
      lastError = new Error(message);
    } catch (error) {
      lastError = error;
      if (attempt === 1) throw error;
    } finally {
      clearTimeout(timeout);
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw lastError ?? new Error('Outfit detection failed.');
};

*/
const asList = (value) => {
  if (Array.isArray(value)) return value.flatMap(asList);
  if (typeof value !== 'string') return [];
  return value.split(/[,/|]/).map((part) => part.trim()).filter(Boolean);
};

const findMeta = (html, property) => {
  const wanted = property.toLowerCase();
  const meta = tags(html, 'meta').find((tag) => {
    const key = firstString(tagAttribute(tag, 'property'), tagAttribute(tag, 'name'), tagAttribute(tag, 'itemprop')).toLowerCase();
    return key === wanted;
  });
  return meta ? firstString(tagAttribute(meta, 'content'), tagAttribute(meta, 'value')) : '';
  /*
  const matcher = new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i');
  return html.match(matcher)?.[1] ?? '';
  */
};

const findMarkupValue = (html, property) => {
  const wanted = property.toLowerCase();
  const element = tags(html, '[a-zA-Z][a-zA-Z0-9:-]*').find((tag) =>
    tagAttribute(tag, 'itemprop').toLowerCase().split(/\s+/).includes(wanted),
  );
  return element
    ? firstString(tagAttribute(element, 'content'), tagAttribute(element, 'value'), tagAttribute(element, 'data-price'), tagAttribute(element, 'src'), tagAttribute(element, 'href'))
    : '';
};

const documentTitle = (html) => {
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return stripTags(h1 || title || '');
};

const collectImageUrls = (value) => {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(collectImageUrls);
  if (value && typeof value === 'object') return [value.url, value.contentUrl, value.image].flatMap(collectImageUrls);
  return [];
};

// Retailers often put a campaign/model photo first. Prefer a product or
// pack-shot URL when the page gives us a gallery, while retaining a safe
// fallback for retailers with less descriptive CDN filenames.
const productImageScore = (url) => {
  const text = url.toLowerCase();
  let score = 0;
  if (/(product|packshot|pack-shot|flat|pdp|primary|main|front|sku|catalog|still)/.test(text)) score += 20;
  if (/(model|lookbook|lifestyle|editorial|campaign|outfit|ugc|scene)/.test(text)) score -= 35;
  if (/(swatch|thumbnail|thumb|icon|logo|placeholder)/.test(text)) score -= 60;
  if (/(?:w|width)=([8-9]\d\d|[1-9]\d{3,})/.test(text)) score += 3;
  return score;
};

const structuredCurrentOffer = (product) => {
  const offers = Array.isArray(product?.offers) ? product.offers : product?.offers ? [product.offers] : [];
  const eligible = offers.filter((entry) => {
    const type = asText(entry?.['@type'] ?? entry?.type).toLowerCase();
    if (type.includes('aggregateoffer')) return false;
    const validThrough = Date.parse(asText(entry?.priceValidUntil ?? entry?.validThrough));
    return !Number.isFinite(validThrough) || validThrough >= Date.now();
  });
  const offer = eligible.length === 1 ? eligible[0] : eligible.length > 1
    ? eligible.find((entry) => asText(entry?.sku) && asText(entry.sku) === asText(product?.sku)) : undefined;
  const specifications = Array.isArray(offer?.priceSpecification) ? offer.priceSpecification : offer?.priceSpecification ? [offer.priceSpecification] : [];
  const usableSpecs = specifications.filter((spec) => !/(?:msrp|rrp|list|strikethrough|compare)/i.test(asText(spec?.priceType ?? spec?.['@type'])));
  const saleSpec = usableSpecs.find((spec) => /sale|current|selling/i.test(asText(spec?.priceType ?? spec?.['@type'])));
  const spec = saleSpec ?? (usableSpecs.length === 1 ? usableSpecs[0] : undefined);
  const explicitCurrent = [product?.salePrice, product?.currentPrice, product?.offerPrice, product?.sellingPrice,
    offer?.salePrice, offer?.currentPrice, offer?.offerPrice, offer?.sellingPrice, spec?.price,
    offer?.price, product?.price];
  const raw = explicitCurrent.find((value) => value !== undefined && value !== null && value !== '') ?? '';
  const numeric = Number(typeof raw === 'object' ? raw.value ?? raw.amount ?? raw.price : String(raw).replace(/[^\d.]/g, ''));
  const currency = firstString(spec?.priceCurrency, offer?.priceCurrency, offer?.currency, product?.priceCurrency).toUpperCase();
  if (!Number.isFinite(numeric) || numeric <= 0) return { price: '', currency: '' };
  return { price: String(numeric), currency, sourceOffer: offer, offerType: saleSpec ? 'SALE_PRICE' : 'CURRENT_PRICE' };
};

const extractShopifyProduct = async (pageUrl, preferredSize = '', sizePreferences = {}, selectedVariantId = '', marketCountry = '') => {
  const url = new URL(pageUrl);
  const match = url.pathname.match(/\/products\/([^/?]+)/i);
  if (!match) return null;
  try {
    const endpoint = new URL(`/products/${match[1]}.js`, url.origin);
    const result = await secureFetch(endpoint, {
      headers: { 'User-Agent': 'Cura product resolver/1.0' },
      allowedTypes: ['application/json', 'application/javascript', 'text/javascript', 'text/plain'],
      maximumBytes: 1_500_000,
      timeout: 8_000,
    });
    if (!result.response.ok) return null;
    const product = JSON.parse(result.bytes.toString('utf8'));
    if (!asText(product?.title)) return null;
    const options = Array.isArray(product.options) ? product.options : [];
    const optionValues = (expression) => options
      .filter((option) => expression.test(asText(option?.name)))
      .flatMap((option) => Array.isArray(option?.values) ? option.values : [])
      .map(asText)
      .filter(Boolean);
    const titleParts = asText(product.title).split('|').map((part) => part.trim()).filter(Boolean);
    const titleColour = titleParts.length > 1 ? titleParts[titleParts.length - 1] : '';
    const categoryText = asText(product.title).toLowerCase();
    const isShoe = /\b(shoe|sneaker|boot|heel|sandal|loafer|flat)\b/.test(categoryText);
    const sizeCategory = isShoe ? 'shoes'
      : /\b(dress|jumpsuit|romper|gown)\b/.test(categoryText) ? 'dresses'
        : /\b(skirt|short|pant|trouser|jean|legging|bottom)\b/.test(categoryText) ? 'bottoms'
          : /\b(top|shirt|blouse|crop|bra|sweater|cardigan|jacket|coat|activewear)\b/.test(categoryText) ? 'tops' : '';
    const categoryPreference = sizeCategory ? sizePreferences[sizeCategory] : null;
    const generalPreference = sizePreferences.generalClothing;
    const legacySize = sizeCategory === 'shoes' ? sizePreferences.shoe
      : sizeCategory === 'dresses' ? sizePreferences.dress
        : sizeCategory === 'bottoms' ? sizePreferences.bottom : sizePreferences.top;
    const requestedSize = sizeCategory ? asText(categoryPreference?.value) || asText(generalPreference?.value) || asText(legacySize) || preferredSize : '';
    const sourceRegion = asText(categoryPreference?.system) || asText(generalPreference?.system) || asText(sizePreferences.region) || 'US/CA';
    const price = Number(product.price);
    const variants = Array.isArray(product.variants) ? product.variants : [];
    const sizeOptionIndex = options.findIndex((option) => /size/i.test(asText(option?.name)));
    const normalizedPreferredSize = requestedSize.toLowerCase().replace(/[^a-z0-9]/g, '');
    const sizeAliases = new Map([
      ['xs', ['xs', 'extrasmall']], ['extrasmall', ['xs', 'extrasmall']],
      ['s', ['s', 'small']], ['small', ['s', 'small']],
      ['m', ['m', 'medium']], ['medium', ['m', 'medium']],
      ['l', ['l', 'large']], ['large', ['l', 'large']],
      ['xl', ['xl', 'extralarge']], ['extralarge', ['xl', 'extralarge']],
      ['xxl', ['xxl', '2xl', 'doubleextralarge']], ['2xl', ['xxl', '2xl', 'doubleextralarge']],
    ]);
    const acceptedSizes = new Set(sizeAliases.get(normalizedPreferredSize) ?? [normalizedPreferredSize]);
    const requestedNumeric = Number(requestedSize);
    if (Number.isFinite(requestedNumeric)) {
      const targetRegion = ({ GB: 'UK', AU: 'AU', CA: 'US/CA', US: 'US/CA' })[marketCountry] ?? (marketCountry && marketCountry !== 'US' && marketCountry !== 'CA' ? 'EU' : sourceRegion);
      // Numeric international conversions vary by category and brand. Only compare
      // an exact numeric size when the user's system matches the retailer market.
      if (targetRegion !== sourceRegion) acceptedSizes.clear();
    }
    const sizeForVariant = (variant) => asText(Array.isArray(variant?.options) ? variant.options[sizeOptionIndex] : variant?.[`option${sizeOptionIndex + 1}`]);
    const sizeMatchingVariants = normalizedPreferredSize && sizeOptionIndex >= 0
      ? variants.filter((variant) => acceptedSizes.has(sizeForVariant(variant).toLowerCase().replace(/[^a-z0-9]/g, '')))
      : [];
    const selectedVariant = selectedVariantId ? variants.find((variant) => String(variant?.id) === selectedVariantId) : null;
    const selectedVariantMatchesSize = selectedVariant && (!normalizedPreferredSize || acceptedSizes.has(sizeForVariant(selectedVariant).toLowerCase().replace(/[^a-z0-9]/g, '')));
    const selectedPrice = Number(selectedVariantMatchesSize ? selectedVariant?.price : product.price);
    const distinctVariantSizes = [...new Set(variants.map(sizeForVariant).filter(Boolean))];
    const oneSizeProduct = sizeOptionIndex < 0 || distinctVariantSizes.length === 1 || distinctVariantSizes.every((size) => /^(?:one size|one-size|os|o\/s)$/i.test(size));
    const selectedOptions = Array.isArray(selectedVariant?.options) ? selectedVariant.options : [];
    const sameNonSizeVariant = (variant) => !selectedVariant || !Array.isArray(variant?.options) || variant.options.every((value, index) => index === sizeOptionIndex || asText(value) === asText(selectedOptions[index]));
    const sameProductContextMatches = sizeMatchingVariants.filter(sameNonSizeVariant);
    const candidateVariants = selectedVariantMatchesSize ? [selectedVariant]
      : selectedVariant && normalizedPreferredSize ? sameProductContextMatches
        : normalizedPreferredSize ? sizeMatchingVariants
          : oneSizeProduct ? selectedVariant ? [selectedVariant] : variants : [];
    const availabilityStates = new Set(candidateVariants.map((variant) => variant?.available).filter((value) => typeof value === 'boolean'));
    const availabilityConsistent = candidateVariants.length > 0 && availabilityStates.size === 1;
    const matchingVariants = availabilityConsistent ? candidateVariants : [];
    const entireProductSoldOut = product.available === false || (variants.length > 0 && variants.every((variant) => variant?.available === false));
    const inventoryCounts = matchingVariants
      .flatMap((variant) => variant?.inventory_quantity === null || variant?.inventory_quantity === undefined || variant?.inventory_quantity === '' ? [] : [Number(variant.inventory_quantity)])
      .filter(Number.isFinite);
    const matchedAvailable = matchingVariants[0]?.available === true;
    const matchedSize = matchingVariants.length ? sizeForVariant(matchingVariants[0]) : '';
    const imageUrls = [product.featured_image, ...(Array.isArray(product.images) ? product.images : [])].flatMap((value) => {
      try {
        const imageUrl = new URL(asText(value), url.origin).toString();
        return allowedUrl(imageUrl) ? [imageUrl] : [];
      } catch {
        return [];
      }
    });
    return {
      title: asText(product.title),
      brand: asText(product.vendor),
      imageUrls: [...new Set(imageUrls)],
      price: Number.isFinite(selectedPrice) ? String(selectedPrice / 100) : '',
      currency: currencyFromUrl(pageUrl),
      currencyAssumed: Boolean(currencyFromUrl(pageUrl)),
      availability: entireProductSoldOut ? 'OutOfStock' : matchingVariants.length ? matchedAvailable ? 'InStock' : 'OutOfStock' : '',
      stockCount: inventoryCounts.length ? String(inventoryCounts.reduce((total, count) => total + count, 0)) : '',
      colors: [...new Set([...optionValues(/colou?r/i), titleColour].filter(Boolean))],
      sizes: optionValues(/size/i),
      matchedSize,
      matchedVariantId: selectedVariantMatchesSize ? String(selectedVariant?.id ?? '') : matchingVariants.length ? String(matchingVariants[0]?.id ?? '') : '',
      availabilityVerified: entireProductSoldOut || Boolean(matchingVariants.length),
    };
  } catch {
    return null;
  }
};

export const extractProduct = (html, pageUrl) => {
  const identity = parseProductUrl(pageUrl);
  if (looksLikeChallengePage(String(html))) {
    return { title: '', brand: '', imageUrl: '', imageUrls: [], price: '', currency: identity.currencyHint, availability: '', stockCount: '', colors: [], sizes: [], productId: identity.productId, sku: identity.sku };
  }
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  const candidates = scripts.flatMap((match) => {
    if (!/(?:type\s*=\s*["']application\/(?:ld\+json|json)(?:\s*;[^"']*)?["']|id\s*=\s*["']__NEXT_DATA__["'])/i.test(match[1])) return [];
    try {
      const value = JSON.parse(decodeHtml(match[2].trim()));
      return flattenObjects(value);
    } catch {
      return [];
    }
  });
  const products = candidates.filter((value) => productType(value) || (value?.title && (value?.variants || value?.images) && value?.handle));
  const product = products.map((value) => {
    const identifiers = [value.sku, value.productID, value.productId, value.id].map(asText);
    const urls = [value.url, value['@id']].map(asText);
    const exactId = identity.candidateIdentifiers.some((id) => identifiers.includes(id));
    const exactUrl = urls.some((url) => { try { return parseProductUrl(new URL(url, pageUrl).toString()).normalizedUrl === identity.normalizedUrl; } catch { return false; } });
    const conflicts = identity.candidateIdentifiers.length && identifiers.some(Boolean) && !exactId;
    return { value, score: conflicts ? -100 : (exactId ? 100 : 0) + (exactUrl ? 100 : 0) + (value.name || value.title ? 5 : 0) + (value.offers ? 2 : 0) };
  }).filter(({ score }) => score >= 0).sort((a, b) => b.score - a.score)[0]?.value;
  const embeddedVariantPrice = product?.handle && product?.variants?.[0]?.price != null
    ? String(Number(product.variants[0].price) / 100) : '';
  const currentOffer = structuredCurrentOffer(product);
  const offer = currentOffer.sourceOffer;
  const properties = Array.isArray(product?.additionalProperty) ? product.additionalProperty : [];
  const propertyValues = (name) => properties.filter((property) => asText(property?.name).toLowerCase() === name).flatMap((property) => asList(property?.value));
  const page = new URL(pageUrl);
  const selectedColorCode = [...page.searchParams.entries()].find(([key]) => /(?:^|_)colou?r$/i.test(key))?.[1] ?? '';
  const selectedSize = [...page.searchParams.entries()].find(([key]) => /(?:^|_)size$/i.test(key))?.[1] ?? '';
  const selectedColorName = html.match(/"selectedProductUrl"\s*:\s*"[^"]*"[\s\S]{0,1800}?"colors"\s*:\s*\{\s*"selected"\s*:\s*\{[\s\S]{0,900}?"displayValue"\s*:\s*"([^"]+)"/i)?.[1]
    ?? html.match(/"colors"\s*:\s*\{\s*"selected"\s*:\s*\{[\s\S]{0,900}?"displayValue"\s*:\s*"([^"]+)"/i)?.[1]
    ?? '';
  const preloadImage = tags(html, 'link').find((tag) =>
    tagAttribute(tag, 'rel').toLowerCase() === 'preload'
      && tagAttribute(tag, 'as').toLowerCase() === 'image'
      && (!selectedColorCode || decodeHtml(tagAttribute(tag, 'href')).toLowerCase().includes(selectedColorCode.toLowerCase())),
  );
  const rawImageUrls = [...new Set([
    preloadImage ? decodeHtml(tagAttribute(preloadImage, 'href')) : '',
    ...collectImageUrls(product?.image),
    ...collectImageUrls(product?.images),
    findMeta(html, 'og:image'),
    findMeta(html, 'twitter:image'),
    findMarkupValue(html, 'image'),
  ].filter(allowedUrl))];
  const imageUrls = rawImageUrls
    .sort((left, right) => {
      if (!selectedColorCode) return 0;
      return Number(right.toLowerCase().includes(selectedColorCode.toLowerCase())) - Number(left.toLowerCase().includes(selectedColorCode.toLowerCase()));
    })
    .slice(0, 12);
  const title = decodeHtml(firstString(product?.name, product?.title, findMeta(html, 'og:title'), findMeta(html, 'twitter:title'), findMarkupValue(html, 'name'), documentTitle(html)));
  const titleColour = title.match(/\bin\s+([a-z][a-z -]{2,})$/i)?.[1]?.trim() ?? '';
  const hm = extractHmProduct(html, pageUrl);
  const result = {
    title,
    brand: decodeHtml(firstString(product?.brand?.name, product?.brand, product?.vendor, findMarkupValue(html, 'brand'), findMeta(html, 'og:site_name'))),
    imageUrl: imageUrls[0] ?? '',
    imageUrls,
    price: firstString(currentOffer.price, embeddedVariantPrice, normalizePrice(findMeta(html, 'product:price:amount'), findMeta(html, 'og:price:amount'), findMeta(html, 'price'), findMarkupValue(html, 'price'))),
    currency: firstString(currentOffer.currency, offer?.priceCurrency, product?.priceCurrency, findMeta(html, 'product:price:currency'), findMarkupValue(html, 'priceCurrency')),
    availability: firstString(offer?.availability, findMeta(html, 'product:availability'), findMarkupValue(html, 'availability')),
    stockCount: firstString(offer?.inventoryLevel?.value, offer?.inventoryLevel?.quantity, offer?.inventoryQuantity, product?.inventoryQuantity),
    colors: [...new Set([selectedColorName, ...asList(product?.color), ...propertyValues('color'), titleColour].filter(Boolean))],
    sizes: [...new Set([selectedSize, ...asList(product?.size), ...propertyValues('size')].filter(Boolean))],
    productId: firstString(hm?.productId, product?.sku, product?.productID, product?.productId, identity.productId),
    sku: firstString(hm?.sku, product?.sku),
    upc: firstString(product?.upc, product?.gtin12, identity.upc),
    gtin: firstString(product?.gtin, product?.gtin13, product?.gtin14, identity.gtin),
    ean: firstString(product?.ean, product?.gtin13, identity.ean),
  };
  if (!hm) return result;
  return {
    ...result,
    title: firstString(hm.title, result.title),
    brand: firstString(hm.brand, result.brand),
    imageUrl: firstString(hm.imageUrl, result.imageUrl),
    imageUrls: [...new Set([...(hm.imageUrls ?? []), ...result.imageUrls])],
    price: firstString(hm.price, result.price),
    currency: firstString(hm.currency, result.currency),
    currencyAssumed: Boolean(hm.currencyAssumed || result.currencyAssumed),
    productId: firstString(hm.productId, result.productId),
    sku: firstString(hm.sku, result.sku),
    fieldSources: { title: 'hm_adapter', brand: 'hm_adapter', imageUrl: 'hm_adapter', price: 'hm_adapter', currency: 'hm_adapter', productId: 'hm_adapter' },
  };
};

export const directProductResolver = async (context) => {
  const page = await secureFetch(context.normalizedUrl, {
    headers: browserHeaders,
    allowedTypes: ['text/html', 'application/xhtml+xml'],
    maximumBytes: 3_000_000,
    timeout: 7_000,
  });
  if (!page.response.ok) throw new Error(`HTTP_${page.response.status}`);
  const html = page.bytes.toString('utf8');
  if (looksLikeChallengePage(html)) throw new Error('BOT_CHALLENGE');
  const metadata = extractProduct(html, page.finalUrl);
  const shopify = await extractShopifyProduct(page.finalUrl, context.preferredSize, context.sizePreferences, context.variantId, context.country);
  const imageUrls = shopify?.imageUrls?.length ? shopify.imageUrls : metadata.imageUrls;
  const productText = firstString(shopify?.title, metadata.title).toLowerCase();
  const sizedProduct = /\b(top|shirt|blouse|crop|bra|dress|jumpsuit|romper|skirt|short|pant|trouser|jean|legging|shoe|sneaker|boot|heel|sandal|loafer|activewear)\b/.test(productText) || metadata.sizes.length > 1;
  const metadataOneSize = metadata.sizes.length === 1 && /^(?:one size|one-size|os|o\/s)$/i.test(metadata.sizes[0]);
  const metadataAvailability = !shopify && (!sizedProduct || metadataOneSize) ? metadata.availability : '';
  return {
    ...metadata,
    title: decodeHtml(firstString(shopify?.title, metadata.title)),
    brand: decodeHtml(firstString(shopify?.brand, metadata.brand)),
    retailer: context.retailer,
    productId: firstString(metadata.productId, context.productId),
    articleId: firstString(metadata.productId, context.productId),
    sku: metadata.sku,
    upc: metadata.upc,
    gtin: metadata.gtin,
    ean: metadata.ean,
    imageUrl: imageUrls[0] ?? metadata.imageUrl,
    imageUrls,
    price: firstString(shopify?.price, metadata.price),
    variantVerified: !context.variantId && !context.colorId && !context.sizeId
      || Boolean(context.variantId && shopify?.matchedVariantId === context.variantId),
    currency: firstString(metadata.currency, shopify?.currency, context.currencyHint),
    currencyAssumed: Boolean(metadata.currencyAssumed || shopify?.currencyAssumed
      || (firstString(shopify?.price, metadata.price) && !metadata.currency && !shopify?.currency && context.currencyHint)),
    availability: shopify ? shopify.availability : metadataAvailability,
    stockCount: shopify ? shopify.stockCount : metadataAvailability ? metadata.stockCount : '',
    colors: [...new Set([...(shopify?.colors ?? []), ...metadata.colors])],
    sizes: [...new Set([...(shopify?.sizes ?? []), ...metadata.sizes])],
    color: firstString(shopify?.colors?.[0], metadata.colors[0]),
    size: firstString(shopify?.matchedSize, context.preferredSize ? '' : metadata.sizes[0]),
    fieldSources: {
      title: shopify?.title ? 'retailer_product_feed' : metadata.fieldSources?.title ?? 'retailer_structured_data',
      brand: shopify?.brand ? 'retailer_product_feed' : metadata.fieldSources?.brand ?? 'retailer_structured_data',
      imageUrl: shopify?.imageUrls?.length ? 'retailer_product_feed' : metadata.fieldSources?.imageUrl ?? 'retailer_metadata',
      price: shopify?.price ? 'retailer_product_feed' : metadata.fieldSources?.price ?? 'retailer_structured_data',
      currency: metadata.currency || (shopify?.currency && !shopify?.currencyAssumed) ? 'retailer_structured_data' : context.currencyHint ? 'url_locale' : '',
      retailer: 'url_domain',
      availability: shopify?.availabilityVerified && shopify.availability ? 'retailer_variant_inventory' : metadataAvailability ? 'retailer_structured_data' : '',
    },
  };
};

const searchQuota = new SearchQuota({ dailyCap: resolverConfig.dailyCap, providerCaps: { tavily: resolverConfig.tavilyCap, firecrawl: resolverConfig.firecrawlCap } });
const firecrawlProvider = resolverConfig.firecrawlKey ? new FirecrawlProvider(resolverConfig.firecrawlKey) : undefined;
const imageResolver = new ProductImageResolver({ provider: firecrawlProvider, quota: searchQuota });
const searchRotation = new SearchRotation({ providers: [
  ...(resolverConfig.tavilyKey ? [new TavilyProvider(resolverConfig.tavilyKey)] : []),
  ...(firecrawlProvider ? [firecrawlProvider] : []),
], quota: searchQuota, dailyCap: resolverConfig.dailyCap });

export const resolveProduct = createProductResolver({
  directResolver: directProductResolver,
  exactPageResolver: createExactPageResolver({ provider: firecrawlProvider, quota: searchQuota }),
  renderedResolver: async () => ({}),
  nativeCatalogResolver: async () => ({}),
  searchProviders: [searchRotation],
  imageResolver,
  directTimeoutMs: 7_500,
  providerTimeoutMs: 55_000,
});

const extractionRate = new Map();
app.use('/api/extract-product', (request, response, next) => {
  const key = request.ip ?? 'unknown';
  const current = extractionRate.get(key) ?? { startedAt: Date.now(), count: 0 };
  if (Date.now() - current.startedAt > 60_000) {
    current.startedAt = Date.now();
    current.count = 0;
  }
  current.count += 1;
  extractionRate.set(key, current);
  if (current.count > 30) return response.status(429).json({ error: 'Please wait a moment before resolving more links.' });
  return next();
});

app.post('/api/extract-product', async (request, response) => {
  const rawUrl = asText(request.body?.url);
  try {
    const normalizedUrl = parseProductUrl(rawUrl).normalizedUrl;
    await urlSafety.check(normalizedUrl);
    const product = await resolveProduct(rawUrl, {
      force: request.body?.force === true,
      preferredCurrency: asText(request.body?.preferredCurrency),
      preferredSize: asText(request.body?.preferredSize),
      sizePreferences: request.body?.sizePreferences,
      lockedFields: Array.isArray(request.body?.lockedFields) ? request.body.lockedFields : [],
      existing: request.body?.existing,
      rejectedImages: Array.isArray(request.body?.rejectedImages) ? request.body.rejectedImages.filter((url) => typeof url === 'string').slice(0, 20) : [],
    });
    const resolvedProduct = product;
    return response.json({
      ...resolvedProduct,
      availabilityVerified: Boolean(resolvedProduct.availability && /^retailer_(?:variant_inventory|structured_data)$/.test(asText(resolvedProduct.fieldSources?.availability))),
      colors: resolvedProduct.color ? [resolvedProduct.color] : [],
      sizes: resolvedProduct.size ? [resolvedProduct.size] : [],
      imageFallbackTried: !resolvedProduct.imageUrl,
    });
  } catch {
    return response.status(400).json({ error: 'This product link could not be used.' });
  }
});

app.post('/api/reports', (request, response) => {
  try { return response.status(201).json(reportStore.submit(request.body)); }
  catch { return response.status(400).json({ error: 'This report could not be submitted.' }); }
});

const productImageCache = createImageCache({
  directory: resolve(process.cwd(), 'data', 'image-cache'),
  onEvent: recordResolverEvent,
  fetchImage: async (url, maximumBytes) => {
    const image = await secureFetch(url, {
      headers: { 'User-Agent': 'Cura product image cache/1.0' },
      allowedTypes: ['image/'],
      maximumBytes,
      timeout: 10_000,
    });
    if (!image.response.ok) throw new Error('IMAGE_FETCH_FAILED');
    return { bytes: image.bytes, contentType: image.contentType };
  },
});

app.get('/api/image-proxy', async (request, response) => {
  const url = asText(request.query.url);
  if (!allowedUrl(url)) return response.status(400).json({ error: 'Please provide a public product-image URL.' });
  try {
    const image = await productImageCache.resolve(url);
    response.set('Content-Type', image.contentType);
    response.set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    return response.send(image.bytes);
  } catch {
    return response.status(422).json({ error: 'That retailer image could not be retrieved.' });
  }
});

app.post('/api/visual-search', async (request, response) => {
  if (!serpApiKey) return response.status(503).json({ error: 'Visual search is not configured. Add SERPAPI_KEY to the server environment.' });
  const imageDataUrl = asText(request.body?.imageDataUrl);
  const imageUrl = asText(request.body?.imageUrl);
  const piece = asText(request.body?.piece).toLowerCase();
  const discover = request.body?.discover === true;
  const match = imageDataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  let image;
  let imageType;
  if (match) {
    image = Buffer.from(match[2], 'base64');
    imageType = match[1];
  } else if (allowedUrl(imageUrl)) {
    try {
      const remoteImage = await secureFetch(imageUrl, { headers: { 'User-Agent': 'Cura product visual search/1.0' }, allowedTypes: ['image/'], maximumBytes: 1_500_000, timeout: 10_000 });
      if (!remoteImage.response.ok) return response.status(422).json({ error: 'That image address could not be read.' });
      image = remoteImage.bytes;
      imageType = remoteImage.contentType.split(';')[0];
    } catch {
      return response.status(422).json({ error: 'That image address could not be retrieved.' });
    }
  } else {
    return response.status(400).json({ error: 'Please provide a public image address or a PNG, JPEG, or WebP image.' });
  }
  if (image.byteLength > 1_500_000) return response.status(413).json({ error: 'This image is still too large for visual search. Try a smaller image.' });
  try {
    const moderation = await imageModeration.moderate(image);
    if (!moderation.allowed) return response.status(422).json({ error: 'This image cannot be used.' });
  } catch {
    return response.status(503).json({ error: 'This image cannot be checked right now.' });
  }

  try {
    const uploadBody = new FormData();
    uploadBody.set('image', new Blob([image], { type: imageType }), 'item-image');
    uploadBody.set('api_key', serpApiKey);
    const upload = await fetch('https://serpapi.com/image', { method: 'POST', body: uploadBody });
    const uploadData = await upload.json();
    if (!upload.ok || !uploadData.image_id) return response.status(422).json({ error: uploadData.error ?? 'Image upload for visual search failed.' });

    const runLensSearch = async (type) => {
      const searchUrl = new URL('https://serpapi.com/search.json');
      searchUrl.searchParams.set('engine', 'google_lens');
      searchUrl.searchParams.set('image_id', uploadData.image_id);
      searchUrl.searchParams.set('type', type);
      if (type === 'visual_matches' && piece) searchUrl.searchParams.set('q', visualSearchQuery(piece));
      searchUrl.searchParams.set('auto_crop', 'false');
      searchUrl.searchParams.set('safe', 'active');
      searchUrl.searchParams.set('hl', 'en');
      searchUrl.searchParams.set('api_key', serpApiKey);
      const search = await fetch(searchUrl);
      return search.json();
    };
    const collectShoppingMatches = (data) => {
      const rawMatches = [...(data.exact_matches ?? []), ...(data.visual_matches ?? []), ...(data.products_results ?? []), ...(data.shopping_results ?? [])];
      const seen = new Set();
      return rawMatches.flatMap((result) => {
        const link = firstString(result.link, result.product_link);
        const title = firstString(result.title, result.name);
        if (!title || !link || seen.has(link) || !shoppingResultLink(result, link)) return [];
        seen.add(link);
        return [{
          title,
          link,
          source: firstString(result.source, result.merchant, result.website),
          thumbnail: firstString(result.thumbnail, result.image),
          price: firstString(result.price?.extracted_value, result.price, result.extracted_price),
          currency: firstString(result.currency, result.price?.currency),
        }];
      });
    };

    let data = await runLensSearch(discover ? 'visual_matches' : 'exact_matches');
    let allMatches = collectShoppingMatches(data);
    const categoryTerms = visualCategoryTerms(piece);
    if (!discover) {
      const possibleOriginals = allMatches.filter((result) => matchesVisualCategory(result, categoryTerms));
      if (possibleOriginals.length) return response.json({ matches: possibleOriginals.slice(0, 12), matchKind: 'original' });
    }
    if (!discover) {
      data = await runLensSearch('visual_matches');
      allMatches = collectShoppingMatches(data);
    }
    if (discover) {
      const categories = [
        { label: 'Dress / jumpsuit', pattern: /\b(dress|gown|jumpsuit|romper)\b/i },
        { label: 'Top', pattern: /\b(top|shirt|blouse|sweater|cardigan|tee|pullover|bodysuit|bra)\b/i },
        { label: 'Bottoms', pattern: /\b(skirt|pants?|trousers?|jeans|shorts?)\b/i },
        { label: 'Outerwear', pattern: /\b(jacket|coat|blazer|outerwear)\b/i },
        { label: 'Shoes', pattern: /\b(shoes?|heels?|pumps?|sandals?|boots?|sneakers?|loafers?)\b/i },
        { label: 'Bag', pattern: /\b(bag|purse|handbag|tote|satchel|clutch)\b/i },
        { label: 'Accessories', pattern: /\b(earrings?|necklace|bracelet|watch|belt|scarf|glasses|sunglasses|hat)\b/i },
      ];
      const pieces = categories.map((category) => {
        const positions = allMatches.flatMap((result, index) => category.pattern.test(result.title) ? [index] : []);
        return { label: category.label, count: positions.length, first: positions[0] ?? Number.POSITIVE_INFINITY };
      }).filter((category) => category.count >= 2 || category.first < 5)
        .sort((left, right) => left.first - right.first || right.count - left.count)
        .slice(0, 4)
        .map((category) => category.label);
      return response.json({
        pieces: pieces.length ? pieces : ['clothing item'],
        matches: allMatches.slice(0, 12),
      });
    }
    const matches = allMatches.filter((result) => matchesVisualCategory(result, categoryTerms)).slice(0, 12);
    return response.json({ matches, matchKind: 'alternatives' });
  } catch {
    return response.status(502).json({ error: 'Visual search could not reach the search service.' });
  }
});

/* Disabled Roboflow endpoint.
app.post('/api/decompose-outfit', async (request, response) => {
  if (!roboflowApiKey) {
    return response.status(503).json({ error: 'Outfit extraction is not configured. Add ROBOFLOW_API_KEY to the server environment.' });
  }
  const imageDataUrl = asText(request.body?.imageDataUrl);
  const match = imageDataUrl.match(/^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return response.status(400).json({ error: 'Please use a PNG, JPEG, or WebP image.' });

  try {
    const data = await callRoboflowWorkflow({
      inputs: {
        image: { type: 'base64', value: match[1] },
        confidence: 0.4,
        iou_threshold: 0.3,
        class_agnostic_nms: false,
        max_detections: 1000,
      },
    });
    const candidates = findSegmentationPredictions(data)
      .map((prediction, index) => ({ prediction, points: normalisePoints(prediction.points), index }))
      .filter(({ points }) => points.length >= 3)
      .map((prediction, index) => ({
        id: `${index}-${asText(prediction.prediction.class_name ?? prediction.prediction.class) || 'piece'}`,
        label: asText(prediction.prediction.class_name ?? prediction.prediction.class) || 'Clothing piece',
        confidence: Number(prediction.prediction.confidence ?? 0),
        points: prediction.points,
      }));
    return response.json({ candidates });
  } catch (error) {
    return response.status(502).json({ error: error instanceof Error ? error.message : 'Outfit extraction could not reach the segmentation service.' });
  }
});

*/
const distPath = resolve('dist');
if (existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('/{*path}', (_request, response) => response.sendFile(resolve(distPath, 'index.html')));
}

const isMainModule = Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) app.listen(port, () => console.log(`Shopping Canvas API listening at http://localhost:${port}`));
