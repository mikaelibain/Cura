import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL(resolve(tmpdir(), 'cura-layout-check/node_modules/playwright-core/index.mjs')));
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const bottle = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="500"><rect x="36" y="10" width="48" height="70" rx="6" fill="#716a60"/><rect x="12" y="78" width="96" height="405" rx="20" fill="#dab6a3"/><rect x="22" y="205" width="76" height="130" rx="2" fill="#fffaf4"/><text x="60" y="260" text-anchor="middle" font-family="serif" font-size="17" fill="#5e5149">CURA</text><text x="60" y="287" text-anchor="middle" font-family="sans-serif" font-size="9" fill="#796c61">DAILY SERUM</text></svg>')}`;
const jar = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="180"><rect x="20" y="35" width="360" height="135" rx="24" fill="#c5d0bd"/><rect x="18" y="10" width="364" height="42" rx="14" fill="#7d8a73"/><text x="200" y="110" text-anchor="middle" font-family="serif" font-size="24" fill="#44523e">HYDRATION CREAM</text></svg>')}`;
await page.addInitScript(({ bottle, jar }) => {
  localStorage.setItem('cura-link-only-board-v2', JSON.stringify({ items: [
    { id: 'bottle', title: 'Daily hydration and barrier support facial serum — large refillable bottle', x: 40, y: 190, imageUrl: bottle, price: 128, currency: 'CAD', scale: .8 },
    { id: 'jar', title: 'Rich overnight hydration cream', x: 285, y: 190, imageUrl: jar, price: 99, currency: 'USD', scale: 1 },
    { id: 'perfume', title: 'Evening eau de parfum in a tall glass bottle', x: 845, y: 240, imageUrl: bottle, price: 325, currency: 'CAD', scale: .9 },
  ].map((item) => ({ brand: 'Cura Beauty', sourceUrl: 'https://example.com/products/' + item.id, color: 'Original', colorOptions: [], sizeOptions: [], size: '', notes: '', unsure: false, availability: 'Normal availability', createdAt: new Date().toISOString(), priceEstimated: true, priceReference: 'Official search listing price reference', ...item })), outfits: [
    { id: 'routine', name: 'Skincare · daily hydration & evening treatments', itemIds: ['bottle', 'jar'], color: '#849c72', budget: 500 },
    { id: 'fragrance', name: 'Fragrances for every season — favourites and future discoveries', itemIds: ['perfume'], color: '#a58091', budget: null },
  ] }));
  localStorage.setItem('thread-shopping-canvas-user-settings', JSON.stringify({ preferredCurrency: 'CAD' }));
}, { bottle, jar });

try {
  await page.goto('http://localhost:8787');
  await page.locator('.sticker').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  const verifyLayout = async () => {
    const measurements = await page.evaluate(() => [...document.querySelectorAll('.outfit-frame')].map((frame) => {
      const bounds = frame.getBoundingClientRect();
      const header = frame.querySelector('.outfit-header').getBoundingClientRect();
      const ids = frame.dataset.outfitId === 'routine' ? ['bottle', 'jar'] : ['perfume'];
      return { id: frame.dataset.outfitId, grips: frame.querySelectorAll('.outfit-resize').length, headerOverflow: frame.querySelector('.outfit-header').scrollWidth > header.width + 1,
        items: ids.map((id) => {
          const card = document.querySelector(`[data-item-id="${id}"]`);
          const rect = card.getBoundingClientRect();
          const art = card.querySelector('.sticker-art').getBoundingClientRect();
          const meta = card.querySelector('.sticker-meta').getBoundingClientRect();
          return { id, contained: rect.left >= bounds.left && rect.right <= bounds.right && rect.bottom <= bounds.bottom, headerClear: rect.top >= header.bottom + 8, imageClear: art.bottom <= meta.top, textFits: card.querySelector('.sticker-meta').scrollWidth <= meta.width + 1 };
        }) };
    }));
    for (const frame of measurements) {
      assert.equal(frame.grips, 1, 'one board resize grip');
      assert.equal(frame.headerOverflow, false, 'header must wrap within board');
      for (const card of frame.items) {
        assert.ok(card.contained, `${card.id}: board contains entire card`);
        assert.ok(card.headerClear, `${card.id}: header and item do not overlap`);
        assert.ok(card.imageClear, `${card.id}: image and metadata do not overlap`);
        assert.ok(card.textFits, `${card.id}: text stays in card`);
      }
    }
    return measurements;
  };
  await verifyLayout();
  await page.screenshot({ path: resolve(tmpdir(), 'cura-layout-desktop.png') });

  const bottleCard = page.locator('[data-item-id="bottle"]');
  const before = await bottleCard.evaluate((el) => ({ width: el.offsetWidth, art: el.querySelector('.sticker-art').offsetHeight, font: getComputedStyle(el.querySelector('.sticker-meta strong')).fontSize }));
  const grip = await bottleCard.locator('.sticker-resize').boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + 65, grip.y + 75, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const after = await bottleCard.evaluate((el) => ({ width: el.offsetWidth, art: el.querySelector('.sticker-art').offsetHeight, font: getComputedStyle(el.querySelector('.sticker-meta strong')).fontSize }));
  assert.ok(after.width > before.width && after.art > before.art, 'bottle grows proportionally');
  assert.equal(after.font, before.font, 'resizing does not shrink/enlarge text');
  await verifyLayout();
  assert.equal(context.pages().length, 1, 'resize must not open a listing');

  const boardGrip = await page.locator('[data-outfit-id="routine"] .outfit-resize').boundingBox();
  const beforeBoard = await page.locator('[data-outfit-id="routine"]').boundingBox();
  await page.mouse.move(boardGrip.x + 14, boardGrip.y + 14);
  await page.mouse.down();
  await page.mouse.move(boardGrip.x + 110, boardGrip.y + 94, { steps: 10 });
  await page.mouse.up();
  const afterBoard = await page.locator('[data-outfit-id="routine"]').boundingBox();
  assert.ok(afterBoard.width > beforeBoard.width && afterBoard.height > beforeBoard.height, 'board resizes in both directions');
  await verifyLayout();
  const shrinkGrip = await page.locator('[data-outfit-id="routine"] .outfit-resize').boundingBox();
  await page.mouse.move(shrinkGrip.x + 14, shrinkGrip.y + 14);
  await page.mouse.down();
  await page.mouse.move(shrinkGrip.x - 250, shrinkGrip.y - 220, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  await verifyLayout();
  await page.locator('[data-outfit-id="routine"] .outfit-resize').dblclick();
  await page.waitForTimeout(100);
  await verifyLayout();
  const fitted = await page.evaluate(() => JSON.parse(localStorage.getItem('cura-link-only-board-v2')).outfits.find((outfit) => outfit.id === 'routine'));
  assert.equal(fitted.customWidth, undefined, 'double-click fits board to products');

  await page.getByRole('button', { name: 'Hide prices', exact: true }).click();
  assert.equal(await page.locator('.outfit-price').count(), 0);
  await page.getByRole('button', { name: 'Show prices', exact: true }).click();
  await page.waitForTimeout(100);
  await verifyLayout();

  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(100);
  const toolbarFits = await page.locator('.topbar').evaluate((el) => el.scrollWidth <= window.innerWidth);
  assert.ok(toolbarFits, 'toolbar fits narrow screen');
  await page.getByRole('button', { name: 'Fit canvas', exact: true }).click();
  const fittedOnscreen = await page.evaluate(() => [...document.querySelectorAll('.outfit-frame')].every((el) => {
    const rect = el.getBoundingClientRect();
    return rect.left >= 20 && rect.right <= innerWidth - 20 && rect.top >= document.querySelector('.topbar').getBoundingClientRect().bottom && rect.bottom <= innerHeight - 60;
  }));
  assert.ok(fittedOnscreen, 'fit canvas shows all boards below toolbar');
  await page.locator('.board').evaluate((el) => el.dispatchEvent(new MouseEvent('contextmenu', { clientX: 365, clientY: 802, button: 2, bubbles: true })));
  const quickAdd = await page.locator('.quick-add').boundingBox();
  await page.screenshot({ path: resolve(tmpdir(), 'cura-layout-mobile.png') });
  assert.ok(quickAdd.x >= 0 && quickAdd.x + quickAdd.width <= 375 && quickAdd.y + quickAdd.height <= 812, 'paste menu stays onscreen');
  await page.locator('[data-item-id="bottle"]').evaluate((el) => el.dispatchEvent(new MouseEvent('contextmenu', { clientX: 365, clientY: 802, button: 2, bubbles: true })));
  const itemMenu = await page.locator('.item-menu').boundingBox();
  assert.ok(itemMenu.x >= 0 && itemMenu.x + itemMenu.width <= 375 && itemMenu.y + itemMenu.height <= 812, 'item menu stays onscreen');
  await page.setViewportSize({ width: 320, height: 640 });
  await page.getByRole('button', { name: /Settings/ }).click();
  const settings = await page.locator('.settings-modal').boundingBox();
  assert.ok(settings.x >= 0 && settings.x + settings.width <= 320 && settings.y >= 0 && settings.y + settings.height <= 640, 'settings fits small screen');
  assert.deepEqual(errors, [], 'no browser runtime errors');
  console.log(JSON.stringify({ result: 'passed', checks: ['board/header containment', 'bottle resize and readable text', 'single grip per board', 'board resizing and fit', 'price visibility toggle', 'mobile toolbar', 'onscreen menus', 'small-screen settings', 'fit canvas'], screenshots: [resolve(tmpdir(), 'cura-layout-desktop.png'), resolve(tmpdir(), 'cura-layout-mobile.png')] }));
} finally {
  await browser.close();
}
