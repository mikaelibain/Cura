# Cura touch-only task checklist

Status reflects touch-only Playwright checks run at 390×844 on 2026-10-06. **FAIL** means a task is not yet demonstrated as completable by touch alone; it does not authorize changing production behavior in this verification phase.

## Products

- [x] **PASS** Paste or type a product URL — touch entered a test product URL in the manual add form in `scratch/touch-product-check.mjs`.
- [x] **PASS** Add a product — two manual products were added by touch in `scratch/touch-product-check.mjs`.
- [x] **PASS** Select a product — verified on the phone canvas in `scratch/touch-product-check.mjs`.
- [x] **PASS** Multi-select products — Select mode and two product taps selected both products in `scratch/touch-product-check.mjs`.
- [x] **PASS** Move a product — touch drag changed saved x/y in `scratch/touch-product-check.mjs`.
- [x] **PASS** Resize a product — touch grip drag changed item scale in `scratch/touch-product-check.mjs`.
- [x] **PASS** Delete a product — touch Delete and explicit confirmation removed selected products in `scratch/touch-product-check.mjs`.
- [x] **PASS** Edit a product — touch Edit opened the product inspector in `scratch/touch-product-check.mjs`.

## Boards and sections

- [x] **PASS** Create a board — touch New board in `scratch/touch-board-check.mjs`.
- [x] **PASS** Move a product into a board — created a board from touch selection, then dragged a second product into it in `scratch/touch-membership-check.mjs`.
- [x] **PASS** Move a product out of a board — touch drag beyond the detach boundary removed board membership while retaining the product in `scratch/touch-membership-check.mjs`.
- [x] **PASS** Select/deselect boards — touch Select all boards and individual board choices in `scratch/board-bulk-check.mjs`.
- [x] **PASS** Move a board — touch header drag translated the board while keeping its saved width and height in `scratch/touch-board-check.mjs`.
- [x] **PASS** Delete boards while preserving products — verified by touch; item IDs/positions and section membership retained in `scratch/board-bulk-check.mjs`.
- [x] **PASS** Delete a board including its products — verified explicit confirmation and only the selected board's products removed in `scratch/board-bulk-check.mjs`.
- [x] **PASS** Set a budget — touch opened the board budget editor in `scratch/touch-board-check.mjs`.
- [x] **PASS** Use a template — touch preview and apply Hair Routine in `scratch/section-touch-check.mjs`.
- [x] **PASS** Select a section — verified one tap at 390×844 in `scratch/section-check.mjs`.
- [x] **PASS** Move a section — verified touch header drag at 390×844; section and child world coordinates move together without changing saved dimensions.
- [x] **PASS** Edit a section — verified Rename and Style open the compact editor after explicit commands at 390×844.

## Canvas and workspace

- [x] **PASS** Zoom — touch zoom control in `scratch/touch-surface-check.mjs`.
- [x] **PASS** Pan — touch drag on empty canvas in `scratch/touch-surface-check.mjs`.
- [x] **PASS** Fit the canvas — touch Fit action in `scratch/touch-surface-check.mjs`.
- [x] **PASS** Open Saved collections — opened and dismissed by touch in `scratch/touch-surface-check.mjs`.
- [x] **PASS** Open Purchases — opened and dismissed by touch in `scratch/touch-surface-check.mjs`.
- [x] **PASS** Share — share surface opened and dismissed by touch in `scratch/touch-surface-check.mjs`.
- [x] **PASS** Close tested panels, dialogs, and menus — touch dismissal verified for Add, product and board inspectors, section editor, saved collections, purchases, settings, sizing, share, budget, template, delete confirmation, and board selection flows in the touch checks and `scratch/ux-matrix.mjs`.

## Updating this audit

Change a status to **PASS** only after completing that task on a touch-only device or touch emulation without relying on hover, right-click, keyboard, or mouse input. Record the tested viewport/device and any steps needed beside the item. Keep each task independently verified.
