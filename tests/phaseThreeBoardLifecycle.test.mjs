import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');

test('one or many selected items can create a board without a two-item minimum', () => {
  assert.match(app, /if \(selectedIds\.length < 1\) return/);
  assert.match(app, /itemIds: selectedIds/);
  assert.doesNotMatch(app, /selectedIds\.length < 2/);
});

test('explicit empty boards persist until the user acts on them', () => {
  assert.match(app, /preserveWhenEmpty\?: boolean/);
  assert.match(app, /preserveWhenEmpty: true/);
  assert.match(app, /itemIds: \[\], budget: null/);
});

test('a board stops being intentionally empty after its first item arrives', () => {
  assert.match(app, /preserveWhenEmpty: outfit\.id === outfitId \? false : outfit\.preserveWhenEmpty/);
});

test('deleting or removing a final item removes the emptied board', () => {
  assert.match(app, /outfit\.itemIds\.includes\(id\) && itemIds\.length === 0 && !outfit\.preserveWhenEmpty \? \[\]/);
  assert.match(app, /itemIds\.length === 0 && !outfit\.preserveWhenEmpty \? \[\]/);
});

test('moving the final item to another board removes the source board', () => {
  assert.match(app, /outfit\.id !== outfitId && outfit\.itemIds\.includes\(itemId\) && itemIds\.length === 0\) return \[\]/);
  assert.match(app, /if \(outfit\.id === drag\?\.sourceOutfitId\) return false/);
  assert.match(app, /moveSelectedToBoard\(destination\.id, movedIds\)/);
});

test('dragging decisively outside the original board removes membership', () => {
  assert.match(app, /sourceOutfitId: sourceOutfit\?\.id/);
  assert.match(app, /hasDetachIntent\(point, drag\.sourceBounds, alreadyDetached\)/);
  assert.match(app, /removeItemsFromBoards\(movedIds\)/);
});

test('freeform movement preserves overlap, gaps, and asymmetric positions', () => {
  assert.match(app, /x: origin\.x \+ deltaX, y: origin\.y \+ deltaY, autoPlaced: false/);
  assert.match(app, /if \(layout === 'freeform'\)/);
  assert.match(app, /Moves products only when you click Re-layout\./);
});

test('board bounds grow around products and independent board elements', () => {
  assert.match(app, /element\.x \+ element\.width \+ 28/);
  assert.match(app, /element\.y \+ element\.height \+ 48/);
  assert.match(app, /width: Math\.max\(300, computedWidth, elementWidth, outfit\.customWidth \?\? 0\)/);
  assert.match(app, /height: Math\.max\(computedHeight, elementHeight, outfit\.customHeight \?\? 0\)/);
});

test('manual board whitespace is retained as a minimum size', () => {
  assert.match(app, /customWidth: Math\.max\(300, resize\.width \+ deltaX\)/);
  assert.match(app, /customHeight: Math\.max\(250, resize\.height \+ deltaY\)/);
  assert.match(app, /double-click to fit products/);
});

test('board deletion offers keep-products and remove-products paths through existing helpers', () => {
  assert.match(app, /const dissolveBoard[\s\S]*dissolveBoardsPreservingItems\(current, \[outfitId\]\)/);
  assert.match(app, /Dissolve board, keep products/);
  assert.match(app, /const deleteBoardAndContents[\s\S]*setDeletionRequest\(\{ itemIds: \[\], boardIds: \[outfitId\] \}\)/);
  assert.match(app, /setBoard\(\(current\) => dissolveBoardsPreservingItems\(current, boardIds\)\)/);
  assert.match(app, /setBoard\(\(current\) => deleteBoardsAndContents\(current, boardIds\)\)/);
  assert.match(app, /Delete board\(s\), keep products/);
  assert.match(app, /Delete board\(s\) and products/);
});

test('board lifecycle and geometry persist through the existing board payload', () => {
  assert.match(app, /window\.localStorage\.setItem\(storageKey, JSON\.stringify\(board\)\)/);
  assert.match(app, /const \[board, setBoard\] = useState<Board>\(loadBoard\)/);
});
