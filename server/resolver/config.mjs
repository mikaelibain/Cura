const numberFromEnv = (name, fallback) => {
  const parsed = Number(process.env[name] ?? '');
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const configuredCountry = (process.env.DEFAULT_COUNTRY ?? 'ca').trim().toLowerCase();
export const resolverConfig = Object.freeze({
  tavilyKey: process.env.TAVILY_API_KEY ?? '',
  firecrawlKey: process.env.FIRECRAWL_API_KEY ?? '',
  tavilyCap: numberFromEnv('TAVILY_MONTHLY_CAP', 900),
  firecrawlCap: numberFromEnv('FIRECRAWL_MONTHLY_CAP', 900),
  dailyCap: numberFromEnv('SEARCH_DAILY_CAP', 50),
  schemaVersion: Math.max(4, numberFromEnv('RESOLVER_SCHEMA_VERSION', 4)),
  defaultCountry: /^[a-z]{2}$/.test(configuredCountry) ? configuredCountry : 'ca',
});
