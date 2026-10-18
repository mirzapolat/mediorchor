import { memo, useState } from 'react';
import { ChevronDown, Download, ExternalLink, FileCode2, FileMusic, FileText, Link as LinkIcon, Music, Paperclip, type LucideIcon } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { useI18n, type TranslationKey } from '@/lib/i18n';
import { isMuseScoreFileName, isTimingFileName } from '@/lib/mpos';
import {
  isFileDownloadable,
  pieceDownloadName,
  pieceFileDownloadUrl,
  TRACK_RECORDING_FIELDS,
  type TrackRecordingField,
} from '@/lib/pieceFiles';
import { cn } from '@/lib/cn';
import { track } from '@/lib/analytics';
import type { Piece, PieceCredit, PieceFile, PieceFileKind, PieceTrack } from '@/types';

// What members download from a piece without folders: grouped by what each
// file is (moved here from the piece page), and who worked on the piece.

const FILE_GROUPS: Array<{ kind: PieceFileKind; label: TranslationKey; icon: LucideIcon }> = [
  { kind: 'score', label: 'fileKindScore', icon: FileText },
  { kind: 'audio', label: 'fileKindAudio', icon: Music },
  { kind: 'notation', label: 'fileKindNotation', icon: FileCode2 },
  { kind: 'midi', label: 'fileKindMidi', icon: FileMusic },
  { kind: 'other', label: 'fileKindOther', icon: Paperclip },
  { kind: 'link', label: 'fileKindLink', icon: LinkIcon },
];

const downloadHref = (piece: Piece, name: string, f: PieceFile) =>
  f.file_path ? pieceFileDownloadUrl(f.file_path, pieceDownloadName(piece, name, f.file_name ?? f.file_path)) : '#';

const rowClass =
  'flex min-h-[3rem] w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors duration-150 hover:bg-surface-subtle';

// What each of a voice's recordings is called in the download choice.
const VARIANT_LABELS: Record<TrackRecordingField, TranslationKey> = {
  file_id: 'variantSolo',
  click_file_id: 'variantSoloClick',
  quiet_file_id: 'variantWithOthers',
  quiet_click_file_id: 'variantWithOthersClick',
};

interface DownloadOption {
  key: string;
  label: string;
  href: string;
  kind: PieceFileKind;
}

// One download row for several versions of the same thing (a voice's
// recordings, the score as PDF and MusicXML): it opens a button per version;
// with only one it downloads right away.
const DownloadChoice = ({
  title,
  icon: Icon,
  options,
}: {
  title: string;
  icon: LucideIcon;
  options: DownloadOption[];
}) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  if (options.length === 1) {
    return (
      <a href={options[0].href} onClick={() => track('file-download', { kind: options[0].kind })} className={rowClass}>
        <Icon size={16} className="flex-shrink-0 text-text-secondary" />
        <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
        <Download size={15} className="flex-shrink-0 text-text-tertiary" />
      </a>
    );
  }

  return (
    <>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className={rowClass}>
        <Icon size={16} className="flex-shrink-0 text-text-secondary" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{title}</span>
          <span className="block text-xs text-text-tertiary">
            {t('voiceDownloadVariants').replace('{count}', String(options.length))}
          </span>
        </span>
        <ChevronDown
          size={16}
          className={cn('flex-shrink-0 text-text-tertiary transition-transform duration-150', open && 'rotate-180')}
        />
      </button>
      {open && (
        <div className="grid grid-cols-2 gap-2 border-t border-border bg-surface-subtle p-2.5">
          {options.map((o) => (
            <a
              key={o.key}
              href={o.href}
              onClick={() => track('file-download', { kind: o.kind })}
              aria-label={`${title}: ${o.label}`}
              className="flex min-h-[2.75rem] items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs font-medium leading-tight transition-colors duration-150 hover:border-black sm:text-sm"
            >
              <Download size={14} className="flex-shrink-0 text-text-tertiary" />
              <span className="min-w-0">{o.label}</span>
            </a>
          ))}
        </div>
      )}
    </>
  );
};

// Downloads and links, grouped by what they are. The score (PDF, MusicXML
// and MuseScore) is one row, recordings one row per voice; recordings no
// voice uses are listed on their own after them. Only what is switched to
// downloadable in the setup is listed.
export const FileList = memo(({ piece, files: allFiles, voices: allVoices }: { piece: Piece; files: PieceFile[]; voices: PieceTrack[] }) => {
  const { t } = useI18n();
  const files = allFiles.filter((f) => isFileDownloadable(f, allVoices));
  const voices = allVoices.filter((v) => v.downloadable);
  if (files.length === 0) {
    return <p className="text-sm text-text-secondary">{t('noFiles')}</p>;
  }
  const voiceRows = voices.flatMap((v) => {
    const name = v.title.trim() || t('fileKindAudio');
    const options = TRACK_RECORDING_FIELDS.flatMap((field) => {
      const file = files.find((f) => f.id === v[field] && f.file_path);
      if (!file) return [];
      const label = t(VARIANT_LABELS[field]);
      return [{ key: field, label, href: downloadHref(piece, `${name} (${label})`, file), kind: file.kind, fileId: file.id }];
    });
    return options.length > 0 ? [{ id: v.id, title: name, icon: Music, options }] : [];
  });
  const usedIds = new Set(voiceRows.flatMap((r) => r.options.map((o) => o.fileId)));

  // PDF, MusicXML, MuseScore and its bar timing (.mpos); several of a
  // format are told apart by their names.
  const sheetFormat = (f: PieceFile) =>
    isMuseScoreFileName(f.file_name ?? '')
      ? 'MuseScore'
      : isTimingFileName(f.file_name ?? '')
        ? t('timingFromMuseScore')
        : f.kind === 'score'
          ? 'PDF'
          : 'MusicXML';
  const sheetFiles = files.filter(
    (f) =>
      f.file_path &&
      (isMuseScoreFileName(f.file_name ?? '') || f.kind === 'score' || f.kind === 'notation'),
  );
  const sheetIds = new Set(sheetFiles.map((f) => f.id));
  const sheetOptions = sheetFiles.map((f) => {
    const format = sheetFormat(f);
    const several = sheetFiles.filter((x) => sheetFormat(x) === format).length > 1;
    const label = several && f.title.trim() ? `${format} · ${f.title.trim()}` : format;
    return { key: f.id, label, href: downloadHref(piece, `${t('sheetMusic')} (${label})`, f), kind: f.kind };
  });

  return (
    <div className="space-y-4">
      {FILE_GROUPS.map(({ kind, label, icon: Icon }) => {
        if (kind === 'notation') return null;
        const choices =
          kind === 'audio'
            ? voiceRows
            : kind === 'score' && sheetOptions.length > 0
              ? [{ id: 'sheet', title: t('sheetMusic'), icon: FileText, options: sheetOptions }]
              : [];
        const group = files.filter(
          (f) => f.kind === kind && kind !== 'score' && !usedIds.has(f.id) && !sheetIds.has(f.id),
        );
        if (group.length === 0 && choices.length === 0) return null;
        return (
          <div key={kind}>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-tertiary">
              {kind === 'score' ? t('sheetMusic') : t(label)}
            </h3>
            <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-surface">
              {choices.map((c) => (
                <li key={c.id}>
                  <DownloadChoice title={c.title} icon={c.icon} options={c.options} />
                </li>
              ))}
              {group.map((f) => {
                // Uploaders' file names are never shown: the display name,
                // or the group's name when there is none.
                const name = f.title.trim() || (kind === 'link' ? f.url ?? '—' : t(label));
                // Only plain web links are ever rendered as a clickable href.
                const href =
                  kind === 'link' ? (/^https?:\/\//i.test(f.url ?? '') ? (f.url as string) : '#') : downloadHref(piece, name, f);
                return (
                  <li key={f.id}>
                    <a
                      href={href}
                      {...(kind === 'link'
                        ? { target: '_blank', rel: 'noreferrer noopener' }
                        : { onClick: () => track('file-download', { kind }) })}
                      className={rowClass}
                    >
                      <Icon size={16} className="flex-shrink-0 text-text-secondary" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{name}</span>
                        {kind === 'link' && name !== f.url && (
                          <span className="block truncate text-xs text-text-tertiary">{f.url}</span>
                        )}
                      </span>
                      {kind === 'link' ? (
                        <ExternalLink size={15} className="flex-shrink-0 text-text-tertiary" />
                      ) : (
                        <Download size={15} className="flex-shrink-0 text-text-tertiary" />
                      )}
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
});
FileList.displayName = 'FileList';

// Who worked on the piece, with their profile photo and role ("made the
// MIDIs" unless set otherwise). Display only: nothing here links anywhere.
export const Credits = memo(({ credits }: { credits: PieceCredit[] }) => {
  const { t } = useI18n();
  return (
    <ul className="space-y-3">
      {credits.map((c) => (
        <li key={c.id} className="flex items-center gap-3">
          <Avatar name={c.name} photoUrl={c.photo_url} size={40} />
          <div className="min-w-0">
            <p className="truncate font-medium">{c.name}</p>
            <p className="text-sm text-text-secondary">{c.role.trim() || t('midiCreditRole')}</p>
          </div>
        </li>
      ))}
    </ul>
  );
});
Credits.displayName = 'Credits';
