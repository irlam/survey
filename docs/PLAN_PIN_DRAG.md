# Plan: Enable Dragging Pins on Plan When Creating/Editing an Issue 🔧

## Summary ✨
Add an interactive drag-and-drop pin editing workflow to the issue creation/edit UI that allows users to reposition a pin directly on a plan image, persist the normalized coordinates (x_norm/y_norm) to the database, and surface the new coordinates across the app (viewer, exports, and render endpoints).

Goals
- Provide an intuitive UX for placing and adjusting issue pins on plans.
- Ensure coordinates are saved immediately and reliably.
- Keep exports (PDF/CSV) and server-side renders in sync with dragged positions.
- Maintain accessibility, touch support, and graceful fallbacks.

---

## Motivation & Context 💡
Currently pins are stored as normalized coordinates and rendered either as vector pins or raster composites. Allowing in-place dragging will make issue location correction faster and reduce errors from entering coordinates manually.

Key constraints from codebase:
- `issues` table already contains `x_norm` / `y_norm` columns (code references exist in `api/export_report.php`).
- Rendering path supports vector pin drawing (`DrawPinAt`) and raster fallbacks.
- The app is vanilla JS frontend (app/*), PHP backend (api/*) and uses FPDF for PDF generation.

---

## UX / Interaction Design 🖱️

Flow #1: Create Issue + Place Pin
1. User clicks "New Issue" → opens issue modal or side panel.
2. Plan preview is shown (small, interactive) with a pin at default location (0.5,0.5).
3. User taps/drags pin on the preview to desired location.
4. UI shows live coordinates (x%, y%) and a small tooltip with "Save"/"Done".
5. On save, client POSTs updated coordinates with `save_issue.php` (or a new endpoint) and receives confirmation.

Flow #2: Edit Existing Issue Location
1. User opens an existing issue in edit mode; plan preview shows existing pin at saved coords.
2. Drag to new place; coordinates update live.
3. On drop, the change is debounced (e.g., 300ms) and auto-saved (optimistic UI). A small spinner or check confirms save.

Accessibility & Touch
- Drag must support mouse and touch events. Provide a long-press handler for touch if necessary.
- Include keyboard alternatives: arrow keys to nudge pin, text input for precise coords.

Mobile considerations
- Larger tap target and confirm-save to avoid accidental drags.
- Provide a zoom control for precise placement.

Visual cues
- Snap-to-grid toggle optional for precision.
- Pin center (hotspot) used for placement — pin tip should point precisely to coordinates.

---

## Client-side Implementation (High-level) 🧭

Files to update / add
- `app/overlay.js` or `app/viewer.js` — add pin drag handlers and preview support.
- `app/ui.js` or `app/router.js` — show the interactive preview in the issue creation/edit flow.
- Add small module: `app/pin-draggable.js` to encapsulate drag logic, touch handling, keyboard nudges, and coordinate conversions.

Important behaviors
- Convert between screen (px) and normalized coords: x_norm = cursorX / imgWidth (range 0..1) — account for rotated/scaled plans and device DPR.
- Debounce saves to avoid excessive API calls (e.g., 250–500ms). Use optimistic UI and show save status.
- Emit analytics events for UX: `pin_drag_start`, `pin_drag_end`, `pin_save_success`, `pin_save_failure`.

Tests
- Unit tests for pixel→normalized conversions and vice-versa (accounting for bounding box padding).
- E2E tests with Puppeteer (drag pin, save, assert API call and eventual PDF reflect change).

UX notes
- Provide a small overlay handle to drag (not the pin's label) so users easily grab it.
- For small screens, allow long-press to enter precise placement mode.

---

## Backend/API Changes 🛠️

API options
1. Reuse `api/save_issue.php` to accept `x_norm` and `y_norm` fields (fast, minimal change). Ensure request validation & authentication remain unchanged.
2. Or add `api/move_pin.php` to focus solely on pin updates (thin endpoint returning the updated issue payload and success). Prefer #1 for simplicity.

Validation
- Ensure `x_norm` & `y_norm` are floats between 0 and 1.
- Enforce permissions: only issue owner or permitted user can move pin.
- Rate limit or CSRF protections as per existing `save_issue.php` conventions.

Server-side behavior
- Persist normalized coordinates to `issues` table (existing columns used).
- Return updated `issue` JSON.
- Add server-side logging for `pin_move` events for auditability.

Compatibility
- Ensure older clients ignore extra fields (backwards-compatible additions to API payload will be fine).

---

## Rendering & Exports Integration ✅

- `api/export_report.php` already draws vector pins at request-time using `DrawPinAt`.
- Exports should automatically reflect the updated coordinates because they read `issues.x_norm`/`y_norm` at export time.
- Add unit/integration tests that:
  - create an issue with coords (or update via pin drag API), call export endpoint with `debug=1`, and assert that `render_debug` includes expected plan_thumb and pin drawing metadata.

Edge cases
- Very small thumbnails: ensure pin is still visible or scaled down gracefully (we already have `DrawPinAt` scale logic).
- Missing plan file: show fallback behavior and optionally show error to user.

---

## Tests & CI ✅

- Unit tests: convert coords and handler logic.
- API tests: test `save_issue.php` update with valid/invalid coordinates.
- Integration test: full export flow verifying PDF includes vector pin overlay at the new coordinates.
- E2E tests: Puppeteer/Playwright script to open the UI, drag a pin, assert the coordinates saved and visible in viewer, and export contains pin.

Smoke test additions
- Extend `tools/run_smoke_http.js` to include a pin-move test:
  1. POST to `save_issue.php` updating issue 21 with x_norm=0.6,y_norm=0.3
  2. POST export with debug=1 and confirm `render_debug` for that issue shows plan_thumb (or render_method) and pins_included increased.

---

## Rollout & Feature Flag 🚦

- Add a feature flag (config): `FEATURE_PIN_DRAG = false` (default). Enable per-env or via admin toggle for staged rollout.
- Staged rollout steps:
  1. Enable in staging and run E2E tests.
  2. Enable for internal users only (use query param or user role check).
  3. Monitor logs & analytics for failures.
  4. Roll out to production after stability is confirmed.

Rollback
- Revert client changes and set `FEATURE_PIN_DRAG=false`. Existing coordinate data remains intact.

---

## Acceptance Criteria & Definition of Done ✅

- [ ] User can drag a pin on plan preview in issue create/edit and see live position.
- [ ] Position is saved to DB and reflected in viewer and PDF exports immediately or after save confirmation.
- [ ] Touch & keyboard interactions supported and tested.
- [ ] Integration tests (export debug) confirm pin is included and shows expected coordinates.
- [ ] Feature guarded behind `FEATURE_PIN_DRAG` and disabled by default.

---

## Security & Privacy Considerations 🔐

- Only authorized users may move a pin on an issue (same policy as editing the issue). Enforce server-side checks.
- Validate inputs tightly to prevent malformed coords or injection.
- Rate limit per user as needed to avoid automated abuse (rapid pin moves saving excessive updates).

---

## Estimated Implementation Tasks & Timeline ⏱️

Small team (1–2 devs) estimate: 1–2 sprints (2–4 days):
1. UX + small mockups / accessibility review — 0.5 day
2. Implement client drag module + integration into issue UI — 1 day
3. Add API save support (if not present) + validation — 0.5 day
4. Add integration tests + unit tests + e2e — 0.5–1 day
5. QA, staging rollout, bug fixes — 0.5–1 day

---

## Implementation Checklist (for PR) 🧾
- [ ] Add `app/pin-draggable.js` with unit tests
- [ ] Wire into issue create/edit UI (feature-flag guarded)
- [ ] Server: extend `save_issue.php` or add `move_pin.php` with validation tests
- [ ] Integration tests: run export and assert `render_debug` JSON includes updated plan_thumb and pin metadata
- [ ] E2E: Puppeteer script to drag and save
- [ ] Docs: Update `docs/ASSISTANT_CONTEXT.md` / `docs/FEATURES.md` and add user-facing help tooltip
- [ ] QA checklist & accessibility sign-off

---

## Notes / Implementation Tips 💡
- Use normalized coordinates so plan image scaling/rotation does not affect underlying data.
- For performance, render plan thumbnails at a small size in the issue modal (client-side) but ensure the exported PDF is generated server-side from the plan file.
- Use CSS transforms for smooth dragging and an overlay canvas for pin rendering while dragging.

---

## Next steps (developer ready)
- If you want, I can create a GitHub Issue filling in the tasks above and add a `help wanted` label and suggested PR template for implementers.

---

Document created by: GitHub Copilot (implementation plan)
