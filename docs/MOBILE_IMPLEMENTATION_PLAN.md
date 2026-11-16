# Cura dynamic UI implementation plan

## Guardrails for every batch

- Preserve Cura as a spatial shopping canvas. Do not introduce a product-grid default view.
- Preserve all `Board`, `Item`, `Outfit`, `BoardElement`, user-settings, sharing, sizing, quota, and cache persistence formats.
- Avoid a broad `App.tsx` refactor. Extract narrowly only when a batch needs a reusable presentation or interaction primitive.
- Every batch runs `npm test` and `npm run build`; add focused behavior tests before changing existing interaction semantics.
- Validate at least one compact, one odd-width, one tablet/medium, one short-height landscape, and one expanded width after each relevant batch.

## Batch 0 — Test and visual QA harness first

**Goal:** Make responsive regressions observable before changing UI behavior.

- Define a manual scripted matrix from the accepted dimensions, including 320×568, 375×667, 390×844, 487×800, 713×700, 768×1024, 1024×600, 1280×650, 1366×768, 1920×1080, and 2560-wide.
- Script scenarios: empty canvas; selected product; active board; long board editor; selected decoration; context menu at each edge; add/manual import; budget; sizing; sharing; image crop; virtual keyboard; persisted canvas after resize/orientation.
- Determine the project-appropriate way to add browser-level visual/interactions tests without replacing the current Node suite. Do not add a heavy runner unless it is justified by the project.

**Expected files:** `docs/`, potentially new focused UI test infrastructure and `package.json` only if approved by evidence.

**Exit criteria:** Current behavior is captured and the 159-unit-test baseline remains green.

## Batch A — Adaptive CSS foundation and shell geometry

**Goal:** Establish shared layout and safe-area tokens without changing workflows.

- Add semantic custom properties for safe-area insets, dynamic viewport, header/action-dock space, overlay gutter, panel measure, tap target, and z-index tiers.
- Replace raw viewport assumptions in shell CSS with safe `svh`/`dvh` strategy; preserve browser zoom.
- Define content-fit layout-state classes/attributes only if CSS cannot express the required high-level shell state. Do not use UA detection.
- Make body/root/canvas sizing robust below the current 320px minimum and under browser chrome.

**Expected files:** `src/styles.css`, `index.html` only if semantic viewport metadata needs confirmation; narrowly `src/App.tsx` only to expose shell state/refs.

**Exit criteria:** Canvas, Add, zoom, top chrome, toasts, and overlays respect safe insets and dynamic height without changing data or tool behavior.

## Batch B — Primary actions and application shell

**Goal:** Make compact layouts canvas-first while preserving all workspace actions.

- Group existing topbar actions into always-visible, contextual, and workspace actions.
- Implement an intentional compact overflow/action surface rather than wrapping the current text buttons arbitrarily.
- Retain New board, Templates, Purchases, Settings, Saved collections, Share, price visibility, Select all, and Grab canvas; change presentation only.
- Make Fit use the actual available canvas rectangle once the shell defines it.

**Expected files:** `src/App.tsx`, `src/styles.css`; optionally a small shell/action component under `src/` if it reduces duplication without moving domain state.

**Exit criteria:** 320–430px and short landscape keep Add and core canvas controls reachable; expanded desktop retains efficient familiar access.

## Batch C — Overlay, dialog, menu, and sheet primitives

**Goal:** Solve modal safety and overlay collision before moving feature-specific panels.

- Create a narrow shared dialog/sheet contract: focus management, Escape policy, focus return, aria naming, scrollable body, dynamic-height action reachability, and layer token usage.
- Add collision-safe anchored menu behavior; compact fallback uses a contextual action sheet.
- Migrate the smallest/simple flows first (budget and deletion confirmation), then import, sizing/settings, saved/shared collection, gallery, match, and crop flows incrementally.
- Ensure resize/orientation preserves logical overlay state rather than silently closing it.

**Expected files:** `src/App.tsx`, `src/styles.css`, potentially new focused `src/overlay*.tsx`/`src/overlay*.ts` files; relevant tests.

**Exit criteria:** No essential action is right-click-only; dialogs are keyboard-safe and no supported geometry hides a required action below the viewport.

## Batch D — Adaptive inspector and formatting presentation

**Goal:** Re-present existing inspector content without changing item, board, element, or formatting logic.

- Keep one logical inspector target and contents.
- Render it as compact bottom sheet, medium transient pane, expanded persistent side inspector, based on usable geometry and short-height modifier.
- Merge or coordinate product formatting toolbar so compact layouts do not stack two competing bottom panels.
- Add container-query layouts for field pairs, style controls, template options, and routine controls.

**Expected files:** `src/App.tsx`, `src/styles.css`, potentially narrowly extracted inspector content/presentation files; `src/presentation.ts` only if a presentation type needs a nonbreaking helper; tests.

**Exit criteria:** Product, board, and decoration editors preserve selection/open state during layout changes and retain full functionality on compact/short views.

## Batch E — Canvas input policy and transform geometry

**Goal:** Make touch, trackpad, pen, and mouse interaction intentional without resetting spatial state.

- Separate tap-selection from drag commit with input-appropriate thresholds.
- Define navigation versus selection behavior; maintain Grab canvas as discoverable explicit control.
- Update client-to-world and Fit calculations to use canvas rect, not window dimensions/hard-coded chrome.
- Add pinch/trackpad-wheel zoom only after the core button fallback and gesture conflict rules are tested.
- Limit `touch-action:none` to actual custom-manipulation surfaces/active gestures.

**Expected files:** `src/App.tsx`, `src/styles.css`, `src/boardUx.ts`, focused interaction tests.

**Exit criteria:** Tap does not unintentionally move a product; panning/selection/zoom remain usable for touch, mouse, trackpad, pen, and keyboard; resize/orientation preserves transform and coordinates.

## Batch F — Product, board, selection, and decoration contextual actions

**Goal:** Complete non-hover/non-drag access to spatial operations.

- Give selected objects a discoverable action entry on compact and keyboard paths.
- Make destination chooser, remove-from-board, dissolve, duplicate, lock, bought, open/edit, and destructive operations available without right-click.
- Add nudge/move/resize alternatives for product, board, and decoration; retain drag and existing keyboard arrows.
- Bring delete-board-and-items into the contextual inspector/sheet with current confirmation behavior.
- Increase usable target areas for delete/open/resize and ensure hover remains enhancement only.

**Expected files:** `src/App.tsx`, `src/styles.css`, `src/boardUx.ts`, relevant behavioral tests.

**Exit criteria:** Core object lifecycle actions work on touch and keyboard without hover, right-click, modifiers, or dragging.

## Batch G — Task-specific editors and information density

**Goal:** Make dense flows usable in constrained geometry while preserving Cura’s visual hierarchy.

- Apply adaptive field layouts to import/manual details, board formatting/style, sizing, settings, budget, sharing, template gallery, and closet.
- Improve image match gallery and crop review for short height and keyboard; introduce crop’s non-drag equivalent.
- Keep product cards image-first, clean-name-second, price-third; secondary attributes stay in inspector/reveal/context.
- Do not transform board content into a conventional shopping list.

**Expected files:** `src/App.tsx`, `src/styles.css`, `src/imageProcessing.ts` only if crop data helpers are needed, relevant tests.

**Exit criteria:** Every focused task has a reachable close/submit/cancel action with keyboard open, and no editor depends on a single width breakpoint.

## Batch H — Accessibility completion pass

**Goal:** Verify WCAG 2.2 AA interaction baseline across the adaptive system.

- Audit semantics, labels, live status, focus order, focus visible, dialogs, and destructive confirmations.
- Verify 44px usable targets for important touch controls; use visually quiet larger hit areas where needed.
- Verify keyboard alternatives for canvas selection, object movement/resizing, board actions, sheets, menus, and crop.
- Verify `prefers-reduced-motion` applies to all new transitions/gestures.

**Expected files:** `src/App.tsx`, `src/styles.css`, focused accessibility tests/documentation.

**Exit criteria:** No core task is hover-only, right-click-only, or drag-only; modal and overlay keyboard behavior is consistent.

## Batch I — Matrix QA, resilience, and visual polish

**Goal:** Stabilize the adaptive UI at arbitrary widths/heights and preserve the calm spatial character.

- Run the full required size matrix and input matrix, including odd widths 335, 487, 713, 913, and 1187.
- Test safe areas, virtual keyboards, mobile browser chrome changes, landscape, resize while menu/sheet/editor is open, persisted state reload, and long translated-like labels.
- Resolve overlap/collision, scroll, layer, hit-area, and visual-density defects without broad visual redesign.
- Run final `npm test` and `npm run build`.

**Expected files:** Any directly affected `src/` files, UI tests, `docs/` QA record.

**Exit criteria:** No blocked core operation at the required geometries; no persistence compatibility regression; desktop/resized-window experience remains spatial and intentional.

## Recommended sequencing rationale

The current largest risks are structural: viewport/safe-area assumptions, competing fixed panels, and mouse-centric direct manipulation. Foundation, shell, and overlay primitives come first because feature-by-feature mobile patches would otherwise duplicate behavior and create additional z-index/viewport bugs. Canvas input follows the overlay/inspector work so every new gesture change already has a non-drag contextual fallback. Task-specific editor polish follows only after those presentation and accessibility contracts exist.

## Foundation batch record

Batch A is implemented in `src/styles.css` and `index.html`. The shell/canvas now share a dynamic viewport height; root/body no longer require 320px width; fixed controls and overlays use safe-area and layer tokens; selected reusable surfaces have container-query behavior; important existing chrome controls gain coarse-pointer hit areas; and reduced-motion behavior covers the drawer and key transitions. No `App.tsx`, state, storage key, or world-coordinate data changed.

## Batch B completion record — shell, navigation, primary actions

Implemented in `src/App.tsx` and `src/styles.css` without changing business data or persistence:

- One-row header with a content-fit action hierarchy: New board always visible; Templates/Share exposed with medium header space; Purchases/Saved collections exposed with expanded space; remaining workspace actions in a compact, bounded More surface. Totals move into More when the header cannot accommodate them, and obey Hide prices.
- Existing Grab canvas mode moved next to Zoom/Fit as a labeled Pan toggle. Add product remains the prominent canvas button. Selection actions remain selection-only, now a single horizontally scrollable row instead of wrapping into several rows on compact widths.
- The header is a container-query host, the action cluster is capped on very wide screens, and the More surface scrolls within short viewports. Safe-area and dynamic viewport sizing continue to come from Batch A tokens.
- Fit centers the current board in the actual canvas rectangle after accounting for header and bottom canvas controls. It does not reset or recenter state merely because the layout resizes.
- More closes on outside pointer and Escape; workspace navigation surfaces close one another so they do not accumulate. Complete focus-trap/focus-return handling for modal and anchored surfaces remains Batch C.

Validation: `npm test` passed 159/159 and `npm run build` passed during implementation. Headless Chrome geometry checks passed at 320×568, 360×800, 375×812, 390×844, 414×896, 430×932, 768×1024, 820×1180, 1024×600, 1024×768, 1280×720, 1440×900, 1920×1080, and odd widths 335, 487, 713, 913, 1187. These checks covered one-row header, no body horizontal scroll, on-screen Add/zoom/menu controls, and a 390×844 create-board/Fit path. Real-device safe-area, browser chrome, virtual-keyboard, and touch/keyboard interaction QA remain open.

The next implementation batch is **Batch C — Overlay, dialog, menu, and sheet primitives**. Its small first slice should establish focus/Escape/scroll and collision contracts before migrating feature-specific surfaces. Inspector presentation and product/board contextual action redesign remain later batches. New-board and paste placement still use window-center coordinates; Batch E should align them with the canvas's usable rectangle alongside other transform work.

## Canvas + multi-input pass record (Batch E and a narrow Batch F slice)

This requested pass was implemented before the previously planned overlay/inspector batches. It is intentionally narrow: one shared gesture policy in `src/canvasGesture.ts`, existing Pointer Events handlers in `src/App.tsx`, targeted object hit areas in `src/styles.css`, and pure membership/nudge helpers in `src/boardUx.ts`.

Completed: movement thresholds for touch versus mouse/pen; pointer-ID ownership; tap-safe selection and box-selection threshold; cancellation/lost-capture cleanup and geometry rollback for product, board, and decoration moves/resizes; nested control drag exclusion; native browser pinch zoom availability; requestAnimationFrame-coalesced wheel/trackpad canvas panning with editor-scroll exclusions; explicit touch multi-selection; and command alternatives for product board membership, product/board nudge, product size, decoration dimensions, and board delete. The existing drag-to-board/detach and keyboard-arrow paths remain intact. The board-transfer algorithm was extracted without altering its empty-board or membership rules and now has direct tests.

Focused tests cover tap/drag thresholds, active pointer ownership and cleanup, interactive-child exclusion, additive selection, wheel delta conversion, board transfer, and board nudge. A temporary headless-browser pointer harness also passed mouse tap/subthreshold/drag, touch cancellation and subsequent tap, nested product button isolation, Pan tap/drag, lost-capture rollback and recovery, touch selection toggle/preservation, and wheel panning. The harness was removed after validation; it is not a permanent browser test suite. Final `npm test`/`npm run build` results for this pass are recorded in the handoff.

Still open for later small batches: Batch C overlay focus/collision and sheet scroll behavior; Batch D adaptive inspector/formatting placement; remaining Batch E geometry for new-board/paste center and any deliberate two-pointer canvas zoom design; remaining Batch F overlapping-board z-order, contextual menu parity, and extreme-zoom handle sizing; full real-device touch/pen/keyboard and accessibility QA. The native browser pinch path is preserved, but custom canvas pinch was not added because it would create a second simultaneous transform gesture before those contracts are tested. Do not mark Batches C–F wholly complete based on this interaction slice.

## Adaptive inspector / sheet / editor presentation record

The requested inspector/editor presentation slice is implemented in `src/styles.css`; existing `App.tsx` surface content and handlers were intentionally left shared and mounted. Compact inspectors and formatting controls are bounded floating sheets above the canvas dock; medium inspectors are transient right-side panes; expanded layouts reserve a canvas-adjacent inspector lane only when both width and height allow it. Dialogs, template/saved panels, contextual menus, popovers, and the closet drawer now use dynamic-height safe-edge surfaces with internal scroll containment. Form pair and gallery density remains host/container-driven. A viewport layout change does not alter selection, editor state, product/board data, or persistence.

The batch also adapts the existing dialogs and task surfaces without changing import, share, budget, sizing, availability, board style, templates, decorations, or product formatting semantics. Complex forms remain scrollable; lightweight tasks are not forced fullscreen. Modal headings and editor close controls remain sticky/reachable, and no drag-only dismissal was introduced. Focus trapping/restoration and OS keyboard behavior still need explicit accessibility/device QA; the automated reduced-height check only approximates a virtual keyboard.

Headless Chrome checked 320×568, 360×640, 375×667, 390×420, 390×844, 414×896, 430×932, 600×800, 768×1024, 820×1180, 1024×600, 1024×768, 1280×650, 1280×720, 1440×900, and 1920×1080. Inspector/dialog geometry, internal long-form scroll, sticky close-heading visibility, confirmation reachability after scrolling, no horizontal page overflow, and coarse-pointer 44px targets passed. At 820px, enabling touch emulation retained the medium pane rather than switching to compact presentation. A focused input stayed visible at 390×420; real mobile keyboard/safe-area verification remains outstanding. The temporary harness was removed after this check.

The next practical slice is **overlay interaction/accessibility completion**: Escape/outside-dismiss policy, focus return and focus containment where appropriate, and collision/reflow validation for dialogs and anchored menus. Follow with task-specific editor density/accessibility details, then the complete viewport/input QA matrix. Expected files: `src/App.tsx`, `src/styles.css`, and focused tests/docs; preserve all existing persisted data contracts.
