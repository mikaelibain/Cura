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
const openMore = async () => {
  const trigger = page.locator('.workspace-menu-trigger');
  if (!(await page.locator('.workspace-menu').isVisible().catch(() => false))) await tap(trigger);
  return page.getByRole('group', { name: /workspace actions/i });
};
const closeModal = async locator => {
  const close = locator.locator('button[aria-label^="Close"], button[title^="Close"]').first();
  if (await close.count()) await tap(close);
  else if (await locator.getByRole('button', { name: 'Done', exact: true }).count()) await tap(locator.getByRole('button', { name: 'Done', exact: true }));
};
const cdpTouch = async (cdp, type, points = []) => cdp.send('Input.dispatchTouchEvent', {
  type, touchPoints: points.map(([x, y, id]) => ({ x, y, id })),
});

try {
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
  const initialActions = await openMore();
  await tap(initialActions.getByRole('button', { name: 'Templates', exact: true }));
  const picker = page.getByRole('dialog', { name: 'Choose a canvas template' });
  await tap(picker.getByRole('button', { name: /Preview Hair Routine/ }));
  await tap(picker.getByRole('button', { name: /Use template/ }));

  await tap(page.locator('.canvas-toolbar .canvas-add'));
  const add = page.locator('.add-modal');
  const urlInput = add.locator('.primary-link-field input');
  await tap(urlInput);
  const inputPresentation = await urlInput.evaluate(element => ({ inputMode: element.inputMode, fontSize: getComputedStyle(element).fontSize, submitPosition: getComputedStyle(element.closest('form').querySelector('.submit-button')).position }));
  assert.equal(inputPresentation.inputMode, 'url');
  assert.ok(Number.parseFloat(inputPresentation.fontSize) >= 16 && inputPresentation.submitPosition === 'sticky', 'add form is usable with the phone keyboard');
  await tap(add.getByRole('button', { name: 'Close add product' }));

  const initialViewport = await page.locator('.world').evaluate(el => getComputedStyle(el).transform);
  await tap(page.locator('.canvas-toolbar .fit-canvas'));
  await page.waitForTimeout(100);
  const fitViewport = await page.locator('.world').evaluate(el => getComputedStyle(el).transform);
  assert.notEqual(fitViewport, initialViewport, 'Fit changes canvas framing');
  await tap(page.locator('.canvas-zoom-more summary'));
  const zoomIn = page.getByRole('button', { name: 'Zoom in' });
  await page.screenshot({ path: 'scratch/touch-zoom-menu.png' });
  await tap(zoomIn);
  const zoomedViewport = await page.locator('.world').evaluate(el => getComputedStyle(el).transform);
  assert.notEqual(zoomedViewport, fitViewport, 'touch zoom control changes canvas framing');

  const actions = await openMore();
  await tap(actions.getByRole('button', { name: /Saved collections/ }));
  const saved = page.getByRole('dialog', { name: 'Saved collections' });
  assert.ok(await saved.isVisible(), 'Saved collections opens by touch');
  await closeModal(saved);
  await tap((await openMore()).getByRole('button', { name: /My Purchases/ }));
  const purchases = page.locator('.closet-drawer');
  assert.ok(await purchases.isVisible(), 'Purchases opens by touch');
  await closeModal(purchases);
  await tap((await openMore()).getByRole('button', { name: 'Settings', exact: true }));
  const settings = page.locator('.settings-modal');
  assert.ok(await settings.isVisible(), 'Settings opens by touch');
  await tap(settings.getByRole('button', { name: 'Sizing preferences' }));
  const sizing = page.getByRole('dialog', { name: 'Sizing preferences' });
  assert.ok(await sizing.isVisible(), 'Sizing preferences opens by touch');
  await tap(sizing.getByRole('button', { name: 'Close sizing preferences' }));
  await tap(settings.locator('.modal-heading button').first());
  await tap((await openMore()).getByRole('button', { name: /Share canvas/ }));
  const share = page.locator('.share-link-toast');
  assert.ok(await share.isVisible(), 'Share opens by touch');
  await closeModal(share);
  assert.equal(await page.locator('.workspace-menu').count(), 0, 'workspace menu can be dismissed by touch');
  assert.equal(await page.locator('.share-link-toast').count(), 0, 'share surface can be dismissed by touch');

  const board = page.locator('.board');
  const beforePan = await board.evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const cdp = await context.newCDPSession(page);
  const beforePinch = await page.locator('.world').evaluate(el => new DOMMatrixReadOnly(getComputedStyle(el).transform).a);
  await cdpTouch(cdp, 'touchStart', [[120, 650, 1], [270, 650, 2]]);
  await cdpTouch(cdp, 'touchMove', [[90, 650, 1], [300, 650, 2]]);
  await cdpTouch(cdp, 'touchEnd');
  await page.waitForTimeout(100);
  const afterPinch = await page.locator('.world').evaluate(el => new DOMMatrixReadOnly(getComputedStyle(el).transform).a);
  assert.ok(afterPinch > beforePinch, 'two-finger touch pinches to zoom');
  const beforePanTransform = await page.locator('.world').evaluate(el => getComputedStyle(el).transform);
  const start = [Math.min(beforePan.w - 20, 365), Math.min(beforePan.h - 90, 620)];
  await cdpTouch(cdp, 'touchStart', [[start[0], start[1], 1]]);
  await cdpTouch(cdp, 'touchMove', [[start[0] - 34, start[1] - 24, 1]]);
  await cdpTouch(cdp, 'touchEnd');
  const afterPan = await page.locator('.world').evaluate(el => getComputedStyle(el).transform);
  assert.notEqual(afterPan, beforePanTransform, 'touch drag on empty canvas pans the world');
  console.log('Phone touch QA passed: template, URL entry keyboard sizing, Fit, zoom, pinch zoom, Saved, Purchases, Settings, sizing, Share, dismissal, and canvas pan.');
} finally {
  await context.close();
  await browser.close();
}
