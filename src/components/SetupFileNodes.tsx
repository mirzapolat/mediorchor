import { useMemo, useState } from 'react';
import { Check, FilePlus2, Plus, Search, X } from 'lucide-react';
import { Button } from './Button';
import { Modal } from './Modal';
import { fileIcon, fileTone } from './PieceFileParts';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import type { PieceFile } from '@/types';

// The file nodes of a piece's "Konfiguration": a card per file the editors
// added, and the dialog that adds uploaded files as nodes.

const fileExt = (f: PieceFile) => /\.([a-z0-9]{1,8})$/i.exec(f.file_name ?? '')?.[1].toUpperCase() ?? '';
const fileTitle = (f: PieceFile) => f.title.trim() || f.file_name || '—';

// "2.3 MB": a file's size, shortly.
const formatBytes = (bytes: number) => {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(unit > 1 ? 1 : 0)} ${units[unit]}`;
};

// What a file is at a glance: a tinted icon tile, its name, its type and size.
const FileFace = ({ file, size = 'md' }: { file: PieceFile; size?: 'sm' | 'md' }) => {
  const Icon = fileIcon(file);
  const ext = fileExt(file);
  return (
    <>
      <span
        className={cn(
          'flex flex-shrink-0 items-center justify-center rounded-xl bg-surface-muted',
          size === 'md' ? 'h-10 w-10' : 'h-8 w-8',
          fileTone(file),
        )}
      >
        <Icon size={size === 'md' ? 19 : 16} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium" title={fileTitle(file)}>
          {fileTitle(file)}
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-text-tertiary">
          {ext && (
            <span className="rounded bg-surface-muted px-1.5 py-px text-[10px] font-semibold tracking-wide text-text-secondary">
              {ext}
            </span>
          )}
          {file.size != null && <span className="truncate tabular-nums">{formatBytes(file.size)}</span>}
        </span>
      </span>
    </>
  );
};

// A file node's content (inside FileWiring's card). `onRemove` takes it off
// the configuration; the file itself stays on the "Dateien" page.
export const FileNodeCard = ({ file, onRemove }: { file: PieceFile; onRemove?: () => void }) => {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-3 py-3">
      <FileFace file={file} />
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`${t('removeNode')}: ${fileTitle(file)}`}
          title={t('removeNode')}
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-text-tertiary opacity-0 transition-opacity duration-150 hover:bg-surface-hover hover:text-text focus:opacity-100 group-hover/node:opacity-100 max-lg:opacity-100"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
};

// While there are no nodes: what they are for.
export const FileNodesEmpty = () => {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border px-5 py-8 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-muted text-text-secondary">
        <FilePlus2 size={18} />
      </span>
      <p className="text-sm font-medium">{t('noFileNodes')}</p>
      <p className="max-w-[16rem] text-xs text-text-secondary">{t('noFileNodesHint')}</p>
    </div>
  );
};

// "Add file": picks uploaded files that are no node yet (several at once,
// searchable when there are many).
export const AddFileNodes = ({ available, onAdd }: { available: PieceFile[]; onAdd: (files: PieceFile[]) => void }) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? available.filter((f) => `${fileTitle(f)} ${f.file_name ?? ''}`.toLowerCase().includes(q)) : available;
  }, [available, query]);

  const close = () => {
    setOpen(false);
    setPicked([]);
    setQuery('');
  };
  const toggle = (id: string) => setPicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={available.length === 0}
        title={available.length === 0 ? t('allFilesAreNodes') : undefined}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-border-strong text-sm font-medium text-text-secondary transition-colors duration-150 hover:border-black hover:bg-surface-subtle hover:text-text disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border-strong disabled:hover:bg-transparent"
      >
        <Plus size={16} />
        {available.length === 0 ? t('allFilesAreNodes') : t('addFileNode')}
      </button>

      <Modal
        open={open}
        title={t('addFileNodesTitle')}
        onClose={close}
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              {t('cancel')}
            </Button>
            <Button
              disabled={picked.length === 0}
              onClick={() => {
                onAdd(available.filter((f) => picked.includes(f.id)));
                close();
              }}
            >
              <Plus size={15} />
              {picked.length > 1 ? t('addFileNodesCount').replace('{n}', String(picked.length)) : t('addFileNode')}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-text-secondary">{t('addFileNodesHint')}</p>
          {available.length > 6 && (
            <label className="relative block">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
              <input
                autoFocus
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('filesSearch')}
                aria-label={t('filesSearch')}
                className="h-10 w-full rounded-lg border border-border bg-surface-subtle pl-9 pr-3 text-base focus:border-black focus:bg-surface focus:outline-none sm:text-sm"
              />
            </label>
          )}
          {shown.length === 0 ? (
            <p className="py-6 text-center text-sm text-text-secondary">{t('filesNoMatches')}</p>
          ) : (
            <ul className="max-h-[50vh] space-y-1 overflow-y-auto">
              {shown.map((f) => {
                const on = picked.includes(f.id);
                return (
                  <li key={f.id}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      onClick={() => toggle(f.id)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors duration-150',
                        on ? 'border-accent bg-accent/10' : 'border-transparent hover:bg-surface-subtle',
                      )}
                    >
                      <FileFace file={f} size="sm" />
                      <span
                        className={cn(
                          'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border transition-colors duration-150',
                          on ? 'border-accent bg-accent text-white' : 'border-border-strong bg-surface',
                        )}
                      >
                        {on && <Check size={13} strokeWidth={3} />}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Modal>
    </>
  );
};
