


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

// --- Issues Modal Logic ---
function showIssuesModal(planId) {
  const modal = document.getElementById('issuesModal');
  const closeBtn = document.getElementById('closeIssuesModal');
  const issuesList = document.getElementById('issuesList');
  const pdfBtn = document.getElementById('btnGeneratePdf');
  const pdfOut = document.getElementById('pdfReportOut');
  if (!modal || !closeBtn || !issuesList || !pdfBtn || !pdfOut) return;

  modal.style.display = 'block';
  issuesList.innerHTML = '<div class="muted">Loading…</div>';
  pdfOut.textContent = '';

  fetch(`/api/list_issues.php?plan_id=${encodeURIComponent(planId)}`)
    .then(r => r.json())
    .then(async (data) => {
      if (!data.ok) throw new Error(data.error || 'Failed to load issues');
      if (!data.issues.length) {
        issuesList.innerHTML = '<div class="muted">No issues for this plan.</div>';
        return;
      }
      // build enhanced list
      issuesList.innerHTML = '';
      const container = document.createElement('div');
      container.style.display = 'flex';
      container.style.flexDirection = 'column';
      container.style.gap = '8px';

      for (const issue of data.issues) {
        const item = document.createElement('div');
        item.className = 'card';
        item.style.display = 'flex';
        item.style.alignItems = 'center';
        item.style.justifyContent = 'space-between';

        const left = document.createElement('div');
        left.style.flex = '1';
        left.innerHTML = `
          <div style="font-weight:800;">${escapeHtml(issue.title || ('Issue #' + issue.id))}</div>
          <div style="font-size:13px;color:var(--muted);margin-top:4px;">${escapeHtml(issue.notes||issue.description||'')}</div>
          <div style="margin-top:6px;font-size:13px;color:var(--muted);">
            <strong>ID:</strong> ${escapeHtml(String(issue.id||''))} &nbsp; 
            <strong>Page:</strong> ${escapeHtml(String(issue.page||''))} &nbsp; 
            <strong>Coords:</strong> ${issue.x_norm!=null ? (Math.round(issue.x_norm*1000)/1000) : ''}, ${issue.y_norm!=null ? (Math.round(issue.y_norm*1000)/1000) : ''}
          </div>
        `;

        const right = document.createElement('div');
        right.style.display = 'flex';
        right.style.flexDirection = 'column';
        right.style.alignItems = 'flex-end';
        right.style.gap = '6px';

        // status / priority / assignee
        const metaRow = document.createElement('div');
        metaRow.style.display = 'flex'; metaRow.style.gap = '8px'; metaRow.style.alignItems = 'center';
        const status = document.createElement('span'); status.className = 'pill'; status.textContent = issue.status || 'open'; status.style.fontSize = '12px';
        const prio = document.createElement('span'); prio.textContent = (issue.priority || ''); prio.style.fontSize = '12px'; prio.className = 'muted';
        metaRow.appendChild(status); metaRow.appendChild(prio);

        const createdDiv = document.createElement('div'); createdDiv.style.fontSize = '12px'; createdDiv.style.color = 'var(--muted)';
        if (issue.created_at) {
          const d = new Date(issue.created_at);
          const pad = (n) => n.toString().padStart(2,'0');
          createdDiv.textContent = `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}` + (issue.created_by ? (' — ' + issue.created_by) : '');
        } else if (issue.created_by) {
          createdDiv.textContent = issue.created_by;
        }

        const btnRow = document.createElement('div'); btnRow.style.display='flex'; btnRow.style.gap='8px';
        const viewBtn = document.createElement('button'); viewBtn.className='btn'; viewBtn.textContent='View';
        viewBtn.onclick = ()=>{ try{ if(window.showIssueModal) window.showIssueModal(issue); else alert('Viewer not loaded'); }catch(e){ console.error(e); alert('Unable to open issue'); } };
        const jumpBtn = document.createElement('button'); jumpBtn.className='btn'; jumpBtn.textContent='Jump to page';
        jumpBtn.onclick = ()=>{ try{ if(window.startViewer){ // ensure viewer loaded
            // set plan id in URL then start viewer; viewer will render page where user can navigate
            const u = new URL(window.location.href); u.searchParams.set('plan_id', String(planId)); history.pushState({},'',u.toString()); if(window.startViewer) window.startViewer().then(()=>{ try{ if(window.currentPage!==undefined){ /* best-effort */ } }catch(e){} });
          } }catch(e){ console.error(e); } };

        btnRow.appendChild(viewBtn); btnRow.appendChild(jumpBtn);

        right.appendChild(metaRow); right.appendChild(createdDiv); right.appendChild(btnRow);

        item.appendChild(left); item.appendChild(right);
        container.appendChild(item);
      }

      issuesList.appendChild(container);
    })
    .catch(e => {
      issuesList.innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
    });

  closeBtn.onclick = () => { modal.style.display = 'none'; };
  window.onclick = (event) => { if (event.target === modal) modal.style.display = 'none'; };

  pdfBtn.onclick = () => {
    pdfOut.textContent = 'Generating PDF…';
    fetch('/api/export_report.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `plan_id=${encodeURIComponent(planId)}`
    })
      .then(r => r.json())
      .then(data => {
        if (!data.ok) throw new Error(data.error || 'Failed to generate PDF');
        pdfOut.innerHTML = `<a href="/storage/exports/${encodeURIComponent(data.filename)}" target="_blank">Download PDF Report</a>`;
      })
      .catch(e => {
        pdfOut.textContent = e.message;
      });
  };
}

// Attach View Issues button logic after plan is opened
function wireViewIssues(planId) {
  const btn = document.getElementById('btnViewIssues');
  if (btn) {
    btn.onclick = () => showIssuesModal(planId);
  }
}

// Attempt to wrap the global `openPlanInApp` when it becomes available
(function waitAndWire(){
  function tryWrap(){
    if (window.openPlanInApp && !window.__viewIssuesPatched){
      const orig = window.openPlanInApp;
      window.openPlanInApp = async function(planId){
        await orig(planId);
        try { wireViewIssues(planId); } catch(e) { console.error('wireViewIssues error', e); }
      };
      window.__viewIssuesPatched = true;
      return true;
    }
    return false;
  }
  if (!tryWrap()){
    const iv = setInterval(()=>{ if (tryWrap()) clearInterval(iv); }, 200);
  }
})();

// Listen for planOpened events (fired by viewer) and wire View Issues button
document.addEventListener('planOpened', (e) => {
  try {
    const planId = e?.detail?.planId;
    if (planId) wireViewIssues(planId);
  } catch (err) { console.error('planOpened handler error', err); }
});
