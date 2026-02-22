/* app/sync.js - Offline sync queue helpers (04/02/2026)
 * UMD pattern for compatibility (no ES6 modules)
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['./idb.js'], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./idb.js'));
  } else {
    root.SyncQueue = factory({ openDB: window.openDB || (window.idbModule && window.idbModule.openDB) });
  }
})(this, function(idbModule) {
  'use strict';

  // IndexedDB helper (inline to avoid module dependency issues)
  function openDB() {
    return new Promise((resolve, reject) => {
      const req = window.indexedDB.open('survey', 2); // bumped version for sync store
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('sync')) {
          db.createObjectStore('sync', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('plans')) db.createObjectStore('plans', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('issues')) db.createObjectStore('issues', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
    });
  }

  /**
   * Queue a change for later sync
   * @param {string} type - Type of change (e.g., 'issue_create', 'issue_update')
   * @param {object} data - Change data to sync
   */
  async function queueChange(type, data) {
    const db = await openDB();
    try {
      const tx = db.transaction('sync', 'readwrite');
      tx.objectStore('sync').add({ type, data, ts: Date.now(), retries: 0 });
      console.log('[sync] Queued change:', type);
    } catch (e) {
      console.warn('[sync] Queue store not available', e);
    }
  }

  /**
   * Process queued changes when online
   */
  async function processQueue() {
    if (!navigator.onLine) {
      console.log('[sync] Offline, skipping queue processing');
      return;
    }
    
    const db = await openDB();
    try {
      const tx = db.transaction('sync', 'readwrite');
      const store = tx.objectStore('sync');
      const req = store.openCursor();
      
      req.onsuccess = async (e) => {
        const cursor = e.target.result;
        if (cursor) {
          const item = cursor.value;
          console.log('[sync] Processing queued item:', item.type);
          
          try {
            // Send to server
            const res = await fetch('/api/sync_change.php', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(item),
              keepalive: true
            });
            
            if (res.ok) {
              cursor.delete(); // Remove on success
              console.log('[sync] Synced item:', item.type);
            } else {
              console.warn('[sync] Server rejected item:', item.type, await res.text());
            }
          } catch (err) {
            console.warn('[sync] Failed to sync item', item, err);
            // Increment retry count
            if (item.retries < 3) {
              item.retries++;
              cursor.update(item);
            } else {
              cursor.delete(); // Give up after 3 retries
              console.warn('[sync] Dropped item after 3 retries:', item.type);
            }
          }
          
          cursor.continue();
        }
      };
    } catch (e) {
      console.warn('[sync] Queue store not available', e);
    }
  }

  // Process queue on load if online
  if (typeof document !== 'undefined' && navigator.onLine) {
    document.addEventListener('DOMContentLoaded', processQueue);
  }

  // Listen for online events
  if (typeof window !== 'undefined') {
    window.addEventListener('online', processQueue);
  }

  return { queueChange, processQueue };
});
