import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { itemsWithVerifiedPrices } from '../src/commercePricing.mjs';

const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');

test('total, spent, and budget remain distinct concepts', () => {
  assert.match(app, /const totalSummary = useMemo\(\(\) => priceSummary/);
  assert.match(app, /const canvasSpentSummary = useMemo\(\(\) => spentSummary/);
  assert.match(app, /budgetCurrency\?: string/);
  assert.doesNotMatch(app, /boardTotal|canvasTotal/);
});

test('total includes purchased and unpurchased items while spent includes only purchased items', () => {
  assert.match(app, /const spentSummary[\s\S]*items\.filter\(\(item\) => item\.bought\)/);
  assert.match(app, /priceSummary\(board\.items, userSettings\.preferredCurrency/);
  assert.match(app, /outfit\.itemIds\.includes\(item\.id\)\)\s*,/);
  assert.doesNotMatch(app, /outfit\.itemIds\.includes\(item\.id\) && !item\.bought/);
});

test('future purchase price overrides current price only for spent', () => {
  assert.match(app, /purchasePrice\?: number/);
  assert.match(app, /Number\.isFinite\(item\.purchasePrice\)/);
  assert.match(app, /price: item\.purchasePrice!/);
});

test('canvas and board trackers present total and spent together', () => {
  assert.match(app, /trackerAmount\(totalSummary, userSettings\.preferredCurrency\)[\s\S]*trackerAmount\(canvasSpentSummary, userSettings\.preferredCurrency\)[\s\S]*spent/);
  assert.match(app, /trackerAmount\(total, userSettings\.preferredCurrency\)[\s\S]*trackerAmount\(spent, userSettings\.preferredCurrency\)[\s\S]*spent/);
});

test('canvas totals derive from unique canvas products rather than board totals', () => {
  assert.match(app, /unique\.set\(item\.sourceUrl\.trim\(\)\.toLowerCase\(\) \|\| `item:\$\{item\.id\}`/);
  assert.match(app, /priceSummary\(board\.items/);
  assert.doesNotMatch(app, /sum\([^)]*outfit|reduce\([^)]*outfitTotals/);
});

test('one-item and many-item boards derive trackers from current membership', () => {
  assert.match(app, /board\.items\.filter\(\(item\) => outfit\.itemIds\.includes\(item\.id\)\)/);
  assert.match(app, /const itemsForBoard = outfitTotals\.get\(outfit\.id\) \?\? \[\]/);
});

test('unboarded products remain included in the canvas tracker', () => {
  assert.match(app, /priceSummary\(board\.items, userSettings\.preferredCurrency/);
  assert.doesNotMatch(app, /totalSummary[\s\S]{0,180}outfit\.itemIds/);
});

test('missing prices are omitted from arithmetic and reported as incomplete', () => {
  assert.match(app, /itemsWithVerifiedPrices\(relevantItems\)/);
  assert.deepEqual(itemsWithVerifiedPrices([
    { price: 12, priceEstimated: false },
    { price: null, priceEstimated: false },
    { price: 8, priceEstimated: true },
  ]), [{ price: 12, priceEstimated: false }]);
  assert.match(app, /totalSummary\.missing > 0/);
  assert.match(app, /canvasSpentSummary\.missing > 0/);
  assert.match(app, /purchased \$\{canvasSpentSummary\.missing === 1 \? 'price' : 'prices'\} missing/);
});

test('price edits continue to update derived totals without stored aggregate values', () => {
  assert.match(app, /updateItem\(selectedItem\.id, \{ price, priceManual: price !== null/);
  assert.match(app, /const totalSummary = useMemo[\s\S]*\[board\.items, userSettings\.preferredCurrency, exchangeRates\]/);
});

test('moving and deleting products naturally changes board membership inputs', () => {
  assert.match(app, /const moveSelectedToBoard/);
  assert.match(app, /items: current\.items\.filter\(\(item\) => !ids\.has\(item\.id\)\)/);
  assert.match(app, /outfitTotals = useMemo[\s\S]*\[board\]/);
});

test('dedicated budget interaction supports amount, currency, save, edit, and removal', () => {
  assert.match(app, /const openBudgetEditor/);
  assert.match(app, />Budget amount</);
  assert.match(app, />Budget currency</);
  assert.match(app, /budget: amount, budgetCurrency: budgetCurrencyDraft/);
  assert.match(app, /budget: null, budgetCurrency: undefined/);
});

test('price state continues to persist as product and board data, not stale totals', () => {
  assert.match(app, /window\.localStorage\.setItem\(storageKey, JSON\.stringify\(board\)\)/);
  assert.doesNotMatch(app, /localStorage\.setItem\([^\n]*(boardTotal|canvasTotal)/);
});
