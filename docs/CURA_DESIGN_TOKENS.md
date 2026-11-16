# Cura design tokens

`src/styles.css` is the canonical visual token source. Components should use these custom properties rather than add literal type, radius, shadow, or color values.

## Typography

- `--font-ui`: DM Sans for application chrome, products, boards, forms, prices, and controls.
- `--font-decorative`: Playfair Display for the wordmark, template names, and decorative section headings.
- `--text-xs`, `--text-sm`, `--text-md`, `--text-lg`, `--text-xl`, and `--text-display`: rem-based responsive roles. `--text-xs` has a 12px minimum at the default root size.
- Text inputs, selects, and text areas use `--text-md` to avoid mobile focus zoom. Price values use tabular numerals.

## Spacing, shape, depth, and motion

- Spacing: `--space-0` through `--space-6`.
- Radius: `--radius-small`, `--radius-medium`, and `--radius-pill`; square edges use `0`.
- Shadow: `--shadow-low`, `--shadow-medium`, and `--shadow-overlay`. `--shadow-overlay-mask` is reserved for the image crop mask overlay.
- Motion: `--motion-short`, `--motion-normal`, and `--motion-slow`.

## Color

Semantic roles include surface, raised and muted surfaces, text, secondary and muted text, border, strong border, accent, soft accent, danger, warning, success, and focus. Template families use sage, blush, sky, lavender, cream, and butter tokens with soft and border variants.

## Audit

`node scratch/design-token-audit.mjs` reports the CSS token counts and WCAG contrast ratios for semantic text/surface and family foreground/background pairs. The baseline counts were 34 unique font-size values, 36 border-radius values, and 456 unique hex/RGB literal color values. After migration, component styles use six type roles, three radius roles, and no literal color values; the token palette retains 33 unique hex values.

Primary text contrast ranges from 4.53:1 to 13.33:1 across the three surface tokens. The semantic action and template tint pairs are checked by `tests/designTokens.test.mjs` and meet 4.5:1.
