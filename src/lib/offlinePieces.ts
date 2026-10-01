// "Save offline" for a project's pieces: loads every piece page's data (the
// API layer keeps those answers, see offlineStore) and puts every score,
// notation file and recording into the offline file cache, which the service
// worker serves when there is no connection.

import { loadPiece, loadPieceFiles, loadPiecesOverview, pieceFileUrl } from './pieceFiles';
import { OFFLINE_FILES_CACHE, OFFLINE_META_PREFIX } from './offlineStore';
// The PDF renderer is loaded on demand; fetch it now (the service worker
// keeps build files), or an offline piece page couldn't show its score.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

export interface OfflineMeta {
  savedAt: string;
  pieces: number;
  files: number;
  bytes: number;
  failed: number; // files the server could not deliver (skipped)
  urls: string[]; // the cached files, to clean up precisely later
}

const metaKey = (projectId: string) => `${OFFLINE_META_PREFIX}${projectId}`;

// Files still needed by saved projects other than this one.
const urlsOfOtherProjects = (projectId: string): Set<string> => {
  const out = new Set<string>();
  try {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(OFFLINE_META_PREFIX) || key === metaKey(projectId)) continue;
      const meta = JSON.parse(localStorage.getItem(key) ?? 'null') as OfflineMeta | null;
      meta?.urls?.forEach((u) => out.add(u));
    }
  } catch {
    /* storage unavailable */
  }
  return out;
};

export const offlineSupported = () =>
  typeof caches !== 'undefined' && 'serviceWorker' in navigator && typeof indexedDB !== 'undefined';

export const getOfflineMeta = (projectId: string): OfflineMeta | null => {
  try {
    const raw = localStorage.getItem(metaKey(projectId));
    return raw ? (JSON.parse(raw) as OfflineMeta) : null;
  } catch {
    return null;
  }
};

export const saveProjectOffline = async (
  projectId: string,
  onProgress: (done: number, total: number) => void,
): Promise<OfflineMeta> => {
  // Ask the browser not to evict the files under storage pressure.
  void navigator.storage?.persist?.().catch(() => false);

  // Code the piece page only loads when needed (score view, PDF worker).
  await Promise.all([
    import('@/components/PdfScoreView'),
    fetch(pdfWorkerUrl).then((r) => r.blob()),
  ]);

  const { pieces } = await loadPiecesOverview(projectId);
  const perPiece = await Promise.all(
    pieces.map(async (p) => {
      const [, files] = await Promise.all([loadPiece(p.id), loadPieceFiles(p.id)]);
      return files;
    }),
  );
  const urls = [
    ...new Set(
      perPiece
        .flat()
        .filter((f) => f.kind !== 'link')
        .flatMap((f) => [f.file_path, f.click_file_path])
        .filter((p): p is string => !!p)
        .map(pieceFileUrl),
    ),
  ];

  const cache = await caches.open(OFFLINE_FILES_CACHE);
  let done = 0;
  let bytes = 0;
  onProgress(0, urls.length);
  // A few at a time: quick, without flooding a phone's connection.
  const queue = [...urls];
  const saved: string[] = [];
  let failed = 0;
  const worker = async () => {
    for (let url = queue.shift(); url; url = queue.shift()) {
      let cached = await cache.match(url);
      if (!cached) {
        let response: Response;
        try {
          response = await fetch(url);
        } catch {
          throw new Error('offline'); // connection lost: stop, report
        }
        // A file missing on the server shouldn't sink everything else.
        if (!response.ok) {
          failed += 1;
          onProgress(++done, urls.length);
          continue;
        }
        await cache.put(url, response);
        cached = await cache.match(url);
      }
      saved.push(url);
      const length = Number(cached?.headers.get('Content-Length') ?? 0);
      bytes += length > 0 ? length : ((await cached?.blob())?.size ?? 0);
      onProgress(++done, urls.length);
    }
  };
  await Promise.all(Array.from({ length: 3 }, worker));

  // Drop files this project no longer has (replaced or deleted since the
  // last save), unless another saved project still uses them.
  const previous = getOfflineMeta(projectId);
  const others = urlsOfOtherProjects(projectId);
  const current = new Set(saved);
  for (const url of previous?.urls ?? []) {
    if (!current.has(url) && !others.has(url)) await cache.delete(url);
  }

  const meta: OfflineMeta = {
    savedAt: new Date().toISOString(),
    pieces: pieces.length,
    files: saved.length,
    bytes,
    failed,
    urls: saved,
  };
  try {
    localStorage.setItem(metaKey(projectId), JSON.stringify(meta));
  } catch {
    /* storage unavailable */
  }
  return meta;
};

export const removeProjectOffline = async (projectId: string) => {
  const meta = getOfflineMeta(projectId);
  const others = urlsOfOtherProjects(projectId);
  try {
    localStorage.removeItem(metaKey(projectId));
  } catch {
    /* storage unavailable */
  }
  if (!meta) return;
  const cache = await caches.open(OFFLINE_FILES_CACHE);
  for (const url of meta.urls ?? []) {
    if (!others.has(url)) await cache.delete(url);
  }
};
