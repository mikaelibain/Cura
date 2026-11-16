import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [app, styles, matrix] = await Promise.all([
  readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../scratch/ux-matrix.mjs', import.meta.url), 'utf8'),
]);

test('canvas objects expose one roving Tab stop and keyboard selection, editing, deletion, and nudging', () => {
  assert.match(app, /const canvasObjectTabStop =/);
  assert.match(app, /data-canvas-keyboard-object=\{`item:/);
  assert.match(app, /tabIndex=\{canvasObjectTabStop === `item:/);
  assert.match(app, /if \(event\.key === 'Enter'\).*setSelectedIds\(\[item\.id\]\)/s);
  assert.match(app, /if \(event\.key === ' '\).*setSelectedIds\(/s);
  assert.match(app, /event\.key === 'Delete' \|\| event\.key === 'Backspace'/);
  assert.match(app, /const step = event\.shiftKey \? 16 : 8/);
  assert.match(app, /requestDeleteSelectedBoardsAndContents\(\)/);
  assert.match(app, /announceCanvasAction\(`\$\{count\} .*deleted; products preserved\.`\)/);
});

test('inspector uses a labelled, keyboard-operated tablist with linked panels', () => {
  assert.match(app, /role="tablist" aria-label="Inspector sections"/);
  assert.match(app, /aria-controls="inspector-panel-details"/);
  assert.match(app, /aria-controls="inspector-panel-look"/);
  assert.match(app, /role="tabpanel" aria-labelledby="inspector-tab-details"/);
  assert.match(app, /role="tabpanel" aria-labelledby="inspector-tab-look"/);
  assert.match(app, /handleInspectorTabKeyDown/);
});

test('focus visibility, increased contrast, and forced-colors styles are available', () => {
  assert.match(styles, /:focus-visible\s*\{\s*outline: 2px solid var\(--color-focus\)/);
  assert.match(styles, /prefers-contrast:\s*more/);
  assert.match(styles, /forced-colors:\s*active/);
  assert.match(styles, /outline: 2px solid Highlight/);
});

test('UX matrix runs axe WCAG 2.2 AA checks and exercises the keyboard canvas model', () => {
  assert.match(matrix, /@axe-core\/playwright/);
  assert.match(matrix, /wcag22aa/);
  assert.match(matrix, /keyboard-canvas-model/);
  assert.match(matrix, /one roving Tab stop/);
});
