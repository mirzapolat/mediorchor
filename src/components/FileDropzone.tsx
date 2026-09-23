import { useState, type DragEvent } from 'react';
import { FileText, Upload } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';

// Drop target that is also a file picker: click (or Enter/Space when focused)
// opens the dialog, dropping a file hands it over directly. `accept` uses the
// file input syntax and is checked for dropped files too, since the browser
// only filters the picker.
export const FileDropzone = ({
  accept,
  fileName,
  onFile,
  hint,
}: {
  accept: string;
  fileName?: string | null;
  onFile: (file: File) => void;
  hint?: string;
}) => {
  const { t } = useI18n();
  const [dragging, setDragging] = useState(false);
  const [rejected, setRejected] = useState(false);

  const accepts = (file: File) =>
    accept.split(',').some((rule) => {
      const r = rule.trim().toLowerCase();
      if (r.startsWith('.')) return file.name.toLowerCase().endsWith(r);
      if (r.endsWith('/*')) return file.type.startsWith(r.slice(0, -1));
      return file.type === r;
    });

  const take = (file: File | undefined) => {
    if (!file) return;
    if (!accepts(file)) {
      setRejected(true);
      return;
    }
    setRejected(false);
    onFile(file);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    take(e.dataTransfer.files[0]);
  };

  return (
    <div>
      <label
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          setDragging(true);
        }}
        onDragLeave={(e) => {
          // Ignore leaving into a child element.
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
        }}
        onDrop={onDrop}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-4 py-7 text-center transition-colors duration-150',
          'focus-within:border-black',
          dragging
            ? 'border-black bg-surface-muted'
            : fileName
              ? 'border-border bg-surface hover:bg-surface-subtle'
              : 'border-border bg-surface-subtle hover:border-text-tertiary hover:bg-surface-subtle',
        )}
      >
        <span
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-full',
            fileName ? 'bg-success-soft text-success-strong' : 'bg-surface-hover text-text-secondary',
          )}
        >
          {fileName ? <FileText size={18} /> : <Upload size={18} />}
        </span>
        {fileName ? (
          <>
            <span className="max-w-full truncate text-sm font-medium">{fileName}</span>
            <span className="text-xs text-text-secondary">{t('dropzoneReplace')}</span>
          </>
        ) : (
          <>
            <span className="text-sm font-medium">
              {dragging ? t('dropzoneRelease') : t('dropzoneTitle')}
            </span>
            <span className="text-xs text-text-secondary">{hint ?? t('dropzoneHint')}</span>
          </>
        )}
        <input
          type="file"
          accept={accept}
          className="sr-only"
          onChange={(e) => {
            take(e.target.files?.[0]);
            // Allow picking the same file again after changes.
            e.target.value = '';
          }}
        />
      </label>
      {rejected && <p className="mt-2 text-sm text-accent">{t('dropzoneWrongType')}</p>}
    </div>
  );
};
