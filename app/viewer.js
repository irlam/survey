// Minimal PDF.js viewer logic for Milestone 2
import { getQuery } from './router.js';

const planId = getQuery('plan_id');
if (!planId) {
	document.getElementById('app').innerHTML = '<p>No plan_id specified.</p>';
} else {
	renderViewer(planId);
}

function renderViewer(planId) {
	const app = document.getElementById('app');
	app.innerHTML = `
		<div style="display:flex;align-items:center;gap:8px;">
			<button id="prev" style="min-width:44px;min-height:44px;">◀</button>
			<span id="pageNum">1</span>/<span id="pageCount">?</span>
			<button id="next" style="min-width:44px;min-height:44px;">▶</button>
			<button id="zoomIn" style="min-width:44px;min-height:44px;">＋</button>
			<button id="zoomOut" style="min-width:44px;min-height:44px;">－</button>
		</div>
		<div id="pdfContainer" style="touch-action:pan-x pan-y;overflow:auto;width:100vw;height:80vh;background:#232347;position:relative;"></div>
		<div id="overlay" style="position:absolute;top:0;left:0;width:100vw;height:80vh;pointer-events:none;"></div>
		<div style="margin-top:8px;">
			<label><input type="checkbox" id="addIssueToggle"> Add Issue</label>
		</div>
	`;
	loadPDF(planId);
	window.addIssueMode = false;
	document.getElementById('addIssueToggle').onchange = (e) => {
		window.addIssueMode = e.target.checked;
		document.getElementById('overlay').style.pointerEvents = window.addIssueMode ? 'auto' : 'none';
	};
}

async function loadPDF(planId) {
	// Load PDF.js dynamically
	if (!window.pdfjsLib) {
		const script = document.createElement('script');
		script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.67/pdf.min.js';
		script.onload = () => showPDF(planId);
		document.body.appendChild(script);
	} else {
		showPDF(planId);
	}
}

function showPDF(planId) {
	const url = `/api/plan_file.php?plan_id=${planId}`;
	const container = document.getElementById('pdfContainer');
	window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.67/pdf.worker.min.js';
	let pdfDoc = null, pageNum = 1, pageCount = 1, scale = 1.2;

	window.pdfjsLib.getDocument(url).promise.then(function(pdf) {
		pdfDoc = pdf;
		pageCount = pdf.numPages;
		document.getElementById('pageCount').textContent = pageCount;
		renderPage(pageNum);
	});

	function renderPage(num) {
		pdfDoc.getPage(num).then(function(page) {
			const viewport = page.getViewport({ scale });
			const canvas = document.createElement('canvas');
			const ctx = canvas.getContext('2d');
			canvas.height = viewport.height;
			canvas.width = viewport.width;
			container.innerHTML = '';
			container.appendChild(canvas);
			page.render({ canvasContext: ctx, viewport }).promise.then(() => {
				document.getElementById('pageNum').textContent = num;
				renderOverlay(num, viewport.width, viewport.height);
			});
			// Overlay click for pin placement
			const overlay = document.getElementById('overlay');
			overlay.style.width = canvas.style.width;
			overlay.style.height = canvas.style.height;
			overlay.onclick = (e) => {
				if (!window.addIssueMode) return;
				const rect = overlay.getBoundingClientRect();
				const x = (e.clientX - rect.left) / rect.width;
				const y = (e.clientY - rect.top) / rect.height;
				openIssueDrawer({ x_norm: x, y_norm: y, page: num });
			};
		});
	}

	async function renderOverlay(pageNum, w, h) {
		const overlay = document.getElementById('overlay');
		overlay.innerHTML = '';
		overlay.style.width = w + 'px';
		overlay.style.height = h + 'px';
		// Fetch issues for this plan
		const res = await fetch(`/api/list_issues.php?plan_id=${planId}`);
		if (!res.ok) return;
		const data = await res.json();
		for (const issue of data.issues) {
			if (issue.page !== pageNum) continue;
			const pin = document.createElement('div');
			pin.style.position = 'absolute';
			pin.style.left = (issue.x_norm * w - 22) + 'px';
			pin.style.top = (issue.y_norm * h - 22) + 'px';
			pin.style.width = '44px';
			pin.style.height = '44px';
			pin.style.background = '#00ffe7';
			pin.style.borderRadius = '50%';
			pin.style.boxShadow = '0 0 8px #00ffe7';
			pin.style.opacity = '0.8';
			pin.title = issue.title;
			pin.style.pointerEvents = 'auto';
			pin.onclick = () => openIssueDrawer(issue);
			overlay.appendChild(pin);
		}
	}

	function openIssueDrawer(issue) {
		// Minimal drawer for editing/creating issues
		const app = document.getElementById('app');
		app.insertAdjacentHTML('beforeend', `
			<div id="issueDrawer" style="position:fixed;bottom:0;left:0;width:100vw;background:#232347;color:#00ffe7;padding:1em;box-shadow:0 -2px 16px #00ffe7;z-index:10;">
				<form id="issueForm">
					<input type="text" name="title" value="${issue.title||''}" placeholder="Issue title" required style="width:80%;margin-bottom:8px;" />
					<textarea name="description" placeholder="Description" style="width:80%;height:44px;margin-bottom:8px;">${issue.description||''}</textarea>
					<button type="submit">Save</button>
					${issue.id ? '<button type="button" id="deleteBtn">Delete</button>' : ''}
					<button type="button" id="closeBtn">Close</button>
				</form>
			</div>
		`);
		const form = document.getElementById('issueForm');
		form.onsubmit = async (e) => {
			e.preventDefault();
			const fd = {
				id: issue.id,
				plan_id: planId,
				x_norm: issue.x_norm,
				y_norm: issue.y_norm,
				page: issue.page,
				title: form.title.value,
				description: form.description.value,
				status: 'open'
			};
			const res = await fetch('/api/save_issue.php', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(fd)
			});
			document.getElementById('issueDrawer').remove();
			renderPage(issue.page);
		};
		if (issue.id) {
			document.getElementById('deleteBtn').onclick = async () => {
				await fetch('/api/delete_issue.php', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ id: issue.id, plan_id: planId })
				});
				document.getElementById('issueDrawer').remove();
				renderPage(issue.page);
			};
		}
		document.getElementById('closeBtn').onclick = () => {
			document.getElementById('issueDrawer').remove();
		};
	}

	document.getElementById('prev').onclick = () => {
		if (pageNum > 1) { pageNum--; renderPage(pageNum); }
	};
	document.getElementById('next').onclick = () => {
		if (pageNum < pageCount) { pageNum++; renderPage(pageNum); }
	};
	document.getElementById('zoomIn').onclick = () => { scale *= 1.2; renderPage(pageNum); };
	document.getElementById('zoomOut').onclick = () => { scale /= 1.2; renderPage(pageNum); };
}