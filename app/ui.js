export function renderPlansScreen() {
	const app = document.getElementById('app');
	app.innerHTML = `
		<h1>Plans</h1>
		<form id="uploadForm" enctype="multipart/form-data">
			<input type="file" name="file" accept="application/pdf" required style="display:block;margin-bottom:8px;" />
			<input type="text" name="name" placeholder="Plan name" required style="display:block;margin-bottom:8px;" />
			<button type="submit" style="min-width:44px;min-height:44px;">Upload</button>
		</form>
		<ul id="plansList"></ul>
	`;
	fetchPlans();
	app.querySelector('#uploadForm').onsubmit = async (e) => {
		e.preventDefault();
		const form = e.target;
		const fd = new FormData(form);
		const btn = form.querySelector('button');
		btn.disabled = true;
		const res = await fetch('/api/upload_plan.php', { method: 'POST', body: fd });
		btn.disabled = false;
		if (res.ok) {
			form.reset();
			fetchPlans();
		} else {
			alert('Upload failed');
		}
	};
}

async function fetchPlans() {
	const ul = document.getElementById('plansList');
	ul.innerHTML = '<li>Loading...</li>';
	const res = await fetch('/api/list_plans.php');
	if (!res.ok) { ul.innerHTML = '<li>Failed to load</li>'; return; }
	const data = await res.json();
	ul.innerHTML = '';
	for (const plan of data.plans) {
		const li = document.createElement('li');
		li.innerHTML = `<a href="?plan_id=${plan.id}">${plan.name}</a> (rev ${plan.revision})`;
		li.style.minHeight = '44px';
		ul.appendChild(li);
	}
}