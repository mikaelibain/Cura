import test from 'node:test';
import assert from 'node:assert/strict';
import { canvasActivationIntent } from '../src/canvasActivation.ts';

test('single activation selects without entering edit mode', () => {
  assert.equal(canvasActivationIntent('click', false), 'select');
  assert.equal(canvasActivationIntent('click', true), 'select');
});

test('double activation edits an already selected canvas object', () => {
  assert.equal(canvasActivationIntent('double-activate', false), 'select');
  assert.equal(canvasActivationIntent('double-activate', true), 'edit');
});

test('Enter selects first and edits after selection', () => {
  assert.equal(canvasActivationIntent('enter', false), 'select');
  assert.equal(canvasActivationIntent('enter', true), 'edit');
});
