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
		<div id="pdfContainer" style="touch-action:pan-x pan-y;overflow:auto;width:100vw;height:80vh;background:#eee;"></div>
	`;
	loadPDF(planId);
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
			});
		});
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