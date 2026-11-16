process.env.PLAYWRIGHT_BROWSERS_PATH='.playwright-browsers';
const { chromium } = await import('playwright');
import assert from 'node:assert/strict';
process.env.PLAYWRIGHT_BROWSERS_PATH='.playwright-browsers';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const urls=['https://www.anthropologie.com/en-ca/shop/by-anthropologie-sleeveless-ruffled-chiffon-midi-dress2?color=524&size=XL&type=STANDARD','https://www2.hm.com/en_ca/productpage.1338299003.html','https://www2.hm.com/en_ca/productpage.1337767006.html'];
const items=urls.map((url,i)=>({id:'old-'+i,sourceUrl:url,title:'Old incomplete card',brand:'',imageUrl:'',price:null,currency:'CAD',color:'',size:'',colorOptions:[],sizeOptions:[],availability:'',notes:'keep me',unsure:false,x:100+i*300,y:100,createdAt:'2026-09-01T12:00:00Z',autoPlaced:true}));
items.push({...items[0],id:'manual',title:'My manual title',titleManual:true,price:17,priceManual:true,x:100,y:600});
await page.addInitScript(board=>localStorage.setItem('cura-link-only-board-v3',JSON.stringify(board)),{items,outfits:[]});
const responses=[];page.on('response',async r=>{if(r.url().includes('/api/extract-product'))responses.push({status:r.status(),data:await r.json().catch(()=>null)});});
await page.goto('http://localhost:5173');
await page.waitForFunction(()=>{const b=JSON.parse(localStorage.getItem('cura-link-only-board-v3'));return b.items.every(i=>i.imageUrl&&i.price>0&&!i.isLoading);},{},{timeout:180000});
const board=await page.evaluate(()=>JSON.parse(localStorage.getItem('cura-link-only-board-v3')));
for(const original of items){const item=board.items.find(x=>x.id===original.id);assert.equal(item.x,original.x);assert.equal(item.y,original.y);assert.equal(item.notes,original.notes);assert.equal(item.createdAt,original.createdAt);}
assert.equal(board.items.find(i=>i.id==='manual').title,'My manual title');assert.equal(board.items.find(i=>i.id==='manual').price,17);
for(const item of board.items){const card=page.locator(`[data-item-id="${item.id}"]`);assert.equal(await card.getByRole('button',{name:'Add price',exact:true}).count(),0);await card.locator('.sticker-art img').evaluate(img=>img.decode());}
assert.deepEqual(errors,[]);
await page.screenshot({path:'scratch/existing-cards-enriched.png',fullPage:true});
console.log(JSON.stringify({pass:true,requests:responses.map(r=>({status:r.status,cacheHit:r.data?.cacheHit,title:r.data?.title,price:r.data?.price})),items:board.items.map(({id,title,imageUrl,price,currency,x,y})=>({id,title,imageUrl,price,currency,x,y})),errors},null,2));
await browser.close();


