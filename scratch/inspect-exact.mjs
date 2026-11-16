import { FirecrawlProvider } from '../server/resolver/providers/firecrawl.mjs';
import { SearchQuota } from '../server/resolver/quota.mjs';
import { resolverConfig } from '../server/resolver/config.mjs';
import { writeFile } from 'node:fs/promises';
const quota = new SearchQuota({ dailyCap: resolverConfig.dailyCap, providerCaps: {firecrawl:resolverConfig.firecrawlCap,tavily:resolverConfig.tavilyCap} });
const provider = new FirecrawlProvider(resolverConfig.firecrawlKey);
for (const [name,url] of [['hm','https://www2.hm.com/en_ca/productpage.1338299003.html'],['anthro','https://www.anthropologie.com/en-ca/shop/by-anthropologie-sleeveless-ruffled-chiffon-midi-dress2?color=524&size=XL&type=STANDARD']]) {
 if(!quota.spend('firecrawl',1,'scrape')) throw Error('LOCAL_QUOTA');
 const data=await provider.scrape(url);
 await writeFile(`scratch/${name}-page.json`,JSON.stringify(data));
 const html=data.rawHtml || '';
 console.log(name,JSON.stringify({metadata:data.metadata,headings:[...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map(m=>m[1].replace(/<[^>]+>/g,'')),jsonld:[...html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>{try{return JSON.parse(m[1])}catch{return 'invalid'}})},null,2));
}
