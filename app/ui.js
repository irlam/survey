// app/ui.js — Milestone 2: Plans library + open viewer stub (PDF.js wiring can be added in viewer.js)
// Assumes these endpoints exist:
// - GET  /api/list_plans.php
// - POST /api/upload_plan.php (multipart/form-data)
// - GET  /api/get_plan.php?plan_id=123 (should return pdf_url OR plan.pdf_url)

function $(id) { return document.getElementById(id); }

function setViewerOpen(isOpen) {
  if (typeof window.setViewerOpen === 'function') window.setViewerOpen(isOpen);
  document.body.classList.toggle('viewer-open', !!isOpen);
}

function toast(msg, ms) {
  if (typeof window.toast === 'function') return window.toast(msg, ms);
  console.log(msg);
}

async function apiGet(url) {
  const r = await fetch(url, { credentials: 'same-origin' });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.ok === false) {
    throw new Error(data.error || `Request failed (${r.status})`);
  }
  return data;
}

async function apiPostForm(url, formData) {
  const r = await fetch(url, { method: 'POST', body: formData, credentials: 'same-origin' });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.ok === false) {
    throw new Error(data.error || `Request failed (${r.status})`);
  }
  return data;
}

function fmtDate(dt) {
  if (!dt) return '';
  // expected: "YYYY-MM-DD HH:MM:SS"
  return String(dt).slice(0, 16);
}

function plansListItem(plan) {
  const li = document.createElement('li');
  li.className = 'list-item';

  const left = document.createElement('div');
  left.style.display = 'flex';
  left.style.flexDirection = 'column';
  left.style.gap = '4px';

  const title = document.createElement('a');
  title.href = `/?plan_id=${encodeURIComponent(plan.id)}`;
  title.textContent = plan.name || `Plan #${plan.id}`;
  title.addEventListener('click', (e) => {
    e.preventDefault();
    openPlan(plan.id);
  });

  const meta = document.createElement('div');
  meta.className = 'meta';
  const rev = plan.revision ? `Rev ${plan.revision}` : 'No rev';
  meta.textContent = `${rev} • ${fmtDate(plan.created_at)}`;

  left.appendChild(title);
  left.appendChild(meta);

  const right = document.createElement('div');
  right.style.display = 'flex';
  right.style.gap = '8px';

  const openBtn = document.createElement('button');
  openBtn.className = 'btn btn-primary';
  openBtn.type = 'button';
  openBtn.textContent = 'Open';
  openBtn.addEventListener('click', () => openPlan(plan.id));

  right.appendChild(openBtn);

  li.appendChild(left);
  li.appendChild(right);
  return li;
}

async function refreshPlans() {
  const listEl = $('plansList');
  const countEl = $('plansCount');

  listEl.innerHTML = '';
  countEl.textContent = '…';

  const data = await apiGet('/api/list_plans.php');
  const plans = data.plans || [];

  countEl.textContent = String(plans.length);

  if (plans.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'list-item';
    empty.innerHTML = `<div class="meta">No plans yet. Upload a PDF above.</div>`;
    listEl.appendChild(empty);
    return;
  }

  for (const p of plans) {
    listEl.appendChild(plansListItem(p));
  }
}

function showViewerUI(show) {
  const viewerCard = $('viewerCard');
  viewerCard.style.display = show ? '' : 'none';
  setViewerOpen(show);
}

function bindCloseButtons() {
  const closeBtn = $('closeViewerBtn');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      showViewerUI(false);
      toast('Viewer closed', 1200);
    });
  }

  const railClose = document.getElementById('railCloseViewer');
  if (railClose) {
    railClose.addEventListener('click', () => showViewerUI(false));
  }
}

async function openPlan(planId) {
  try {
    const data = await apiGet(`/api/get_plan.php?plan_id=${encodeURIComponent(planId)}`);
    const plan = data.plan;

    $('viewerTitle').textContent = plan?.name ? plan.name : `Plan #${planId}`;
    $('viewerMeta').textContent =
      `${plan?.revision ? `Revision: ${plan.revision} • ` : ''}${plan?.created_at ? `Uploaded: ${fmtDate(plan.created_at)}` : ''}`;

    // pdf_url can be returned as top-level or inside plan
    const pdfUrl = data.pdf_url || plan?.pdf_url || '(missing pdf_url)';

    // Reset viewer placeholders (real PDF.js wiring comes next in viewer.js)
    $('pageBadge').textContent = 'Page 1 / 1';
    $('pageInput').value = '1';
    $('zoomBadge').textContent = '100%';
    $('pdfContainer').innerHTML = `
      <div class="card" style="margin:12px;">
        <div class="meta">Viewer stub ready. Next step: wire PDF.js render in <code>/app/viewer.js</code> using <code>pdf_url</code> from the API.</div>
        <div class="meta" style="margin-top:8px;">PDF URL: <span class="badge cyan">${pdfUrl}</span></div>
      </div>
    `;

    showViewerUI(true);
    toast('Plan opened', 1200);
  } catch (e) {
    console.error(e);
    toast(e.message || 'Failed to open plan');
  }
}

function bindUpload() {
  const form = $('uploadForm');
  const fileInput = $('planFile');
  const nameInput = $('planName');
  const revInput = $('planRev');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!fileInput.files || fileInput.files.length === 0) {
      toast('Choose a PDF first');
      return;
    }

    const fd = new FormData();
    fd.append('file', fileInput.files[0]);
    if (nameInput.value.trim()) fd.append('name', nameInput.value.trim());
    if (revInput.value.trim()) fd.append('revision', revInput.value.trim());

    const btn = $('uploadBtn');
    btn.disabled = true;
    btn.textContent = 'Uploading…';

    try {
      await apiPostForm('/api/upload_plan.php', fd);
      toast('Uploaded', 1200);
      form.reset();
      await refreshPlans();
    } catch (err) {
      console.error(err);
      toast(err.message || 'Upload failed');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Upload plan';
    }
  });
}

function bindRefresh() {
  const btn = $('refreshBtn');
  btn.addEventListener('click', async () => {
    try {
      btn.disabled = true;
      btn.textContent = 'Refreshing…';
      await refreshPlans();
      toast('Refreshed', 900);
    } catch (e) {
      console.error(e);
      toast(e.message || 'Refresh failed');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Refresh';
    }
  });
}

export function renderPlansScreen() {
  bindUpload();
  bindRefresh();
  bindCloseButtons();

  const params = new URLSearchParams(location.search);
  const pid = params.get('plan_id');
  if (pid) {
    openPlan(pid);
  } else {
    showViewerUI(false);
  }

  refreshPlans().catch(err => {
    console.error(err);
    toast(err.message || 'Failed to load plans');
  });
}
