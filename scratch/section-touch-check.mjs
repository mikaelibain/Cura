import assert from 'node:assert/strict';
import { resolve } from 'node:path';

process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve('.playwright-browsers');
const { chromium } = await import('playwright');
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const page = await context.newPage();
page.setDefaultTimeout(8000);
await page.route('**/api/**', route => route.fulfill({ status: 503, body: '{}' }));
const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('cura-link-only-board-v3')));
const tap = locator => locator.tap();
const dispatchTouch = async (cdp, type, points = []) => cdp.send('Input.dispatchTouchEvent', {
  type,
  touchPoints: points.map(([x, y, id]) => ({ x, y, id })),
});

try {
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
  if (await page.getByRole('button', { name: 'Templates', exact: true }).isVisible().catch(() => false)) {
    await tap(page.getByRole('button', { name: 'Templates', exact: true }));
  } else {
    await tap(page.locator('.workspace-menu-trigger'));
    await tap(page.getByRole('group', { name: /workspace actions/i }).getByRole('button', { name: 'Templates' }));
  }
  const picker = page.getByRole('dialog', { name: 'Choose a canvas template' });
  await tap(picker.getByRole('button', { name: /Preview Hair Routine/ }));
  await tap(picker.getByRole('button', { name: /Use template/ }));

  const section = page.locator('.canvas-section').first();
  const title = section.locator('.section-title');
  await tap(title);
  assert.ok(await section.evaluate(element => element.classList.contains('is-active')));
  assert.equal(await page.locator('.section-mobile-editor').count(), 0, 'single tap selects without editing');
  const toolbar = page.locator('.section-toolbar');
  await tap(toolbar.getByRole('button', { name: 'Rename' }));
  const editor = page.locator('.section-mobile-editor');
  assert.ok(await editor.isVisible());
  const titleInput = page.getByRole('textbox', { name: 'Section title' });
  await titleInput.fill('Touch Hair Edit');
  await tap(editor.getByRole('button', { name: 'Close section editor' }));
  assert.equal((await saved()).sections[0].title, 'Touch Hair Edit');
  await tap(toolbar.getByRole('button', { name: 'Style' }));
  assert.ok(await editor.isVisible(), 'Style opens the touch editor');
  await tap(editor.getByRole('button', { name: 'Close section editor' }));
  await tap(title);
  await tap(title);
  assert.ok(await editor.isVisible(), 'double tap enters section editing');
  assert.equal(await page.locator('.section-mobile-editor:visible').count(), 1, 'only one section editor is visible');
  await tap(editor.getByRole('button', { name: 'Close section editor' }));

  const beforeMove = await saved();
  await tap(page.locator('.canvas-mode-select'));
  const heading = section.locator('.section-heading');
  const rect = await heading.boundingBox();
  assert.ok(rect && rect.height >= 44, 'the section header is a touch-sized move target');
  const cdp = await context.newCDPSession(page);
  const startX = Math.min(rect.x + rect.width - 12, 370);
  const startY = rect.y + rect.height / 2;
  await dispatchTouch(cdp, 'touchStart', [[startX, startY, 1]]);
  await dispatchTouch(cdp, 'touchMove', [[startX + 36, startY + 20, 1]]);
  await dispatchTouch(cdp, 'touchEnd');
  await page.waitForTimeout(120);
  const afterMove = await saved();
  const deltaX = afterMove.sections[0].x - beforeMove.sections[0].x;
  const deltaY = afterMove.sections[0].y - beforeMove.sections[0].y;
  assert.ok(deltaX > 0 && deltaY > 0, 'touch drag moves section');
  assert.equal(afterMove.sections[0].width, beforeMove.sections[0].width);
  assert.equal(afterMove.sections[0].height, beforeMove.sections[0].height);
  const childBoard = afterMove.outfits.find(outfit => beforeMove.sections[0].boardIds.includes(outfit.id));
  const oldChildBoard = beforeMove.outfits.find(outfit => outfit.id === childBoard.id);
  assert.equal(childBoard.customLeft, oldChildBoard.customLeft + deltaX);
  const childItem = afterMove.items.find(item => childBoard.itemIds.includes(item.id));
  const oldChildItem = beforeMove.items.find(item => item.id === childItem.id);
  assert.equal(childItem.x, oldChildItem.x + deltaX);

  await page.screenshot({ path: 'scratch/final-touch-section-after-drag.png' });
  console.log('Phone touch QA passed: template, single-tap select, explicit rename/style, double-tap edit, section drag, child world-coordinate translation, and unchanged section dimensions.');
} finally {
  await context.close();
  await browser.close();
}
