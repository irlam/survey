/* app/app.js - App bootstrap, PWA setup, and iOS install banner (04/02/2026) */

// CSRF token management
window.__csrfToken = null;
window.__csrfInitialized = false;

async function initCSRF() {
  if (window.__csrfInitialized) return;
  window.__csrfInitialized = true;
  
  try {
    const res = await fetch('/api/get_csrf_token.php', { credentials: 'same-origin' });
    if (!res.ok) {
      console.warn('[CSRF] Failed to fetch token, HTTP', res.status);
      return;
    }
    const data = await res.json();
    window.__csrfToken = data.csrf_token;
    if (window.__csrfToken) {
      console.log('[CSRF] Token initialized');
    } else {
      console.warn('[CSRF] Server returned null token (CSRF may be disabled)');
    }
  } catch (e) {
    console.warn('[CSRF] Failed to fetch token', e);
  }
}

// Wrap fetch to include CSRF token for state-changing requests
(function wrapFetchForCSRF() {
  if (!window.fetch) return;
  const originalFetch = window.fetch;
  
  window.fetch = async function(url, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    
    // Include CSRF token for state-changing requests
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
      if (!window.__csrfInitialized) {
        await initCSRF();
      }
      if (window.__csrfToken) {
        options.headers = {
          ...options.headers,
          'X-CSRF-Token': window.__csrfToken
        };
      }
    }
    
    return originalFetch(url, options);
  };
})();

window.addEventListener('DOMContentLoaded', async () => {
  // Initialize CSRF token early
  await initCSRF();
  
  if (window.renderPlansScreen) await window.renderPlansScreen();
  if (window.startViewer) {
    // Bind Add Issue UI and load PDF if ?plan_id= exists.
    await window.startViewer();
  }
});

// PWA: service worker registration + install prompt UI
(function initPwa(){
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch((err) => {
      console.warn('Service worker registration failed', err);
    });
  });

  let deferredPrompt = null;
  const installBtn = () => document.getElementById('installPwaBtn');
  const isStandalone = () => (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const btn = installBtn();
    if (btn && !isStandalone()) btn.style.display = 'inline-flex';
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    const btn = installBtn();
    if (btn) btn.style.display = 'none';
  });

  document.addEventListener('DOMContentLoaded', () => {
    const btn = installBtn();
    if (!btn) return;
    if (isStandalone()) btn.style.display = 'none';
    btn.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      btn.disabled = true;
      try {
        deferredPrompt.prompt();
        await deferredPrompt.userChoice;
      } finally {
        deferredPrompt = null;
        btn.disabled = false;
        btn.style.display = 'none';
      }
    });
  });
})();

// iOS install banner (Safari doesn't fire beforeinstallprompt)
(function initIosInstallBanner(){
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent || '');
  const isStandalone = window.navigator.standalone === true;
  if (!isIos || isStandalone) return;

  const dismissed = localStorage.getItem('iosInstallDismissed');
  const banner = document.getElementById('iosInstallBanner');
  const closeBtn = document.getElementById('iosBannerClose');
  if (!banner || !closeBtn) return;

  if (!dismissed) banner.style.display = 'flex';
  closeBtn.addEventListener('click', () => {
    banner.style.display = 'none';
    try { localStorage.setItem('iosInstallDismissed', '1'); } catch (e) {}
  });
})();
