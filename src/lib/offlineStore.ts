// Last-seen API read responses, kept in IndexedDB so the app still shows data
// without a connection (e.g. practising in a rehearsal room). Only reads are
// stored; online, everything always comes fresh from the server. Cleared on
// sign-out.

const DB_NAME = 'anwesenheit-offline';
const STORE = 'responses';
const MAX_ENTRIES = 800;

interface Entry {
  key: string;
  data: unknown;
  at: number;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

const openDb = (): Promise<IDBDatabase | null> => {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  dbPromise ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore(STORE, { keyPath: 'key' });
        store.createIndex('at', 'at');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null); // private mode / blocked storage: just no offline data
    }
  });
  return dbPromise;
};

const run = async <T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> => {
  const db = await openDb();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => resolve(undefined);
      tx.onabort = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
};

let writes = 0;

export const putResponse = async (key: string, data: unknown) => {
  await run('readwrite', (store) => store.put({ key, data, at: Date.now() } satisfies Entry));
  // Now and then drop the least recently seen entries beyond the cap.
  if (++writes % 50 === 0) {
    await run('readwrite', (store) => {
      const countReq = store.count();
      countReq.onsuccess = () => {
        let excess = countReq.result - MAX_ENTRIES;
        if (excess <= 0) return;
        store.index('at').openCursor().onsuccess = (e) => {
          const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
          if (!cursor || excess-- <= 0) return;
          cursor.delete();
          cursor.continue();
        };
      };
    });
  }
};

export const getResponse = async (key: string): Promise<unknown | undefined> => {
  const entry = (await run('readonly', (store) => store.get(key))) as Entry | undefined;
  return entry?.data;
};

export const clearResponses = async () => {
  await run('readwrite', (store) => store.clear());
};

// Cache holding the piece files (scores, recordings) saved for offline use;
// the service worker (public/sw.js) serves them from here. Same name there.
export const OFFLINE_FILES_CACHE = 'offline-files-v1';
export const OFFLINE_META_PREFIX = 'anwesenheit.offline.';

// Everything saved for offline use: responses, files and the bookkeeping.
export const clearOfflineData = async () => {
  await clearResponses();
  try {
    await caches.delete(OFFLINE_FILES_CACHE);
  } catch {
    /* no Cache API */
  }
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(OFFLINE_META_PREFIX))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    /* storage unavailable */
  }
};
