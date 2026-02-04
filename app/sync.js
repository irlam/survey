/* app/sync.js - Offline sync queue helpers (04/02/2026) */

import { openDB } from './idb.js';

export async function queueChange(type, data) {
  const db = await openDB();
  try {
    const tx = db.transaction('sync', 'readwrite');
    tx.objectStore('sync').add({ type, data, ts: Date.now() });
  } catch (e) {
    // If the store does not exist yet, fail softly so the app remains usable offline.
    console.warn('[sync] Queue store not available', e);
  }
}

export async function processQueue() {
  const db = await openDB();
  try {
    const tx = db.transaction('sync', 'readwrite');
    const store = tx.objectStore('sync');
    const req = store.openCursor();
    req.onsuccess = async (e) => {
      const cursor = e.target.result;
      if (cursor) {
        // TODO: send to server, then delete on success.
        cursor.continue();
      }
    };
  } catch (e) {
    console.warn('[sync] Queue store not available', e);
  }
}
