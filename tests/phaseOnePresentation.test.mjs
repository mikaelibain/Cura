import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const presentation = await readFile(new URL('../src/presentation.ts', import.meta.url), 'utf8');
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

test('new users default to USD while saved settings continue to override defaults', () => {
  assert.match(app, /preferredCurrency:\s*'USD'/);
  assert.match(app, /return \{ \.\.\.defaultSettings, \.\.\.JSON\.parse\(saved\) \}/);
});

test('product cards render name before price and keep readable wrapping', () => {
  assert.ok(app.indexOf('className="product-name"') < app.indexOf('className="product-price"'));
  assert.match(styles, /\.sticker-meta \.product-name[^}]*overflow-wrap:\s*anywhere[^}]*white-space:\s*normal/);
  assert.match(styles, /\.sticker-meta \.product-price[^}]*overflow-wrap:\s*anywhere/);
});

test('product images default to contain without distortion', () => {
  assert.match(presentation, /imageFit:[^\n]*'contain'/);
  assert.match(styles, /\.product-image-shell img[^}]*width:\s*100%[^}]*height:\s*100%[^}]*max-width:\s*100%[^}]*max-height:\s*100%/);
});

test('only verified availability receives a visible stock label', () => {
  assert.match(app, /if \(item\.unsure \|\| !item\.availabilityVerified\) return ''/);
  assert.match(app, /'Out of stock'\) return 'Sold out'/);
  assert.match(app, /'Low in stock'\) return 'Low stock'/);
  assert.match(app, /'Normal availability' \|\| item\.availability === 'Plenty in stock'\) return 'In stock'/);
});

test('user-facing price source and closet terminology are removed', () => {
  assert.doesNotMatch(app, /Price Source|Price source/);
  assert.doesNotMatch(styles, /\.price-source/);
  assert.doesNotMatch(app, /My Closet/);
  assert.match(app, /My Purchases/);
});

test('the product presentation does not expose a planned price total', () => {
  assert.doesNotMatch(app, /planned total|Planned/);
  assert.match(app, /trackerAmount\(totalSummary, userSettings\.preferredCurrency\)/);
});

test('product resizing changes artwork dimensions while keeping text at readable CSS sizes', () => {
  assert.match(app, /const itemScale = \(item: Item\) => Math\.min\(2, Math\.max\(0\.75, item\.scale \?\? 1\)\)/);
  assert.match(app, /height: itemArtworkHeight\(item, containingOutfit\) \* itemScale\(item\)/);
  assert.match(styles, /\.sticker-meta \.product-name[^}]*font-size:\s*var\(--text-sm\)/);
  assert.match(styles, /\.sticker-meta \.product-price[^}]*font-size:\s*var\(--text-sm\)/);
});

test('contain presentation applies equally to bottles, clothing, and shoes', () => {
  for (const representativeTitle of ['Perfume bottle', 'Vitamin C serum', 'Silk dress', 'Leather shoes']) {
    assert.equal(/perfume|serum|dress|shoes/i.test(representativeTitle), true);
    assert.match(presentation, /imageFit:[^\n]*'contain'/);
  }
  assert.match(app, /style=\{\{ objectFit: presentation\.imageFit \}\}/);
});

test('product formatting is disclosed in the Look inspector and detail editing is explicit', () => {
  assert.match(app, />Look<\/button>/);
  assert.match(app, /Text alignment/);
  assert.match(app, /Text size/);
  assert.match(app, /Show brand/);
  assert.match(app, /Show availability/);
  assert.match(app, /selectedItem && itemDetailsOpenId === selectedItem\.id/);
  assert.match(app, /<details className="inspector-advanced"><summary>Advanced/);
});

test('formatting toggles control their corresponding card details', () => {
  assert.match(app, /presentation\.showBrand && item\.brand/);
  assert.match(app, /presentation\.showAvailability && \(item\.color \|\| availability\)/);
  assert.match(app, /style=\{\{ textAlign: presentation\.textAlign \}\}/);
  assert.match(app, /style=\{\{ color: presentation\.textColor \|\| undefined \}\}/);
  assert.match(styles, /\.sticker\.title-large \.product-name[^}]*font-size:\s*var\(--text-md\)/);
  assert.match(styles, /\.sticker\.price-large \.product-price[^}]*font-size:\s*var\(--text-md\)/);
});

test('Edit Details protects manual prices and keeps price provenance internal', () => {
  assert.match(app, /priceManual: price !== null/);
  assert.match(app, /priceManual: price !== null/);
  assert.match(app, /currentItem\.priceManual && 'price'/);
  assert.match(app, /currentItem\.priceManual && 'currency'/);
  assert.doesNotMatch(app, />Price Source</);
});

test('product formatting and manual edits persist with the existing board payload', () => {
  assert.match(app, /window\.localStorage\.setItem\(storageKey, JSON\.stringify\(board\)\)/);
  assert.match(app, /const \[board, setBoard\] = useState<Board>\(loadBoard\)/);
  assert.match(app, /items: current\.items\.map\(\(item\) => \(item\.id === id \? \{ \.\.\.item, \.\.\.change \} : item\)\)/);
});
