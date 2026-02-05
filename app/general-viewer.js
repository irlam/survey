/* app/general-viewer.js - Simple PDF list + viewer bindings (02/05/2026) */
(function initGeneralViewer(){
  const listEl = document.getElementById('generalList');
  const form = document.getElementById('generalUploadForm');
  const outEl = document.getElementById('generalUploadOut');
  const fileInput = form ? form.querySelector('input[name="file"]') : null;
  const netDot = document.getElementById('netDot');
  const menuBtn = document.getElementById('menuBtn');
  const newFolderBtn = document.getElementById('generalNewFolderBtn');
  const upBtn = document.getElementById('generalUpBtn');
  const breadcrumbEl = document.getElementById('generalBreadcrumb');
  let currentFolderId = null;

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

  async function apiPost(url, body){
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      credentials: 'same-origin'
    });
    const data = await res.json().catch(() => null);
    if (!data || data.ok !== true) throw new Error((data && data.error) || 'Request failed');
    return data;
  }

  function renderBreadcrumb(crumbs){
    if (!breadcrumbEl) return;
    const items = Array.isArray(crumbs) ? crumbs : [];
    const parts = [];
    parts.push({ id: null, name: 'Root' });
    for (const c of items) parts.push({ id: c.id, name: c.name });
    breadcrumbEl.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.flexWrap = 'wrap';
    wrap.style.gap = '6px';
    parts.forEach((p, idx) => {
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.type = 'button';
      btn.textContent = p.name;
      btn.onclick = () => {
        currentFolderId = p.id || null;
        refreshList();
      };
      wrap.appendChild(btn);
      if (idx < parts.length - 1) {
        const sep = document.createElement('span');
        sep.textContent = '/';
        sep.style.opacity = '0.6';
        wrap.appendChild(sep);
      }
    });
    breadcrumbEl.appendChild(wrap);
  }

  async function refreshList(){
    if (!listEl) return;
    listEl.setAttribute('aria-busy', 'true');
    listEl.innerHTML = '<div class="muted">Loading PDFs…</div>';
    try{
      const qs = currentFolderId ? `?folder_id=${encodeURIComponent(currentFolderId)}` : '';
      const res = await fetch(`/api/list_generic_pdfs.php${qs}`, { credentials: 'same-origin' });
      const data = await res.json();
      if (!data || data.ok !== true) throw new Error((data && data.error) || 'Failed to load PDFs');
      const folders = Array.isArray(data.folders) ? data.folders : [];
      const files = Array.isArray(data.files) ? data.files : [];
      renderBreadcrumb(data.breadcrumbs || []);
      if (upBtn) upBtn.style.display = (currentFolderId ? 'inline-flex' : 'none');
      if (!folders.length && !files.length) {
        listEl.innerHTML = '<div class="muted">No items yet. Upload a PDF or create a folder.</div>';
        listEl.setAttribute('aria-busy', 'false');
        return;
      }
      listEl.innerHTML = '';
      for (const f of folders) {
        const row = document.createElement('div');
        row.className = 'planRow';
        row.setAttribute('role', 'listitem');
        const meta = document.createElement('div');
        meta.className = 'planMeta';
        const name = document.createElement('div');
        name.className = 'planName';
        name.textContent = f.name || 'Folder';
        const sub = document.createElement('div');
        sub.className = 'planSub';
        sub.textContent = f.created_at ? `Created ${f.created_at}` : 'Folder';
        meta.appendChild(name);
        meta.appendChild(sub);
        const btnRow = document.createElement('div');
        btnRow.style.display = 'flex';
        btnRow.style.gap = '6px';
        const openBtn = document.createElement('button');
        openBtn.className = 'btn';
        openBtn.type = 'button';
        openBtn.textContent = 'Open';
        openBtn.onclick = () => { currentFolderId = f.id; refreshList(); };
        const renameBtn = document.createElement('button');
        renameBtn.className = 'btn';
        renameBtn.type = 'button';
        renameBtn.textContent = 'Rename';
        renameBtn.onclick = async () => {
          const next = window.prompt('Folder name', f.name || '');
          if (!next) return;
          try{ await apiPost('/api/rename_pdf_folder.php', { id: f.id, name: next }); refreshList(); }
          catch(e){ showToast(e.message || 'Rename failed'); }
        };
        const delBtn = document.createElement('button');
        delBtn.className = 'btn';
        delBtn.type = 'button';
        delBtn.textContent = 'Delete';
        delBtn.onclick = async () => {
          if (!window.confirm('Delete this folder and its contents?')) return;
          try{ await apiPost('/api/delete_pdf_folder.php', { id: f.id }); refreshList(); }
          catch(e){ showToast(e.message || 'Delete failed'); }
        };
        btnRow.appendChild(openBtn);
        btnRow.appendChild(renameBtn);
        btnRow.appendChild(delBtn);
        row.appendChild(meta);
        row.appendChild(btnRow);
        listEl.appendChild(row);
      }
      for (const f of files) {
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
        const btnRow = document.createElement('div');
        btnRow.style.display = 'flex';
        btnRow.style.gap = '6px';
        const openBtn = document.createElement('button');
        openBtn.className = 'btn';
        openBtn.type = 'button';
        openBtn.textContent = 'Open';
        openBtn.onclick = () => {
          if (window.openPdfUrlInApp) {
            window.openPdfUrlInApp(f.url, f.original_name || 'PDF Viewer');
          } else {
            window.open(f.url, '_blank');
          }
        };
        const renameBtn = document.createElement('button');
        renameBtn.className = 'btn';
        renameBtn.type = 'button';
        renameBtn.textContent = 'Rename';
        renameBtn.onclick = async () => {
          const next = window.prompt('PDF name', f.original_name || '');
          if (!next) return;
          try{ await apiPost('/api/rename_generic_pdf.php', { id: f.id, name: next }); refreshList(); }
          catch(e){ showToast(e.message || 'Rename failed'); }
        };
        const delBtn = document.createElement('button');
        delBtn.className = 'btn';
        delBtn.type = 'button';
        delBtn.textContent = 'Delete';
        delBtn.onclick = async () => {
          if (!window.confirm('Delete this PDF?')) return;
          try{ await apiPost('/api/delete_generic_pdf.php', { id: f.id }); refreshList(); }
          catch(e){ showToast(e.message || 'Delete failed'); }
        };
        btnRow.appendChild(openBtn);
        btnRow.appendChild(renameBtn);
        btnRow.appendChild(delBtn);
        row.appendChild(meta);
        row.appendChild(btnRow);
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
      if (currentFolderId) fd.append('folder_id', String(currentFolderId));
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
  if (newFolderBtn) newFolderBtn.onclick = async () => {
    const name = window.prompt('Folder name');
    if (!name) return;
    try{ await apiPost('/api/create_pdf_folder.php', { name, parent_id: currentFolderId }); refreshList(); }
    catch(e){ showToast(e.message || 'Create folder failed'); }
  };
  if (upBtn) upBtn.onclick = async () => {
    const res = await fetch(`/api/list_generic_pdfs.php?folder_id=${encodeURIComponent(currentFolderId)}`, { credentials: 'same-origin' });
    const data = await res.json().catch(()=>null);
    if (data && Array.isArray(data.breadcrumbs) && data.breadcrumbs.length > 1) {
      const parent = data.breadcrumbs[data.breadcrumbs.length - 2];
      currentFolderId = parent.id;
    } else {
      currentFolderId = null;
    }
    refreshList();
  };
  if (form) form.addEventListener('submit', handleUpload);
  refreshList();
})();
