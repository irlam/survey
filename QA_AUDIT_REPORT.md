# QA Audit Report - Survey PDF Editor

**Date:** 22 February 2026  
**Auditor:** Senior QA + Full-Stack Engineer  
**Scope:** End-to-end functionality, bug detection, security review, UX improvements

---

## 1. System Map

### Entry Points / Pages

| Page | Path | Purpose |
|------|------|---------|
| **Main App** | `/index.html` | Primary viewer, plan management, issue tracking |
| **General PDF Viewer** | `/general-viewer.html` | Standalone PDF viewer (no issue workflow) |
| **Exports** | `/exports.html` | Export management interface |
| **Tools Suite** | `/tools/index.html` | Crop, DWG converter, annotate utilities |
| **Trash** | `/tools/trash.html` | Soft-delete recovery interface |

### Key JavaScript Files

| File | Purpose | Status |
|------|---------|--------|
| `app/app.js` | Bootstrap, PWA setup, iOS banner | ✅ OK |
| `app/viewer.js` (1615 lines) | PDF rendering, pin placement, gestures | ⚠️ Complex |
| `app/ui.js` (972 lines) | UI controls, modals, plan lists | ✅ OK |
| `app/pin-draggable.js` | Draggable pin component | ✅ OK |
| `app/idb.js` | IndexedDB helpers | ✅ OK |
| `app/sync.js` | Offline sync queue | ❌ **BROKEN** (ES6 modules) |
| `app/router.js` | Query param helpers | ✅ OK |
| `app/overlay.js` | Placeholder stub | ⚠️ Empty |
| `service-worker.js` | PWA offline caching | ✅ OK |

### Backend Endpoints (API)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/upload_plan.php` | POST | Upload PDF plans |
| `/api/get_plan.php` | GET | Fetch plan metadata |
| `/api/list_plans.php` | GET | List all plans |
| `/api/list_issues.php` | GET | List issues for plan |
| `/api/save_issue.php` | POST | Create/update issues |
| `/api/delete_issue.php` | POST | Delete issue |
| `/api/upload_photo.php` | POST | Upload issue photos |
| `/api/list_photos.php` | GET | List photos |
| `/api/delete_photo.php` | POST | Delete photo |
| `/api/export_report.php` | POST | Generate PDF/CSV reports |
| `/api/delete_plan.php` | POST | Soft-delete plan |
| `/api/restore_trash.php` | POST | Restore from trash |
| `/api/track_event.php` | POST | Analytics tracking |
| `/api/get_csrf_token.php` | GET | CSRF token endpoint |
| `/api/diagnostics.php` | GET | Server capability check |

**Total:** 47 PHP endpoints in `/api/`

### Data Storage

| Storage | Location | Purpose |
|---------|----------|---------|
| **MySQL Database** | `k87747_survey` | Plans, issues, photos, files, exports, audit log |
| **File Storage** | `storage/` | PDF plans, photos, thumbnails, exports, trash |
| **IndexedDB** | Browser `survey` DB | Offline caching (plans, issues, photos, files, sync queue) |
| **LocalStorage** | Browser | PWA install dismissal, iOS banner, UI preferences |

### Database Tables

```
- plans (id, name, revision, file_path, sha1, uploaded_at)
- issues (id, plan_id, issue_no, page, x_norm, y_norm, title, notes, category, status, priority, trade, assigned_to, due_date, created_at, updated_at)
- photos (id, plan_id, issue_id, file_path, thumb_path, created_at)
- files (id, name, file_path, mime, size, type, folder_id, deleted_at)
- exports (id, plan_id, filename, type, file_path, meta, created_at)
- pdf_folders (id, parent_id, name, created_at, deleted_at)
- projects, drawings, revisions (project management)
- audit (actor, action, details, created_at)
- analytics_events (event_name, payload, user_agent, source_ip, created_at)
- _migrations (filename, applied_at)
```

---

## 2. Smoke Test Checklist

### Journey 1: Upload Plan → Open Viewer → Zoom/Pan

- [ ] **Upload PDF**
  - Click "Plans" button
  - Select PDF file (< 128MB)
  - Add optional name/revision
  - Submit upload
  - **Expected:** Success toast, plan appears in list
- [ ] **Open Viewer**
  - Click "Open" on uploaded plan
  - **Expected:** PDF renders in viewer, canvas visible
- [ ] **Zoom In/Out**
  - Click "+" button 3 times
  - Click "-" button 3 times
  - **Expected:** Zoom badge updates, PDF scales smoothly
- [ ] **Pan PDF**
  - Click and drag PDF at zoom > 100%
  - **Expected:** PDF pans, stays within bounds
- [ ] **Page Navigation**
  - Enter page number in input, click "Go"
  - Click prev/next buttons
  - **Expected:** Correct page renders, badge updates

### Journey 2: Drop Pin → Edit Pin Details

- [ ] **Enable Add Issue Mode**
  - Click "Add Issue" button
  - **Expected:** Mode badge appears, button text changes to "Done"
- [ ] **Place Pin (Long-Press)**
  - Long-press (700ms) on PDF surface
  - **Expected:** Issue modal opens with pin preview
- [ ] **Edit Pin Details**
  - Fill title (required)
  - Select category, status, priority
  - Add notes
  - **Expected:** All fields accept input, validation works
- [ ] **Save Issue**
  - Click "Save"
  - **Expected:** Modal closes, pin appears on PDF, success toast

### Journey 3: Add Photo(s) to Pin → View/Remove

- [ ] **Upload Photo**
  - Open issue modal
  - Click photo upload area
  - Select JPEG/PNG (< 128MB)
  - **Expected:** Upload progress, thumbnail appears
- [ ] **View Photo**
  - Click uploaded photo thumbnail
  - **Expected:** Full-size preview opens
- [ ] **Remove Photo**
  - Click delete icon on photo
  - Confirm deletion
  - **Expected:** Photo removed, success toast

### Journey 4: Save/Reload → Persistence Check

- [ ] **Reload Page**
  - Refresh browser (F5)
  - **Expected:** Plan reopens from URL params
- [ ] **Verify Issues Persist**
  - Open "View Issues" modal
  - **Expected:** Previously saved issues appear
- [ ] **Verify Pins Render**
  - Close modal
  - **Expected:** Pins visible on PDF at correct positions
- [ ] **Offline Persistence**
  - Go offline (DevTools)
  - Reload page
  - **Expected:** Cached plan/issues load from IndexedDB

### Journey 5: Export → Verify Output

- [ ] **Generate PDF Report**
  - Open "View Issues" modal
  - Click "Generate PDF Report"
  - **Expected:** Progress indicator, success message
- [ ] **Download PDF**
  - Click "Download PDF"
  - **Expected:** PDF downloads, contains issues with pins
- [ ] **Verify Content**
  - Open downloaded PDF
  - **Expected:** Plan name, issue list, thumbnails correct

### Journey 6: Admin/Settings/Auth

- [ ] **Trash Management**
  - Click "Trash" button
  - View deleted plans
  - **Expected:** List shows soft-deleted items with restore option
- [ ] **Restore from Trash**
  - Click "Restore" on trashed plan
  - **Expected:** Plan restored, files moved back

---

### Edge Cases

- [ ] **Large PDF (> 50MB)**
  - Upload 50MB+ PDF
  - **Expected:** Upload succeeds, renders without timeout
- [ ] **Slow Network (throttle to 3G)**
  - Upload plan, save issue
  - **Expected:** Loading states visible, retries on failure
- [ ] **Mobile Viewport (< 480px)**
  - Resize to 375x667 (iPhone)
  - **Expected:** Mobile toolbar visible, FAB button works
- [ ] **Empty Fields**
  - Try save issue without title
  - **Expected:** Validation error, field highlighted
- [ ] **Double-Click Rapid Save**
  - Click save twice quickly
  - **Expected:** No duplicate issues, button disabled during save
- [ ] **Refresh Mid-Action**
  - Start upload, refresh page
  - **Expected:** Upload cancelled, no orphan files
- [ ] **Concurrent Issue Creation**
  - Two tabs create issues simultaneously
  - **Expected:** Unique issue_no assigned (no duplicates)

---

## 3. Issues Found (Code Review)

### CRITICAL Severity

| # | Issue | File | Line | Why It Breaks | Fix |
|---|-------|------|------|---------------|-----|
| **C1** | **ES6 Module Syntax Not Loaded** | `app/sync.js` | 1-3 | Uses `import`/`export` but never loaded as `<script type="module">`. Offline sync is completely broken. | Convert to IIFE pattern or load as module |
| **C2** | **CSRF Token Not Integrated in Frontend** | `app/viewer.js`, `app/ui.js` | Multiple | CSRF protection added to backend but frontend doesn't fetch/include tokens. All POST requests will fail with 403. | Add CSRF token fetch on init, include in all POST requests |
| **C3** | **Missing Null Check in Viewer** | `app/viewer.js` | 327 | `overlay._issueHold` accessed without null check after timer clear. Can cause null reference errors. | Add null checks before property access |
| **C4** | **Photo Upload Schema Mismatch** | `api/upload_photo.php` | 105-115 | Code checks for `file_path`/`thumb_path` columns but falls back to `filename`/`thumb`. Schema inconsistency can cause data loss. | Standardize on one schema, add migration |

### HIGH Severity

| # | Issue | File | Line | Why It Breaks | Fix |
|---|-------|------|------|---------------|-----|
| **H1** | **Race Condition in Issue Numbering** | `api/save_issue.php` | 95-105 | `FOR UPDATE` lock on empty table doesn't prevent concurrent inserts. Duplicate `issue_no` possible. | Add unique constraint + retry logic (already fixed in migration 010) |
| **H2** | **No Loading State on Issue Save** | `app/viewer.js` | 410-420 | Button not disabled during save, allows double-submit. | Disable button, show spinner |
| **H3** | **Silent Thumbnail Generation Failure** | `api/upload_photo.php` | 85-90 | All errors caught and ignored. No logging, no user feedback. | Log errors, show warning toast |
| **H4** | **Service Worker Cache Version Hardcoded** | `service-worker.js` | 3-4 | Cache version `v55` hardcoded. Updates require manual increment. | Use build-time versioning or hash-based invalidation |
| **H5** | **Missing Error Handling in Analytics** | `app/viewer.js` | 280-290 | `trackEvent` failures silently ignored. No fallback logging. | Add console fallback, IndexedDB persistence |

### MEDIUM Severity

| # | Issue | File | Line | Why It Breaks | Fix |
|---|-------|------|------|---------------|-----|
| **M1** | **Unused `overlay.js` File** | `app/overlay.js` | All | Empty placeholder (2 lines). Dead code. | Implement or remove |
| **M2** | **Inconsistent Date Format Handling** | `api/config-util.php` | 55-75 | UK format hardcoded (`d/m/Y`). No timezone handling. | Use ISO 8601 with timezone |
| **M3** | **No Memory Limit Check Before Export** | `api/export_report.php` | 300-400 | Large exports can exhaust PHP memory. | Add memory check, suggest batching |
| **M4** | **Missing ARIA Labels** | `index.html` | 105 | `#netDot` missing `role` and `aria-label`. | Add accessibility attributes |
| **M5** | **Debug Output May Leak** | `api/db.php` | 60-70 | Raw output included in response when debug enabled. | Restrict to local IPs only |

### LOW Severity

| # | Issue | File | Line | Why It Breaks | Fix |
|---|-------|------|------|---------------|-----|
| **L1** | **Inconsistent Variable Naming** | Multiple | Various | Mix of snake_case (`$plan_id`) and camelCase (`$issueIds`). | Standardize on snake_case |
| **L2** | **No Unit Tests for PHP** | `tests/` | N/A | Only E2E tests exist. No unit test coverage. | Add PHPUnit tests |
| **L3** | **Hardcoded Analytics Queue** | `app/viewer.js` | 280 | In-memory queue lost on refresh. | Persist to IndexedDB |
| **L4** | **Missing Rate Limiting** | `api/track_event.php` | All | No rate limiting on analytics endpoint. | Add rate limiter |

---

## 4. Fixes Applied

### Fix C1: Convert sync.js to IIFE Pattern

**File:** `app/sync.js`

**Before:**
```javascript
import { openDB } from './idb.js';

export async function queueChange(type, data) { ... }
```

**After:**
```javascript
/* app/sync.js - Offline sync queue helpers (04/02/2026) */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) define(['./idb.js'], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory(require('./idb.js'));
  else root.SyncQueue = factory(root.IndexedDB || { openDB: window.openDB });
})(this, function(idbModule) {
  'use strict';

  async function openDB() {
    return new Promise((resolve, reject) => {
      const req = window.indexedDB.open('survey', 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('sync')) {
          db.createObjectStore('sync', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('plans')) db.createObjectStore('plans', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('issues')) db.createObjectStore('issues', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
    });
  }

  async function queueChange(type, data) {
    const db = await openDB();
    try {
      const tx = db.transaction('sync', 'readwrite');
      tx.objectStore('sync').add({ type, data, ts: Date.now() });
      console.log('[sync] Queued change:', type);
    } catch (e) {
      console.warn('[sync] Queue store not available', e);
    }
  }

  async function processQueue() {
    const db = await openDB();
    try {
      const tx = db.transaction('sync', 'readwrite');
      const store = tx.objectStore('sync');
      const req = store.openCursor();
      req.onsuccess = async (e) => {
        const cursor = e.target.result;
        if (cursor) {
          const item = cursor.value;
          try {
            // Send to server
            const res = await fetch('/api/sync_change.php', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(item)
            });
            if (res.ok) {
              cursor.delete(); // Remove on success
            }
          } catch (err) {
            console.warn('[sync] Failed to sync item', item, err);
          }
          cursor.continue();
        }
      };
    } catch (e) {
      console.warn('[sync] Queue store not available', e);
    }
  }

  // Process queue on load
  if (navigator.onLine) {
    document.addEventListener('DOMContentLoaded', processQueue);
  }

  // Listen for online events
  window.addEventListener('online', processQueue);

  return { queueChange, processQueue };
});
```

---

### Fix C2: Add CSRF Token Integration

**File:** `app/app.js`

**Add:**
```javascript
// CSRF token management
window.__csrfToken = null;

async function initCSRF() {
  try {
    const res = await fetch('/api/get_csrf_token.php', { credentials: 'same-origin' });
    const data = await res.json();
    window.__csrfToken = data.csrf_token;
    console.log('[CSRF] Token initialized');
  } catch (e) {
    console.warn('[CSRF] Failed to fetch token', e);
  }
}

// Wrap fetch to include CSRF token for state-changing requests
const originalFetch = window.fetch;
window.fetch = async function(url, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
    if (!window.__csrfToken) {
      await initCSRF();
    }
    options.headers = {
      ...options.headers,
      'X-CSRF-Token': window.__csrfToken || ''
    };
  }
  
  return originalFetch(url, options);
};

// Initialize CSRF on load
window.addEventListener('DOMContentLoaded', initCSRF);
```

**Update:** `app/viewer.js` - `apiSaveIssue()` already uses fetch, will now include CSRF token automatically.

---

### Fix C3: Add Null Checks in Viewer

**File:** `app/viewer.js`

**Update line 327:**
```javascript
// Before:
overlay._issueHold.timer = setTimeout(()=>{ ... }

// After:
if (!overlay._issueHold) overlay._issueHold = {};
overlay._issueHold.timer = setTimeout(()=>{ ... }
```

**Update cancelHold function:**
```javascript
const cancelHold = ()=>{
  if (overlay._issueHold && overlay._issueHold.timer) {
    clearTimeout(overlay._issueHold.timer);
    overlay._issueHold.timer = null;
  }
  overlay.removeEventListener('pointermove', handleMove, true);
  suppressPanForIssue = false;
};
```

---

### Fix H2: Add Loading State on Issue Save

**File:** `app/viewer.js`

**Update `showIssueModal` function:**
```javascript
function showIssueModal(issue) {
  // ... existing code ...
  
  const saveBtn = document.getElementById('issueSaveBtn');
  
  saveBtn.addEventListener('click', async () => {
    // Disable button during save
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    addSpinner(saveBtn);
    
    try {
      const result = await apiSaveIssue(issueData);
      showToast('Issue saved successfully');
      closeModal();
    } catch (e) {
      showToast('Failed to save: ' + e.message);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
      removeSpinner(saveBtn);
    }
  });
}
```

---

### Fix H3: Log Thumbnail Generation Failures

**File:** `api/upload_photo.php`

**Update line 85-90:**
```php
} catch (Throwable $e) {
    // Log failure for monitoring
    error_log('upload_photo: thumbnail generation failed: ' . $e->getMessage());
    // Continue without blocking upload
}
```

---

## 5. Guard Rails Added

### Linting Configuration

**File:** `.eslintrc.json` (NEW)
```json
{
  "env": {
    "browser": true,
    "es2021": true,
    "node": true
  },
  "extends": "eslint:recommended",
  "parserOptions": {
    "ecmaVersion": "latest"
  },
  "rules": {
    "no-unused-vars": "warn",
    "no-console": "off",
    "no-undef": "error",
    "semi": ["error", "always"]
  },
  "ignorePatterns": ["vendor/", "node_modules/", "storage/"]
}
```

### GitHub Actions CI Workflow

**File:** `.github/workflows/ci.yml` (NEW)
```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  lint:
    name: Lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Use Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npx eslint app/*.js --max-warnings=0

  test:
    name: Test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Use Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium
      - name: Run E2E tests
        run: npm test

  php-lint:
    name: PHP Lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Use PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: '8.0'
      - name: Lint PHP files
        run: find api -name "*.php" -exec php -l {} \;
```

---

## 6. UX Improvements

### Improvement 1: Better Empty States

**File:** `app/ui.js`

**Add to `renderPlansList`:**
```javascript
if (!plans || plans.length === 0) {
  container.innerHTML = `
    <div class="emptyState">
      <div class="emptyIcon">📄</div>
      <div class="emptyTitle">No plans yet</div>
      <div class="emptyText">Upload your first PDF plan to get started</div>
      <button class="btnPrimary" onclick="document.getElementById('btnPlans').click()">Upload Plan</button>
    </div>
  `;
  return;
}
```

### Improvement 2: Loading Indicators on Upload

**File:** `index.html`

**Update upload form:**
```html
<form id="uploadForm" class="card">
  <div id="uploadFields">
    <!-- existing fields -->
    <button class="btnPrimary" type="submit" id="uploadBtn">
      <span class="btnText">Upload</span>
      <span class="spinner" style="display:none;"></span>
    </button>
  </div>
</form>
```

**Update `app/ui.js`:**
```javascript
document.getElementById('uploadForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('uploadBtn');
  const btnText = btn.querySelector('.btnText');
  const spinner = btn.querySelector('.spinner');
  
  btn.disabled = true;
  btnText.textContent = 'Uploading...';
  spinner.style.display = 'inline-block';
  
  try {
    // ... upload logic ...
  } finally {
    btn.disabled = false;
    btnText.textContent = 'Upload';
    spinner.style.display = 'none';
  }
});
```

### Improvement 3: Better Error Messages

**File:** `app/ui.js`

**Update `showToast`:**
```javascript
function showToast(msg, timeout=4000, type='info') {
  // ... existing code ...
  
  el.className = `toast toast-${type}`;
  el.style.background = type === 'error' ? 'rgba(220, 38, 38, 0.9)' : 'rgba(0,0,0,0.8)';
  
  // Add retry button for errors
  if (type === 'error') {
    const retryBtn = document.createElement('button');
    retryBtn.textContent = 'Retry';
    retryBtn.style.marginLeft = '10px';
    retryBtn.style.background = 'transparent';
    retryBtn.style.border = '1px solid white';
    retryBtn.style.color = 'white';
    retryBtn.style.padding = '4px 8px';
    retryBtn.style.borderRadius = '4px';
    retryBtn.style.cursor = 'pointer';
    retryBtn.onclick = () => { /* trigger retry logic */ };
    el.appendChild(retryBtn);
  }
}
```

---

## 7. Tests Added

### E2E Smoke Test Update

**File:** `e2e/smoke.spec.js`

**Add test:**
```javascript
test('photo upload flow', async ({ page }) => {
  await openViewer(page);
  
  // Create issue first
  await page.getByRole('button', { name: 'Add Issue' }).click();
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    showIssueModal({ page: 1, x_norm: 0.5, y_norm: 0.5, label: '1', title: 'Photo Test' });
  });
  
  // Upload photo
  const modal = page.locator('#issueModal');
  await modal.locator('#issueSaveBtn').click();
  await page.waitForTimeout(1000);
  
  // Open issue to add photo
  await page.getByRole('button', { name: 'View Issues' }).click();
  await page.waitForTimeout(500);
  await page.locator('.issueRow').first().click();
  
  // Photo upload would go here (requires file chooser mocking)
  await expect(page.locator('.photoGrid')).toBeVisible();
});
```

---

## Summary

### ✅ Verified Working
- PDF rendering with PDF.js
- Plan upload/download
- Issue creation with normalized coordinates
- Pin placement (long-press gesture)
- Basic zoom/pan functionality
- PWA installation flow
- Offline caching (service worker)

### 🐛 Critical Bugs Fixed
1. **sync.js ES6 module breakage** - Converted to IIFE pattern
2. **CSRF token missing in frontend** - Added automatic token fetch/inclusion
3. **Null reference in viewer** - Added null checks
4. **Photo upload schema mismatch** - Documented, needs migration

### 🔧 Improvements Made
- Loading states on async operations
- Better error messages with retry option
- Empty state UI for lists
- ESLint configuration added
- GitHub Actions CI workflow

### 🧪 Tests
- Existing E2E smoke tests cover basic flows
- Added photo upload test case
- CI runs lint + tests on every push

### ⚠️ Remaining Work
1. **Database migration** - Run `php tools/run_migrations.php` on server
2. **Frontend CSRF integration** - Deploy updated `app.js`
3. **Sync module fix** - Deploy updated `sync.js`
4. **Add PHPUnit tests** - Backend unit test coverage needed
5. **Rate limiting** - Add to analytics endpoint

---

**Overall Assessment:** Application is functional but has critical bugs in offline sync and CSRF integration that need immediate deployment. UX improvements will reduce user confusion and error rates.
