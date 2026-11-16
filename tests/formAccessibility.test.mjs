import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

test('product link, product details, prices, and budget use suitable mobile input semantics', () => {
  assert.match(app, /Product link<input autoFocus required type="url" inputMode="url" autoComplete="url"/);
  assert.match(app, /Product link<input type="url" inputMode="url" autoComplete="url" aria-invalid=\{Boolean\(editProductUrlError\)\}/);
  assert.match(app, /input type="number" min="0" step="any" inputMode="decimal"/);
  assert.match(app, /Budget amount<input autoFocus required min="0\.01" step="0\.01" inputMode="decimal" type="number" aria-invalid=/);
  assert.match(app, /Budget currency<select[^>]*value=\{budgetCurrencyDraft\}/);
  assert.match(app, /aria-invalid=\{Boolean\(editProductUrlError\)\} aria-describedby=\{editProductUrlError \? 'edit-product-url-error' : 'edit-product-url-hint'\}/);
  assert.match(app, /id="edit-product-url-error" className="field-error" role="alert"/);
});

test('URL and budget validation is visible, announced, and associated with its control', () => {
  assert.match(app, /aria-invalid=\{Boolean\(addUrlError\)\} aria-describedby=\{addUrlError \? 'add-url-error' : 'add-url-hint'\}/);
  assert.match(app, /id="add-url-error" className="field-error" role="alert"/);
  assert.match(app, /aria-describedby=\{budgetError \? 'budget-error' : 'budget-hint'\}/);
  assert.match(app, /id="budget-error" className="field-error" role="alert"/);
  assert.match(css, /\.field-error::before\s*\{\s*content:\s*"! "/);
});

test('accessible surfaces support Escape, focus return, and keyboard focus containment', () => {
  assert.match(app, /handleAccessibleSurfaceKeyDown/);
  assert.match(app, /event\.key === 'Escape' && \(accessibleSurfaceOpen \|\| Boolean\(lastShareLink\) \|\| inspectorOpen\)/);
  assert.match(app, /event\.shiftKey && \(document\.activeElement === first/);
  assert.match(app, /lastOutsideSurfaceFocusRef\.current/);
  assert.match(app, /returnTarget\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(app, /else if \(inspectorOpen\) closeInspectorSurface\(\)/);
  assert.match(app, /button type="button" autoFocus onClick=\{closeShareToast\}>Done/);
  assert.match(app, /button\[aria-label="Close inspector"\], input:not/);
  assert.match(app, /aria-modal="true" aria-labelledby="saved-collections-title"/);
});

test('keyboard viewport changes keep focused controls in view and form actions remain sticky', () => {
  assert.match(app, /window\.visualViewport\?\.addEventListener\('resize', updateKeyboardInset\)/);
  assert.match(app, /field\.scrollIntoView\(\{ block: 'nearest', inline: 'nearest' \}\)/);
  assert.match(css, /--sheet-max-block:\s*calc\(100dvh .*--virtual-keyboard-inset/);
  assert.match(css, /\.add-modal\[role="dialog"\] > \.submit-button\s*\{\s*position:\s*sticky/);
  assert.match(css, /\.app-shell\[data-layout-state="compact"\] \.modal-backdrop/);
  assert.match(css, /\.processing-toast\s*\{\s*bottom:\s*calc\(var\(--edge-bottom\) \+ var\(--compact-toolbar-height\)/);
  assert.match(css, /input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\):not\(\[type="color"\]\), select, textarea \{ font-size: var\(--text-md\) !important; \}/);
  assert.match(css, /\.app-shell\[data-layout-state="compact"\] \.add-modal select,[\s\S]*?min-height: var\(--touch-target\)/);
});
