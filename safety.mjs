import { createHash } from 'node:crypto';

const nowIso = () => new Date().toISOString();

export class GoogleWebRiskProvider {
  constructor(apiKey, fetcher = fetch) { this.apiKey = apiKey; this.fetcher = fetcher; }
  async check(url) {
    if (!this.apiKey) return { safe: true, provider: 'not-configured' };
    const endpoint = new URL('https://webrisk.googleapis.com/v1/uris:search');
    ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE'].forEach((type) => endpoint.searchParams.append('threatTypes', type));
    endpoint.searchParams.set('uri', url);
    endpoint.searchParams.set('key', this.apiKey);
    const response = await this.fetcher(endpoint, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error('URL_SAFETY_UNAVAILABLE');
    const result = await response.json();
    return { safe: !result.threat, provider: 'google-web-risk' };
  }
}

export const createUrlSafetyService = ({ validate, canonicalize, provider, ttlMs = 24 * 60 * 60 * 1000, cache = new Map() }) => ({
  async check(rawUrl) {
    const validated = await validate(rawUrl);
    const canonicalUrl = canonicalize(validated.toString());
    const cached = cache.get(canonicalUrl);
    if (cached && cached.expiresAt > Date.now()) {
      if (!cached.safe) throw new Error('UNSAFE_URL');
      return { ...cached, canonicalUrl, cacheHit: true };
    }
    const verdict = provider ? await provider.check(canonicalUrl) : { safe: true, provider: 'local-validation' };
    const result = { safe: verdict.safe === true, provider: verdict.provider, checkedAt: nowIso(), expiresAt: Date.now() + ttlMs };
    cache.set(canonicalUrl, result);
    if (!result.safe) throw new Error('UNSAFE_URL');
    return { ...result, canonicalUrl, cacheHit: false };
  },
  cache,
});

export class GoogleVisionSafeSearchProvider {
  constructor(apiKey, fetcher = fetch) { this.apiKey = apiKey; this.fetcher = fetcher; }
  async moderate(bytes) {
    if (!this.apiKey) return { allowed: true, provider: 'not-configured' };
    const response = await this.fetcher(`https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(this.apiKey)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ image: { content: bytes.toString('base64') }, features: [{ type: 'SAFE_SEARCH_DETECTION' }] }] }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error('IMAGE_MODERATION_UNAVAILABLE');
    const safe = (await response.json()).responses?.[0]?.safeSearchAnnotation ?? {};
    const blocked = ['adult', 'violence', 'racy'].some((field) => ['LIKELY', 'VERY_LIKELY'].includes(safe[field]));
    return { allowed: !blocked, provider: 'google-vision-safe-search' };
  }
}

export const createImageModerationService = ({ provider, cache = new Map() }) => ({
  async moderate(bytes) {
    const key = createHash('sha256').update(bytes).digest('hex');
    if (cache.has(key)) return { ...cache.get(key), cacheHit: true };
    const verdict = provider ? await provider.moderate(bytes) : { allowed: true, provider: 'local-policy' };
    const result = { ...verdict, checkedAt: nowIso() };
    cache.set(key, result);
    return { ...result, cacheHit: false };
  },
  cache,
});

export const createReportStore = () => {
  const reports = [];
  return {
    submit(input) {
      if (!['item', 'board'].includes(input?.targetType) || !String(input?.targetId ?? '').trim() || !String(input?.collectionId ?? '').trim()) throw new Error('INVALID_REPORT');
      const report = { id: crypto.randomUUID(), targetType: input.targetType, targetId: String(input.targetId), collectionId: String(input.collectionId), reason: String(input.reason ?? 'Other').slice(0, 200), status: 'open', createdAt: nowIso() };
      reports.push(report);
      return report;
    },
    list: () => reports.map((report) => ({ ...report })),
  };
};
