# Security Fixes Applied

This document describes the critical security fixes applied to the Survey PDF Editor application.

## Fixes Applied (22/02/2026)

### 1. CSRF Protection ✅

**Issue:** No CSRF (Cross-Site Request Forgery) protection on state-changing endpoints.

**Files Changed:**
- `api/db.php` - Added `verify_csrf()` and `generate_csrf_token()` functions
- `api/config.sample.php` - Added `csrf_enabled` configuration option
- `api/get_csrf_token.php` - New endpoint for frontend to retrieve CSRF tokens

**Solution:**
- Added session-based CSRF token generation and verification
- Tokens are validated via `X-CSRF-Token` header or `_csrf` POST parameter
- GET requests are exempt (should be read-only)
- Enabled by default via `csrf_enabled: true` in config

**Frontend Integration:**
```javascript
// On app initialization, fetch CSRF token
async function initCSRF() {
  const res = await fetch('/api/get_csrf_token.php');
  const data = await res.json();
  window.csrfToken = data.csrf_token;
  
  // Include in all state-changing requests
  fetch('/api/save_issue.php', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': window.csrfToken
    },
    body: JSON.stringify(issue)
  });
}
```

**Database Migration:** None required

---

### 2. Path Traversal Prevention ✅

**Issue:** `storage_dir()` function vulnerable to `../` path traversal attacks.

**Files Changed:**
- `api/config-util.php` - Enhanced `storage_dir()` function

**Solution:**
- Strip `../`, `..\\`, `./`, `.\\` sequences from input paths
- Validate resolved paths are within base storage directory using `realpath()`
- Prevents symlink attacks and absolute path injection

**Before:**
```php
function storage_dir($subpath) {
  $base = resolve_storage_path();
  $full = rtrim($base, '/\\') . '/' . ltrim($subpath, '/\\');
  ensure_dir(dirname($full));
  return $full;
}
```

**After:**
```php
function storage_dir($subpath) {
  $base = resolve_storage_path();
  
  // Security: Remove path traversal sequences
  $subpath = str_replace(['../', '..\\', './', '.\\'], '', $subpath);
  $subpath = ltrim($subpath, '/\\');
  
  $full = rtrim($base, '/\\') . '/' . $subpath;
  
  // Security: Validate path is within base directory
  $realBase = realpath($base) ?: $base;
  $realPath = realpath(dirname($full)) ?: dirname($full);
  
  if (strpos($realPath, $realBase) !== 0) {
    error_response('Invalid storage path', 400);
  }
  
  ensure_dir(dirname($full));
  return $full;
}
```

**Database Migration:** None required

---

### 3. Race Condition Fix ✅

**Issue:** Concurrent issue creation could result in duplicate `issue_no` values.

**Files Changed:**
- `api/save_issue.php` - Enhanced transaction handling with retry logic
- `sql/010_issue_unique_constraint.sql` - New migration for unique constraint

**Solution:**
- Lock parent `plans` row before allocating issue number
- Added retry logic for duplicate key errors
- Database unique constraint on `(plan_id, issue_no)`

**Database Migration Required:**
```bash
# Run the migration
php tools/run_migrations.php

# Or manually:
mysql -u user -p database < sql/010_issue_unique_constraint.sql
```

**Migration Script:**
```sql
-- Fix existing duplicates first
UPDATE issues i1
JOIN (
    SELECT plan_id, issue_no, MIN(id) as min_id
    FROM issues
    GROUP BY plan_id, issue_no
    HAVING COUNT(*) > 1
) dup ON i1.plan_id = dup.plan_id AND i1.issue_no = dup.issue_no AND i1.id > dup.min_id
SET i1.issue_no = (
    SELECT COALESCE(MAX(issue_no), 0) + 1
    FROM issues i2
    WHERE i2.plan_id = i1.plan_id
);

-- Add unique constraint
ALTER TABLE issues 
ADD UNIQUE KEY uq_plan_issue_no (plan_id, issue_no);
```

---

### 4. Input Validation for Analytics ✅

**Issue:** Analytics endpoint accepted any event name without validation.

**Files Changed:**
- `api/track_event.php` - Added event name validation and whitelist

**Solution:**
- Regex validation: event names must start with letter, contain only `[a-zA-Z0-9._-]`
- Whitelist of known event types enforced in production
- Debug mode allows unknown events for development

**Allowed Event Types:**
- `plan.*` - Plan-related events
- `issue.*` - Issue tracking events
- `photo.*` - Photo upload/view events
- `report.*` - Report generation events
- `nav.*` - Navigation events
- `user.*` - User authentication events
- `error.*` - Error tracking events
- `feature.*` - Feature usage events

**Database Migration:** None required

---

## Additional Improvements

### Migration Runner

**New File:** `tools/run_migrations.php`

A utility to run SQL migrations in order:

```bash
php tools/run_migrations.php
```

Features:
- Tracks applied migrations in `_migrations` table
- Runs migrations in numeric order (001_, 002_, etc.)
- Stops on first error to prevent partial migrations
- Safe to run multiple times (idempotent)

### Configuration Updates

**File:** `api/config.sample.php`

Changes:
- Increased `max_upload_mb` from 25 to 128
- Added `csrf_enabled` option (default: `true`)
- Added documentation comments for PHP/nginx upload limits

---

## Deployment Checklist

### Before Deploying

- [ ] Run database migrations: `php tools/run_migrations.php`
- [ ] Update `api/config.php` with `csrf_enabled => true`
- [ ] Update PHP settings:
  - `upload_max_filesize = 128M`
  - `post_max_size = 128M`
- [ ] Update nginx config (if applicable):
  - `client_max_body_size 128M;`

### Frontend Updates Required

Add CSRF token handling to your frontend JavaScript:

```javascript
// app/app.js or similar entry point
let csrfToken = null;

async function getCsrfToken() {
  if (csrfToken) return csrfToken;
  const res = await fetch('/api/get_csrf_token.php', { credentials: 'same-origin' });
  const data = await res.json();
  csrfToken = data.csrf_token;
  return csrfToken;
}

// Wrap fetch to include CSRF token for state-changing requests
const originalFetch = window.fetch;
window.fetch = async function(url, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
    const token = await getCsrfToken();
    options.headers = {
      ...options.headers,
      'X-CSRF-Token': token
    };
  }
  
  return originalFetch(url, options);
};
```

---

## Security Best Practices Going Forward

1. **Always validate input** - Never trust client-side data
2. **Use prepared statements** - Prevents SQL injection
3. **Validate file paths** - Prevent directory traversal
4. **Enable CSRF protection** - Protect state-changing operations
5. **Log security events** - Monitor for attack attempts
6. **Keep dependencies updated** - Regular security patches
7. **Use HTTPS** - Encrypt all traffic in production

---

## Reporting Security Issues

If you discover a security vulnerability, please report it privately before disclosing publicly.

**Contact:** [Your contact information]

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 22/02/2026 | Initial security fixes: CSRF, path traversal, race condition, input validation |
