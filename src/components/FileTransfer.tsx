import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Check, Download, Loader2, Share } from 'lucide-react';
import { Overlay } from './Overlay';
import { useI18n } from '@/lib/i18n';
import { canShareFiles, shareFiles } from '@/lib/pwa';
import { createZip, safeFileName } from '@/lib/zip';
import { saveFile } from '@/lib/saveFile';
import { localeOf } from '@shared/languages';

// Fetching files before they are saved or shared, with a popup that shows
// it happening (and its progress), and the share sheet afterwards.

export type Progress = (loaded: number, total: number | null) => void;

// Types for files the server doesn't name (notation, MIDI, …); anything
// else stays a generic binary file, which iPhone and iPad share as well.
const TYPES: Record<string, string> = {
  mscz: 'application/x-musescore',
  mscx: 'application/x-musescore+xml',
  musicxml: 'application/vnd.recordare.musicxml+xml',
  mxl: 'application/vnd.recordare.musicxml',
  xml: 'application/xml',
  mid: 'audio/midi',
  midi: 'audio/midi',
  zip: 'application/zip',
};
const typeOfName = (name: string) =>
  TYPES[/\.([a-z0-9]{1,8})$/i.exec(name)?.[1].toLowerCase() ?? ''] ?? 'application/octet-stream';

// Fetches one URL as a File under `name`, reporting the bytes as they come.
export const fetchFile = async (url: string, name: string, signal: AbortSignal, onProgress?: Progress): Promise<File> => {
  const response = await fetch(url, { signal, credentials: 'same-origin' });
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      message = ((await response.json()) as { error?: { message?: string } }).error?.message ?? message;
    } catch {
      /* not JSON */
    }
    throw new Error(message);
  }
  // The server sends unknown types as octet-stream; the share sheet (and
  // the app that receives the file) does better with the real one.
  const served = response.headers.get('content-type')?.split(';')[0].trim() ?? '';
  const type = served && served !== 'application/octet-stream' ? served : typeOfName(name);
  const total = Number(response.headers.get('content-length')) || null;
  const reader = response.body?.getReader();
  if (!reader) return new File([await response.blob()], name, { type });
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress?.(loaded, total);
  }
  return new File(chunks as BlobPart[], name, { type });
};

// Saves fetched files (several as one ZIP made here). In the installed
// iPhone app that is the share sheet (see saveFile); 'retry' when it wants
// one more tap, handed to `onRetry`.
const saveAll = async (files: File[], zipName: string, onRetry: (file: File) => void) => {
  if (files.length === 1) return saveFile(files[0], onRetry);
  const entries = await Promise.all(files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })));
  return saveFile(new File([createZip(entries)], `${safeFileName(zipName)}.zip`, { type: 'application/zip' }), onRetry);
};

export interface TransferJob {
  // What is loaded (a file's or folder's name).
  name: string;
  // A ZIP is packed by the server first.
  zip?: boolean;
  load: (signal: AbortSignal, onProgress: Progress) => Promise<File[]>;
}

type State =
  | { phase: 'loading'; job: TransferJob; loaded: number; total: number | null }
  | { phase: 'share'; job: TransferJob; files: File[] }
  | { phase: 'saved-instead'; job: TransferJob }
  | { phase: 'error'; job: TransferJob; message: string };

const tile = 'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl';
const quietButton = 'h-10 rounded-lg px-4 text-sm font-medium text-text-secondary hover:bg-surface-muted hover:text-text';

// `run(job, 'download' | 'share')` loads the job's files behind a popup and
// saves or shares them; `dialog` is that popup. When the system can't share
// these files they are downloaded (and the popup says so). When the share
// sheet may no longer open by itself (the tap expired while loading), the
// popup asks for one more tap.
export const useFileTransfer = () => {
  const { t, lang } = useI18n();
  const [state, setState] = useState<State | null>(null);
  // The popup appears only when loading takes a moment (no flash).
  const [shown, setShown] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  const close = () => {
    abort.current?.abort();
    abort.current = null;
    setState(null);
    setShown(false);
  };

  // The share sheet needs a new tap: the popup offers it.
  const askToShare = (job: TransferJob, file: File) => {
    setShown(true);
    setState({ phase: 'share', job, files: [file] });
  };

  const share = async (job: TransferJob, files: File[]) => {
    if (!canShareFiles(files)) {
      if ((await saveAll(files, job.name, (file) => askToShare(job, file))) === 'retry') return;
      setShown(true);
      return setState({ phase: 'saved-instead', job });
    }
    const result = await shareFiles({ files });
    if (result === 'retry') {
      setShown(true);
      return setState({ phase: 'share', job, files });
    }
    close();
  };

  const run = async (job: TransferJob, then: 'download' | 'share') => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setState({ phase: 'loading', job, loaded: 0, total: null });
    setShown(false);
    const timer = window.setTimeout(() => !controller.signal.aborted && setShown(true), 200);
    try {
      const files = await job.load(controller.signal, (loaded, total) => {
        if (!controller.signal.aborted) setState({ phase: 'loading', job, loaded, total });
      });
      window.clearTimeout(timer);
      if (controller.signal.aborted) return;
      if (then === 'share') return await share(job, files);
      if ((await saveAll(files, job.name, (file) => askToShare(job, file))) === 'retry') return;
      close();
    } catch (error) {
      window.clearTimeout(timer);
      if (controller.signal.aborted) return;
      setShown(true);
      setState({ phase: 'error', job, message: error instanceof Error ? error.message : String(error) });
    }
  };

  const percent = state?.phase === 'loading' && state.total ? Math.min(1, state.loaded / state.total) : null;
  const mb = (bytes: number) => (bytes / 1024 / 1024).toLocaleString(localeOf(lang), { maximumFractionDigits: 1 });

  const dialog =
    state && shown
      ? createPortal(
          <Overlay onClick={state.phase === 'loading' ? undefined : close}>
            <div
              role="dialog"
              aria-modal="true"
              aria-live="polite"
              onClick={(e) => e.stopPropagation()}
              className="mx-4 w-full max-w-sm animate-[fadein_200ms_ease-in-out] rounded-2xl border border-border bg-surface p-5 shadow-lg"
            >
              <div className="flex items-center gap-3">
                {state.phase === 'loading' ? (
                  <span className={`${tile} bg-surface-muted text-text-secondary`}>
                    <Loader2 size={20} className="animate-spin" />
                  </span>
                ) : state.phase === 'error' ? (
                  <span className={`${tile} bg-danger-soft text-danger`}>
                    <AlertTriangle size={20} />
                  </span>
                ) : (
                  <span className={`${tile} bg-success-soft text-success-strong`}>
                    {state.phase === 'share' ? <Check size={20} /> : <Download size={20} />}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {state.phase === 'loading'
                      ? t(state.job.zip ? 'transferPacking' : 'transferLoading')
                      : state.phase === 'share'
                        ? t('readyToShare')
                        : state.phase === 'saved-instead'
                          ? t('transferSavedInstead')
                          : t('transferFailed')}
                  </p>
                  <p className="truncate text-sm text-text-tertiary" title={state.job.name}>
                    {state.phase === 'error' ? state.message : state.job.name}
                  </p>
                </div>
              </div>

              {state.phase === 'loading' && (
                <div className="mt-4 space-y-1.5">
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface-muted">
                    {percent == null ? (
                      <div className="h-full w-1/3 animate-pulse rounded-full bg-accent" />
                    ) : (
                      <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${percent * 100}%` }} />
                    )}
                  </div>
                  <p className="flex justify-between text-xs tabular-nums text-text-tertiary">
                    <span>{state.loaded > 0 ? `${mb(state.loaded)}${state.total ? ` / ${mb(state.total)}` : ''} MB` : ' '}</span>
                    {percent != null && <span>{Math.round(percent * 100)} %</span>}
                  </p>
                </div>
              )}

              <div className="mt-4 flex justify-end gap-2">
                {state.phase === 'share' ? (
                  <>
                    <button type="button" onClick={close} className={quietButton}>
                      {t('close')}
                    </button>
                    <button
                      type="button"
                      autoFocus
                      onClick={() => void share(state.job, state.files)}
                      className="inline-flex h-10 items-center gap-2 rounded-lg bg-black px-4 text-sm font-semibold text-white hover:opacity-90"
                    >
                      <Share size={15} />
                      {t('shareFile')}
                    </button>
                  </>
                ) : (
                  <button type="button" onClick={close} className={quietButton}>
                    {state.phase === 'loading' ? t('cancel') : t('close')}
                  </button>
                )}
              </div>
            </div>
          </Overlay>,
          document.body,
        )
      : null;

  return { run, dialog };
};
