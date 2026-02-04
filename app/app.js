/* app/app.js - App bootstrap, PWA setup, and iOS install banner (04/02/2026) */

window.addEventListener('DOMContentLoaded', async () => {
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
