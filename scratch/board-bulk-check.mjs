import assert from 'node:assert/strict';
import { resolve } from 'node:path';

process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve('.playwright-browsers');
const { chromium } = await import('playwright');
const browser = await chromium.launch({ headless: true });
const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('cura-link-only-board-v3')));
const act = async (touch, locator) => touch ? locator.tap() : locator.click();
async function openHair(page, touch) {
  await page.goto('http://127.0.0.1:5173/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  if (touch) {
    await act(touch, page.locator('.workspace-menu-trigger'));
    await act(touch, page.getByRole('group', { name: /workspace actions/i }).getByRole('button', { name: 'Templates' }));
  } else await act(touch, page.getByRole('button', { name: 'Templates', exact: true }));
  const picker = page.getByRole('dialog', { name: 'Choose a canvas template' });
  await act(touch, picker.getByRole('button', { name: /Preview Hair Routine/ }));
  await act(touch, picker.getByRole('button', { name: /Use template/ }));
  await page.waitForTimeout(100);
}
try {
  for (const config of [{ name: 'desktop', width: 1440, height: 900, touch: false }, { name: 'phone', width: 390, height: 844, touch: true }]) {
    const page = await browser.newPage({ viewport: { width: config.width, height: config.height }, hasTouch: config.touch, isMobile: config.touch });
    await page.route('**/api/**', (route) => route.fulfill({ status: 503, body: '{}' }));
    await openHair(page, config.touch);
    const original = await saved(page);
    assert.equal(original.outfits.length, 5);
    assert.equal(original.items.length, 15);
    const bar = page.locator('.board-bulk-actions');
    const workspaceMore = page.locator('.workspace-menu-trigger');
    await act(config.touch, workspaceMore);
    const selectAll = page.getByRole('group', { name: /workspace actions/i }).getByRole('button', { name: 'Select all boards', exact: true });
    await act(config.touch, selectAll);
    if (config.touch) {
      const legacyHide = await page.addStyleTag({ content: '.board-bulk-actions { display: none !important; }' });
      await page.screenshot({ path: 'scratch/before-board-bulk-phone.png' });
      await legacyHide.evaluate(element => element.remove());
      await page.screenshot({ path: 'scratch/after-board-bulk-phone.png' });
    }
    const boardChoices = await bar.locator('.board-bulk-choices button').all();
    assert.equal(boardChoices.length, 5);
    await act(config.touch, bar.locator('.board-bulk-heading button[aria-label="Finish selecting boards"]'));
    await act(config.touch, workspaceMore);
    await act(config.touch, page.getByRole('group', { name: /workspace actions/i }).getByRole('button', { name: 'Select all boards', exact: true }));
    await act(config.touch, bar.locator('.board-bulk-choices button').first());
    assert.equal(await bar.locator('.board-bulk-choices button[aria-pressed="true"]').count(), 4);
    assert.equal(await bar.getByRole('button', { name: 'Delete selected boards', exact: true }).isVisible(), true);
    await page.screenshot({ path: `scratch/board-bulk-${config.name}.png` });
    await act(config.touch, bar.getByRole('button', { name: 'Delete selected boards', exact: true }));
    await page.waitForTimeout(100);
    let state = await saved(page);
    assert.equal(state.outfits.length, 1);
    assert.equal(state.items.length, 15);
    assert.deepEqual(state.items.map((item) => [item.id, item.x, item.y]), original.items.map((item) => [item.id, item.x, item.y]));
    assert.equal(state.sections.length, 1);
    assert.equal(state.sections[0].boardIds.length, 1);
    await act(config.touch, page.locator('.workspace-menu-trigger'));
    await act(config.touch, page.getByRole('group', { name: /workspace actions/i }).getByRole('button', { name: 'Select all boards', exact: true }));
    assert.equal(await bar.getByRole('button', { name: 'Delete all boards', exact: true }).isVisible(), true);
    assert.equal(await bar.locator('.board-bulk-choices button[aria-pressed="true"]').count(), 1);
    const productsToDelete = new Set(state.outfits[0].itemIds);
    assert.equal(await bar.getByRole('button', { name: 'Delete all boards', exact: true }).isVisible(), true);
    await act(config.touch, bar.getByRole('button', { name: 'Delete all boards and contents' }));
    const confirm = page.getByRole('alertdialog');
    assert.ok(await confirm.isVisible());
    assert.match(await confirm.innerText(), /Delete board\(s\) and products/i);
    await act(config.touch, confirm.getByRole('button', { name: 'Delete board(s) and products' }));
    await page.waitForTimeout(100);
    state = await saved(page);
    assert.equal(state.outfits.length, 0);
    assert.deepEqual(state.items.map((item) => [item.id, item.x, item.y]), original.items
      .filter((item) => !productsToDelete.has(item.id)).map((item) => [item.id, item.x, item.y]));
    assert.deepEqual(state.sections[0].boardIds, []);
    console.log(`${config.name}: touch board selection, delete boards while keeping products, and confirmed board-plus-product deletion passed.`);
    await page.close();
  }
} finally { await browser.close(); }
