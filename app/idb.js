/* app/idb.js - IndexedDB helpers for offline caching (04/02/2026) */

export function openDB() {
  return new Promise((resolve, reject) => {
    const req = window.indexedDB.open('survey', 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      db.createObjectStore('plans', { keyPath: 'id' });
      db.createObjectStore('issues', { keyPath: 'id' });
      db.createObjectStore('photos', { keyPath: 'id' });
      db.createObjectStore('files', { keyPath: 'id' });
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  });
}
