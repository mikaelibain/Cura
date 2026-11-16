# Cura dynamic UI architecture

## Purpose

Cura remains a visual shopping canvas. Adaptive UI must create more usable space for arranging, comparing, collecting, planning, and styling products; it must not turn the canvas into a product grid or a conventional shopping feed.

The responsive system changes how Cura’s controls are presented, not the spatial data model. Product and board positions remain world coordinates, boards remain spatial groupings, and the primary visual hierarchy remains image → clean product name → price. Secondary data remains contextual.

## Design principles

- Adapt from actual available inline and block space, not a device label or user agent.
- Treat width, height, input modality, and transient browser UI as independent constraints.
- Keep the canvas as the principal surface; reserve persistent chrome only when it earns the space.
- Use CSS for geometry and presentation; use JavaScript only for interaction state or measurements that must affect transform calculations.
- Keep hover, right-click, modifiers, long-press, dragging, and pinch as enhancements. Every core result needs a visible/keyboard/touch path.
- Preserve selection, inspector target, active board element, open editor, canvas transform, in-progress form data, and persisted canvas data through any layout-state transition.

## Adaptive layout states

These are content-fit states, not named devices. Exact thresholds should be validated against the acceptance matrix and implemented as tokens rather than scattered constants.

| State | Intended geometry | Persistent chrome | Inspector/panels | Canvas behavior |
| --- | --- | --- | --- | --- |
| Compact | Insufficient inline room for a side inspector and primary actions together; or short enough that persistent multi-row chrome harms manipulation. | One concise canvas header/action row. Add is always visible; less frequent actions enter an overflow or action sheet. | Bottom sheet for selection/product/board details; task dialogs for focused flows. | Canvas-first. Contextual actions replace permanent controls. |
| Medium | Enough inline room for a transient panel without permanently sacrificing the canvas, but not enough for a broad side column plus all formatting. | Primary actions visible; secondary actions grouped. | Dismissible floating/transient inspector anchored away from current key controls; may become a larger sheet at short height. | Maintain a large unobscured manipulation rectangle. |
| Expanded | Side inspector no longer makes the canvas materially cramped. | A stable header with useful actions; concise selection controls. | Persistent side inspector is reasonable; formatting can share it or use a bounded companion panel. | Canvas and inspector have explicit, non-overlapping regions. |
| Large / extra-large | Substantially more room than a comfortable inspector needs. | Do not expand every control row. | Cap reading/editor measure; use surplus space for canvas and optionally a second nonessential region only when intentionally useful. | More spatial view, not wider forms or generic product grids. |

### Height-aware behavior

Height is a first-class modifier:

- **Short height:** Collapse persistent navigation, favor a compact action row or overflow, constrain sheets/dialogs with a scrollable body and pinned close/action region, and avoid two simultaneous bottom panels.
- **Tall height:** A side inspector or larger sheet can show more contextual controls, but content should remain comfortably bounded rather than stretch to the full viewport.
- **Landscape:** Use available inline width without assuming adequate block height. A 1024×600 or 1280×650 window should use a compact-height shell even when the width normally qualifies for an expanded inspector.
- **Virtual keyboard:** Dialog/sheet content must use dynamic viewport space and allow focused inputs/action buttons to remain reachable. The canvas can shrink visually, but its world transform/state must not reset.

### Input capability modifier

- **Touch-primary/coarse pointer:** Visible context affordances, roughly 44×44px usable hit targets for important controls, a clear navigation/selection intent, and no hover-only required control.
- **Fine pointer + hover:** Hover can reveal a visual affordance, but selection/action state remains the non-hover equivalent. Right-click can open the same menu faster, never the only path.
- **Keyboard:** Focusable canvas objects retain arrow nudge behavior; standard controls, Escape, dialog focus containment, and a visible action route provide complete task coverage.
- **Pen:** Pointer Events remain the interaction substrate. Gesture thresholds prevent incidental pen contact from moving objects.

## Shell, viewport, and safe-area strategy

The new shell should define semantic layout variables rather than hard-code offsets in individual controls. Illustrative names:

```css
:root {
  --safe-top: env(safe-area-inset-top, 0px);
  --safe-right: env(safe-area-inset-right, 0px);
  --safe-bottom: env(safe-area-inset-bottom, 0px);
  --safe-left: env(safe-area-inset-left, 0px);
  --tap-target: 44px;
  --space-1: clamp(0.5rem, 1vw, 0.75rem);
  --space-2: clamp(0.75rem, 1.5vw, 1.25rem);
  --panel-inline: clamp(17rem, 26vw, 25rem);
  --overlay-gutter: max(var(--space-2), var(--safe-left));
}

.app-shell { min-block-size: 100svh; min-block-size: 100dvh; }
```

`dvh` should be the dynamic runtime size; `svh` is a stable fallback/reference that avoids content sitting behind mobile browser controls. Never disable user zoom in the viewport meta tag. Fixed visual elements must offset by safe-area tokens, including header, add action, zoom controls, sheets, toast, and drawer edge padding.

The canvas needs a defined **usable canvas rect**: shell space after active persistent header, safe areas, and any persistent expanded inspector. JavaScript should read that element’s `getBoundingClientRect()` only where transform math needs it (`clientToBoard`, Fit, contextual placement). CSS should handle normal reflow; no global width-based resize listener or UA sniffing is needed.

## Toolbar and primary-action strategy

The current top bar has actions from several categories. Keep their behavior but group their presentation:

1. **Always available:** Cura identity, Add product, navigation/fit and currently relevant selection context.
2. **Contextual:** selected-object actions, board actions, formatting, budget, move destination, destructive actions.
3. **Collection/workspace:** new board, templates, purchases, saved collections, sharing, settings, price visibility.

Compact state shows the first category plus a clearly labeled overflow/action launcher. Medium state may show a few workspace actions. Expanded state can show the current familiar text actions, with an overflow before wrapping creates an uncontrolled multi-row header. The action model must avoid an ecommerce navigation bar; it is a canvas tool palette.

Selection actions should be one adaptive context surface. On compact layouts they may be a small selected-count chip plus bottom sheet; on expanded layouts they can be a concise floating action bar. The same actions and selected IDs must survive a transition between those presentations.

## Inspector and bottom-sheet strategy

Current inspector content should be treated as a shared content contract, with three presentations:

- **Compact:** modal bottom sheet. It has a visible drag handle only as an enhancement, close button, title, scrollable body, and pinned/visible critical action area. Avoid displaying formatting toolbar and inspector sheet independently at the same bottom edge.
- **Medium:** transient inspector/pane that can be dismissed and does not cover core add/zoom/navigation controls. If the available block size becomes short, promote it to the compact sheet pattern even at medium width.
- **Expanded:** persistent side inspector within shell layout, not an unrelated fixed overlay. It receives a stable bounded inline size, and its scroll container is independent of the canvas.

The product, board, and decoration inspector bodies should use the same state data currently selected in `App.tsx`. A later extraction should first preserve event handlers and state ownership, then split presentation components only when tests can protect the behavior.

## Overlay and modal strategy

Create one overlay contract for import, quota, sizing, budget, settings, shared collections, gallery, image intent, crop review, visual matches, and deletion confirmation:

- Semantic `role="dialog"` or `alertdialog` as appropriate, `aria-modal`, accessible name/description.
- Initial focus, focus trap, Escape close where not destructive/in-progress, focus return to invoking control, and a visible close button.
- Scrollable body with `max-block-size` based on dynamic viewport and safe insets; no action must live below the keyboard/viewport.
- A layout-dependent presentation: centered bounded dialog on medium/expanded, bottom sheet on compact/short geometry when task content benefits from it.
- One named layer scale: canvas, fixed shell, contextual surface, popover, nonblocking toast, modal, blocking modal. Do not introduce arbitrary high z-index values per feature.

Popover/menu placement must use a shared collision policy against the usable viewport (including safe insets), react when the anchor or viewport changes, and fall back to a sheet/action surface on compact layouts. Right-click and hover access that same action content.

## Canvas input model

The canvas needs an explicit interaction-policy layer, while retaining its spatial behavior:

- **Tap/click:** selects a product/board/element without moving it.
- **Direct manipulation:** begins after a movement threshold suitable for coarse and fine pointers; pointer capture begins only once drag intent is clear where practical.
- **Navigation:** an explicit navigation mode remains discoverable. On touch, its controls should explain/enable one-finger pan; on fine-pointer, middle button/Alt remain shortcuts.
- **Zoom:** buttons and Fit remain accessible. Add pinch and trackpad-wheel zoom only as enhancements after preventing accidental page/canvas conflicts; retain sensible zoom limits.
- **Selection:** explicit Select mode/action supports additive selection and lasso without requiring Ctrl/Cmd. Keyboard modifiers and current Select All remain enhancements.
- **Move/resize alternatives:** inspector/sheet must provide destination chooser, nudge controls, and practical size adjustments/presets. Existing arrow-key nudges remain supported.
- **Board membership:** drag-to-board and detach remain visual enhancements; action surfaces always offer Move to board / Remove from board / Dissolve where applicable.

The `touch-action:none` currently applied broadly must be reconsidered per active interaction surface. Apply it only where a custom manipulation gesture actually needs it, so controls and ordinary content retain expected browser behavior.

## Responsive CSS architecture

Use a small foundation layer before feature-level changes:

- Custom properties for safe insets, header height, compact action dock height, panel widths, overlay gutter, touch target, radii, z-index tiers, and dynamic canvas insets.
- `clamp()`, `min()`, and `max()` for bounded dimensions and type/control spacing—not indiscriminate scaling.
- CSS Grid for shell/panel relationships; Flexbox for compact action clusters and field flow.
- `@container` on inspector/editor/overlay content so control grids react to actual panel width. Examples: board style controls, sizing rows, gallery options, shared-copy regions, match cards, and inspector two-column fields.
- Viewport media queries only for high-level shell geometry and input capabilities: inline size, block size, aspect ratio where truly needed, `hover`, `pointer`, and `prefers-reduced-motion`.
- `@media (prefers-reduced-motion: reduce)` extends beyond the existing image skeleton to sheet/panel transitions; no essential state change depends on motion.

Do not add device-name media queries, user-agent sniffing, or JS-only CSS breakpoints.

## Accessibility interaction alternatives

WCAG 2.2 AA is the implementation baseline:

- Important visible controls have about 44×44 CSS px usable hit area where practical; the icon can remain visually quiet inside it.
- Hover-only delete/open/resize affordances have selected-state and action-surface equivalents.
- Right-click menus have touch/keyboard action entry points. Long press, if added, is optional enhancement.
- Every dialog has complete keyboard behavior and an announced name; async processing remains a `role="status"`/live update without trapping users in an unlabelled overlay.
- Focus indicators remain visible against board and product styling. Logical focus order must follow the active surface, not hidden layers behind it.
- Keyboard supports select, nudge, resize, open action surface, move to/from board, delete confirmation, and dialog dismiss. Existing item/element/resize arrow behavior is retained and made discoverable.
- Crop requires non-drag operation: reset/full image and editable/keyboard-accessible framing controls.

## State-preservation requirements

The following cannot be reset by a width, height, orientation, input-capability, or layout-presentation change:

- `Board` item positions/scales, board geometry/membership, templates/presentation/style overrides, decorations, budgets, purchase state, and all localStorage compatibility.
- Canvas `viewport` transform unless the user explicitly invokes Fit/reset.
- Current selected IDs, active board, selected board element, inspector target, formatting tab, template gallery intent, and ongoing menu/action context where its anchor remains meaningful.
- In-progress import/manual fields, budget form values, sizing changes, image match/crop state, sharing selection, and quota prompt state.
- Focus and scroll position whenever the same logical panel changes from floating pane to sheet or side inspector.

When a presentation becomes impossible at the new geometry (for example an anchored popover on compact width), preserve its logical state and re-render it in the fallback sheet/overlay rather than closing it or dropping its data.

## Foundation decisions implemented

The adaptive foundation batch established the following primitives in `src/styles.css` and `index.html`:

- `viewport-fit=cover` enables the four CSS safe-area insets; the viewport still allows browser zoom.
- The application shell uses `100vh` as legacy fallback, `100svh` as the stable mobile fallback, and `100dvh` as the active size. The canvas fills the shell instead of independently sizing itself to `100vw × 100vh`. Root/body no longer impose a 320px minimum width; body scrolling remains disabled for the spatial canvas.
- Shared custom properties now define safe edges, fluid spacing/gutter, a 44px touch target, control and compact toolbar heights, inspector/sheet/modal dimensions, radii, typography, and named layer roles. Existing fixed controls and overlays use these tokens for safe offsets and dynamic-height limits.
- The first content-fit modifiers are compact inline space (`max-width:48rem`), expanded inline plus usable block space (`min-width:75rem` and `min-height:45rem`), and short block space (`max-height:40rem`). These are foundation constraints, not device names or a complete shell presentation switch.
- The inspector, generic dialog surfaces, format toolbar, and template gallery are query containers. Their narrow field/grid behavior responds to their own width, including when they later move between pane and sheet hosts.
- Coarse primary pointers increase the usable targets of the existing zoom, Add, and surface close controls. Product and board handles remain for the contextual-action batch because enlarging those within the scaled world can change drag and overlap behavior.
- Reduced motion disables existing drawer/image-loading animation and nonessential card/control transitions. No canvas transform animation was added.

The foundation does not change selection, canvas gestures, inspector presentation, topbar action grouping, or overlay focus policy. Those remain the responsibilities of Batches B–H. In particular, initial menu coordinates and Fit still use `window` dimensions and require the later canvas/overlay geometry work.

## Batch B shell and navigation decisions implemented

The app shell now has one non-wrapping header row. The header itself is an inline-size query container: below the space needed for the medium actions, it keeps the Cura mark, **New board**, and **More**; with more room it exposes Templates and Share; with generous room it additionally exposes Purchases and Saved collections. A bounded total appears only when it fits and remains available inside More on narrower layouts. These are content-fit thresholds, not device classifications. The header action cluster is capped on ultrawide screens instead of spreading every control to the edges.

Action hierarchy is explicit in the current presentation:

- **Primary:** Add product (canvas button), New board (header), zoom/Fit/Pan (canvas dock). Pan keeps the existing explicit navigation mode and is now next to the view controls.
- **Contextual:** Selection actions remain conditional on selected products; object/board editing remains in the existing inspector. Compact selection actions stay on one horizontally scrollable row for this shell batch; their eventual compact action-sheet treatment belongs to the contextual-actions/inspector batches.
- **Secondary:** Templates, Share, Purchases, Saved collections, price visibility, Select all, and Settings are in the bounded More surface whenever they are not exposed directly by available header space. No feature action was removed.
- **Destructive:** Delete/dissolve remain in selected-object controls and their existing confirmation paths, never in the global workspace menu.

The More surface is keyboard-addressable, closes on Escape or outside pointer, has internal scrolling under short viewport heights, and is kept above selected-object chrome while open. Opening another workspace navigation surface closes the prior workspace navigation surface. This is deliberately narrow behavior; complete dialog focus management and collision-safe object menus remain Batch C/F work.

`Fit` now measures the board element and the actual header/Add/zoom rectangles. It centers spatial content within the unobscured canvas portion without changing stored board coordinates or automatically fitting on resize. Existing viewport transform, selection, import drafts, and persisted data remain untouched by layout-state changes. New-board and paste placement still use window-center coordinates and are reserved for the canvas-geometry batch.

The shell uses the foundation's dynamic viewport and safe-edge tokens. Header, menu, and canvas dock were checked in a headless browser across the required compact, tablet, short-height, desktop, and odd-width matrix; the 390×844 new-board/Fit path was also checked. This is geometry validation, not a substitute for real-device safe-area, virtual-keyboard, touch, and screen-reader QA.

## Adaptive inspector, sheet, and editor presentation implemented

The inspector remains the same conditional React surface for product details, board details, board elements, and multi-selection. Its input state, handlers, selection target, formatting tab, and persisted product/board meanings are unchanged. CSS now changes only the presentation according to available geometry:

- **Compact (up to 48rem):** the inspector and product formatting controls become bounded, scrollable floating sheets above the canvas control dock, leaving Add and zoom/Fit reachable. Reading surfaces cap at the shared sheet width and center where the host is wider. Dialogs use a bottom-aligned sheet presentation with internal scrolling; simple dialogs keep their natural height rather than being forced fullscreen. Template/saved surfaces and contextual menus/popovers use safe-edge-bounded sheet fallbacks; quick-add remains a small floating input rather than stretching into a full-width sheet.
- **Medium:** inspector remains a transient right-side pane with its height bounded by the dynamic viewport and top chrome. Formatting remains a capped floating panel instead of widening with the viewport. Tablet presentation follows room, not touch capability.
- **Expanded (at least 75rem wide and 45rem tall):** when the shared inspector exists, CSS reserves a side lane beside the canvas. Selection actions, template/saved panels, share toast, and product formatting are offset into the canvas lane to avoid stacking over the inspector. This is a presentation-only change; the existing canvas transform and selected target remain in React state. A wide-but-short window intentionally falls back to the transient pane.
- **Short height:** editor, menu, gallery, and dialog surfaces cap their block size against `dvh`, use contained internal scrolling, and keep their headings/close controls sticky. Modal forms can scroll to their existing submit/cancel actions; this batch does not introduce gesture dismissal.

The closet drawer becomes a compact bottom sheet but remains a side drawer when space permits. Dialog, inspector, toolbar, gallery, and closet continue to use container queries so field/grid density follows the actual host width. Container-query rules collapse related form pairs only when those surfaces become narrow. Existing z-index/layer tokens and safe-area tokens are reused; no UA sniffing, resize listener, viewport zoom restriction, business-state change, or data migration was added.

Headless Chrome geometry validation passed at 320×568, 360×640, 375×667, 390×420, 390×844, 414×896, 430×932, 600×800, 768×1024, 820×1180, 1024×600, 1024×768, 1280×650, 1280×720, 1440×900, and 1920×1080. It checked that the inspector and dialogs stay in the viewport, long surfaces scroll internally, modal headings/close controls and bottom confirmation actions remain reachable, and no body-level horizontal overflow appears. Coarse-pointer emulation confirmed 44×44 close/input/submit targets through 768px while 820px remains the medium presentation even when touch emulation is enabled. The 390×420 focused-form case is a reduced-height keyboard approximation. Browser emulation cannot reproduce an operating-system virtual keyboard or physical device safe areas; those remain real-device QA items.

## Adaptive inspector and editor refinement

The shared inspector remains the single editing surface for product details, board details, decorations, and selection context, while product presentation uses one formatting surface. This batch does not split phone and desktop editor state or handlers. Compact inspector space now supports complex product/board forms up to 76dvh while preserving a viewport-derived cap; formatting controls stay lighter and smaller. Short viewport rules account for keyboard-reduced `dvh`, keep inspector actions within the usable area, and contain scrolling in dialogs. Form fields continue to collapse by inspector/dialog container width.

Board style overrides are progressively disclosed under **Advanced board style**. Template, background, decoration, budget, and layout actions remain visible as task groups; typography, colour, border, and corner overrides are available when requested. This keeps the default board editor focused while preserving all controls. Product, board, and board-element editor close buttons now declare their action type and accessible label, and remain visible in the sticky inspector heading.

`npm test` passes (167 tests) and `npm run build` completes. The previously documented geometry matrix is retained; a fresh live browser run for this refinement was not performed in this environment. The existing `.cura-adaptive-viewport-check.mjs` covers synthetic inspector/dialog geometry and short-height form focus but does not exercise every contextual surface or application interaction path. Real-device keyboard and safe-area checks remain necessary for final device validation.

## Canvas and multi-input interaction pass implemented

`src/canvasGesture.ts` now supplies one pointer-ID-aware movement policy for mouse, touch, and pen. Touch requires 9 CSS px of movement before a manipulation commits; mouse and pen require 5 px. The handlers still capture the pointer at gesture start so release and cancellation arrive reliably, but no product/board/decoration coordinates or canvas transform are changed before the movement threshold. A second pointer cannot take over an active gesture. The persisted board schema and coordinate formulas are unchanged.

Blank-canvas tap now deselects without creating a zero-size lasso. A deliberate blank drag retains box selection; a deliberate drag in Pan mode retains the existing canvas transform behavior. Pointer cancellation and lost capture clear the active gesture and transient UI. Product, board, and decoration moves/resizes restore their starting geometry on cancellation; successful release alone performs board transfer/detach. Nested buttons/links/inputs are excluded from parent dragging, including SVG descendants. Editor/selection controls do not start canvas gestures.

Ordinary product tap/click selects one object; modifiers remain an additive fine-pointer shortcut. A discoverable **Select multiple products** command appears in More and the selected-product actions. In that mode, taps toggle individual membership, box selection adds to the existing set, and **Finish selecting** preserves the set for group actions. Pan and multi-select modes yield to one another rather than competing for the same gesture. The selected action surface also exposes Edit details and Remove from board; destination selection was already present. Product detail controls now include nudge/size presets and Lock position; board details include whole-board nudge and delete-board-with-items; decoration details include numeric dimensions. These are non-drag supplements, not replacements for spatial manipulation.

Plain wheel/two-finger trackpad scrolling pans the canvas, coalesced to one transform update per animation frame. Shift-wheel maps vertical wheel input to horizontal pan. Wheel events inside editors, scrolling reveal details, menus, and controls stay with those surfaces. Ctrl/Meta-wheel is not intercepted, so browser/OS zoom remains available. Zoom/Fit buttons remain the deterministic canvas-zoom path. There is no custom pinch-to-canvas zoom yet: `touch-action: pinch-zoom` permits native browser zoom while one-finger object manipulation remains custom. Custom pinch would require a separate, tested two-pointer transform contract and was intentionally not added during this stabilization pass.

Coarse-pointer object handles and selected-card open/delete controls now use a restrained, zoom-aware hit-area token, capped to avoid swallowing an entire tiny zoomed-out object. At extreme canvas zoom, object handles can still be smaller than 44 screen pixels; Fit/zoom controls and inspector command alternatives remain available. Keyboard arrow movement for products/decorations and board/element resize remains; selected controls gain focus-visible outlines. Remaining interaction work includes real-device pinch/pen validation, edge/overlap behavior, richer keyboard object commands, and completing the overlay/inspector presentation batches.
