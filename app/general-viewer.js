/* app/general-viewer.js - Simple PDF list + viewer bindings (02/05/2026) */
(function initGeneralViewer(){
  const listEl = document.getElementById('generalList');
  const form = document.getElementById('generalUploadForm');
  const outEl = document.getElementById('generalUploadOut');
  const fileInput = form ? form.querySelector('input[name="file"]') : null;
  const netDot = document.getElementById('netDot');
  const menuBtn = document.getElementById('menuBtn');

  function setNetDot(){
    if (!netDot) return;
    netDot.classList.toggle('online', navigator.onLine);
    netDot.title = navigator.onLine ? 'Online' : 'Offline';
  }

  function showToast(msg, timeout){
    const t = timeout || 2200;
    let stack = document.getElementById('toastStack');
    if (!stack) {
      stack = document.createElement('div');
      stack.id = 'toastStack';
      stack.setAttribute('role','status');
      stack.setAttribute('aria-live','polite');
      stack.style.position = 'fixed';
      stack.style.right = '20px';
      stack.style.bottom = '20px';
      stack.style.zIndex = 999999;
      stack.style.display = 'flex';
      stack.style.flexDirection = 'column';
      stack.style.gap = '8px';
      stack.style.pointerEvents = 'none';
      document.body.appendChild(stack);
    }
    const el = document.createElement('div');
    el.textContent = msg;
    el.style.background='rgba(0,0,0,0.8)';
    el.style.color='#fff';
    el.style.padding='10px 14px';
    el.style.borderRadius='8px';
    el.style.boxShadow='0 6px 18px rgba(0,0,0,.4)';
    el.style.pointerEvents = 'auto';
    stack.appendChild(el);
    while (stack.children.length > 3) {
      try{ stack.removeChild(stack.firstChild); }catch(e){ break; }
    }
    const timer = setTimeout(()=>{ try{ el.remove(); }catch(e){} }, t);
    el.addEventListener('click', ()=>{ clearTimeout(timer); try{ el.remove(); }catch(e){} });
  }

  function fmtSize(bytes){
    const n = Number(bytes || 0);
    if (!n) return '0 KB';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function refreshList(){
    if (!listEl) return;
    listEl.setAttribute('aria-busy', 'true');
    listEl.innerHTML = '<div class="muted">Loading PDFs…</div>';
    try{
      const res = await fetch('/api/list_generic_pdfs.php', { credentials: 'same-origin' });
      const data = await res.json();
      if (!data || data.ok !== true) throw new Error((data && data.error) || 'Failed to load PDFs');
      const items = Array.isArray(data.files) ? data.files : [];
      if (!items.length) {
        listEl.innerHTML = '<div class="muted">No PDFs yet. Upload one.</div>';
        listEl.setAttribute('aria-busy', 'false');
        return;
      }
      listEl.innerHTML = '';
      for (const f of items) {
        const row = document.createElement('div');
        row.className = 'planRow';
        row.setAttribute('role', 'listitem');
        const meta = document.createElement('div');
        meta.className = 'planMeta';
        const name = document.createElement('div');
        name.className = 'planName';
        name.textContent = f.original_name || `PDF #${f.id}`;
        const sub = document.createElement('div');
        sub.className = 'planSub';
        const created = f.created_at ? ` · ${f.created_at}` : '';
        sub.textContent = `${fmtSize(f.size)}${created}`;
        meta.appendChild(name);
        meta.appendChild(sub);
        const btn = document.createElement('button');
        btn.className = 'btn';
        btn.type = 'button';
        btn.textContent = 'Open';
        btn.onclick = () => {
          if (window.openPdfUrlInApp) {
            window.openPdfUrlInApp(f.url, f.original_name || 'PDF Viewer');
          } else {
            window.open(f.url, '_blank');
          }
        };
        row.appendChild(meta);
        row.appendChild(btn);
        listEl.appendChild(row);
      }
      listEl.setAttribute('aria-busy', 'false');
    }catch(e){
      listEl.innerHTML = `<div class="error">${e.message || 'Failed to load PDFs'}</div>`;
      listEl.setAttribute('aria-busy', 'false');
    }
  }

  async function handleUpload(e){
    e.preventDefault();
    if (!fileInput || !fileInput.files || !fileInput.files[0]) {
      showToast('Select a PDF to upload');
      return;
    }
    const btn = form ? form.querySelector('button[type="submit"]') : null;
    if (btn) btn.disabled = true;
    if (outEl) outEl.textContent = 'Uploading…';
    try{
      const fd = new FormData();
      fd.append('file', fileInput.files[0]);
      const res = await fetch('/api/upload_generic_pdf.php', { method: 'POST', body: fd, credentials: 'same-origin' });
      const data = await res.json();
      if (!data || data.ok !== true) throw new Error((data && data.error) || 'Upload failed');
      if (outEl) outEl.textContent = 'Uploaded.';
      fileInput.value = '';
      await refreshList();
    }catch(e){
      if (outEl) outEl.textContent = '';
      showToast(e.message || 'Upload failed');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  window.addEventListener('online', setNetDot);
  window.addEventListener('offline', setNetDot);
  setNetDot();
  if (menuBtn) menuBtn.onclick = () => document.body.classList.toggle('sidebar-open');
  if (form) form.addEventListener('submit', handleUpload);
  refreshList();
})();
