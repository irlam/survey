window.addEventListener('DOMContentLoaded', async () => {
  if (window.renderPlansScreen) await window.renderPlansScreen();
  if (window.startViewer) await window.startViewer(); // binds Add Issue, and loads PDF if ?plan_id= exists
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
