import { FirecrawlProvider } from '../server/resolver/providers/firecrawl.mjs';
import { SearchQuota } from '../server/resolver/quota.mjs';
import { resolverConfig } from '../server/resolver/config.mjs';
import { parseProductUrl, validatePublicUrl } from '../productResolver.mjs';
import { parseExactPage } from '../server/resolver/exactPage.mjs';

const provider = new FirecrawlProvider(resolverConfig.firecrawlKey);
const quota = new SearchQuota({ dailyCap: resolverConfig.dailyCap, providerCaps: { firecrawl: resolverConfig.firecrawlCap, tavily: resolverConfig.tavilyCap } });
const walk = (node, path, visit) => {
  if (!node || typeof node !== 'object') return;
  visit(node, path);
  for (const [key, value] of Object.entries(node)) walk(value, `${path}.${key}`, visit);
};
for (const url of process.argv.slice(2)) {
  try {
    await validatePublicUrl(url);
    if (!quota.spend('firecrawl', 1, 'scrape')) throw new Error('LOCAL_QUOTA');
    const data = await provider.scrape(url);
    const context = parseProductUrl(url);
    const scripts = [], products = [], state = [];
    for (const match of String(data.rawHtml ?? '').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
      if (!/json|__NEXT_DATA__/i.test(match[1])) continue;
      try {
        const value = JSON.parse(match[2]);
        scripts.push({ attributes: match[1].slice(0, 160), keys: Object.keys(value).slice(0, 20) });
        walk(value, '', (node, path) => {
          if (/Product/.test(String(node['@type']))) products.push(Object.fromEntries(Object.entries(node).filter(([key]) => ['@type', 'name', 'url', 'sku', 'productID', 'productId', 'image', 'offers', 'color', 'size'].includes(key))));
          if (!/ld\+json/i.test(match[1]) && /product|variant|price/i.test(path) && state.length < 30
            && Object.keys(node).some((key) => /^(?:sku|productId|productID|salePrice|price|priceCurrency|images|image)$/i.test(key))) {
            state.push({ path, fields: Object.fromEntries(Object.entries(node).filter(([key, value]) => /^(?:sku|productId|productID|id|name|title|salePrice|price|priceCurrency|currency|color|size|url)$/i.test(key) && typeof value !== 'object')), keys: Object.keys(node).slice(0, 30) });
          }
        });
      } catch { scripts.push({ attributes: match[1].slice(0, 160), invalid: true }); }
    }
    console.log(JSON.stringify({ url, metadata: Object.fromEntries(Object.entries(data.metadata ?? {}).filter(([key]) => /^(?:url|sourceURL|statusCode|title|ogTitle|ogImage|ogUrl)$/i.test(key))),
      extracted: parseExactPage(data, context), scripts, products, state }, null, 2));
  } catch (error) { console.log(JSON.stringify({ url, error: error.message })); }
}
