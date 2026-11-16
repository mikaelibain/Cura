import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { advanceCanvasGesture, canStartObjectGesture, canvasWheelPan, clearCanvasGesture, gestureMatches, selectionAfterItemTap, startCanvasGesture } from '../src/canvasGesture.ts';
import { moveItemsBetweenBoards, nudgeBoardAndItems } from '../src/boardUx.ts';
import { MAX_CANVAS_ZOOM, MIN_CANVAS_ZOOM, pinchGeometry, pinchViewport, semanticZoomState, zoomViewportAt } from '../src/viewportTransform.ts';

test('a tap stays a tap; deliberate movement crosses a pointer-type threshold', () => {
  const touch = startCanvasGesture('item', 4, 'touch', 100, 100);
  assert.equal(advanceCanvasGesture(touch, 4, 105, 105).dragging, false);
  assert.equal(advanceCanvasGesture(touch, 4, 109, 100).dragging, true);
  const mouse = startCanvasGesture('board', 5, 'mouse', 100, 100);
  assert.equal(advanceCanvasGesture(mouse, 5, 103, 103).dragging, false);
  assert.equal(advanceCanvasGesture(mouse, 5, 105, 100).dragging, true);
});

test('another pointer cannot move or finish an active gesture, and cancellation clears only its owner', () => {
  const gesture = startCanvasGesture('element', 7, 'pen', 20, 30);
  assert.equal(advanceCanvasGesture(gesture, 8, 100, 100), gesture);
  assert.equal(gestureMatches(gesture, 'element', 8), false);
  assert.equal(clearCanvasGesture(gesture, 'element', 8), gesture);
  assert.equal(clearCanvasGesture(gesture, 'board', 7), gesture);
  assert.equal(clearCanvasGesture(gesture, 'element', 7), null);
});

test('nested controls and navigation mode do not start parent object drags', () => {
  assert.equal(canStartObjectGesture(0, false, false), true);
  assert.equal(canStartObjectGesture(0, false, true), false);
  assert.equal(canStartObjectGesture(0, true, false), false);
  assert.equal(canStartObjectGesture(2, false, false), false);
});

test('ordinary selection is single; explicit additive selection toggles without losing other items', () => {
  assert.deepEqual(selectionAfterItemTap(['a', 'b'], 'c', false), ['c']);
  assert.deepEqual(selectionAfterItemTap(['a', 'b'], 'b', true), ['a']);
  assert.deepEqual(selectionAfterItemTap(['a'], 'b', true), ['a', 'b']);
});

test('ordinary wheel pans use normalized deltas', () => {
  assert.deepEqual(canvasWheelPan(8, -12, 0, 800, false), { x: -8, y: 12 });
  assert.deepEqual(canvasWheelPan(0, 2, 1, 800, true), { x: -32, y: 0 });
  assert.deepEqual(canvasWheelPan(0, 1, 2, 600, false), { x: 0, y: -600 });
});

test('pointer anchored zoom keeps the world point under its anchor fixed and respects zoom limits', () => {
  const initial = { x: 30, y: -18, zoom: 0.8 };
  const anchor = { x: 240, y: 170 };
  const zoomed = zoomViewportAt(initial, anchor, 1.2);
  const anchoredAfterZoom = {
    x: (anchor.x - zoomed.x) / zoomed.zoom,
    y: (anchor.y - zoomed.y) / zoomed.zoom,
  };
  const anchoredBeforeZoom = {
    x: (anchor.x - initial.x) / initial.zoom,
    y: (anchor.y - initial.y) / initial.zoom,
  };
  assert.ok(Math.abs(anchoredAfterZoom.x - anchoredBeforeZoom.x) < 1e-10);
  assert.ok(Math.abs(anchoredAfterZoom.y - anchoredBeforeZoom.y) < 1e-10);
  assert.equal(zoomViewportAt(initial, anchor, 100).zoom, MAX_CANVAS_ZOOM);
  assert.equal(zoomViewportAt(initial, anchor, 0).zoom, MIN_CANVAS_ZOOM);
  assert.equal(zoomViewportAt(initial, anchor, 2).zoom, 2);
});

test('semantic zoom breakpoints use the requested far, mid, and near ranges', () => {
  assert.equal(semanticZoomState(0.25), 'far');
  assert.equal(semanticZoomState(0.399), 'far');
  assert.equal(semanticZoomState(0.4), 'mid');
  assert.equal(semanticZoomState(0.5), 'mid');
  assert.equal(semanticZoomState(0.75), 'mid');
  assert.equal(semanticZoomState(1), 'near');
  assert.equal(semanticZoomState(2), 'near');
});

test('pinch uses the moving midpoint as its anchor without cumulative drift', () => {
  const initial = { x: 35, y: -22, zoom: 0.7 };
  const first = { x: 100, y: 100 };
  const second = { x: 200, y: 100 };
  const start = pinchGeometry(first, second);
  const nextFirst = { x: 90, y: 110 };
  const nextSecond = { x: 230, y: 110 };
  const next = pinchGeometry(nextFirst, nextSecond);
  const once = pinchViewport(initial, start.midpoint, next.midpoint, start.distance, next.distance);
  const repeated = pinchViewport(initial, start.midpoint, next.midpoint, start.distance, next.distance);
  assert.deepEqual(repeated, once);
  const stagedPointerA = [{ x: 94, y: 108 }, { x: 96, y: 109 }, nextFirst];
  const stagedPointerB = [{ x: 210, y: 104 }, { x: 220, y: 108 }, nextSecond];
  let staged = initial;
  for (let index = 0; index < stagedPointerA.length; index += 1) {
    const stageGeometry = pinchGeometry(stagedPointerA[index], stagedPointerB[index]);
    staged = pinchViewport(initial, start.midpoint, stageGeometry.midpoint, start.distance, stageGeometry.distance);
  }
  assert.deepEqual(staged, once);
  assert.equal(once.zoom, 0.98);
  const anchoredWorld = { x: (start.midpoint.x - initial.x) / initial.zoom, y: (start.midpoint.y - initial.y) / initial.zoom };
  assert.equal(once.x, next.midpoint.x - anchoredWorld.x * once.zoom);
  assert.equal(once.y, next.midpoint.y - anchoredWorld.y * once.zoom);
  assert.equal(pinchViewport(initial, start.midpoint, next.midpoint, start.distance, 1).zoom, MIN_CANVAS_ZOOM);
  assert.equal(pinchViewport(initial, start.midpoint, next.midpoint, start.distance, 10_000).zoom, MAX_CANVAS_ZOOM);
});

test('moving selected items between boards preserves membership, order, and empty-board rules', () => {
  const boards = [
    { id: 'one', itemIds: ['a', 'b'], preserveWhenEmpty: false },
    { id: 'two', itemIds: ['c'], preserveWhenEmpty: true },
    { id: 'three', itemIds: ['d'], preserveWhenEmpty: false },
  ];
  assert.deepEqual(moveItemsBetweenBoards(boards, 'two', ['a', 'b', 'd']), [
    { id: 'two', itemIds: ['c', 'a', 'b', 'd'], preserveWhenEmpty: false },
  ]);
  assert.deepEqual(boards[0].itemIds, ['a', 'b']);
});

test('a non-drag board nudge moves its members and fixed frame without changing membership', () => {
  const items = [{ id: 'a', x: 10, y: 20 }, { id: 'b', x: 30, y: 40 }];
  const boards = [{ id: 'one', itemIds: ['a'], customLeft: 5, customTop: 6 }];
  assert.deepEqual(nudgeBoardAndItems(items, boards, 'one', 16, -8), {
    items: [{ id: 'a', x: 26, y: 12 }, { id: 'b', x: 30, y: 40 }],
    outfits: [{ id: 'one', itemIds: ['a'], customLeft: 21, customTop: -2 }],
  });
  assert.deepEqual(items[0], { id: 'a', x: 10, y: 20 });
});

test('pointer cancellation and capture loss are wired to rollback handlers', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /onPointerCancel=\{cancelBoardPointer\}/);
  assert.match(app, /onLostPointerCapture=\{cancelBoardPointer\}/);
  assert.match(app, /onPointerCancel=\{cancelItemDrag\}/);
  assert.match(app, /onLostPointerCapture=\{cancelItemDrag\}/);
  assert.match(app, /onPointerCancel=\{cancelOutfitDrag\}/);
  assert.match(app, /onLostPointerCapture=\{cancelBoardElementMove\}/);
});

test('long press, pinch, and modifier-wheel are wired to the existing canvas action paths', async () => {
  const [app, styles] = await Promise.all([
    readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
  ]);
  assert.match(app, /onPointerDownCapture=\{handleCanvasPointerDownCapture\}/);
  assert.match(app, /}, 450\);/);
  assert.match(app, /dispatchEvent\(new MouseEvent\('contextmenu'/);
  assert.match(app, /objectGestureStarted/);
  assert.match(app, /pinchViewport\(pinch\.viewport/);
  assert.match(app, /zoomViewportAt\(current, anchor/);
  assert.match(styles, /\.board, \.sticker, \.outfit-frame, \.board-element, \.world \.corner-grip \{ touch-action: none; \}/);
  assert.match(styles, /--object-hit-size: max\(44px, calc\(44px \/ var\(--canvas-zoom, 1\)\)\)/);
});

test('semantic zoom state lives on the canvas root and the matrix covers readable zoom levels', async () => {
  const [app, styles, matrix] = await Promise.all([
    readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
    readFile(new URL('../scratch/ux-matrix.mjs', import.meta.url), 'utf8'),
  ]);
  assert.match(app, /canvas\.dataset\.zoom = semanticZoomState\(zoom\)/);
  assert.match(app, /setProperty\('--canvas-zoom'/);
  assert.match(app, /Zoom to selection/);
  assert.match(app, /event\.key === '0'/);
  assert.match(app, /event\.key === '1'/);
  assert.match(styles, /\.board\[data-zoom="far"\].*\.product-name/s);
  assert.match(styles, /container: cura-product \/ inline-size/);
  for (const level of ['0.25','0.5','1','2']) assert.ok(matrix.includes(`[${level},`), `matrix should exercise ${level}x zoom`);
});
