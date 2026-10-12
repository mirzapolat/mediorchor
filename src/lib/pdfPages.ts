import * as pdfjs from 'pdfjs-dist';
// See PdfScoreView: the worker is pulled in as an asset URL.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// Size of every page of a PDF in points, as shown (rotation applied).
export const pdfPageSizes = async (url: string): Promise<Array<{ width: number; height: number }>> => {
  const task = pdfjs.getDocument({ url, disableRange: true, disableStream: true });
  const doc = await task.promise;
  try {
    const sizes: Array<{ width: number; height: number }> = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const { width, height } = (await doc.getPage(i)).getViewport({ scale: 1 });
      sizes.push({ width, height });
    }
    return sizes;
  } finally {
    void task.destroy();
  }
};
