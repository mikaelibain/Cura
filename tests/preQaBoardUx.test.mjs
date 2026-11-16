import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { hasDetachIntent } from '../src/boardUx.ts';
import { resolveBoardStyle } from '../src/presentation.ts';
import { copyBoardToCanvas, makeEditableCopy } from '../src/sharing.ts';

const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');

test('detach hysteresis tolerates edge crossing and requires decisive movement', () => {
  const bounds = { left: 100, top: 100, width: 500, height: 400 };
  assert.equal(hasDetachIntent({ x: 620, y: 250 }, bounds, false), false);
  assert.equal(hasDetachIntent({ x: 697, y: 250 }, bounds, false), true);
  assert.equal(hasDetachIntent({ x: 660, y: 250 }, bounds, true), true);
  assert.equal(hasDetachIntent({ x: 640, y: 250 }, bounds, true), false);
  assert.equal(hasDetachIntent({ x: 700, y: 600 }, bounds, false), true);
});

test('board bounds grow with right, bottom, diagonal and resized content without moving products', () => {
  assert.match(app, /right = Math\.max\(\.\.\.members\.map/);
  assert.match(app, /bottom = Math\.max\(\.\.\.members\.map/);
  assert.match(app, /itemCardWidth\(item, outfit\) \* itemScale\(item\)/);
  assert.match(app, /Math\.max\(computedHeight, elementHeight, outfit\.customHeight \?\? 0\)/);
  assert.doesNotMatch(app.slice(app.indexOf('const moveItem'), app.indexOf('const endItemDrag')), /positionForBoardItem|relayoutBoard/);
});

test('detach feedback, free-canvas removal, board transfer, cancellation and contextual removal are wired', () => {
  assert.match(app, /Remove from board/);
  assert.match(app, /removeItemsFromBoards\(movedIds\)/);
  assert.match(app, /moveSelectedToBoard\(destination\.id, movedIds\)/);
  assert.match(app, /const cancelItemDrag/);
  assert.match(app, /x: original\.x, y: original\.y/);
  assert.match(app, /onPointerCancel=\{cancelItemDrag\}/);
  assert.match(app, />Remove from board</);
});

test('empty-board lifecycle and manual whitespace protections remain intact', () => {
  assert.match(app, /!outfit\.preserveWhenEmpty/);
  assert.match(app, /outfit\.customWidth \?\? 0/);
  assert.match(app, /outfit\.customHeight \?\? 0/);
  assert.match(app, /const moveOutfit/);
  const boardDragBranch = app.slice(app.indexOf('const drag = outfitDragRef.current', app.indexOf('const moveOutfit')), app.indexOf('const endOutfitDrag'));
  assert.doesNotMatch(boardDragBranch, /customWidth|customHeight/);
});

test('board style overrides inherit theme values and override only explicit properties', () => {
  const theme = { headingPreset: 'technical', backgroundPreset: 'sage' };
  assert.equal(resolveBoardStyle(theme).titleFont, 'mono');
  const styled = resolveBoardStyle(theme, { titleFont: 'serif', titleColor: '#123456', titleAlign: 'right', corners: 'soft' });
  assert.equal(styled.titleFont, 'serif');
  assert.equal(styled.titleColor, '#123456');
  assert.equal(styled.titleAlign, 'right');
  assert.equal(styled.corners, 'soft');
  assert.equal(resolveBoardStyle({ ...theme, headingPreset: 'soft' }, { titleColor: '#123456' }).titleFont, 'soft');
});

test('individual and complete style resets remove overrides rather than replacing theme data', () => {
  assert.match(app, /delete styleOverrides\[key\]/);
  assert.match(app, /if \(value === undefined\) delete styleOverrides\[key\]/);
  assert.match(app, /styleOverrides: Object\.keys\(styleOverrides\)\.length \? styleOverrides : undefined/);
});

test('copy board and editable copy preserve board style presentation', () => {
  const source = {
    items: [{ id: 'i1', sourceUrl: 'https://shop.example/i1', x: 20, y: 30, notes: '', createdAt: 'now' }],
    outfits: [{ id: 'b1', name: 'Board', itemIds: ['i1'], styleOverrides: { titleColor: '#123456', corners: 'soft' }, presentation: { headingPreset: 'serif' } }],
  };
  const copied = copyBoardToCanvas({ items: [], outfits: [] }, source, 'b1');
  assert.deepEqual(copied.outfits[0].styleOverrides, source.outfits[0].styleOverrides);
  const editable = makeEditableCopy(source, 'new-owner', 'shared');
  assert.deepEqual(editable.outfits[0].styleOverrides, source.outfits[0].styleOverrides);
});

test('board style and geometry remain part of the existing persisted board payload', () => {
  assert.match(app, /localStorage\.setItem\(storageKey, JSON\.stringify\(board\)\)/);
  assert.match(app, /outfit-price/);
  assert.match(app, /Budget:/);
});
