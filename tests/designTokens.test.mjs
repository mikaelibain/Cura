import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

function blockWithoutRoot(source) {
  const start = source.indexOf(':root');
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}' && --depth === 0) return `${source.slice(0, start)}${source.slice(index + 1)}`;
  }
  throw new Error('Unclosed :root token block');
}

function token(source, name) {
  const value = source.match(new RegExp(`--${name}\\s*:\\s*(#[\\da-f]{3,8})`, 'i'))?.[1];
  assert.ok(value, `Missing color token --${name}`);
  let hex = value.slice(1);
  if (hex.length === 3 || hex.length === 4) hex = [...hex].slice(0, 3).map((channel) => channel + channel).join('');
  return [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
}

function contrast(first, second) {
  const luminance = (color) => color.map((channel) => {
    const value = channel / 255;
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  }).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter + .05) / (darker + .05);
}

const componentCss = blockWithoutRoot(css);

test('semantic typography, spacing, radius, shadow, motion, and color families are defined', () => {
  for (const name of ['font-ui', 'font-decorative', 'text-xs', 'text-sm', 'text-md', 'text-lg', 'text-xl', 'text-display', 'space-0', 'space-1', 'space-2', 'space-3', 'space-4', 'space-5', 'space-6', 'radius-small', 'radius-medium', 'radius-pill', 'shadow-low', 'shadow-medium', 'shadow-overlay', 'motion-short', 'motion-normal', 'motion-slow', 'color-surface', 'color-surface-raised', 'color-surface-muted', 'color-text', 'color-text-secondary', 'color-text-muted', 'color-border', 'color-border-strong', 'color-accent', 'color-accent-soft', 'color-danger', 'color-warning', 'color-success', 'color-focus', 'color-sage-soft', 'color-blush-soft', 'color-sky-soft', 'color-lavender-soft', 'color-cream-soft', 'color-butter-soft']) {
    assert.match(css, new RegExp(`--${name}\\s*:`), `Missing design token --${name}`);
  }
});

test('component styles use type and radius tokens and contain no literal colors or mono/Georgia fonts', () => {
  const fontSizes = [...componentCss.matchAll(/font-size\s*:\s*([^;{}]+)/g)].map((match) => match[1].trim());
  assert.ok(fontSizes.every((value) => value === '0'
    || /^var\(--text-[\w-]+\)(?:\s*!important)?$/i.test(value)
    || /^clamp\(var\(--text-[\w-]+\),\s*[\d.]+cqi,\s*var\(--text-[\w-]+\)\)$/i.test(value)));
  const radii = [...componentCss.matchAll(/border-radius\s*:\s*([^;{}]+)/g)].map((match) => match[1].trim());
  assert.ok(radii.every((value) => value.split(/\s+/).every((part) => part === '0' || /^var\(--radius-(?:small|medium|pill|control|panel|dialog)\)$/.test(part))));
  assert.doesNotMatch(componentCss, /#[\da-f]{3,8}\b|rgba?\(/i);
  assert.doesNotMatch(css, /DM Mono|Georgia,\s*serif|font-family:\s*monospace|font-family:\s*['"]DM Sans/i);
  assert.match(componentCss, /input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\):not\(\[type="color"\]\), select, textarea \{ font-size: var\(--text-md\) !important/);
  assert.match(componentCss, /font-variant-numeric:\s*tabular-nums/);
});

test('primary text, semantic actions, and template tint labels meet 4.5:1 on their intended surfaces', () => {
  const surfaces = ['color-surface', 'color-surface-raised', 'color-surface-muted'];
  for (const foreground of ['color-text', 'color-text-secondary', 'color-text-muted']) {
    for (const background of surfaces) assert.ok(contrast(token(css, foreground), token(css, background)) >= 4.5, `${foreground} on ${background} is below 4.5:1`);
  }
  for (const [foreground, background] of [
    ['color-accent', 'color-accent-soft'], ['color-danger', 'color-danger-soft'], ['color-warning', 'color-warning-soft'], ['color-sage', 'color-sage-soft'], ['color-blush', 'color-blush-soft'], ['color-sky', 'color-sky-soft'], ['color-lavender', 'color-lavender-soft'], ['color-cream', 'color-cream-soft'], ['color-butter', 'color-butter-soft'],
  ]) assert.ok(contrast(token(css, foreground), token(css, background)) >= 4.5, `${foreground} on ${background} is below 4.5:1`);
});
