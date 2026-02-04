/* app/router.js - Lightweight query helpers and auto-viewer boot (04/02/2026) */

export function getQuery(key) {
  const params = new URLSearchParams(window.location.search);
  return params.get(key);
}

// Auto-load viewer if plan_id is present in the URL
if (window.location.search.includes('plan_id=')) {
  // Viewer is loaded as a non-module script from index.html; call startViewer when available.
  if (window.startViewer) {
    window.startViewer();
  } else {
    window.addEventListener('DOMContentLoaded', () => {
      if (window.startViewer) window.startViewer();
    });
  }
}
