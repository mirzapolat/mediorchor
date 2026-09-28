// Service worker for the installable app. Keeps the app shell (HTML, runtime
// config, fingerprinted JS/CSS, icons) so the app opens fast and even without
// a connection. Uploaded piece files are served from the offline cache only
// when the user saved them for offline use (src/lib/offlinePieces.ts); API
// data is handled by the page itself (src/lib/offlineStore.ts).

const SHELL = 'app-shell-v2';
const ASSETS = 'app-assets-v1';
// Same name as OFFLINE_FILES_CACHE in src/lib/offlineStore.ts.
const FILES = 'offline-files-v1';
const PRECACHE = ['/', '/config.js', '/manifest.webmanifest', '/favicon.svg', '/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(PRECACHE))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => ![SHELL, ASSETS, FILES].includes(k)).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

// Network first, cache as fallback (offline) — for things that can change.
const networkFirst = async (request, cacheKey = request) => {
  const cache = await caches.open(SHELL);
  try {
    const response = await fetch(request);
    if (response.ok) void cache.put(cacheKey, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
    throw error;
  }
};

// Keeps the build-file cache from growing across releases: oldest out first.
const MAX_ASSETS = 80;
const trimAssets = async (cache) => {
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_ASSETS)).map((k) => cache.delete(k)));
};

// Cache first — for fingerprinted build files, which never change.
const cacheFirst = async (request) => {
  const cache = await caches.open(ASSETS);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) void cache.put(request, response.clone()).then(() => trimAssets(cache));
  return response;
};

// Saved piece files: from the offline cache when there, else the network.
// Answers byte-range requests too (audio seeking asks for parts of a file).
const savedFile = async (request) => {
  const cache = await caches.open(FILES);
  const cached = await cache.match(request.url, { ignoreVary: true });
  if (!cached) return fetch(request);
  const range = request.headers.get('range');
  if (!range) return cached;
  const body = await cached.arrayBuffer();
  const size = body.byteLength;
  const match = /bytes=(\d*)-(\d*)/.exec(range);
  let start = match && match[1] ? Number(match[1]) : 0;
  let end = match && match[2] ? Number(match[2]) : size - 1;
  if (match && !match[1] && match[2]) {
    start = Math.max(0, size - Number(match[2])); // "bytes=-500": the last 500
    end = size - 1;
  }
  end = Math.min(end, size - 1);
  if (start > end) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }
  return new Response(body.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': cached.headers.get('Content-Type') || 'application/octet-stream',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    },
  });
};

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Piece files the user saved for offline use (downloads with a
  // ?download=… name always go to the server).
  if (url.pathname.startsWith('/files/piece-files/') && !url.search) {
    event.respondWith(savedFile(request));
    return;
  }
  // Live data and other uploads always come straight from the server.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/files/')) return;

  // Page loads: the (branded) app shell; offline, the last one we saw.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, '/'));
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (PRECACHE.includes(url.pathname) || /^\/(icon-|apple-touch-icon)/.test(url.pathname)) {
    event.respondWith(networkFirst(request));
  }
});
