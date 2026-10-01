import * as pdfjs from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { api } from './api';
import { pieceFileUrl } from './pieceFiles';
import type { PieceFile } from '@/types';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// Link-preview image of a piece: the top of the score's first page (title,
// composer, first systems) at 1200×630. The server can't render PDFs, so the
// browser of whoever manages the piece makes it once per score file; the
// server points og:image at it (same key as server/linkPreview.ts).
const WIDTH = 1200;
const HEIGHT = 630;

const previewKey = (pieceId: string, scoreId: string) => `${pieceId}/preview-${scoreId}.jpg`;

const pending = new Set<string>();

const render = async (url: string): Promise<Blob | null> => {
  const task = pdfjs.getDocument({ url, disableRange: true, disableStream: true });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: WIDTH / base.width });
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = 'white'; // paper, whatever the theme
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    await page.render({ canvas, viewport }).promise;
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  } finally {
    void task.destroy();
  }
};

// Makes the preview when it is missing. Best effort: failures (offline, no
// write access) just leave the piece with the generic preview.
export const ensureScorePreview = async (pieceId: string, score: PieceFile): Promise<void> => {
  if (!score.file_path) return;
  const key = previewKey(pieceId, score.id);
  if (pending.has(key)) return;
  pending.add(key);
  try {
    const head = await fetch(pieceFileUrl(key), { method: 'HEAD', cache: 'no-store' });
    if (head.status !== 404) return;
    const blob = await render(pieceFileUrl(score.file_path));
    if (!blob) return;
    await api.storage.from('piece-files').upload(key, blob, { upsert: true, contentType: 'image/jpeg' });
  } catch {
    /* best effort */
  } finally {
    pending.delete(key);
  }
};
