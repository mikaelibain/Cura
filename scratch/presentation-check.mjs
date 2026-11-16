import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL(resolve(tmpdir(), 'cura-layout-check/node_modules/playwright-core/index.mjs')));
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const bottle = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="410"><rect width="100" height="410" rx="12" fill="#f0bdd0"/><text x="50" y="210" text-anchor="middle" font-size="16">SHAMPOO</text></svg>')}`;
const coat = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="180" height="290"><rect x="35" y="10" width="110" height="280" rx="16" fill="#af9c8a"/></svg>')}`;
await page.addInitScript(({ bottle, coat }) => {
  const base = { brand: 'Cura', color: '', size: '', colorOptions: [], sizeOptions: [], availability: 'Normal availability', notes: '', unsure: false, createdAt: new Date().toISOString() };
  if (!localStorage.getItem('cura-link-only-board-v2')) localStorage.setItem('cura-link-only-board-v2', JSON.stringify({ items: [
    { ...base, id: 'bottle', title: 'Gloss shampoo', sourceUrl: 'https://example.com/bottle', imageUrl: bottle, price: 19.99, currency: 'CAD', x: 60, y: 220 },
    { ...base, id: 'coat', title: 'Very long classic wool coat with a double-breasted front and a beautifully tailored silhouette', sourceUrl: 'https://example.com/coat', imageUrl: coat, price: 140, priceEstimated: true, currency: 'CAD', x: 300, y: 220 },
    { ...base, id: 'missing', title: 'Everyday lip gloss', sourceUrl: 'https://example.com/lip', imageUrl: bottle, price: null, currency: 'CAD', x: 560, y: 220 },
  ], outfits: [{ id: 'legacy', name: 'Beauty and clothing together', itemIds: ['bottle', 'coat', 'missing'], budget: null }] }));
  localStorage.setItem('thread-shopping-canvas-user-settings', JSON.stringify({ preferredCurrency: 'CAD' }));
}, { bottle, coat });

const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('cura-link-only-board-v2')));
try {
  await page.goto('http://localhost:8787');
  await page.locator('.sticker').first().waitFor();
  assert.equal(await page.locator('.sticker').count(), 3, 'legacy products load');
  assert.equal((await saved()).outfits[0].presentation, undefined, 'legacy data was not rewritten just to load');
  for (const id of ['bottle', 'coat', 'missing']) {
    const card = page.locator(`[data-item-id="${id}"]`);
    const order = await card.evaluate((el) => [...el.querySelector('.sticker-meta').children].map((child) => child.className));
    assert.ok(order.indexOf('product-name') < order.indexOf('product-price'), `${id}: name precedes price`);
    const typography = await card.evaluate((el) => {
      const name = getComputedStyle(el.querySelector('.product-name'));
      const price = getComputedStyle(el.querySelector('.product-price'));
      return { nameWeight: +name.fontWeight, priceWeight: +price.fontWeight, nameSize: parseFloat(name.fontSize), priceSize: parseFloat(price.fontSize) };
    });
    assert.ok(typography.nameWeight >= 600 && typography.priceWeight >= 600 && typography.nameSize >= 14 && typography.priceSize >= 13, `${id}: readable hierarchy`);
  }
  assert.match(await page.locator('[data-item-id="bottle"] .product-price').innerText(), /CA\$19\.99/);
  assert.match(await page.locator('[data-item-id="coat"] .product-price').innerText(), /^Est\. CA\$/);
  assert.equal(await page.locator('[data-item-id="missing"] .product-price').innerText(), 'Price unavailable');
  assert.equal(await page.locator('[data-item-id="bottle"] img').evaluate((el) => getComputedStyle(el).objectFit), 'contain');
  assert.match(await page.locator('[data-outfit-id="legacy"] .outfit-price').innerText(), /Estimated partial total/);
  assert.match(await page.locator('[data-outfit-id="legacy"] .outfit-price').innerText(), /1 price missing/);

  let popupCount = 0;
  page.on('popup', () => { popupCount += 1; });
  await page.locator('[data-item-id="bottle"] .product-image-shell').click();
  assert.equal(popupCount, 0, 'single click edits instead of navigating');
  await page.getByRole('tab', { name: 'style' }).click();
  await page.getByRole('button', { name: 'Polaroid' }).click();
  assert.match(await page.locator('[data-item-id="bottle"]').getAttribute('class'), /product-style-polaroid/);
  await page.getByRole('tab', { name: 'shape' }).click();
  await page.getByRole('button', { name: 'Oval' }).click();
  assert.match(await page.locator('[data-item-id="bottle"]').getAttribute('class'), /image-shape-oval/);
  assert.equal((await saved()).items.find((item) => item.id === 'bottle').sourceUrl, 'https://example.com/bottle');
  assert.equal(await page.locator('[data-item-id="bottle"] .product-open-link').count(), 1, 'explicit retailer link exists');

  await page.locator('[data-item-id="missing"] .add-price-action').click();
  const priceInput = page.locator('.inspector input[type="number"]').first();
  await priceInput.fill('24.50');
  assert.match(await page.locator('[data-item-id="missing"] .product-price').innerText(), /CA\$24\.50/);
  await page.route('**/api/extract-product', (route) => route.fulfill({ json: { title: 'Store title', price: '99', currency: 'USD', imageUrl: coat } }));
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.waitForTimeout(200);
  assert.equal((await saved()).items.find((item) => item.id === 'missing').price, 24.5, 'manual price survives retailer refresh');

  await page.locator('[data-outfit-id="legacy"] .outfit-label').click();
  const before = (await saved()).items.map(({ id, x, y, sourceUrl }) => ({ id, x, y, sourceUrl }));
  await page.getByLabel('Board template').selectOption('beauty');
  assert.deepEqual((await saved()).items.map(({ id, x, y, sourceUrl }) => ({ id, x, y, sourceUrl })), before, 'restyle keeps positions and product identity');
  assert.match(await page.locator('[data-outfit-id="legacy"]').getAttribute('class'), /board-background-blush/);
  await page.screenshot({ path: resolve(tmpdir(), 'cura-presentation-beauty.png') });
  await page.getByLabel('Board layout').selectOption('grid');
  await page.getByRole('button', { name: 'Re-layout', exact: true }).click();
  assert.notDeepEqual((await saved()).items.map(({ id, x, y }) => ({ id, x, y })), before.map(({ id, x, y }) => ({ id, x, y })), 'explicit re-layout moves cards');
  await page.getByLabel('Board layout').selectOption('routine-steps');
  await page.getByRole('button', { name: 'Re-layout', exact: true }).click();
  assert.match(await page.locator('[data-item-id="bottle"] .product-section-label').innerText(), /Step 1/i);
  await page.getByRole('button', { name: 'Move Gloss shampoo down' }).click();
  assert.equal((await saved()).outfits[0].itemIds[1], 'bottle', 'routine steps can be reordered');
  await page.getByLabel('Board layout').selectOption('category-rows');
  await page.getByRole('button', { name: 'Re-layout', exact: true }).click();
  assert.match(await page.locator('[data-item-id="coat"] .product-section-label').innerText(), /Tops & layers/i);
  await page.getByLabel('Board layout').selectOption('capsule');
  await page.getByRole('button', { name: 'Re-layout', exact: true }).click();
  assert.match(await page.locator('[data-item-id="bottle"] .product-section-label').innerText(), /Hair/i);

  await page.getByRole('button', { name: 'New board', exact: true }).click();
  assert.equal((await saved()).outfits.at(-1).presentation.templateId, 'default');
  const templates = [['Beauty Edit', 'beauty'], ['Skincare Routine', 'skincare'], ['Clothing Haul', 'clothing'], ['Mixed Haul', 'mixed'], ['Capsule Wardrobe', 'capsule']];
  for (const [name, id] of templates) {
    await page.getByRole('button', { name: 'Templates', exact: true }).click();
    await page.locator('.template-options').getByRole('button', { name: new RegExp(name) }).click();
    assert.equal((await saved()).outfits.at(-1).presentation.templateId, id, `${name} created`);
    assert.equal(await page.locator(`[data-outfit-id="${(await saved()).outfits.at(-1).id}"]`).count(), 1, `${name} renders`);
  }
  await page.getByRole('button', { name: 'Fit canvas', exact: true }).click();

  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData('text/plain', 'https://example.com/pasted-product');
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
  });
  await page.locator('.sticker').filter({ hasText: 'Store title' }).waitFor();
  assert.equal((await saved()).items.length, 4, 'link paste creates a product');
  await page.locator('.board').evaluate((el) => {
    const data = new DataTransfer();
    data.setData('text/plain', 'https://example.com/dropped-product');
    el.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, clientX: 650, clientY: 650 }));
  });
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('cura-link-only-board-v2')).items.length === 5);
  assert.equal((await saved()).items.at(-1).sourceUrl, 'https://example.com/dropped-product', 'link drop creates a product');
  const beforeReload = await saved();
  await page.reload();
  assert.equal((await saved()).outfits.length, beforeReload.outfits.length, 'new boards persist across reloads');
  assert.equal((await saved()).items.find((item) => item.id === 'bottle').presentation.preset, 'polaroid', 'item formatting persists');
  assert.equal((await saved()).items.find((item) => item.id === 'missing').price, 24.5, 'manual price persists');

  const mobile = await browser.newPage({ viewport: { width: 375, height: 812 } });
  mobile.on('pageerror', (error) => errors.push(error.message));
  await mobile.addInitScript((image) => {
    localStorage.setItem('cura-link-only-board-v2', JSON.stringify({ items: [{
      id: 'mobile', title: 'Daily gloss shampoo', brand: 'Cura', sourceUrl: 'https://example.com/shampoo',
      imageUrl: image, price: 19.99, currency: 'CAD', color: '', size: '', colorOptions: [], sizeOptions: [],
      availability: 'Normal availability', notes: '', unsure: false, x: 0, y: 130, createdAt: new Date().toISOString(),
    }], outfits: [] }));
  }, bottle);
  await mobile.goto('http://localhost:8787');
  await mobile.locator('[data-item-id="mobile"] .product-image-shell').click();
  const toolbar = await mobile.locator('.format-toolbar').boundingBox();
  assert.ok(toolbar.x >= 0 && toolbar.x + toolbar.width <= 375 && toolbar.y >= 0 && toolbar.y + toolbar.height <= 812, 'mobile formatting stays onscreen');
  await mobile.getByRole('tab', { name: 'shape' }).click();
  await mobile.getByRole('button', { name: 'Arch' }).click();
  assert.match(await mobile.locator('[data-item-id="mobile"]').getAttribute('class'), /image-shape-arch/);
  await mobile.screenshot({ path: resolve(tmpdir(), 'cura-presentation-mobile.png') });
  assert.deepEqual(errors, [], 'no browser runtime errors');
  console.log('PASS: legacy data, price states, card hierarchy, image fit, selection, presets, shape, manual price, restyle, re-layout, six templates, link paste and drop, mobile formatting.');
} finally {
  await browser.close();
}
