import { isInstalled, isIos, shareFiles } from './pwa';

// Saving a file on the device. In the installed app on iPhone/iPad a
// download — a link to a file, or <a download> with a blob — opens a
// full-screen preview the app window has no way out of. There the file goes
// to the share sheet instead ("In Dateien sichern", AirDrop, …).
export const savesViaShare = () => isInstalled() && isIos() && typeof navigator.share === 'function';

const download = (file: Blob, name: string) => {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
};

// A file waiting for one more tap: the tap that asked for it expired while
// it was made (Safari only opens the share sheet right after a tap).
// SavePrompt shows it.
let pending: File | null = null;
const listeners = new Set<() => void>();
const setPending = (file: File | null) => {
  pending = file;
  listeners.forEach((l) => l());
};
export const pendingSave = () => pending;
export const subscribePendingSave = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const clearPendingSave = () => setPending(null);

// Saves `file`. 'retry' when the share sheet needs a new tap; then, unless
// `onRetry` takes care of it, SavePrompt asks for that tap.
export const saveFile = async (file: File, onRetry?: (file: File) => void): Promise<'done' | 'retry'> => {
  if (!savesViaShare()) {
    download(file, file.name);
    return 'done';
  }
  const result = await shareFiles({ files: [file] });
  if (result === 'retry') {
    if (onRetry) onRetry(file);
    else setPending(file);
    return 'retry';
  }
  // Not shareable: nothing safe to fall back to in the app window.
  return 'done';
};

// For code that has a Blob and a name.
export const saveBlob = (blob: Blob, name: string) => saveFile(new File([blob], name, { type: blob.type }));

// Shares a file waiting for a tap (from SavePrompt's button).
export const sharePending = async () => {
  const file = pending;
  setPending(null);
  if (file) await shareFiles({ files: [file] });
};
