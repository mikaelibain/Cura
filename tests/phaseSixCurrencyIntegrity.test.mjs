import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const currency = await readFile(new URL('../src/sizeConversion.ts', import.meta.url), 'utf8');
const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');

test('live USD-base rates convert CAD, USD, EUR, GBP, KRW, and another supported currency', () => {
  const script = `
    import { convertCurrencyAmount } from './src/sizeConversion.ts';
    const rates = { USD: 1, CAD: 1.35, EUR: 0.92, GBP: 0.78, KRW: 1340, JPY: 149 };
    const inputs = ['CAD', 'USD', 'EUR', 'GBP', 'KRW', 'JPY'];
    for (const code of inputs) {
      const result = convertCurrencyAmount(100, code, 'CAD', rates);
      if (!Number.isFinite(result)) process.exit(1);
    }
    if (!Number.isNaN(convertCurrencyAmount(100, 'CHF', 'CAD', rates))) process.exit(2);
  `;
  const result = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '--eval', script], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('there is no static or one-to-one exchange-rate fallback', () => {
  assert.doesNotMatch(currency, /const usdValue/);
  assert.match(currency, /if \(from === to\) return amount/);
  assert.match(currency, /if \(liveFrom && liveTo\)[\s\S]*return Number\.NaN/);
});

test('native item prices are the default and conversion is display-only', () => {
  assert.match(app, /convertItemPrices: false/);
  assert.match(app, /formatCurrency\(item\.price, itemCurrency, itemCurrency\)/);
  assert.match(app, /Display item prices in my preferred currency/);
  assert.match(app, /products keep their original currency while board and canvas totals are shown in your preferred currency/);
  assert.doesNotMatch(app, /updateItem\([^\n]*convertedPrice/);
  assert.match(app, /item\.priceEstimated \? 'Est\. ' : ''/);
});

test('preferred currency defaults to USD without replacing saved preferences', () => {
  assert.match(app, /preferredCurrency: 'USD'/);
  assert.match(app, /return \{ \.\.\.defaultSettings, \.\.\.JSON\.parse\(saved\) \}/);
});

test('missing rates are excluded and produce an honest unavailable state', () => {
  assert.match(app, /if \(!\[convertedTotal, convertedLow, convertedHigh\]\.every\(Number\.isFinite\)\) \{ conversionMissing = true; return; \}/);
  assert.match(app, /conversionMissing \? 'Currency conversion unavailable'/);
  assert.match(app, /summary\.conversionMissing \? summary\.value/);
});

test('validated rates are cached on the server and client for reloads', () => {
  assert.match(server, /exchangeRateCacheExpiresAt = Date\.now\(\) \+ 12 \* 60 \* 60 \* 1000/);
  assert.match(server, /typeof value === 'number' && Number\.isFinite\(value\) && value > 0/);
  assert.match(app, /Keep the last valid rates even when stale/);
  assert.match(app, /useState<Record<string, number>>\(loadExchangeRateCache\)/);
  assert.match(app, /localStorage\.setItem\(exchangeRateCacheKey/);
});

test('board, canvas, spent, and budget calculations use the preferred currency safely', () => {
  assert.match(app, /priceSummary\(board\.items, userSettings\.preferredCurrency, exchangeRates\)/);
  assert.match(app, /priceSummary\(itemsForBoard, userSettings\.preferredCurrency, exchangeRates\)/);
  assert.match(app, /spentSummary\(itemsForBoard, userSettings\.preferredCurrency, exchangeRates\)/);
  assert.match(app, /convertKnownCurrencyAmount\(outfit\.budget, budgetCurrency, userSettings\.preferredCurrency, exchangeRates\)/);
  assert.match(app, /Number\.isFinite\(convertedBudget\)/);
});
