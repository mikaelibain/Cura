// node --env-file=.env peek.mjs "<product url>"
const url = process.argv[2];
const u = new URL(url);
const id = url.match(/\/p\/([A-Za-z0-9]+)/)?.[1] || '';
const words = (url.match(/\/products\/([^/]+)\//)?.[1] || u.pathname.split('/').filter(Boolean).pop() || '').replace(/-/g, ' ');
const PRICE = /(?:CA\$|\$)\s?\d{1,4}(?:,\d{3})*\.\d{2}/g;

function show(label, text) {
  const t = String(text || '');
  console.log(`\n=== ${label} (${t.length} chars)`);
  const hits = [...t.matchAll(PRICE)].slice(0, 8)
    .map((m) => `${m[0]}   <- ...${t.slice(Math.max(0, m.index - 60), m.index).replace(/\s+/g, ' ')}`);
  console.log(hits.length ? hits.join('\n') : 'NO PRICE-LIKE TEXT');
  const i = t.toLowerCase().indexOf(words.toLowerCase());
  if (i >= 0) console.log('NEAR TITLE:', t.slice(i, i + 200).replace(/\s+/g, ' '));
  if (/"@type"\s*:\s*"Product"/.test(t)) console.log('JSON-LD Product present');
}

const post = async (endpoint, key, body) => {
  const r = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify(body) });
  if (!r.ok) { console.log(endpoint, 'HTTP', r.status); return null; }
  return r.json();
};

// 1) Tavily search with raw content
const s = await post('https://api.tavily.com/search', process.env.TAVILY_API_KEY,
  { query: `${words} ${id}`, include_domains: [u.hostname.replace(/^www\./, '')], include_raw_content: true, max_results: 5 });
for (const r of s?.results || []) {
  console.log('\n--- tavily result:', r.url);
  show('content', r.content);
  show('raw_content', r.raw_content);
}

// 2) Tavily extract on the exact URL (advanced only if basic finds no price)
let ex = await post('https://api.tavily.com/extract', process.env.TAVILY_API_KEY, { urls: [url] });
show('tavily extract (basic)', ex?.results?.[0]?.raw_content);
if (!PRICE.test(String(ex?.results?.[0]?.raw_content || ''))) {
  ex = await post('https://api.tavily.com/extract', process.env.TAVILY_API_KEY, { urls: [url], extract_depth: 'advanced' });
  show('tavily extract (advanced)', ex?.results?.[0]?.raw_content);
}

// 3) Firecrawl scrape of the exact URL
const f = await post('https://api.firecrawl.dev/v2/scrape', process.env.FIRECRAWL_API_KEY,
  { url, formats: ['rawHtml', 'markdown'], onlyMainContent: false });
show('firecrawl rawHtml', f?.data?.rawHtml);
show('firecrawl markdown', f?.data?.markdown);