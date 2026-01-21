# Survey PDF Editor — Assistant Context (Handoff)

This repo powers https://survey.defecttracker.uk/ on shared Plesk hosting (no Docker).
Mobile-first dark neon UI. Uses PHP + MySQL + PDF.js in the browser.

## Current state (working)
- Plans list loads from API and opens in-app viewer
- PDF renders via PDF.js inside index.html (viewer.html is now index.html)
- Upload plan works (server + storage fixed to stay inside open_basedir)
- “Add Issue” mode now toggles and allows placing TEMP pins on the PDF (client-side only)
- Pins appear on the overlay layer (not saved to DB yet)

## Frontend files (key)
- `/index.html`
  - Loads `/assets/ui.css`
  - Loads PDF.js:
    - `/vendor/pdfjs/pdf.min.js`
    - worker set to `/vendor/pdfjs/pdf.worker.min.js`
  - Loads `/app/app.js` as module
  - Has:
    - #plansList
    - upload form #uploadForm
    - viewer area: #pdfStage -> #pdfContainer
    - controls: prev/next/go, zoom, fit
    - Add Issue button: #btnAddIssueMode
    - Mode badge: #modeBadge (shows “Add Issue Mode”)

- `/app/app.js`
  - boots the UI: renderPlansScreen()
  - should also call startViewer() once on load so direct ?plan_id links work

- `/app/ui.js`
  - list plans: GET `/api/list_plans.php`
  - upload plan: POST `/api/upload_plan.php`
  - open plan: calls openPlanInApp(plan.id)

- `/app/viewer.js`
  - Uses PDF.js to render PDF
  - Maintains overlay layer `.pdfOverlay` over the canvas
  - Add Issue Mode:
    - toggles `addIssueMode`
    - taps on overlay create temp pins: {page, x_norm, y_norm, label}
    - renders pins on overlay
  - NOT saving pins to DB yet

## API endpoints (key)
- `/api/list_plans.php` -> { ok:true, plans:[...] }
- `/api/get_plan.php?plan_id=ID` -> { ok:true, plan:{...}, pdf_url:".../api/plan_file.php?plan_id=ID" }
- `/api/plan_file.php?plan_id=ID` -> streams the PDF file
- `/api/upload_plan.php` -> handles PDF upload, stores file to storage, inserts into `plans`

Other endpoints exist / planned:
- save_issue.php (to create/update issues in DB)
- list_issues.php (to return issues for a plan/page)
- upload_photo.php (attach photos to an issue)
- save_revision.php etc. (projects/drawings/revisions features)

## Database tables present
- plans (id, name, revision, file_path, sha1, uploaded_at)
- issues (plan_id, issue_no, page, x_norm, y_norm, title, notes, category, status, priority, etc.)
- photos, files, exports, projects, drawings, revisions, audit

## Hosting notes
- open_basedir restrictions apply.
- storage MUST be inside httpdocs, e.g. `/httpdocs/storage/...`
- ping.php now reports storage writable and db ok.

## Current UX rules
- mobile first
- on landscape tablets (min-width:900px and landscape):
  - allow sidebar collapse so viewer gets max width
- dark neon theme (CSS variables in /assets/ui.css)

## Next milestone (what we should build next)
Persist issues (pins) to DB:
1) When in Add Issue Mode, tap creates a pin and opens an “Issue Details” mini modal:
   - title (required)
   - notes
   - status/category/priority (defaults ok)
2) POST to `/api/save_issue.php` to insert into `issues`
3) Load issues for plan/page via `/api/list_issues.php?plan_id=...&page=...`
4) Render DB pins on overlay (not tempPins)
5) Clicking a pin opens/edit issue
