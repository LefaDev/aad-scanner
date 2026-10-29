// @ts-check

const DB_NAME = 'aad_gate_validator_db';
const DB_VERSION = 2; // v2 includes walk_ins store

/**
 * Conference-wide manifest key so delegates remain scannable across all days.
 */
export const SHARED_MANIFEST_KEY = '__aad26_shared__';

const SETTINGS_KEY = 'aad_gate_settings';
const DEVICE_ID_KEY = 'aad_gate_device_id';

/** @type {IDBDatabase|null} */
let dbInstance = null;

/**
 * Return a stable per-browser device identifier across reloads.
 * @returns {string}
 */
export function getOrCreateDeviceId() {
  try {
    if (typeof localStorage !== 'undefined') {
      const existing = localStorage.getItem(DEVICE_ID_KEY);
      if (existing && /^device-[a-z0-9]{5,16}$/i.test(existing)) {
        return existing;
      }
      const bytes = new Uint8Array(5);
      if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        crypto.getRandomValues(bytes);
      } else {
        for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
      }
      const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
      const created = `device-${hex}`;
      localStorage.setItem(DEVICE_ID_KEY, created);
      return created;
    }
  } catch (_) {}
  return 'device-' + Math.random().toString(36).substring(2, 10);
}

/**
 * Open IndexedDB database
 * @returns {Promise<IDBDatabase>}
 */
export async function getDb() {
  if (dbInstance) return dbInstance;

  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not supported on this device.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('manifests')) {
        db.createObjectStore('manifests', { keyPath: 'eventId' });
      }
      if (!db.objectStoreNames.contains('sessions')) {
        db.createObjectStore('sessions', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('cloud_queue')) {
        db.createObjectStore('cloud_queue', { autoIncrement: true, keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('walk_ins')) {
        const walkIns = db.createObjectStore('walk_ins', { keyPath: 'ticket_id' });
        walkIns.createIndex('by_date', 'event_date', { unique: false });
        walkIns.createIndex('by_created', 'created_at', { unique: false });
      }
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };

    request.onerror = () => {
      reject(new Error('Failed to open database: ' + (request.error ? request.error.message : 'Unknown error')));
    };

    request.onblocked = () => {
      console.warn('Database upgrade was blocked by another tab.');
    };
  });
}

/**
 * Save manifest to IndexedDB
 * @param {string} eventId 
 * @param {any} manifestData 
 * @returns {Promise<void>}
 */
export async function saveManifest(eventId, manifestData) {
  try {
    const db = await getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('manifests', 'readwrite');
      const store = tx.objectStore('manifests');
      store.put({ eventId, ...manifestData });
      if (eventId !== SHARED_MANIFEST_KEY) {
        store.put({ ...manifestData, eventId: SHARED_MANIFEST_KEY });
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error('Error saving manifest to IndexedDB:', err);
    throw err;
  }
}

/**
 * Load manifest from IndexedDB (prefers shared conference manifest so merges persist across days)
 * @param {string} eventId 
 * @returns {Promise<any|null>}
 */
export async function loadManifest(eventId) {
  try {
    const db = await getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('manifests', 'readonly');
      const store = tx.objectStore('manifests');
      const sharedReq = store.get(SHARED_MANIFEST_KEY);
      sharedReq.onsuccess = () => {
        if (sharedReq.result) return resolve(sharedReq.result);
        const fallback = store.get(eventId);
        fallback.onsuccess = () => resolve(fallback.result || null);
        fallback.onerror = () => resolve(null);
      };
      sharedReq.onerror = () => reject(sharedReq.error);
    });
  } catch (err) {
    console.error('Error loading manifest from IndexedDB:', err);
    return null;
  }
}

/**
 * Save session state to IndexedDB
 * @param {string} eventId 
 * @param {string} gateId 
 * @param {any} sessionData 
 * @returns {Promise<void>}
 */
export async function saveSession(eventId, gateId, sessionData) {
  try {
    const db = await getDb();
    const key = `${eventId}/${gateId}`;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('sessions', 'readwrite');
      const store = tx.objectStore('sessions');
      store.put({ key, eventId, gateId, ...sessionData, updatedAt: new Date().toISOString() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error('Error saving session to IndexedDB:', err);
  }
}

/**
 * Delete a persisted session from IndexedDB so "Clear" survives page reloads.
 * @param {string} eventId
 * @param {string} gateId
 * @returns {Promise<void>}
 */
export async function deleteSession(eventId, gateId) {
  try {
    const db = await getDb();
    const key = `${eventId}/${gateId}`;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('sessions', 'readwrite');
      tx.objectStore('sessions').delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error('Error deleting session from IndexedDB:', err);
  }
}

/**
 * Load session state from IndexedDB
 * @param {string} eventId 
 * @param {string} gateId 
 * @returns {Promise<any|null>}
 */
export async function loadSession(eventId, gateId) {
  try {
    const db = await getDb();
    const key = `${eventId}/${gateId}`;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('sessions', 'readonly');
      const store = tx.objectStore('sessions');
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error('Error loading session from IndexedDB:', err);
    return null;
  }
}

/**
 * Queue a scan for cloud sync
 * @param {any} row 
 * @returns {Promise<void>}
 */
export async function queueCloudScan(row) {
  try {
    const db = await getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('cloud_queue', 'readwrite');
      const store = tx.objectStore('cloud_queue');
      store.add(row);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error('Error queuing cloud scan:', err);
  }
}

/**
 * Get all queued cloud scans
 * @returns {Promise<any[]>}
 */
export async function getQueuedCloudScans() {
  try {
    const db = await getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('cloud_queue', 'readonly');
      const store = tx.objectStore('cloud_queue');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch (_) {
    return [];
  }
}

/**
 * Remove an item from the cloud queue
 * @param {number} id 
 * @returns {Promise<void>}
 */
export async function removeQueuedCloudScan(id) {
  try {
    const db = await getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('cloud_queue', 'readwrite');
      const store = tx.objectStore('cloud_queue');
      store.delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (_) {}
}

/**
 * POPIA post-conference wipe: erase all delegate PII, manifests, walk-ins,
 * scan logs, and cloud keys from this browser.
 * @returns {Promise<void>}
 */
export async function purgeAllLocalData() {
  try {
    const db = await getDb();
    await new Promise((resolve, reject) => {
      const stores = ['manifests', 'sessions', 'cloud_queue', 'walk_ins'].filter(s =>
        db.objectStoreNames.contains(s)
      );
      const tx = db.transaction(stores, 'readwrite');
      for (const s of stores) {
        tx.objectStore(s).clear();
      }
      tx.oncomplete = () => resolve(undefined);
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error('Error purging IndexedDB stores:', err);
  }

  try {
    localStorage.removeItem(SETTINGS_KEY);
  } catch (_) {}
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (_) {}
}

/**
 * Broadcast channel for multi-tab sync
 * @type {BroadcastChannel|null}
 */
let broadcastChannel = null;

export function initBroadcast(onMessage) {
  if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
    try {
      broadcastChannel = new BroadcastChannel('aad-gate');
      broadcastChannel.onmessage = (event) => {
        if (event.data && typeof onMessage === 'function') {
          onMessage(event.data);
        }
      };
    } catch (e) {
      console.warn('BroadcastChannel not available:', e);
    }
  }
}

/**
 * Broadcast an admission across open tabs on the same device.
 * @param {string} ticketId
 * @param {string} scanTime
 * @param {string} gateName
 * @param {any} counters
 * @param {string} [eventDate]
 * @param {string} [eventId]
 * @param {number} [count]
 */
export function broadcastScan(ticketId, scanTime, gateName, counters, eventDate, eventId, count = 1) {
  if (broadcastChannel) {
    try {
      broadcastChannel.postMessage({
        type: 'SCAN_ADMITTED',
        ticketId,
        scanTime,
        gateName,
        counters,
        eventDate,
        eventId,
        count
      });
    } catch (_) {}
  }
}

/* ==========================================================================
 * WALK-IN REGISTRATIONS (DB v2)
 * ========================================================================== */

/**
 * Persist a walk-in registration.
 * @param {any} record
 * @returns {Promise<void>}
 */
export async function saveWalkIn(record) {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('walk_ins', 'readwrite');
    tx.objectStore('walk_ins').put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Fetch walk-ins for a date (YYYY-MM-DD). Omit the date for all of them.
 * @param {string} [eventDate]
 * @returns {Promise<any[]>}
 */
export async function listWalkIns(eventDate) {
  try {
    const db = await getDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('walk_ins', 'readonly');
      const store = tx.objectStore('walk_ins');
      const req = eventDate ? store.index('by_date').getAll(eventDate) : store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error('Error listing walk-ins:', err);
    return [];
  }
}

/**
 * Count walk-ins already issued for a date — drives the sequence number.
 * @param {string} eventDate
 * @returns {Promise<number>}
 */
export async function countWalkIns(eventDate) {
  const rows = await listWalkIns(eventDate);
  return rows.length;
}

/**
 * @returns {Promise<Record<string, any>>}
 */
export async function getWalkInIndex() {
  const rows = await listWalkIns();
  /** @type {Record<string, any>} */
  const index = {};
  for (const r of rows) index[r.ticket_id] = r;
  return index;
}

/**
 * Delete a walk-in (mis-registration correction).
 * @param {string} ticketId
 * @returns {Promise<void>}
 */
export async function deleteWalkIn(ticketId) {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('walk_ins', 'readwrite');
    tx.objectStore('walk_ins').delete(ticketId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
