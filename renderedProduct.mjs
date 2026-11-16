import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { capabilityFor } from './retailerCapabilities.mjs';

const goodImage = (value) => /^https?:\/\//i.test(value ?? '') && !/logo|placeholder|sprite|icon/i.test(value);
const safeText = (value) => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
const first = (...values) => values.map(safeText).find(Boolean) || '';
const imageList = (value) => (Array.isArray(value) ? value : [value]).flatMap((entry) => {
  if (typeof entry === 'string') return [entry];
  if (entry && typeof entry === 'object') return [entry.url, entry.src, entry.href, entry.imageUrl].filter(Boolean);
  return [];
});

const extractMatchingState = (root, context) => {
  const ids = new Set([context.productId, context.sku, context.upc, context.gtin, context.ean].filter(Boolean).map(String));
  const seen = new Set();
  const stack = [root];
  let visited = 0;
  while (stack.length && visited++ < 30_000) {
    const value = stack.pop();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    if (Array.isArray(value)) { for (const item of value.slice(0, 1000)) stack.push(item); continue; }
    const id = first(value.productId, value.product_id, value.id, value.sku, value.skuId, value.sku_id, value.upc, value.gtin, value.ean, value.code);
    const title = first(value.name, value.title, value.productName, value.product_name, value.displayName, value.display_name);
    const priceNode = value.price && typeof value.price === 'object' ? value.price : value.pricing && typeof value.pricing === 'object' ? value.pricing : {};
    const offer = Array.isArray(value.offers) ? value.offers[0] : value.offers && typeof value.offers === 'object' ? value.offers : {};
    const amount = first(typeof value.price === 'object' ? value.price.value : value.price, value.salePrice, value.sale_price, value.currentPrice, value.current_price, value.regularPrice, priceNode.amount, priceNode.value, priceNode.selling, offer.price);
    const currency = first(value.currency, value.currencyCode, value.currency_code, priceNode.currency, priceNode.currencyCode, offer.priceCurrency).toUpperCase();
    const imageUrls = imageList(value.images ?? value.image ?? value.gallery ?? value.media ?? value.imageUrls ?? value.image_urls).filter(goodImage);
    const brand = first(typeof value.brand === 'object' ? value.brand.name : value.brand, value.brandName, value.brand_name, value.vendor);
    const idsInNode = [id, safeText(value.productId), safeText(value.sku), safeText(value.upc), safeText(value.gtin), safeText(value.ean)].filter(Boolean);
    if (title && idsInNode.some((candidate) => ids.has(candidate))) return {
      title, brand, imageUrl: imageUrls[0] || '', imageUrls,
      price: /^\d+(?:\.\d{1,2})?$/.test(amount.replace(/,/g, '')) ? amount.replace(/,/g, '') : '', currency,
      productId: first(value.productId, value.product_id, value.id), sku: first(value.sku, value.skuId, value.sku_id),
      upc: safeText(value.upc), gtin: first(value.gtin, value.ean), availability: first(value.availability, value.stockStatus, value.stock_status),
      fieldSources: { title: 'retailer_first_party_api', brand: 'retailer_first_party_api', imageUrl: 'retailer_first_party_api', price: 'retailer_first_party_api', currency: 'retailer_first_party_api' },
    };
    for (const [key, child] of Object.entries(value)) {
      if (/password|token|cookie|authorization/i.test(key)) continue;
      if (child && typeof child === 'object') stack.push(child);
    }
  }
  return null;
};

export const createRenderedProductResolver = (extractProduct) => async (context) => {
  if (!capabilityFor(context)?.rendered) return {};
  let browser;
  const network = [];
  const started = new Set();
  let signalExactProduct;
  const exactProductResponse = new Promise((resolvePromise) => { signalExactProduct = resolvePromise; });
  const capture = async (response) => {
    const request = response.request();
    const url = response.url();
    let hostname = '';
    try { hostname = new URL(url).hostname; } catch { return; }
    if (!(hostname === context.baseDomain || hostname.endsWith(`.${context.baseDomain}`))) return;
    const info = { url: url.slice(0, 800), method: request.method(), status: response.status(), contentType: response.headers()['content-type'] || '' };
    const key = `${info.method}:${info.url}`;
    if (!started.has(key)) { started.add(key); network.push({ ...info, json: null }); }
    if (!/json/i.test(info.contentType)) return;
    const slot = network.find((entry) => `${entry.method}:${entry.url}` === key);
    if (!slot || slot.json || response.status() < 200 || response.status() >= 300) return;
    try {
      const body = await response.body();
      if (body.byteLength > 1_500_000) return;
      const parsed = JSON.parse(body.toString('utf8'));
      slot.json = extractMatchingState(parsed, context);
      if (slot.json) signalExactProduct(slot.json);
    } catch { /* Non JSON or unavailable browser response bodies are recorded without payload. */ }
  };
  try {
    const localBrowser = resolve(process.cwd(), '.playwright-browsers', 'chromium-1243', 'chrome-win64', 'chrome.exe');
    browser = await chromium.launch({ headless: true, ...(existsSync(localBrowser) ? { executablePath: localBrowser } : {}) });
    const page = await browser.newPage({ locale: context.country === 'CA' ? 'en-CA' : 'en-US' });
    page.on('response', (response) => { void capture(response); });
    page.on('requestfinished', async (request) => {
      const response = await request.response();
      if (response) void capture(response);
    });
    await page.route('**/*', (route) => {
      const type = route.request().resourceType();
      const url = route.request().url();
      return type === 'media' || type === 'font' || /(?:google-analytics|doubleclick|googletagmanager|facebook\.net\/tr)/i.test(url)
        ? route.abort() : route.continue();
    });
    await page.goto(context.originalUrl, { waitUntil: 'domcontentloaded', timeout: 14000 });
    await Promise.race([exactProductResponse, page.waitForFunction(() => {
      const title = document.querySelector('h1,[itemprop="name"]')?.textContent?.trim();
      const image = document.querySelector('main img,[class*="product"] img,[class*="gallery"] img')?.getAttribute('src');
      return Boolean(title && image);
    }, { timeout: 6000 }).catch(() => null), new Promise((resolvePromise) => setTimeout(resolvePromise, 6500))]);
    await page.waitForTimeout(800);
    const data = await page.evaluate(() => {
      const meta = (name) => document.querySelector(`meta[property="${name}"],meta[name="${name}"]`)?.content || '';
      const firstText = (selectors) => selectors.map((selector) => document.querySelector(selector)?.textContent?.trim()).find(Boolean) || '';
      const images = [...document.querySelectorAll('main img, [class*="product"] img, picture img, [class*="gallery"] img')]
        .flatMap((img) => [img.currentSrc, img.src, img.getAttribute('data-src'), img.srcset?.split(',').at(-1)?.trim().split(' ')[0]])
        .filter(Boolean).map((value) => { try { return new URL(value, location.href).href; } catch { return ''; } });
      const state = [];
      for (const key of ['__NEXT_DATA__', '__NUXT__', '__INITIAL_STATE__', '__APOLLO_STATE__', '__PRELOADED_STATE__', '__STATE__']) {
        try { if (window[key]) state.push(window[key]); } catch {}
      }
      for (const script of document.querySelectorAll('script[type="application/json"],script[type="application/ld+json"]')) {
        if (script.textContent.length > 1_500_000) continue;
        try { state.push(JSON.parse(script.textContent)); } catch {}
      }
      return { html: document.documentElement.outerHTML, title: firstText(['h1', '[itemprop="name"]']),
        price: meta('product:price:amount') || firstText(['[itemprop="price"]', '[data-testid*="price"]', '[class*="current-price"]']),
        currency: meta('product:price:currency'), color: firstText(['[data-testid*="color"]', '[class*="selected-color"]']), images, state };
    });
    if (/captcha|verify you are human|access denied|unusual traffic/i.test((await page.title()) + data.html.slice(0, 3000))) return {};
    const exactState = data.state.map((value) => extractMatchingState(value, context)).find(Boolean);
    const exactNetwork = network.map((entry) => entry.json).find(Boolean);
    const parsed = extractProduct(data.html, page.url());
    const structured = exactNetwork || exactState || {};
    const images = [...new Set([...(structured.imageUrls ?? []), ...(parsed.imageUrls ?? []), ...data.images].filter(goodImage))].slice(0, 12);
    const price = structured.price || parsed.price || data.price.match(/\d[\d,.]*/)?.[0]?.replace(/,/g, '') || '';
    const result = { ...parsed, ...structured, title: structured.title || parsed.title || data.title, brand: structured.brand || parsed.brand,
      imageUrl: structured.imageUrl || images[0] || '', imageUrls: images, price,
      currency: structured.currency || parsed.currency || data.currency || (price ? context.currencyHint : ''),
      color: parsed.colors?.[0] || data.color || '', retailer: context.retailer };
    result.fieldSources = Object.fromEntries(['title', 'brand', 'imageUrl', 'price', 'currency', 'color'].filter((field) => result[field]).map((field) => [field,
      structured[field] ? 'retailer_first_party_api' : field === 'imageUrl' ? 'rendered_retailer_gallery' : 'rendered_retailer']));
    const networkSummary = network.slice(0, 80).map(({ url, method, status, contentType, json }) => ({ url, method, status, contentType, exactProductMatch: Boolean(json) }));
    console.info(JSON.stringify({ event: 'RENDERED_NETWORK_DIAGNOSTICS', retailer: context.retailer, productId: context.productId, responses: networkSummary }));
    return result;
  } finally { await browser?.close(); }
};
