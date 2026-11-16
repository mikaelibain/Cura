import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rmdir, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseProductUrl, verifyCandidate, secureFetch, recordResolverEvent, RESOLVER_SCHEMA_VERSION } from '../../productResolver.mjs';

const cacheRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../data/image-cache/resolution');
const inflight = new Map();
const quoted = (s) => `"${String(s).replace(/["\r\n]/g, ' ').trim()}"`;
const globalIds = (p) => ['gtin', 'upc', 'ean'].map((k) => p[k]).filter(Boolean);
const hasToken = (haystack, token) => String(haystack).toLowerCase().split(/[^a-z0-9]+/).includes(String(token).toLowerCase());
export function buildImageQuery(context, product) {
  const title = ['HIGH', 'MEDIUM'].includes(product.fieldConfidence?.title) && !/^url_/.test(product.fieldSources?.title ?? '') ? product.title : '';
  const id = context.productId || context.sku;
  if (id) return `site:${context.baseDomain} ${quoted(id)}${title ? ` ${quoted(title)}` : ''}`;
  const globalId = globalIds(context)[0] || globalIds(product)[0];
  if (globalId) return [product.brand, title, globalId].filter(Boolean).map(quoted).join(' ');
  return title ? `site:${context.baseDomain} ${quoted(title)}` : '';
}

export function validateImageCandidate(candidate, context, product = {}) {
  const reject = (reason) => ({ accepted: false, reason, variantVerified: false });
  let source, image;
  try { source = parseProductUrl(candidate.sourcePageUrl); image = new URL(candidate.imageUrl); }
  catch { return reject('INVALID_URL'); }
  if (!['https:', 'http:'].includes(image.protocol) || image.username || image.password) return reject('INVALID_IMAGE_URL');
  if (/(?:favicon|logo|sprite|placeholder|loading|blank|tracking|pixel|banner|hero|social[-_]?icon|store[-_]?icon)/i.test(image.pathname)) return reject('NON_PRODUCT_ASSET');
  if (/(?:^|\/)(?:category|categories|collections|search)(?:\/|$)/i.test(new URL(candidate.sourcePageUrl).pathname)) return reject('CATEGORY_IMAGE');
  if ((candidate.width && candidate.width < 100) || (candidate.height && candidate.height < 100)) return reject('TINY_IMAGE');
  // Size normally changes the offer, not the product photograph.
  const match = verifyCandidate({ url: candidate.sourcePageUrl, title: candidate.title }, { ...context, sizeId: '' });
  if (match.variantConflict) return reject('VARIANT_CONFLICT');
  // Retailer-local IDs are meaningful only within the original retailer.
  if (match.originalDomain && match.conflictingIdentifier) return reject('PRODUCT_ID_CONFLICT');
  const exactPage = match.originalDomain && match.exactCanonical;
  const exact = match.originalDomain && match.exactIdentifier;
  const evidence = `${candidate.sourcePageUrl} ${candidate.title ?? ''}`;
  const globalMatch = [...globalIds(context), ...globalIds(product)].some((id) => /^\d{8,14}$/.test(id) && hasToken(evidence, id));
  const tokens = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const titleTokens = tokens(product.title);
  const candidateTokens = new Set(tokens(candidate.title));
  const strongTitle = product.fieldConfidence?.title === 'HIGH' && titleTokens.length >= 3 && titleTokens.every((word) => candidateTokens.has(word));
  const brandDomain = tokens(product.brand).join('');
  const manufacturer = product.fieldSources?.brand && product.fieldSources.brand !== 'url_domain' && brandDomain.length >= 3
    && source.baseDomain.split('.')[0].replace(/-/g, '') === brandDomain;
  // Without a global ID, manufacturer evidence must independently verify all
  // title/size/variant tokens. Unknown selected variants remain retailer-only.
  const manufacturerMatch = manufacturer && strongTitle && !context.variantId && !context.colorId && !context.sizeId;
  const retailerTitleMatch = match.originalDomain && !context.productId && !context.sku && strongTitle && match.exactCanonical;
  if (!exactPage && !exact && !globalMatch && !manufacturerMatch && !retailerTitleMatch) return reject('IDENTITY_UNVERIFIED');
  const requestedVariants = ['variantId', 'colorId'].filter((key) => context[key]);
  const variantVerified = requestedVariants.length > 0 && requestedVariants.every((key) => source[key] === context[key]);
  const sameLocale = source.locale === context.locale && source.country === context.country;
  const identityBasis = exactPage ? 'exact_url_same_market' : exact || retailerTitleMatch ? sameLocale ? 'verified_retailer' : 'verified_same_product_cross_locale' : manufacturer ? 'verified_manufacturer' : 'verified_exact_product_other_retailer';
  return { accepted: true, reason: 'EXACT_PRODUCT', identityBasis, variantVerified, market: source.countryAssumed ? null : source.country,
    domain: source.baseDomain, confidence: exact || globalMatch ? 'HIGH' : 'MEDIUM', rank: exact || retailerTitleMatch ? sameLocale ? 4 : 3 : manufacturer ? 2 : 1 };
}

// Decode dimensions from supported raster headers, never HTML or SVG masquerading as an image.
export function rasterDimensions(bytes) {
  const b = Buffer.from(bytes);
  if (b.length < 24) return null;
  if (b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return [b.readUInt32BE(16), b.readUInt32BE(20)];
  if (b.toString('ascii', 0, 3) === 'GIF') return [b.readUInt16LE(6), b.readUInt16LE(8)];
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const type = b.toString('ascii', 12, 16);
    if (type === 'VP8X' && b.length >= 30) return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
    if (type === 'VP8 ' && b.length >= 30) return [b.readUInt16LE(26) & 16383, b.readUInt16LE(28) & 16383];
    if (type === 'VP8L' && b.length >= 25) { const n = b.readUInt32LE(21); return [(n & 16383) + 1, ((n >>> 14) & 16383) + 1]; }
  }
  if (b[0] === 255 && b[1] === 216) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 255) break;
      const marker = b[i + 1], length = b.readUInt16BE(i + 2);
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
      if (length < 2) break;
      i += 2 + length;
    }
  }
  return null;
}
export async function checkImageAsset(url) {
  const result = await secureFetch(url, { allowedTypes: ['image/'], maximumBytes: 8_000_000, timeout: 8000 });
  if (!result.response.ok) throw new Error(`IMAGE_HTTP_${result.response.status}`);
  const dimensions = rasterDimensions(result.bytes);
  if (!dimensions) throw new Error('UNSUPPORTED_OR_INVALID_IMAGE');
  if (Math.min(...dimensions) < 100 || Math.max(...dimensions) / Math.min(...dimensions) > 6) throw new Error('TINY_OR_BANNER_IMAGE');
  return { width: dimensions[0], height: dimensions[1] };
}

export class ProductImageResolver {
  constructor({ provider, quota, cachePath = cacheRoot, checkAsset = checkImageAsset, ttlMs = 30 * 86400_000 } = {}) {
    Object.assign(this, { provider, quota, cachePath, checkAsset, ttlMs });
  }
  async resolve(context, product, { attemptId = '', rejectedImages = [] } = {}) {
    const log = (event, fields) => recordResolverEvent(event, { attemptId, provider: 'Firecrawl', role: 'IMAGE_SEARCH', ...fields });
    if (product.imageUrl) return null;
    const query = buildImageQuery(context, product);
    if (!query) { log('IMAGE_SEARCH_SKIPPED', { reason: 'INSUFFICIENT_IDENTITY' }); return null; }
    const key = createHash('sha256').update(`${RESOLVER_SCHEMA_VERSION}|${context.cacheKey}|${[...rejectedImages].sort().join('|')}`).digest('hex');
    const flightKey = `${this.cachePath}|${key}`;
    if (inflight.has(flightKey)) { log('IMAGE_INFLIGHT_REUSED', {}); return inflight.get(flightKey); }
    const pending = this.lookup(key, query, context, product, log, rejectedImages);
    inflight.set(flightKey, pending);
    try { return await pending; } finally { inflight.delete(flightKey); }
  }
  async lookup(key, query, context, product, log, rejectedImages = []) {
    const file = resolve(this.cachePath, `${key}.json`), lock = `${file}.lock`;
    const cached = async () => { try { const v = JSON.parse(await readFile(file, 'utf8')); return v.resolverVersion === RESOLVER_SCHEMA_VERSION && v.expiresAt > Date.now() ? v : null; } catch { return null; } };
    await mkdir(this.cachePath, { recursive: true });
    let acquired = false;
    for (let i = 0; i < 160; i++) {
      const hit = await cached();
      if (hit) { log('IMAGE_CACHE_HIT', { imageUrl: hit.result?.imageUrl ?? '', negative: !hit.result }); return hit.result; }
      try { await mkdir(lock); acquired = true; break; }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        try { if (Date.now() - (await stat(lock)).mtimeMs > 120_000) await rmdir(lock); } catch {}
        await new Promise((done) => setTimeout(done, 250));
      }
    }
    if (!acquired) { log('IMAGE_SEARCH_SKIPPED', { reason: 'INFLIGHT_OTHER_PROCESS' }); return null; }
    try {
      const hit = await cached();
      if (hit) return hit.result;
      if (!this.provider || Date.now() < (this.provider.imageRetryAt ?? 0)) { log('IMAGE_SEARCH_SKIPPED', { reason: this.provider ? 'COOLDOWN' : 'NOT_CONFIGURED' }); return null; }
      // Cura's existing web quota counts attempted HTTP calls, not vendor billing credits.
      if (!this.quota.spend('firecrawl', 1, 'image')) { log('IMAGE_SEARCH_SKIPPED', { reason: 'LOCAL_QUOTA' }); return null; }
      log('IMAGE_PROVIDER_ATTEMPT', { query, reservedProviderCalls: 1 });
      const response = await this.provider.searchImages(query);
      log('IMAGE_PROVIDER_RESULT', { query, status: 'SUCCESS', candidateCount: response.candidates.length, responseShape: response.responseShape, creditsUsed: response.creditsUsed });
      const ranked = response.candidates.map((candidate) => {
        let domain;
        try { domain = parseProductUrl(candidate.sourcePageUrl).baseDomain; } catch {}
        return { candidate: { ...candidate, ...(domain ? { domain } : {}) }, verification: validateImageCandidate(candidate, context, product) };
      });
      for (const row of ranked) log('IMAGE_CANDIDATE', { ...row.candidate, ...row.verification });
      ranked.sort((a, b) => (b.verification.rank ?? 0) - (a.verification.rank ?? 0) || (b.candidate.width ?? 0) - (a.candidate.width ?? 0));
      let result = null;
      for (const { candidate, verification } of ranked.filter((row) => row.verification.accepted)) {
        if (rejectedImages.includes(candidate.imageUrl)) { log('IMAGE_CANDIDATE_REJECTED', { imageUrl: candidate.imageUrl, reason: 'RECENT_ASSET_FAILURE' }); continue; }
        try {
          const dimensions = await this.checkAsset(candidate.imageUrl);
          result = { imageUrl: candidate.imageUrl, imageInfo: { provider: 'Firecrawl', sourcePageUrl: candidate.sourcePageUrl,
            identityBasis: verification.identityBasis, market: verification.market, variantVerified: verification.variantVerified,
            verifiedAt: new Date().toISOString(), ...dimensions }, confidence: verification.confidence };
          log('IMAGE_SELECTED', result);
          break;
        } catch (error) { log('IMAGE_CANDIDATE_REJECTED', { imageUrl: candidate.imageUrl, reason: error.message }); }
      }
      const temp = `${file}.${process.pid}.tmp`;
      await writeFile(temp, JSON.stringify({ resolverVersion: RESOLVER_SCHEMA_VERSION, expiresAt: Date.now() + (result ? this.ttlMs : 5 * 60_000), result }));
      await rename(temp, file);
      return result;
    } catch (error) { log('IMAGE_PROVIDER_FAILURE', { requestMode: 'IMAGE_SEARCH', reason: error.message,
      status: error.status, upstreamCode: error.upstreamCode, upstreamMessage: error.upstreamMessage }); return null; }
    finally { await rmdir(lock).catch(() => {}); }
  }
}
