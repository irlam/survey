// Milestone 5: Sync queue for offline changes
import { openDB } from './idb.js';
export async function queueChange(type, data) {
	const db = await openDB();
	const tx = db.transaction('sync', 'readwrite');
	tx.objectStore('sync').add({ type, data, ts: Date.now() });
}
export async function processQueue() {
	const db = await openDB();
	const tx = db.transaction('sync', 'readwrite');
	const store = tx.objectStore('sync');
	const req = store.openCursor();
	req.onsuccess = async e => {
		const cursor = e.target.result;
		if (cursor) {
			// TODO: send to server, then delete
			cursor.delete();
			cursor.continue();
		}
	};
}