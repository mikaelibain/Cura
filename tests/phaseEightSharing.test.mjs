import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { copyBoardToCanvas, copyItemsToCanvas, createSharedCollection, makeEditableCopy, reuseAccounting, saveCollectionReference, sharedIntentFor } from '../src/sharing.ts';

const sourceItem = (overrides = {}) => ({
  id: 'item-1', sourceUrl: 'https://shop.example/products/serum', canonicalProductId: 'product-serum',
  title: 'Serum', brand: 'Brand', imageUrl: 'https://images.example/serum.jpg', price: 40, currency: 'CAD',
  x: 340, y: 220, bought: true, purchasePrice: 31, notes: 'Private gift note', createdAt: '2026-01-01', ...overrides,
});

const sourceBoard = () => ({
  items: [sourceItem(), sourceItem({ id: 'item-2', sourceUrl: 'https://shop.example/products/cream', canonicalProductId: 'product-cream', x: 520, y: 300 })],
  outfits: [{ id: 'board-1', name: 'Skincare', itemIds: ['item-1', 'item-2'], budget: 150, customLeft: 300, customTop: 150, presentation: { templateId: 'skincare', backgroundPreset: 'sage' }, elements: [{ id: 'text-1', type: 'text', content: 'Night routine' }] }],
  collectionId: 'original-collection', ownerId: 'creator-account',
});

test('saving a collection stores only an id reference and is idempotent', () => {
  const collection = createSharedCollection(sourceBoard(), 'Routine', 'creator-account');
  const first = saveCollectionReference(collection, []);
  const second = saveCollectionReference(collection, first);
  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.deepEqual(Object.keys(first[0]).sort(), ['ownerId', 'savedAt', 'sharedCollectionId', 'title']);
  assert.equal(reuseAccounting.productImports, 0);
  assert.equal(reuseAccounting.editableCopies, 0);
});

test('a shared snapshot removes personal purchase state and private notes without changing its source', () => {
  const source = sourceBoard();
  const collection = createSharedCollection(source, 'Routine', 'creator-account');
  assert.equal(collection.canvas.items[0].bought, false);
  assert.equal(collection.canvas.items[0].purchasePrice, undefined);
  assert.equal(collection.canvas.items[0].notes, '');
  assert.equal(source.items[0].bought, true);
  assert.equal(source.items[0].purchasePrice, 31);
  assert.equal(source.items[0].notes, 'Private gift note');
});

test('copying one or several products reuses canonical product data and preserves relative placement', () => {
  const source = sourceBoard();
  const copied = copyItemsToCanvas({ items: [], outfits: [] }, source.items);
  assert.equal(copied.items.length, 2);
  assert.equal(copied.items[0].canonicalProductId, 'product-serum');
  assert.equal(copied.items[1].x - copied.items[0].x, source.items[1].x - source.items[0].x);
  assert.equal(copied.items[1].y - copied.items[0].y, source.items[1].y - source.items[0].y);
  for (const item of copied.items) {
    assert.equal(item.bought, false);
    assert.equal(item.purchasePrice, undefined);
    assert.equal(item.notes, '');
  }
});

test('copy board preserves title, presentation, text, and relative product coordinates', () => {
  const source = sourceBoard();
  const copied = copyBoardToCanvas({ items: [], outfits: [] }, source, 'board-1');
  assert.equal(copied.outfits.length, 1);
  assert.equal(copied.outfits[0].name, 'Skincare');
  assert.deepEqual(copied.outfits[0].presentation, source.outfits[0].presentation);
  assert.equal(copied.outfits[0].elements[0].content, 'Night routine');
  assert.notEqual(copied.outfits[0].id, source.outfits[0].id);
  assert.notEqual(copied.outfits[0].elements[0].id, source.outfits[0].elements[0].id);
  assert.equal(copied.items[1].x - copied.items[0].x, 180);
});

test('full editable copies are independently owned and do not mutate the original', () => {
  const source = sourceBoard();
  const copy = makeEditableCopy(source, 'receiving-account', 'shared-123');
  assert.equal(copy.ownerId, 'receiving-account');
  assert.equal(copy.sourceCollectionId, 'shared-123');
  assert.notEqual(copy.collectionId, source.collectionId);
  assert.notEqual(copy.items[0].id, source.items[0].id);
  assert.equal(copy.items[0].bought, false);
  copy.items[0].title = 'Changed independently';
  assert.equal(source.items[0].title, 'Serum');
});

test('guest or account signup intent retains collection, requested action, and locally saved references', () => {
  const intent = sharedIntentFor('shared-123', 'editable-copy', [{ sharedCollectionId: 'saved-1', title: 'Saved', ownerId: 'other', savedAt: 'today' }]);
  assert.deepEqual(intent, { sharedCollectionId: 'shared-123', action: 'editable-copy', savedReferences: ['saved-1'] });
});

test('copy and remix actions never call the external product resolver', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  for (const handler of ['copySharedItems', 'copySharedBoard', 'makeSharedEditable']) {
    const start = app.indexOf(`const ${handler}`);
    const end = app.indexOf('\n  };', start);
    assert.ok(start >= 0 && end > start);
    assert.doesNotMatch(app.slice(start, end), /fetch\(|extract-product|hydrateItemFromUrl/);
  }
  assert.match(app, /♡ Save collection/);
  assert.match(app, /Copy board to my canvas/);
  assert.match(app, /Make editable copy/);
});
