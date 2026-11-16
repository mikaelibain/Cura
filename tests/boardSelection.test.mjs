import test from 'node:test';
import assert from 'node:assert/strict';
import { bulkBoardDeleteLabel, deleteBoardsAndContents, dissolveBoardsPreservingItems, toggleBoardSelection } from '../src/boardSelection.ts';
import { instantiateTemplate, starterTemplates } from '../src/templates.ts';
import { boardsEnclosedBy, marqueeCanvasSelection } from '../src/canvasSelection.ts';

const ids = ['a', 'b', 'c'];
const makeIds = () => { let next = 0; return () => `id-${++next}`; };

test('Board selection adds, removes, and selects all available Boards', () => {
  assert.deepEqual(toggleBoardSelection([], 'a', ids), ['a']);
  assert.deepEqual(toggleBoardSelection(['a'], 'b', ids), ['a', 'b']);
  assert.deepEqual(toggleBoardSelection(['a', 'b'], 'a', ids), ['b']);
  assert.deepEqual(toggleBoardSelection(['a', 'deleted'], 'c', ids), ['a', 'c']);
  assert.deepEqual([...ids], ['a', 'b', 'c']);
});

test('bulk label changes between selected Boards and every Board', () => {
  assert.equal(bulkBoardDeleteLabel(2, 3), 'Delete selected boards');
  assert.equal(bulkBoardDeleteLabel(3, 3), 'Delete all boards');
  assert.equal(bulkBoardDeleteLabel(2, 2), 'Delete all boards');
  assert.equal(bulkBoardDeleteLabel(1, 3), null);
  assert.equal(bulkBoardDeleteLabel(0, 0), null);
});

test('deleting two Board containers preserves their Items, positions, and free-standing Items', () => {
  const free = { id: 'free', x: 900, y: 900, title: 'Free item' };
  const state = { items: [{ id: 'one', x: 10, y: 20 }, { id: 'two', x: 200, y: 300 }, free],
    outfits: [{ id: 'a', itemIds: ['one'] }, { id: 'b', itemIds: ['two'] }, { id: 'c', itemIds: [] }] };
  const next = dissolveBoardsPreservingItems(state, ['a', 'b']);
  assert.deepEqual(next.outfits.map((board) => board.id), ['c']);
  assert.equal(next.items, state.items);
  assert.deepEqual(next.items, state.items);
  assert.equal(next.items.find((item) => item.id === 'free'), free);
});

test('delete all Boards leaves all products usable and empty template Sections intact', () => {
  const template = starterTemplates.find((entry) => entry.id === 'hair-routine');
  const created = instantiateTemplate(template, { x: 20, y: 30 }, makeIds());
  const state = { items: created.items, outfits: created.outfits, sections: created.sections };
  const next = dissolveBoardsPreservingItems(state, state.outfits.map((board) => board.id));
  assert.equal(next.outfits.length, 0);
  assert.equal(next.items.length, 15);
  assert.deepEqual(next.items.map((item) => [item.id, item.x, item.y]), state.items.map((item) => [item.id, item.x, item.y]));
  assert.equal(next.sections.length, 1);
  assert.deepEqual(next.sections[0].boardIds, []);
  assert.equal(next.sections[0].title, 'Hair Routine');
});

const marqueeBoards = [
  { id: 'board-a', left: 10, top: 10, right: 110, bottom: 110, itemIds: ['a1', 'a2'] },
  { id: 'board-b', left: 130, top: 10, right: 230, bottom: 110, itemIds: ['b1'] },
];
const marqueeItems = [
  { id: 'a1', left: 20, top: 20, right: 45, bottom: 50, boardId: 'board-a' },
  { id: 'a2', left: 60, top: 60, right: 90, bottom: 90, boardId: 'board-a' },
  { id: 'b1', left: 140, top: 20, right: 175, bottom: 55, boardId: 'board-b' },
  { id: 'free', left: 245, top: 30, right: 280, bottom: 70 },
];

test('boardsEnclosedBy selects only fully enclosed board frames', () => {
  assert.deepEqual(boardsEnclosedBy({ left: 0, top: 0, right: 120, bottom: 120 }, marqueeBoards), ['board-a']);
});

test('marquee selects products without selecting their enclosing board', () => {
  const selection = marqueeCanvasSelection({ left: 15, top: 15, right: 100, bottom: 100 }, marqueeItems, marqueeBoards);
  assert.deepEqual(selection, { itemIds: ['a1', 'a2'], boardIds: [], sectionIds: [] });
});

test('marquee selects a fully enclosed board and suppresses its child products', () => {
  const selection = marqueeCanvasSelection({ left: 0, top: 0, right: 120, bottom: 120 }, marqueeItems, marqueeBoards);
  assert.deepEqual(selection, { itemIds: [], boardIds: ['board-a'], sectionIds: [] });
});

test('mixed marquee returns board containers and free products, without board children', () => {
  const selection = marqueeCanvasSelection({ left: 0, top: 0, right: 300, bottom: 120 }, marqueeItems, marqueeBoards);
  assert.deepEqual(selection, { itemIds: ['free'], boardIds: ['board-a', 'board-b'], sectionIds: [] });
});

test('additive marquee adds new objects and removes objects already selected', () => {
  const current = { itemIds: ['free', 'a1'], boardIds: [], sectionIds: [] };
  const selection = marqueeCanvasSelection({ left: 15, top: 15, right: 100, bottom: 100 }, marqueeItems, marqueeBoards, current, true);
  assert.deepEqual(selection, { itemIds: ['free', 'a2'], boardIds: [], sectionIds: [] });
});

test('keep-products deletion dissolves selected boards without moving products', () => {
  const state = { items: [{ id: 'p', x: 12, y: 34 }], outfits: [{ id: 'b', itemIds: ['p'] }] };
  const result = dissolveBoardsPreservingItems(state, ['b']);
  assert.deepEqual(result.outfits, []);
  assert.deepEqual(result.items, state.items);
  assert.deepEqual([result.items[0].x, result.items[0].y], [12, 34]);
});

test('delete-products deletion removes selected boards and their products', () => {
  const state = { items: [{ id: 'p', x: 12, y: 34 }, { id: 'free', x: 70, y: 80 }], outfits: [{ id: 'b', itemIds: ['p'] }] };
  const result = deleteBoardsAndContents(state, ['b']);
  assert.deepEqual(result.outfits, []);
  assert.deepEqual(result.items.map((item) => item.id), ['free']);
});

test('delete-products deletion retains unrelated empty template boards and their frame data', () => {
  const state = { items: [{ id: 'p', x: 12, y: 34 }], outfits: [
    { id: 'selected', itemIds: ['p'] }, { id: 'empty-template', itemIds: [], preserveWhenEmpty: true, customLeft: 40, customTop: 50 },
  ] };
  const result = deleteBoardsAndContents(state, ['selected']);
  assert.deepEqual(result.outfits, [{ id: 'empty-template', itemIds: [], preserveWhenEmpty: true, customLeft: 40, customTop: 50 }]);
});
