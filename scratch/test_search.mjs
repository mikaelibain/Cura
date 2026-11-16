const testQuery = async (q) => {
  const u = 'https://www.bing.com/images/search?q=' + encodeURIComponent(q);
  const res = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' } });
  const html = await res.text();
  const matches = [...html.matchAll(/<a[^>]*class="[^"]*\biusc\b[^"]*"[^>]*\bm="([^"]+)"/gi)].flatMap(m => {
    try {
      const raw = m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
      const d = JSON.parse(raw);
      return [{ title: d.t, page: d.purl, img: d.murl }];
    } catch {
      return [];
    }
  });
  console.log(`\nQuery: "${q}" -> found ${matches.length}`);
  matches.slice(0, 5).forEach((item, i) => {
    console.log(` [${i}] "${item.title}" | page: ${item.page}`);
  });
};

await testQuery('Lululemon "Define Jacket Nulu"');
await testQuery('site:shop.lululemon.com "Define Jacket Nulu"');
await testQuery('Lululemon Define Jacket Nulu "Define Jacket"');
