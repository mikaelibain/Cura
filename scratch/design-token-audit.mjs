import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

function declarations(pattern) {
  return [...new Set([...css.matchAll(pattern)].map((match) => match[1].trim()))].sort();
}

function withoutRoot(cssText) {
  const start = cssText.indexOf(':root');
  if (start < 0) return cssText;
  const open = cssText.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < cssText.length; index += 1) {
    if (cssText[index] === '{') depth += 1;
    if (cssText[index] === '}' && --depth === 0) return `${cssText.slice(0, start)}${cssText.slice(index + 1)}`;
  }
  return cssText;
}

const componentCss = withoutRoot(css);
const literalColors = (text) => new Set(text.match(/#[\da-f]{3,8}\b|rgba?\([^)]*\)/gi) ?? []);
const values = {
  fontSizes: [...new Set(declarations(/font-size\s*:\s*([^;{}]+)/g).map((value) => value.replace(/\s*!important$/i, '')).filter((value) => value !== '0'))],
  radii: [...new Set(declarations(/border-radius\s*:\s*([^;{}]+)/g).filter((value) => !/^0(?:px|rem)?$/i.test(value)))],
  literalColors: [...literalColors(css)].sort(),
  componentLiteralColors: [...literalColors(componentCss)].sort(),
};

function rgb(color) {
  if (color.startsWith('#')) {
    let hex = color.slice(1);
    if (hex.length === 3 || hex.length === 4) hex = [...hex].slice(0, 3).map((digit) => digit + digit).join('');
    return [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
  }
  return color.match(/[\d.]+/g).slice(0, 3).map(Number);
}

function luminance(color) {
  const linear = rgb(color).map((channel) => {
    const value = channel / 255;
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  });
  return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
}

function contrast(first, second) {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter + .05) / (darker + .05);
}

const tokens = Object.fromEntries([...css.matchAll(/--(color-[\w-]+)\s*:\s*(#[\da-f]{3,8})\s*;/gi)].map((match) => [match[1], match[2]]));
const contrastPairs = ['text', 'text-secondary', 'text-muted'].flatMap((foreground) => ['surface', 'surface-raised', 'surface-muted'].map((background) => ({
  foreground: `--color-${foreground}`,
  background: `--color-${background}`,
  ratio: Number(contrast(tokens[`color-${foreground}`], tokens[`color-${background}`]).toFixed(2)),
})));

console.log(JSON.stringify({
  baseline: { uniqueFontSizeValues: 34, uniqueRadiusValues: 36, uniqueLiteralColorValues: 456 },
  uniqueFontSizeValues: values.fontSizes.length,
  uniqueRadiusValues: values.radii.length,
  uniqueLiteralColorValues: values.literalColors.length,
  componentLiteralColorValues: values.componentLiteralColors.length,
  designTokenColorValues: Object.keys(tokens).length,
  contrastPairs,
}, null, 2));
