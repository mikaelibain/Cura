// Only expose bounded upstream error fields, never headers or the raw payload.
const safeImageErrorText = (value, apiKey) => {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  let text = String(value);
  if (apiKey) text = text.split(apiKey).join('[REDACTED]');
  return text.replace(/Bearer\s+[^\s,"'}]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:fc|sk)-[a-z0-9_-]+/gi, '[REDACTED]')
    .replace(/((?:api[_ -]?key|authorization|secret|token)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, '$1[REDACTED]')
    .replace(/[\r\n\x00-\x1f]/g, ' ').slice(0, 512);
};
const imageResponseError = (payload, status, apiKey) => Object.assign(new Error(`HTTP_${status}`), {
  status,
  upstreamCode: safeImageErrorText(payload?.error?.code ?? payload?.code, apiKey),
  upstreamMessage: safeImageErrorText(payload?.error?.message ?? payload?.message ?? payload?.error, apiKey),
});

export class FirecrawlProvider {
  async scrape(url) {
    if (!this.apiKey) throw new Error('NOT_CONFIGURED');
    if (Date.now() < (this.scrapeRetryAt ?? 0)) throw new Error('PROVIDER_COOLDOWN');
    try {
      const response = await this.fetcher('https://api.firecrawl.dev/v2/scrape', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ url, formats: ['rawHtml', 'markdown'], onlyMainContent: false }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw Object.assign(new Error(`HTTP_${response.status}`), { status: response.status });
      const payload = await response.json();
      if (payload.success === false || !payload.data || typeof payload.data !== 'object') throw new Error('INVALID_SCRAPE_RESPONSE');
      if (Number(payload.data.metadata?.statusCode) >= 400) throw new Error('SCRAPE_PAGE_UNAVAILABLE');
      return payload.data;
    } catch (error) {
      this.scrapeRetryAt = Date.now() + ([401, 403].includes(error.status) ? 86400_000 : [402, 429].includes(error.status) ? 3600_000 : 60_000);
      throw error;
    }
  }
  async searchImages(query) {
    if (!this.apiKey) throw new Error('NOT_CONFIGURED');
    if (Date.now() < (this.imageRetryAt ?? 0)) throw new Error('PROVIDER_COOLDOWN');
    try {
      const response = await this.fetcher('https://api.firecrawl.dev/v2/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ query, sources: ['images'], limit: 8 }), signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw imageResponseError(payload, response.status, this.apiKey);
      }
      const payload = await response.json();
      if (payload.success === false) {
        const error = imageResponseError(payload, response.status, this.apiKey);
        error.message = 'PROVIDER_UNSUCCESSFUL';
        throw error;
      }
      const rows = payload?.data?.images;
      if (!Array.isArray(rows)) throw new Error('INVALID_IMAGE_RESPONSE');
      return { responseShape: { keys: Object.keys(payload), dataKeys: Object.keys(payload.data ?? {}), imageKeys: Object.keys(rows[0] ?? {}) },
        creditsUsed: payload.creditsUsed ?? payload.metadata?.creditsUsed,
        candidates: rows.slice(0, 8).map((r) => ({ imageUrl: r.imageUrl, sourcePageUrl: r.url,
          title: r.title, width: r.imageWidth, height: r.imageHeight, position: r.position,
          thumbnailUrl: r.thumbnailUrl, provider: 'Firecrawl', providerSource: 'image_search' })) };
    } catch (error) {
      error.message = safeImageErrorText(error.message, this.apiKey) ?? 'IMAGE_SEARCH_FAILED';
      const code = error.status ?? 0;
      this.imageRetryAt = Date.now() + ([401, 403].includes(code) ? 24 : [402, 429].includes(code) ? 1 : 0.1) * 60 * 60_000;
      throw error;
    }
  }
  constructor(apiKey, fetcher = fetch) { this.apiKey = apiKey; this.fetcher = fetcher; this.name = 'Firecrawl'; this.kind = 'firecrawl_search'; this.retryAt = 0; this.authReported = false; }
  async search(query) {
    if (!this.apiKey) throw Object.assign(new Error('NOT_CONFIGURED'), { state: 'configuration_error' });
    if (Date.now() < this.retryAt) throw Object.assign(new Error('PROVIDER_COOLDOWN'), { state: 'cooldown' });
    try {
      const response = await this.fetcher('https://api.firecrawl.dev/v2/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ query, limit: 8 }), signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw Object.assign(new Error(`HTTP_${response.status}`), { status: response.status });
      const payload = await response.json();
      const rows = Array.isArray(payload?.data?.web) ? payload.data.web : Array.isArray(payload?.web) ? payload.web : Array.isArray(payload?.data) ? payload.data : [];
      return rows.slice(0, 8).map((r) => ({ title: r.title, snippet: r.description ?? r.content, url: r.url,
        image: r.image ?? null, thumbnail: r.thumbnail ?? null, ogImage: r.ogImage ?? r.og_image ?? r.metadata?.ogImage ?? null }));
    } catch (error) {
      this.#cooldown(error);
      if ([401, 403].includes(error.status) && !this.authReported) { console.warn('Firecrawl provider authentication/configuration failure (HTTP ' + error.status + ').'); this.authReported = true; }
      throw error;
    }
  }
  #cooldown(error) { const code = error.status ?? 0; this.retryAt = Date.now() + ([401, 403].includes(code) ? 24 : [402, 429].includes(code) ? 1 : 0.1) * 60 * 60_000; }
}
