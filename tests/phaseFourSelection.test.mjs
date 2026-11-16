import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');

test('one item, multiple items, and all items can share the selection workflow', () => {
  assert.match(app, /setSelectedIds\(board\.items\.map\(\(item\) => item\.id\)\)/);
  assert.match(app, /className="selection-actions unified-selection-bar"/);
  assert.match(app, /role="toolbar" aria-label="Selection actions"/);
  assert.match(app, /const \[canvasSelection, setCanvasSelection\] = useState<CanvasSelection>/);
  assert.match(app, /const selectedIds = canvasSelection\.itemIds/);
  assert.match(app, /if \(selectedIds\.length < 1\) return/);
});

test('selected items expose create, move, style, duplicate, and delete actions', () => {
  assert.match(app, /Make board/);
  assert.match(app, /Move to board…/);
  assert.match(app, /<details className="selection-more"><summary>More<\/summary>/);
  assert.match(app, /duplicateSelected/);
  assert.match(app, /deleteMultiple/);
});

test('group dragging applies one delta without collapsing relative positions', () => {
  assert.match(app, /members: \{ id: string; x: number; y: number \}\[\]/);
  assert.match(app, /x: origin\.x \+ deltaX, y: origin\.y \+ deltaY/);
  assert.doesNotMatch(app, /x: drag\.itemX \+ deltaX, y: drag\.itemY \+ deltaY/);
});

test('bulk board transfer preserves positions and removes emptied source boards', () => {
  assert.match(app, /const moveSelectedToBoard/);
  assert.match(app, /outfits: moveItemsBetweenBoards\(current\.outfits, outfitId, itemIds\)/);
  assert.match(app, /moveSelectedToBoard\(destination\.id, movedIds\)/);
});

test('bulk board creation preserves existing product objects and coordinates', () => {
  assert.match(app, /itemIds: selectedIds/);
  assert.match(app, /setBoard\(\(current\) => \(\{\s*\.\.\.current,\s*outfits:/);
  assert.doesNotMatch(app, /createOutfit[\s\S]{0,1200}positions\.set/);
});

test('bulk duplication preserves product data and relative arrangement', () => {
  assert.match(app, /const duplicateSelected/);
  assert.match(app, /return \{ \.\.\.item, id, x: item\.x \+ 28, y: item\.y \+ 28/);
  assert.match(app, /items: \[\.\.\.current\.items, \.\.\.copies\]/);
});

test('bulk style updates only presentation data for selected products', () => {
  assert.match(app, /const updateSelectedPresentation/);
  assert.match(app, /presentation: \{ \.\.\.item\.presentation, preset \}/);
});

test('selected-item deletion uses the required confirmation language', () => {
  assert.match(app, /Delete all selected items\?/);
  assert.match(app, /This will remove the selected items from this canvas\./);
  assert.match(app, />Cancel<\/button>/);
  assert.match(app, /'Delete all'/);
});

test('bulk deletion filters product placements once and cleans empty boards', () => {
  assert.match(app, /const ids = new Set\(itemIds\)/);
  assert.match(app, /items: current\.items\.filter\(\(item\) => !ids\.has\(item\.id\)\)/);
  assert.match(app, /remainingIds\.length === 0 && !candidate\.preserveWhenEmpty \? \[\]/);
});

test('selection and bulk results persist through the authoritative board state', () => {
  assert.match(app, /window\.localStorage\.setItem\(storageKey, JSON\.stringify\(board\)\)/);
});
