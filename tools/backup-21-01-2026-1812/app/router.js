// Simple query param helper
export function getQuery(key) {
	const params = new URLSearchParams(window.location.search);
	return params.get(key);
}

// Auto-load viewer if plan_id is present
if (window.location.search.includes('plan_id=')) {
	import('./viewer.js');
}