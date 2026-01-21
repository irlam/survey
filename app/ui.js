


function $(sel) { return document.querySelector(sel); }

async function apiJson(url, opts) {
  const r = await fetch(url, opts);
  const data = await r.json().catch(() => null);
  if (!data || data.ok !== true) throw new Error((data && data.error) ? data.error : `Request failed: ${url}`);
  return data;
}

function setNetDot() {
  const dot = $('#netDot');
  if (!dot) return;
  dot.classList.toggle('online', navigator.onLine);
  dot.title = navigator.onLine ? 'Online' : 'Offline';
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (m) => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[m]));
}

function planRow(plan) {
  const li = document.createElement('div');
  li.className = 'planRow';

  const left = document.createElement('div');
  left.className = 'planMeta';
  left.innerHTML = `
    <div class="planName">${escapeHtml(plan.name || ('Plan #' + plan.id))}</div>
    <div class="planSub">${escapeHtml(plan.revision || '')} <span class="muted">#${plan.id}</span></div>
  `;

  const btn = document.createElement('button');
  btn.className = 'btn';
  btn.textContent = 'Open';
  btn.onclick = async () => {
    if (window.openPlanInApp) {
      await window.openPlanInApp(plan.id);
    } else {
      alert('Viewer not loaded');
    }
  };

  li.appendChild(left);
  li.appendChild(btn);
  return li;
}

async function refreshPlans() {
  const box = $('#plansList');
  if (!box) return;
  box.innerHTML = '<div class="muted">Loading plans…</div>';

  try {
    const data = await apiJson('/api/list_plans.php');
    box.innerHTML = '';
    if (!data.plans.length) {
      box.innerHTML = '<div class="muted">No plans yet. Upload one.</div>';
      return;
    }
    data.plans.forEach(p => box.appendChild(planRow(p)));
  } catch (e) {
    box.innerHTML = `<div class="error">Failed to load plans: ${escapeHtml(e.message)}</div>`;
  }
}

async function wireUpload() {
  const form = $('#uploadForm');
  const out = $('#uploadOut');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    out.textContent = 'Uploading…';

    const fd = new FormData(form);
    const r = await fetch('/api/upload_plan.php', { method: 'POST', body: fd });
    const txt = await r.text();
    let data;
    try { data = JSON.parse(txt); } catch { data = { ok:false, error: txt }; }

    if (!r.ok || !data.ok) {
      out.textContent = `Upload failed (HTTP ${r.status}): ${data.error || 'Unknown error'}`;
      return;
    }

    out.textContent = `Uploaded: ${data.plan?.name || 'OK'}`;
    form.reset();
    await refreshPlans();
  });
}

async function renderPlansScreen() {
  setNetDot();
  window.addEventListener('online', setNetDot);
  window.addEventListener('offline', setNetDot);

  const menuBtn = $('#menuBtn');
  if (menuBtn) menuBtn.onclick = () => document.body.classList.toggle('sidebar-open');
  await wireUpload();
  await refreshPlans();
}
window.renderPlansScreen = renderPlansScreen;
}
