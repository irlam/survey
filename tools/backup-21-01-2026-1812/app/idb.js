// Milestone 5: IndexedDB store for offline plans/issues/photos/files
export function openDB() {
	return new Promise((resolve, reject) => {
		const req = window.indexedDB.open('survey', 1);
		req.onupgradeneeded = e => {
			const db = e.target.result;
			db.createObjectStore('plans', { keyPath: 'id' });
			db.createObjectStore('issues', { keyPath: 'id' });
			db.createObjectStore('photos', { keyPath: 'id' });
			db.createObjectStore('files', { keyPath: 'id' });
		};
		req.onsuccess = e => resolve(e.target.result);
		req.onerror = e => reject(e);
	});
}