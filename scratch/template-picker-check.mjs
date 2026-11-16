import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL(resolve(tmpdir(), 'cura-layout-check/node_modules/playwright-core/index.mjs')));
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const errors = [];
try {
  for (const size of [{ name: 'small-phone', width: 320, height: 720, touch: true }, { name: 'phone', width: 390, height: 844, touch: true }, { name: 'tablet', width: 820, height: 1180, touch: true }, { name: 'desktop', width: 1440, height: 900, touch: false }]) {
    const page = await browser.newPage({ viewport: { width: size.width, height: size.height }, hasTouch: size.touch, isMobile: size.touch && size.name === 'phone' });
    page.on('pageerror', (error) => errors.push(`${size.name}: ${error.message}`));
    await page.goto('http://127.0.0.1:5173/');
    const direct = page.getByRole('button', { name: 'Templates', exact: true }).filter({ visible: true });
    if (await direct.count()) await direct.first().click();
    else {
      await page.getByRole('button', { name: /More/ }).first().click();
      await page.getByRole('button', { name: 'Templates', exact: true }).filter({ visible: true }).first().click();
    }
    const dialog = page.getByRole('dialog', { name: 'Choose a canvas template' });
    await dialog.waitFor();
    assert.equal(await dialog.getByRole('button', { name: /Preview Capsule Wardrobe/ }).count(), 1);
    assert.equal(await dialog.locator('.template-miniature svg').count() > 0, true);
    assert.equal(await page.locator('.outfit-frame').count(), 0, 'preview must not instantiate a canvas');
    const frame = await dialog.boundingBox();
    assert.ok(frame.x >= -1 && frame.x + frame.width <= size.width + 1, `${size.name} picker horizontal overflow`);
    await dialog.getByRole('button', { name: 'Beauty', exact: true }).click();
    assert.equal(await dialog.getByRole('button', { name: /Preview Hair Routine/ }).count(), 1);
    assert.equal(await dialog.getByRole('button', { name: /Preview Capsule Wardrobe/ }).count(), 0);
    await dialog.getByRole('button', { name: /Preview Hair Routine/ }).click();
    assert.equal(await dialog.getByRole('heading', { name: 'Hair Routine' }).isVisible(), true);
    assert.equal(await dialog.getByRole('button', { name: /Use template/ }).isVisible(), true);
    const detail = await dialog.locator('.template-detail').boundingBox();
    assert.ok(detail.x >= -1 && detail.x + detail.width <= size.width + 1, `${size.name} detail horizontal overflow`);
    await page.screenshot({ path: `scratch/template-picker-${size.name}.png` });
    if (size.name === 'phone') {
      await dialog.getByRole('button', { name: /Use template/ }).click();
      assert.equal(await dialog.count(), 0);
      assert.equal(await page.locator('.outfit-frame').count(), 5);
    }
    console.log(`${size.name}: picker and selected preview visible; category filter and tap/click selection work; no horizontal overflow`);
    await page.close();
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
