import test from 'node:test';
import assert from 'node:assert/strict';
import { parseExactPage, createExactPageResolver } from '../server/resolver/exactPage.mjs';
import { createProductResolver, parseProductUrl, verifyCandidate } from '../productResolver.mjs';
import { validateImageCandidate } from '../server/resolver/images.mjs';
const url = 'https://shop.example.ca/en-ca/shop/chiffon-dress?color=524&size=XL&type=STANDARD';
const context = parseProductUrl(url);
const canonical = url.split('?')[0];
const image = 'https://cdn.example.ca/dress.jpg';
const node = { '@type': 'Product', name: 'Ruffled Chiffon Dress', sku: 'STYLE-42', url: canonical, image,
  offers: { price: 48, priceCurrency: 'CAD' } };
const page = (product, extra = '') => ({ metadata: { url, statusCode: 200 }, rawHtml: `<script type="application/ld+json">${JSON.stringify(product)}</script>${extra}` });

test('exact slug page accepts canonical without selectors and learns identity without mutating pasted URL', () => {
 const result = parseExactPage(page(node), context);
 assert.equal(result.imageUrl,image); assert.equal(result.price,'48'); assert.equal(result.productId,'STYLE-42');
 assert.equal(result.imageInfo.identityBasis,'exact_url_same_market'); assert.equal(result.imageInfo.variantVerified,false);
 assert.equal(context.originalUrl,url); assert.equal(context.productId,'');
});
test('exact page OpenGraph works without a URL SKU or JSON-LD', () => {
 const result = parseExactPage({ metadata: { url }, rawHtml: `<meta property="og:title" content="Chiffon Dress"><meta property="og:image" content="${image}">` },context);
 assert.equal(result.title,'Chiffon Dress'); assert.equal(result.imageUrl,image); assert.equal(result.price,'');
});
test('exact embedded product state can teach ID and supply media', () => {
 const result = parseExactPage({ metadata:{url}, rawHtml:`<script type="application/json">${JSON.stringify({product:{productId:'STYLE-42',name:'Chiffon Dress',images:[image],price:48,currency:'CAD'}})}</script>` }, context);
 assert.equal(result.productId,'STYLE-42'); assert.equal(result.imageUrl,image); assert.equal(result.price,'48');
});
test('explicit color conflicts reject image while uncertain variants retain generic image', () => {
 assert.equal(parseExactPage(page({...node,colorId:'999'}),context).imageUrl,undefined);
 assert.equal(parseExactPage(page({...node,variants:[{size:'M',price:20},{size:'XL',price:30}]}),context).price,'');
 assert.equal(parseExactPage(page({...node,variants:[{size:'M',price:20},{size:'XL',price:30}]}),context).imageUrl,image);
});
test('size differences do not block exact article imagery; color differences do', () => {
 const c=parseProductUrl('https://www2.hm.com/en_ca/productpage.1234567890.html?size=XL&color=red');
 assert.equal(validateImageCandidate({sourcePageUrl:c.originalUrl.replace('XL','M'),imageUrl:image},c).accepted,true);
 assert.equal(validateImageCandidate({sourcePageUrl:c.originalUrl.replace('red','blue'),imageUrl:image},c).accepted,false);
});
test('ProductGroup offer URLs select the exact article and ignore sibling colors', () => {
 const u='https://www2.hm.com/en_ca/productpage.1234567890.html';
 const variant=(suffix,price,path=u)=>({'@type':'Product',name:'Asymmetric Dress - Beige',sku:'1234567890'+suffix,image,offers:{url:path,price,priceCurrency:'CAD'}});
 const group={'@type':'ProductGroup',name:'Asymmetric Dress',hasVariant:[variant('001',35),variant('002',35),variant('003',80,u.replace('7890','7891'))]};
 const result=parseExactPage({metadata:{url:u},rawHtml:page(group).rawHtml},parseProductUrl(u));
 assert.equal(result.title,'Asymmetric Dress - Beige');assert.equal(result.price,'35');assert.equal(result.imageUrl,image);assert.equal(result.productId,'1234567890');assert.equal(result.sku,undefined);
});
test('same Canadian article across languages permits CAD; foreign article cannot supply CAD offer', () => {
 const u='https://www2.hm.com/en_ca/productpage.1234567890.html', c=parseProductUrl(u);
 assert.equal(verifyCandidate({url:u.replace('en_ca','fr_ca'),currency:'CAD'},c).localeMatch,true);
 assert.equal(verifyCandidate({url:u.replace('en_ca','en_us'),currency:'USD'},c).localeMatch,false);
 assert.equal(validateImageCandidate({sourcePageUrl:u.replace('en_ca','en_us'),imageUrl:image},c).accepted,true);
});
test('local scrape cap is diagnosed separately from provider errors',async()=>{
 await assert.rejects(createExactPageResolver({provider:{},quota:{spend:()=>false},urlValidator:async()=>{}})(context),/LOCAL_QUOTA/);
});
test('broken cached image uses next candidate and preserves manually locked image',async()=>{
 let searches=0;
 const resolver=createProductResolver({statePath:':memory:',urlValidator:async()=>{},directResolver:async()=>({title:'Chiffon Dress',imageUrl:image,imageUrls:[image,image+'?next'],price:'48',currency:'CAD'}),imageResolver:{resolve:async()=>{searches++;return null;}}});
 const result=await resolver(url,{rejectedImages:[image]});assert.equal(result.imageUrl,image+'?next');assert.equal(searches,0);
 const manual=await resolver(url,{rejectedImages:[image],lockedFields:['imageUrl'],existing:{imageUrl:image}});assert.equal(manual.imageUrl,image);
});
