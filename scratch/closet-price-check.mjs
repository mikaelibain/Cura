import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL(resolve(tmpdir(), 'cura-layout-check/node_modules/playwright-core/index.mjs')));
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.addInitScript(() => {
  const shared = { brand: 'Shop', sourceUrl: 'https://example.com/product', imageUrl: '', color: '', size: '', colorOptions: [], sizeOptions: [], availability: 'Normal availability', notes: '', unsure: false, bought: true, createdAt: new Date().toISOString() };
  localStorage.setItem('cura-link-only-board-v2', JSON.stringify({
    items: [
      { ...shared, id: 'hair', title: "L'Oreal Hair Expertise Glycolic Gloss Rinse-Off", price: 37, estimateLow: 8, estimateHigh: 65, priceEstimated: true, priceReference: 'Haircare price estimate (listing price unavailable)', currency: 'CAD', x: 20, y: 140 },
      { ...shared, id: 'skirt', title: 'Capture Satin Skirt', price: 128, currency: 'CAD', x: 260, y: 140 },
      { ...shared, id: 'scent', title: 'Dior Eau de Parfum', price: 140, currency: 'CAD', x: 500, y: 140 },
    ],
    outfits: [],
  }));
  localStorage.setItem('thread-shopping-canvas-user-settings', JSON.stringify({ preferredCurrency: 'CAD' }));
});

try {
  await page.goto('http://localhost:8799');
  await page.locator('[data-item-id="hair"]').waitFor();
  assert.match(await page.locator('[data-item-id="hair"] .product-price').innerText(), /^Est\. CA\$8–CA\$65$/);
  assert.equal(await page.locator('.board-total strong').innerText(), 'CA$0', 'bought items stay out of planned spending');
  await page.getByRole('button', { name: /My Closet/ }).click();
  await page.locator('.closet-tabs').getByRole('button', { name: 'Haircare', exact: true }).click();
  assert.match(await page.locator('.closet-card-info small').innerText(), /^Est\. CA\$8–CA\$65$/);
  for (const [category, expected] of [['Haircare', 'L\'Oreal Hair Expertise'], ['Bottoms', 'Capture Satin Skirt'], ['Fragrance', 'Dior Eau de Parfum']]) {
    await page.locator('.closet-tabs').getByRole('button', { name: category, exact: true }).click();
    assert.equal(await page.locator('.closet-card').count(), 1, `${category} contains only its matching item`);
    assert.ok((await page.locator('.closet-card').innerText()).includes(expected));
  }
  assert.equal(await page.locator('.closet-tabs').getByRole('button', { name: 'Beauty', exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: category-specific Closet filters, broad estimated range, and bought items excluded from planned total.');
} finally {
  await browser.close();
}
