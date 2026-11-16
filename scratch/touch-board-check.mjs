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
try {
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
  await tap(page.locator('.empty-canvas-routes').getByRole('button', { name: 'New board', exact: true }));
  assert.equal((await saved()).outfits.length, 1, 'touch creates a board');
  const closeInspector = page.getByRole('button', { name: 'Close inspector' });
  if (await closeInspector.isVisible().catch(() => false)) await tap(closeInspector);
  await tap(page.locator('.canvas-toolbar .fit-canvas'));
  const title = page.locator('.outfit-label').first();
  await tap(title);
  assert.ok(await page.locator('.unified-selection-bar').isVisible(), 'touch selects a board');
  const bar = page.locator('.unified-selection-bar');
  await tap(bar.locator('.selection-more summary'));
  await tap(bar.getByRole('button', { name: 'Set budget' }));
  const budget = page.locator('.budget-modal');
  assert.ok(await budget.isVisible(), 'touch Set budget opens the budget editor');
  const close = budget.locator('button[aria-label^="Close"]').first();
  if (await close.count()) await tap(close);
  else await tap(budget.getByRole('button', { name: /cancel/i }));

  await tap(page.locator('.canvas-mode-select'));
  const before = (await saved()).outfits[0];
  const header = page.locator('.outfit-header').first();
  const rect = await header.boundingBox();
  assert.ok(rect);
  const x = rect.x + rect.width / 2;
  const y = rect.y + rect.height / 2;
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 36, y: y + 24, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(100);
  const after = (await saved()).outfits[0];
  assert.ok(after.customLeft > before.customLeft && after.customTop > before.customTop, 'touch drag moves a board');
  assert.equal(after.customWidth, before.customWidth, 'board width stays unchanged');
  assert.equal(after.customHeight, before.customHeight, 'board height stays unchanged');
  console.log('Phone touch QA passed: create board, select board, Set budget, move board, and preserve board dimensions.');
} finally {
  await context.close();
  await browser.close();
}
