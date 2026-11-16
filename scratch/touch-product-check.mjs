import assert from 'node:assert/strict';
import { resolve } from 'node:path';

process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve('.playwright-browsers');
const { chromium } = await import('playwright');
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const page = await context.newPage();
page.setDefaultTimeout(5000);
await page.route('**/api/**', route => route.fulfill({ status: 503, body: '{}' }));
const tap = locator => locator.tap();
const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('cura-link-only-board-v3')));
const dispatchTouch = async (cdp, type, points = []) => cdp.send('Input.dispatchTouchEvent', {
  type, touchPoints: points.map(([x, y, id]) => ({ x, y, id })),
});
async function addManual(name) {
  const closeInspector = page.getByRole('button', { name: 'Close inspector' });
  if (await closeInspector.isVisible().catch(() => false)) await tap(closeInspector);
  const add = page.locator('.empty-canvas-primary');
  if (await add.isVisible().catch(() => false)) await tap(add);
  else await tap(page.locator('.canvas-toolbar .canvas-add'));
  const dialog = page.locator('.add-modal');
  await tap(dialog.getByRole('button', { name: 'Add details manually instead' }));
  await dialog.locator('.primary-link-field input').fill(`https://example.com/products/${name.toLowerCase().replace(/\s+/g, '-')}`);
  await dialog.locator('input[placeholder="Linen trousers"]').fill(name);
  await dialog.getByRole('button', { name: 'Add to board' }).tap();
  await dialog.waitFor({ state: 'hidden', timeout: 5000 });
  await page.waitForTimeout(80);
}
try {
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
  await addManual('Touch product one');
  await addManual('Touch product two');
  assert.equal((await saved()).items.length, 2, 'touch form adds products');
  const closeInspector = page.getByRole('button', { name: 'Close inspector' });
  if (await closeInspector.isVisible().catch(() => false)) await tap(closeInspector);

  const cards = page.locator('.sticker:not(.template-placeholder)');
  await tap(cards.first());
  assert.equal(await page.locator('.sticker.is-selected').count(), 1, 'one touch selects a product');
  const bar = page.locator('.unified-selection-bar');
  await tap(bar.getByRole('button', { name: 'Edit', exact: true }));
  assert.ok(await page.locator('.inspector').isVisible(), 'Edit opens the product inspector by touch');
  const productTitle = page.locator('.inspector label').filter({ hasText: /^Title/ }).locator('input');
  await productTitle.fill('Touch edited product');
  await page.waitForTimeout(80);
  assert.ok((await saved()).items.some(item => item.title === 'Touch edited product'), 'touch edits product details');
  await tap(page.getByRole('button', { name: 'Close inspector' }));

  await tap(page.locator('.canvas-mode-select'));
  await tap(page.locator('.canvas-mode-select'));
  await tap(page.locator('.canvas-mode-select'));
  const firstCard = cards.first();
  await tap(firstCard);
  assert.equal(await page.locator('.sticker.is-selected').count(), 1);
  const beforeMove = await saved();
  const cardBox = await firstCard.locator('.sticker-art').boundingBox() ?? await firstCard.boundingBox();
  assert.ok(cardBox);
  const moveX = cardBox.x + cardBox.width / 2;
  const moveY = cardBox.y + cardBox.height / 2;
  const cdp = await context.newCDPSession(page);
  await dispatchTouch(cdp, 'touchStart', [[moveX, moveY, 1]]);
  await dispatchTouch(cdp, 'touchMove', [[moveX + 35, moveY + 22, 1]]);
  await dispatchTouch(cdp, 'touchEnd');
  await page.waitForTimeout(100);
  const afterMove = await saved();
  assert.ok(afterMove.items[0].x > beforeMove.items[0].x && afterMove.items[0].y > beforeMove.items[0].y, `touch drag moves a product; before=${JSON.stringify(beforeMove.items.map(item => [item.id,item.x,item.y]))}, after=${JSON.stringify(afterMove.items.map(item => [item.id,item.x,item.y]))}, mode=${await page.locator('.canvas-mode-select').innerText()}`);
  await page.reload({ waitUntil: 'domcontentloaded' });

  const resizedCard = page.locator('.sticker:not(.template-placeholder)').first();
  await tap(resizedCard);
  const grip = resizedCard.locator('.sticker-resize');
  const gripBox = await grip.boundingBox();
  assert.ok(gripBox, 'selected product exposes a resize target');
  const resizeBefore = await saved();
  const resizeX = gripBox.x + gripBox.width / 2;
  const resizeY = gripBox.y + gripBox.height / 2;
  await dispatchTouch(cdp, 'touchStart', [[resizeX, resizeY, 1]]);
  await dispatchTouch(cdp, 'touchMove', [[resizeX + 30, resizeY + 30, 1]]);
  await dispatchTouch(cdp, 'touchEnd');
  await page.waitForTimeout(100);
  const resizeAfter = await saved();
  assert.ok((resizeAfter.items[0].scale ?? 1) > (resizeBefore.items[0].scale ?? 1), 'touch drag resizes a product');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await tap(page.locator('.canvas-mode-select'));
  await tap(cards.nth(0));
  await tap(cards.nth(1));
  assert.equal(await page.locator('.sticker.is-selected').count(), 2, 'touch Select mode supports multi-selection');
  await tap(bar.getByRole('button', { name: 'Delete', exact: true }));
  const confirmation = page.getByRole('alertdialog');
  assert.ok(await confirmation.isVisible(), 'touch Delete opens a confirmation');
  assert.match(await confirmation.innerText(), /Delete all selected items\?/);
  await tap(confirmation.getByRole('button', { name: 'Delete all', exact: true }));
  await page.waitForTimeout(80);
  assert.equal((await saved()).items.length, 0, 'confirmed touch deletion removes selected products');
  console.log('Phone touch QA passed: manual URL add, product selection/edit, multi-select, touch move/resize, and confirmed delete.');
} finally {
  await context.close();
  await browser.close();
}
