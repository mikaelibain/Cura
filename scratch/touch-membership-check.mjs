import assert from 'node:assert/strict';
import { resolve } from 'node:path';

process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve('.playwright-browsers');
const { chromium } = await import('playwright');
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const page = await context.newPage();
page.setDefaultTimeout(6000);
await page.route('**/api/**', route => route.fulfill({ status: 503, body: '{}' }));
const tap = locator => locator.tap();
const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('cura-link-only-board-v3')));
const addManual = async name => {
  const add = page.locator('.empty-canvas-primary');
  if (await add.isVisible().catch(() => false)) await tap(add);
  else {
    const close = page.getByRole('button', { name: 'Close inspector' });
    if (await close.isVisible().catch(() => false)) await tap(close);
    await tap(page.locator('.canvas-toolbar .canvas-add'));
  }
  const dialog = page.locator('.add-modal');
  await tap(dialog.getByRole('button', { name: 'Add details manually instead' }));
  await dialog.locator('.primary-link-field input').fill(`https://example.com/products/${name.toLowerCase().replace(/\s+/g, '-')}`);
  await dialog.locator('input[placeholder="Linen trousers"]').fill(name);
  await tap(dialog.getByRole('button', { name: 'Add to board' }));
  await dialog.waitFor({ state: 'hidden' });
  const close = page.getByRole('button', { name: 'Close inspector' });
  if (await close.isVisible().catch(() => false)) await tap(close);
};
const dispatchTouch = async (cdp, type, points = []) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y, id]) => ({ x, y, id })) });
try {
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
  await addManual('Membership one');
  await addManual('Membership two');
  const cards = page.locator('.sticker:not(.template-placeholder)');
  await tap(page.locator('.canvas-mode-select'));
  await tap(page.locator('.canvas-mode-select'));
  await tap(page.locator('.canvas-mode-select'));
  await tap(cards.first());
  const productId = (await saved()).items[0].id;
  await tap(page.locator('.unified-selection-bar').getByRole('button', { name: 'Make board' }));
  let state = await saved();
  assert.equal(state.outfits.length, 1);
  assert.ok(state.outfits[0].itemIds.includes(productId), 'Make board places the selected product in the new board');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await tap(page.locator('.canvas-toolbar .fit-canvas'));
  await tap(page.locator('.canvas-mode-select'));
  const marqueeCdp = await context.newCDPSession(page);
  await dispatchTouch(marqueeCdp, 'touchStart', [[10, 80, 1]]);
  await dispatchTouch(marqueeCdp, 'touchMove', [[380, 750, 1]]);
  await dispatchTouch(marqueeCdp, 'touchEnd');
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.sticker.is-selected').count(), 1, 'touch mixed marquee selects the free product');
  assert.equal(await page.locator('.outfit-frame.is-board-selected').count(), 1, 'touch mixed marquee selects the enclosed board');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await tap(page.locator('.canvas-toolbar .fit-canvas'));
  await tap(page.locator('.canvas-mode-select'));
  const boardBox = await page.locator('.outfit-frame').first().boundingBox();
  assert.ok(boardBox);
  await dispatchTouch(marqueeCdp, 'touchStart', [[boardBox.x - 6, boardBox.y - 6, 1]]);
  await dispatchTouch(marqueeCdp, 'touchMove', [[boardBox.x + boardBox.width + 6, boardBox.y + boardBox.height + 6, 1]]);
  await dispatchTouch(marqueeCdp, 'touchEnd');
  await page.waitForTimeout(80);
  assert.equal(await page.locator('.outfit-frame.is-board-selected').count(), 1, 'touch marquee selects a board');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await tap(page.locator('.canvas-toolbar .fit-canvas'));
  await tap(page.locator('.canvas-mode-select'));
  const freeCard = page.locator('.sticker:not(.template-placeholder)').filter({ hasText: 'Membership two' });
  const freeBox = await freeCard.boundingBox(); console.log('freeBox', freeBox, 'cardCount', await cards.count());
  assert.ok(freeBox);
  await dispatchTouch(marqueeCdp, 'touchStart', [[freeBox.x - 25, freeBox.y - 25, 1]]);
  await dispatchTouch(marqueeCdp, 'touchMove', [[freeBox.x + freeBox.width + 20, freeBox.y + freeBox.height + 20, 1]]);
  await dispatchTouch(marqueeCdp, 'touchEnd');
  await page.waitForTimeout(80);
  assert.equal(await page.locator('.sticker.is-selected').count(), 1, 'touch marquee selects a product');
  assert.equal(await page.locator('.outfit-frame.is-board-selected').count(), 0, 'product marquee leaves the board unselected');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await tap(page.locator('.canvas-toolbar .fit-canvas'));
  await tap(page.locator('.canvas-mode-select'));
  const secondCard = page.locator('.sticker:not(.template-placeholder)').nth(1);
  await tap(secondCard);
  const source = await secondCard.locator('.sticker-art').boundingBox() ?? await secondCard.boundingBox();
  const target = await page.locator('.outfit-frame').first().boundingBox();
  assert.ok(source && target);
  const cdp = await context.newCDPSession(page);
  await dispatchTouch(cdp, 'touchStart', [[source.x + source.width / 2, source.y + source.height / 2, 1]]);
  await dispatchTouch(cdp, 'touchMove', [[target.x + target.width / 2, target.y + target.height / 2, 1]]);
  await dispatchTouch(cdp, 'touchEnd');
  await page.waitForTimeout(120);
  state = await saved();
  const movedProductId = state.items[1].id;
  assert.ok(state.outfits[0].itemIds.includes(movedProductId), 'touch drag moves a product into the board');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await tap(page.locator('.canvas-toolbar .fit-canvas'));
  await tap(page.locator('.canvas-mode-select'));
  const movingCard = page.locator('.sticker:not(.template-placeholder)').filter({ hasText: 'Membership two' });
  await tap(movingCard);
  assert.equal(await page.locator('.sticker.is-selected').count(), 1, 'select product before the drag-out gesture');
  const cardRect = await movingCard.locator('.sticker-art').boundingBox() ?? await movingCard.boundingBox();
  const boardRect = await page.locator('.outfit-frame').first().boundingBox();
  assert.ok(cardRect && boardRect);
  const sourceX = cardRect.x + cardRect.width / 2, sourceY = cardRect.y + cardRect.height / 2;
  const targetX = Math.min(380, Math.max(10, boardRect.x + boardRect.width / 2));
  const targetY = boardRect.y > 100 ? 60 : Math.max(60, boardRect.y + boardRect.height + 100);
  const detachCdp = await context.newCDPSession(page);
  await dispatchTouch(detachCdp, 'touchStart', [[sourceX, sourceY, 1]]);
  await dispatchTouch(detachCdp, 'touchMove', [[targetX, targetY, 1]]);
  await dispatchTouch(detachCdp, 'touchEnd');
  await page.waitForTimeout(120);
  state = await saved();
  assert.ok(!state.outfits[0].itemIds.includes(movedProductId), `touch drag out removes board membership and keeps the product; itemIds=${JSON.stringify(state.outfits[0].itemIds)}, target=${targetX},${targetY}`);
  assert.ok(state.items.some(item => item.id === movedProductId), 'the product remains in the canvas data');
  console.log('Phone touch QA passed: mixed product/board marquee, drag a product into a board, and drag it back out while keeping the card.');
} finally {
  await context.close();
  await browser.close();
}
