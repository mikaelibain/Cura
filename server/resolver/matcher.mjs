import { parseProductUrl } from '../../productResolver.mjs';

const moneyPattern = /(?:(?<![A-Za-z0-9])(CA\$|C\$|CAD|US\$|USD|AU\$|AUD|NZ\$|NZD|GBP|EUR|£|€|\$)\s*(\d{1,5}(?:,\d{3})*(?:\.\d{1,2})?)|\b(\d{1,5}(?:,\d{3})*(?:\.\d{1,2})?)\s*(CAD|USD|AUD|NZD|GBP|EUR)\b)/gi;
const rangePrice = /(?:CA\$|C\$|CAD|US\$|USD|AU\$|AUD|NZ\$|NZD|GBP|EUR|£|€|\$)\s*\d[\d,]*(?:\.\d{1,2})?\s*(?:-|\u2013|\u2014|\bto\b)\s*(?:(?:CA\$|C\$|CAD|US\$|USD|AU\$|AUD|NZ\$|NZD|GBP|EUR|£|€|\$)\s*)?\d[\d,]*(?:\.\d{1,2})?/i;
const invalidOfferContext = /\b(?:installments?|payments?\s+of|afterpay|klarna|affirm|per\s+month|monthly|shipping|delivery|tax|taxes|reward\s+points?|save|savings|discount|msrp|rrp|compare(?:d)?\s+at|regular\s+price|list\s+price|original\s+price|orders?\s+over|minimum\s+order|from|starting\s+at)\b|\/\s*(?:mo|month)\b/i;
const oldOfferContext = /\b(?:was|regular|msrp|rrp|compare(?:d)?\s+at|original(?:ly)?|list\s+price)\b/i;
const currentOfferContext = /\b(?:now|today|current(?:ly)?|sale\s+price|selling\s+price|special\s+price)\b/i;
const currencyCode = (token) => ({ 'CA$': 'CAD', 'C$': 'CAD', CAD: 'CAD', 'US$': 'USD', USD: 'USD', 'AU$': 'AUD', AUD: 'AUD', 'NZ$': 'NZD', NZD: 'NZD', GBP: 'GBP', '£': 'GBP', EUR: 'EUR', '€': 'EUR' })[String(token ?? '').toUpperCase()] ?? '';

export const parseSearchPrice = (candidate, context) => {
  const content = String(candidate.rawContent || candidate.snippet || candidate.title || '');
  if (rangePrice.test(content)) return { price: '', currency: '', rejectionReason: 'PRICE_RANGE' };
  let marketSafe = false;
  let marketConflict = false;
  try {
    const sourceMarket = parseProductUrl(candidate.url);
    marketConflict = !sourceMarket.countryAssumed && !context.countryAssumed && sourceMarket.country !== context.country;
    marketSafe = sourceMarket.baseDomain === context.baseDomain && !sourceMarket.countryAssumed
      && sourceMarket.country === context.country && !context.countryAssumed;
  } catch { /* A result without a product destination cannot establish offer market. */ }
  if (marketConflict) return { price: '', currency: '', rejectionReason: 'FOREIGN_MARKET_PRICE' };
  const matches = [...content.matchAll(moneyPattern)];
  const offers = [];
  let rejectedReason = '';
  for (const match of matches) {
    const amountText = match[2] ?? match[3] ?? '';
    const amount = Number(amountText.replace(/,/g, ''));
    const prefix = match[1] ?? match[4] ?? '';
    const before = content.slice(Math.max(0, match.index - 70), match.index);
    const after = content.slice(match.index + match[0].length, Math.min(content.length, match.index + match[0].length + 45));
    const contextText = `${before} ${after}`;
    if (!Number.isFinite(amount) || amount <= 0) { rejectedReason ||= 'ZERO_OR_INVALID_PRICE'; continue; }
    if (invalidOfferContext.test(contextText)) { rejectedReason ||= /install|payment|afterpay|klarna|affirm|month/i.test(contextText) ? 'INSTALLMENT_PRICE' : /save|saving|discount/i.test(contextText) ? 'SAVINGS_NOT_CURRENT' : 'NON_OFFER_AMOUNT'; continue; }
    if (oldOfferContext.test(before) && !currentOfferContext.test(before)) { rejectedReason ||= 'OLD_PRICE'; continue; }
    const explicitCurrency = currencyCode(prefix || match[4]);
    const currency = explicitCurrency || (prefix === '$' && marketSafe ? context.currencyHint : '');
    if (!currency) { rejectedReason ||= 'CURRENCY_UNVERIFIED'; continue; }
    if (currency !== context.currencyHint && !context.countryAssumed) { rejectedReason ||= 'FOREIGN_MARKET_PRICE'; continue; }
    offers.push({ price: String(amount), currency, currencyAssumed: !explicitCurrency && prefix === '$', offerType: 'CURRENT_PRICE' });
  }
  if (!offers.length && ['PRICE_NOT_FOUND', 'CURRENCY_UNVERIFIED'].includes(rejectedReason || 'PRICE_NOT_FOUND') && candidate.price != null && candidate.currency) {
    const rawAmount = String(candidate.price).trim();
    if (!/^(?:\$\s*)?\d{1,5}(?:,\d{3})*(?:\.\d{1,2})?$/.test(rawAmount)) return { price: '', currency: '', rejectionReason: rejectedReason || 'INVALID_PRICE_FORMAT' };
    const amount = Number(rawAmount.replace(/[^\d.]/g, ''));
    const currency = currencyCode(candidate.currency);
    if (amount > 0 && currency && (context.countryAssumed || currency === context.currencyHint)) offers.push({ price: String(amount), currency, currencyAssumed: false, offerType: 'CURRENT_PRICE' });
  }
  if (offers.length !== 1) return { price: '', currency: '', rejectionReason: offers.length ? 'AMBIGUOUS_PRICE_EVIDENCE' : rejectedReason || 'PRICE_NOT_FOUND' };
  return offers[0];
};

export const isProductMediaUrl = (value) => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol)
      && !/(?:^|[\/_.-])(?:favicon|logo|icon|banner|sprite|placeholder|avatar)(?:[\/_.-]|$)/i.test(url.pathname);
  } catch { return false; }
};

export const normalizeSearchCandidate = (result, context, provider) => {
  const media = [result.image, result.thumbnail, result.ogImage].find(isProductMediaUrl) ?? '';
  const candidate = { title: String(result.title ?? '').trim(), snippet: String(result.snippet ?? result.content ?? result.description ?? '').trim(),
    rawContent: String(result.rawContent ?? result.raw_content ?? '').trim(), url: String(result.url ?? '').trim(), imageUrl: media,
    provider: provider.name, providerSource: provider.kind, retailer: context.retailer,
    providerPrice: result.price, providerCurrency: result.currency };
  const price = parseSearchPrice({ ...candidate, price: result.price, currency: result.currency }, context);
  return { ...candidate, ...price, ...(price.price ? { evidenceText: candidate.snippet || candidate.rawContent, sourcePageUrl: candidate.url } : {}) };
};

export const buildSearchQueries = (context, { priceFocus = false } = {}) => {
  const id = context.productId || context.sku || context.styleId || context.candidateIdentifiers?.[0] || '';
  const title = String(context.knownTitle || context.slug || '').trim();
  const site = context.baseDomain;
  if (id) return title ? [`site:${site} "${id}" "${title}"${priceFocus ? ' "$"' : ''}`, `"${title}" "${id}"`] : [`site:${site} "${id}"${priceFocus ? ' "$"' : ''}`];
  return title ? [`site:${site} "${title}"${priceFocus ? ' "$"' : ''}`, `"${title}"`] : [];
};
