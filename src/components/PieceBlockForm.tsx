import { useEffect, useRef, useState, type FormEvent } from 'react';
import { FileText, Music, Upload } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';
import { Input, Field } from './Input';
import { MarkdownEditor } from './MarkdownEditor';
import { useI18n } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { removePieceFiles, uploadPieceFile } from '@/lib/pieceFiles';
import type { PieceBlock, PieceBlockType } from '@/types';

interface PieceBlockFormProps {
  open: boolean;
  pieceId: string;
  type: PieceBlockType; // block type (fixed; chosen via the add menu)
  block: PieceBlock | null; // null → create
  nextPosition: number;
  onClose: () => void;
  onSaved: () => void;
}

// Only plain web links may be stored — anything else (javascript:, data:, …)
// would be rendered as a clickable href later.
const normalizeHttpUrl = (raw: string): string | null => {
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(withScheme);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
};

const typeTitleKey = {
  file: 'blockFile',
  audio: 'blockAudio',
  link: 'blockLink',
  text: 'blockText',
} as const;

export const PieceBlockForm = ({
  open,
  pieceId,
  type,
  block,
  nextPosition,
  onClose,
  onSaved,
}: PieceBlockFormProps) => {
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [content, setContent] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [hasBars, setHasBars] = useState(false);
  const [barsCount, setBarsCount] = useState('');
  const [barsStart, setBarsStart] = useState('1');
  const [barsEnd, setBarsEnd] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(block?.title ?? '');
    setUrl(block?.url ?? '');
    setContent(block?.content ?? '');
    setFile(null);
    setHasBars(block?.has_bars ?? false);
    setBarsStart(String(block?.bars_start ?? 1));
    setBarsEnd(block?.bars_end != null ? String(block.bars_end) : '');
    setBarsCount(
      block?.bars_start != null && block?.bars_end != null
        ? String(block.bars_end - block.bars_start + 1)
        : '',
    );
    setError(null);
  }, [open, block]);

  // The three bar fields describe one range, so they keep each other in sync:
  // count ↔ end (relative to start), matching the requested defaults
  // (start 1, end = number of bars).
  const changeBarsCount = (value: string) => {
    setBarsCount(value);
    const count = parseInt(value, 10);
    const start = parseInt(barsStart, 10) || 1;
    if (count >= 1) setBarsEnd(String(start + count - 1));
  };
  const changeBarsStart = (value: string) => {
    setBarsStart(value);
    const start = parseInt(value, 10);
    const count = parseInt(barsCount, 10);
    if (start >= 1 && count >= 1) setBarsEnd(String(start + count - 1));
  };
  const changeBarsEnd = (value: string) => {
    setBarsEnd(value);
    const end = parseInt(value, 10);
    const start = parseInt(barsStart, 10) || 1;
    if (end >= start) setBarsCount(String(end - start + 1));
  };

  const parsedBarsStart = parseInt(barsStart, 10);
  const parsedBarsEnd = parseInt(barsEnd, 10);
  const barsValid =
    !hasBars || (parsedBarsStart >= 1 && parsedBarsEnd >= parsedBarsStart);

  const needsFile = type === 'file' || type === 'audio';
  const valid =
    (type === 'link'
      ? title.trim() !== '' && url.trim() !== ''
      : type === 'text'
        ? title.trim() !== '' && content.trim() !== ''
        : block !== null || file !== null) &&
    (type !== 'audio' || barsValid);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;

    let linkUrl: string | null = null;
    if (type === 'link') {
      linkUrl = normalizeHttpUrl(url.trim());
      if (!linkUrl) {
        setError(t('invalidUrl'));
        return;
      }
    }

    setBusy(true);
    setError(null);

    let filePath = block?.file_path ?? null;
    let fileName = block?.file_name ?? null;
    if (needsFile && file) {
      const result = await uploadPieceFile(pieceId, file);
      if (!result.path) {
        setError(result.error ?? t('uploadError'));
        setBusy(false);
        return;
      }
      // Replacing an existing attachment: drop the old storage object.
      if (block?.file_path) void removePieceFiles([block.file_path]);
      filePath = result.path;
      fileName = file.name;
    }

    const audioBars = type === 'audio' && hasBars;
    const row = {
      title: needsFile ? (title.trim() || fileName || '') : title.trim(),
      url: linkUrl,
      file_path: filePath,
      file_name: fileName,
      content: type === 'text' ? content : null,
      has_bars: audioBars,
      bars_start: audioBars ? parsedBarsStart : null,
      bars_end: audioBars ? parsedBarsEnd : null,
    };

    const { error: dbError } = block
      ? await supabase.from('piece_blocks').update(row).eq('id', block.id)
      : await supabase
          .from('piece_blocks')
          .insert({ ...row, piece_id: pieceId, type, position: nextPosition });

    setBusy(false);
    if (dbError) {
      setError(dbError.message);
      return;
    }
    onClose();
    onSaved();
  };

  const selectedFileName = file?.name ?? block?.file_name ?? null;

  return (
    <Modal
      open={open}
      title={`${block ? t('editBlock') : t('addBlock')}: ${t(typeTitleKey[type])}`}
      onClose={onClose}
      size={type === 'text' ? '2xl' : 'md'}
    >
      <form onSubmit={submit} className="space-y-4">
        {needsFile && (
          <>
            <Field label={type === 'audio' ? t('audioFile') : t('file')}>
              <input
                ref={fileInputRef}
                type="file"
                accept={type === 'audio' ? 'audio/*' : undefined}
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex w-full items-center gap-3 rounded-md border border-dashed border-border bg-white px-3 py-3 text-left text-sm hover:border-black transition-colors duration-150"
              >
                {type === 'audio' ? (
                  <Music size={18} className="flex-shrink-0 text-text-secondary" />
                ) : (
                  <FileText size={18} className="flex-shrink-0 text-text-secondary" />
                )}
                {selectedFileName ? (
                  <span className="min-w-0 truncate font-medium">{selectedFileName}</span>
                ) : (
                  <span className="text-text-secondary">{t('selectFile')}</span>
                )}
                <Upload size={15} className="ml-auto flex-shrink-0 text-text-tertiary" />
              </button>
              {block && (
                <p className="mt-1.5 text-sm text-text-secondary">{t('replaceFileHint')}</p>
              )}
            </Field>
            <Input
              id="block-title"
              label={
                <>
                  {t('displayName')}{' '}
                  <span className="font-normal text-text-tertiary">({t('optional')})</span>
                </>
              }
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={selectedFileName ?? undefined}
            />
          </>
        )}

        {type === 'audio' && (
          <div className="rounded-md border border-border px-3 py-3 space-y-3">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={hasBars}
                onChange={(e) => setHasBars(e.target.checked)}
                className="mt-0.5 accent-black"
              />
              <span>
                <span className="block text-sm font-medium">{t('hasBars')}</span>
                <span className="mt-0.5 block text-sm text-text-secondary">{t('hasBarsHint')}</span>
              </span>
            </label>
            {hasBars && (
              <div className="grid grid-cols-3 gap-3">
                <Input
                  id="block-bars-count"
                  label={t('barsCount')}
                  type="number"
                  min={1}
                  value={barsCount}
                  onChange={(e) => changeBarsCount(e.target.value)}
                  required
                />
                <Input
                  id="block-bars-start"
                  label={t('barsStartAt')}
                  type="number"
                  min={1}
                  value={barsStart}
                  onChange={(e) => changeBarsStart(e.target.value)}
                  required
                />
                <Input
                  id="block-bars-end"
                  label={t('barsEndAt')}
                  type="number"
                  min={1}
                  value={barsEnd}
                  onChange={(e) => changeBarsEnd(e.target.value)}
                  required
                />
              </div>
            )}
          </div>
        )}

        {type === 'link' && (
          <>
            <Input
              id="block-title"
              label={t('displayName')}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              autoFocus
            />
            <Input
              id="block-url"
              label={t('linkUrl')}
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://"
              required
            />
          </>
        )}

        {type === 'text' && (
          <>
            <Input
              id="block-title"
              label={t('displayName')}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              autoFocus
            />
            <MarkdownEditor id="block-content" value={content} onChange={setContent} minHeight={200} />
          </>
        )}

        {error && <p className="text-sm text-accent">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="submit" disabled={busy || !valid}>
            {busy ? t('loading') : block ? t('save') : t('add')}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
