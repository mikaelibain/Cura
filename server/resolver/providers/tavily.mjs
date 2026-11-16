export class TavilyProvider {
  constructor(apiKey, fetcher = fetch) { this.apiKey = apiKey; this.fetcher = fetcher; this.name = 'Tavily'; this.kind = 'tavily_search'; this.retryAt = 0; this.authReported = false; }
  async search(query) {
    if (!this.apiKey) throw Object.assign(new Error('NOT_CONFIGURED'), { state: 'configuration_error' });
    if (Date.now() < this.retryAt) throw Object.assign(new Error('PROVIDER_COOLDOWN'), { state: 'cooldown' });
    try {
      const response = await this.fetcher('https://api.tavily.com/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ query, max_results: 8, search_depth: 'basic' }), signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw Object.assign(new Error(`HTTP_${response.status}`), { status: response.status });
      const data = await response.json();
      if (!Array.isArray(data?.results)) throw new Error('INVALID_RESPONSE');
      return data.results.slice(0, 8).map((r) => ({ title: r.title, snippet: r.content, rawContent: r.raw_content ?? r.rawContent,
        price: r.price ?? r.structured_content?.price, currency: r.currency ?? r.structured_content?.currency, url: r.url,
        image: r.image ?? null, thumbnail: r.thumbnail ?? null, ogImage: r.ogImage ?? r.og_image ?? r.metadata?.ogImage ?? null }));
    } catch (error) {
      this.#cooldown(error);
      if ([401, 403].includes(error.status) && !this.authReported) { console.warn('Tavily provider authentication/configuration failure (HTTP ' + error.status + ').'); this.authReported = true; }
      throw error;
    }
  }
  #cooldown(error) { const code = error.status ?? 0; this.retryAt = Date.now() + ([401, 403].includes(code) ? 24 : [402, 429].includes(code) ? 1 : 0.1) * 60 * 60_000; }
}
