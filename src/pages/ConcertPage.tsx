import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Coffee,
  ExternalLink,
  Eye,
  FileAudio,
  Film,
  Heading,
  Link2,
  Loader2,
  Music,
  Pencil,
  Plus,
  RotateCcw,
  Shirt,
  Sparkles,
  Trash2,
  Upload,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Input, Select } from '@/components/Input';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PageSpinner } from '@/components/Spinner';
import { NoAccess } from '@/components/NoAccess';
import { EventWhen } from '@/components/EventWhen';
import { SortableList } from '@/components/SortableList';
import { LifecycleActions, LifecycleBadge, type LifecycleAction } from '@/components/Lifecycle';
import { Toast, useToast } from '@/components/Toast';
import { ConcertFields, concertPayload, type ConcertValues } from '@/components/ConcertForm';
import { useProjectContext } from '@/layouts/projectContext';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import { Markdown } from '@/lib/markdown';
import { localeOf } from '@shared/languages';
import { track } from '@/lib/analytics';
import {
  concertFileUrl,
  formatBytes,
  isPastConcert,
  loadConcert,
  recordingMedia,
  uploadConcertFile,
  type ConcertBundle,
} from '@/lib/concerts';
import type { ConcertProgramItem, ConcertProgramKind, ConcertRecording } from '@/types';

interface ProjectPieceOption {
  id: string;
  name: string;
  composer: string;
}

const KIND_ICON: Record<ConcertProgramKind, LucideIcon> = {
  piece: Music,
  heading: Heading,
  break: Coffee,
  encore: Sparkles,
};

// One concert: when and where, its description and dress code, its
// programme and its recordings. Everyone with access reads it; managers
// edit everything in place, publish it (or take it back), archive and
// restore it — and can look at it as participants will ("Vorschau").
export const ConcertPage = () => {
  const { t, lang } = useI18n();
  const { project, canManage } = useProjectContext();
  const { concertId } = useParams();
  const navigate = useNavigate();
  const [bundle, setBundle] = useState<ConcertBundle | null | undefined>(undefined);
  const [pieces, setPieces] = useState<ProjectPieceOption[]>([]);
  const [preview, setPreview] = useState(false);
  const [editing, setEditing] = useState<ConcertValues | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    setBundle(await loadConcert(concertId ?? '', canManage));
  }, [concertId, canManage]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void api
      .from('project_pieces')
      .select('piece_id, position, pieces(id, name, composer)')
      .eq('project_id', project.id)
      .order('position')
      .then(({ data }) => {
        const rows = (data as Array<{ pieces: ProjectPieceOption | null }> | null) ?? [];
        setPieces(rows.map((r) => r.pieces).filter((p): p is ProjectPieceOption => p != null));
      });
  }, [project.id]);

  if (bundle === undefined) return <PageSpinner />;
  if (bundle === null) return <NoAccess />;

  const { concert } = bundle;
  const manage = canManage && !preview;
  const base = `/projects/${project.id}/concerts`;
  const piecesVisible = canManage || project.allow_participant_pieces;

  const patchConcert = async (patch: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    const { error: saveError } = await api.from('concerts').update(patch).eq('id', concert.id);
    setBusy(false);
    if (saveError) {
      setError(`${t('saveFailed')} (${saveError.message})`);
      return false;
    }
    await load();
    return true;
  };

  const onAction = async (action: LifecycleAction) => {
    if (action === 'preview') return setPreview(true);
    if (action === 'publish') {
      if (await patchConcert({ status: 'published' })) {
        track('concert-publish');
        toast.show(t('concertPublishedToast'), async () => void (await patchConcert({ status: 'draft' })));
      }
    } else if (action === 'unpublish') {
      if (await patchConcert({ status: 'draft' })) {
        toast.show(t('concertUnpublishedToast'), async () => void (await patchConcert({ status: 'published' })));
      }
    } else if (action === 'archive') {
      if (await patchConcert({ archived: true })) {
        toast.show(t('concertArchivedToast'), async () => void (await patchConcert({ archived: false })));
      }
    } else if (action === 'restore') {
      await patchConcert({ archived: false });
    }
  };

  const actions: LifecycleAction[] = concert.archived
    ? ['restore']
    : concert.status === 'draft'
      ? ['preview', 'publish', 'archive']
      : ['preview', 'unpublish', 'archive'];

  const saveEdit = async () => {
    if (!editing || !editing.title.trim()) return;
    if (await patchConcert(concertPayload(editing))) setEditing(null);
  };

  const remove = async () => {
    setConfirmDelete(false);
    const { error: deleteError } = await api.from('concerts').delete().eq('id', concert.id);
    if (deleteError) return setError(deleteError.message);
    navigate(base, { replace: true });
  };

  const when = concert.time && concert.end_time ? `${concert.time}–${concert.end_time}` : concert.time;

  return (
    <div className="max-w-3xl space-y-6">
      <Link
        to={base}
        className="hidden items-center gap-2 text-sm font-medium text-text-secondary transition-colors duration-150 hover:text-text md:inline-flex"
      >
        <ArrowLeft size={16} />
        {t('concerts')}
      </Link>

      {preview && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-accent/50 bg-accent/10 px-4 py-3 text-sm">
          <Eye size={16} className="flex-shrink-0" />
          <span className="min-w-0 flex-1">
            {concert.status === 'published' && !concert.archived ? t('concertPreviewHint') : t('concertPreviewHiddenHint')}
          </span>
          <Button variant="secondary" className="h-8 px-3" onClick={() => setPreview(false)}>
            <X size={14} />
            {t('concertPreviewEnd')}
          </Button>
        </div>
      )}

      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="min-w-0 break-words text-xl font-bold sm:text-2xl">{concert.title}</h1>
            {manage && (
              <LifecycleBadge state={concert.archived ? 'archived' : concert.status === 'published' ? 'published' : 'draft'} />
            )}
            {isPastConcert(concert) && (
              <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-semibold text-text-tertiary">
                {t('concertPast')}
              </span>
            )}
          </div>
          <EventWhen date={concert.date} time={when} location={concert.location || null} lang={lang} />
          {concert.date && (
            <p className="mt-0.5 text-xs text-text-tertiary">
              {new Date(`${concert.date}T00:00:00`).toLocaleDateString(localeOf(lang), {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </p>
          )}
        </div>
        {manage && (
          <div className="flex flex-shrink-0 flex-wrap gap-2">
            <LifecycleActions actions={actions} onAction={(a) => void onAction(a)} busy={busy} />
          </div>
        )}
      </header>

      {manage && isPastConcert(concert) && !concert.archived && (
        <p className="text-sm text-text-tertiary">{t('lifecyclePastHint')}</p>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}

      {editing ? (
        <Card className="space-y-4 max-sm:p-4">
          <ConcertFields value={editing} onChange={setEditing} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={busy}>
              {t('cancel')}
            </Button>
            <Button onClick={() => void saveEdit()} disabled={busy || !editing.title.trim()}>
              {busy && <Loader2 size={15} className="animate-spin" />}
              {t('save')}
            </Button>
          </div>
        </Card>
      ) : (
        <>
          {(concert.description || manage) && (
            <Card className="max-sm:p-4">
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">{t('concertAbout')}</h2>
                {manage && (
                  <Button
                    variant="secondary"
                    className="h-8 flex-shrink-0 px-3"
                    onClick={() =>
                      setEditing({
                        title: concert.title,
                        date: concert.date ?? '',
                        time: concert.time ?? '',
                        end_time: concert.end_time ?? '',
                        location: concert.location,
                        description: concert.description,
                        dress_code: concert.dress_code,
                      })
                    }
                  >
                    <Pencil size={14} />
                    {t('edit')}
                  </Button>
                )}
              </div>
              {concert.description ? (
                <Markdown source={concert.description} className="mt-2 space-y-2 break-words text-sm" />
              ) : (
                <p className="mt-2 text-sm text-text-tertiary">{t('concertNoDescription')}</p>
              )}
            </Card>
          )}
          {concert.dress_code && (
            <Card className="max-sm:p-4">
              <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-text-tertiary">
                <Shirt size={14} />
                {t('concertDressCode')}
              </h2>
              <Markdown source={concert.dress_code} className="mt-2 space-y-2 break-words text-sm" />
            </Card>
          )}
        </>
      )}

      <Program
        bundle={bundle}
        pieces={pieces}
        manage={manage}
        pieceLink={(id) => (piecesVisible ? `/projects/${project.id}/pieces/${id}` : null)}
        reload={load}
      />

      <Recordings bundle={bundle} manage={manage} reload={load} showToast={toast.show} />

      {manage && (
        <section className="rounded-2xl border border-danger/30 bg-surface p-4">
          <h2 className="text-sm font-semibold text-danger">{t('dangerZone')}</h2>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <p className="min-w-0 flex-1 text-sm text-text-secondary">{t('concertDeleteHint')}</p>
            <Button variant="secondary" onClick={() => setConfirmDelete(true)}>
              <Trash2 size={15} />
              {t('deletePermanently')}
            </Button>
          </div>
        </section>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title={t('deletePermanently')}
        message={t('concertDeleteConfirm').replace('{name}', concert.title)}
        confirmLabel={t('deletePermanently')}
        destructive
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
      <Toast toast={toast.toast} onClose={toast.hide} />
    </div>
  );
};

const SectionTitle = ({ children, action }: { children: ReactNode; action?: ReactNode }) => (
  <div className="mb-2 flex items-center justify-between gap-3">
    <h2 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">{children}</h2>
    {action}
  </div>
);

// The concert's own running order: project pieces, headings, the interval
// and encores. Managers add, reorder, annotate and remove items.
const Program = ({
  bundle,
  pieces,
  manage,
  pieceLink,
  reload,
}: {
  bundle: ConcertBundle;
  pieces: ProjectPieceOption[];
  manage: boolean;
  pieceLink: (pieceId: string) => string | null;
  reload: () => Promise<void>;
}) => {
  const { t } = useI18n();
  const [items, setItems] = useState(bundle.items);
  const [adding, setAdding] = useState<ConcertProgramKind | null>(null);
  const [pieceId, setPieceId] = useState('');
  const [title, setTitle] = useState('');
  useEffect(() => setItems(bundle.items), [bundle.items]);

  const byId = useMemo(() => new Map(pieces.map((p) => [p.id, p])), [pieces]);
  const label = (item: ConcertProgramItem) => {
    if (item.kind === 'break') return item.title || t('concertBreak');
    const piece = item.piece_id ? byId.get(item.piece_id) : undefined;
    return piece?.name ?? (item.title || (item.kind === 'encore' ? t('concertEncore') : ''));
  };

  const add = async () => {
    if (!adding) return;
    const piece = pieceId ? byId.get(pieceId) : undefined;
    if (adding === 'piece' && !piece) return;
    if (adding === 'heading' && !title.trim()) return;
    await api.from('concert_program_items').insert({
      concert_id: bundle.concert.id,
      kind: adding,
      piece_id: piece?.id ?? null,
      title: piece?.name ?? title.trim(),
      position: items.length,
    });
    setAdding(null);
    setPieceId('');
    setTitle('');
    await reload();
  };

  const startAdding = async (kind: ConcertProgramKind) => {
    // The interval needs nothing more.
    if (kind === 'break') {
      await api
        .from('concert_program_items')
        .insert({ concert_id: bundle.concert.id, kind, title: '', position: items.length });
      await reload();
      return;
    }
    setAdding(kind);
    setPieceId('');
    setTitle('');
  };

  const reorder = async (next: ConcertProgramItem[]) => {
    setItems(next);
    await Promise.all(
      next.map((item, position) =>
        item.position === position ? null : api.from('concert_program_items').update({ position }).eq('id', item.id),
      ),
    );
    await reload();
  };

  const saveNote = async (item: ConcertProgramItem, note: string) => {
    if (note === item.note) return;
    await api.from('concert_program_items').update({ note }).eq('id', item.id);
    await reload();
  };

  const remove = async (item: ConcertProgramItem) => {
    setItems((list) => list.filter((x) => x.id !== item.id));
    await api.from('concert_program_items').delete().eq('id', item.id);
    await reload();
  };

  if (!manage && items.length === 0) return null;

  // Running numbers for the pieces (not for headings, the interval, encores).
  const numbers = new Map<string, number>();
  let n = 0;
  for (const item of items) if (item.kind === 'piece') numbers.set(item.id, ++n);

  return (
    <section>
      <SectionTitle>{t('concertProgram')}</SectionTitle>
      {items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border-strong px-4 py-6 text-center text-sm text-text-secondary">
          {t('concertProgramEmpty')}
        </p>
      ) : (
        <SortableList
          items={items}
          getId={(item) => item.id}
          variant="joined"
          onReorder={manage ? (next) => void reorder(next) : undefined}
          renderItem={(item) => {
            const Icon = KIND_ICON[item.kind];
            const link = item.piece_id ? pieceLink(item.piece_id) : null;
            const name = label(item);
            const piece = item.piece_id ? byId.get(item.piece_id) : undefined;
            if (item.kind === 'heading') {
              return (
                <div className="group/item flex items-center gap-2 bg-surface-subtle px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wide text-text-secondary">
                    {name}
                  </span>
                  {manage && <RemoveButton label={name} onClick={() => void remove(item)} />}
                </div>
              );
            }
            return (
              <div className="group/item flex items-center gap-3 px-3 py-2.5">
                <span
                  className={cn(
                    'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-xs font-semibold',
                    item.kind === 'encore' ? 'bg-accent/15 text-accent' : 'bg-surface-muted text-text-secondary',
                  )}
                >
                  {numbers.get(item.id) ?? <Icon size={15} />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    {link ? (
                      <Link to={link} className="min-w-0 truncate font-medium hover:underline" title={name}>
                        {name}
                      </Link>
                    ) : (
                      <span
                        className={cn('min-w-0 truncate', item.kind === 'break' ? 'text-text-secondary' : 'font-medium')}
                        title={name}
                      >
                        {name}
                      </span>
                    )}
                    {item.kind === 'encore' && (
                      <span className="rounded bg-surface-muted px-1.5 py-px text-[10px] font-semibold text-text-secondary">
                        {t('concertEncore')}
                      </span>
                    )}
                  </div>
                  {piece?.composer && <p className="truncate text-xs text-text-tertiary">{piece.composer}</p>}
                  {manage ? (
                    <NoteInput value={item.note} onSave={(note) => void saveNote(item, note)} />
                  ) : (
                    item.note && <p className="mt-0.5 text-sm text-text-secondary">{item.note}</p>
                  )}
                </div>
                {manage && <RemoveButton label={name} onClick={() => void remove(item)} />}
              </div>
            );
          }}
        />
      )}

      {manage && (
        <div className="mt-2">
          {adding ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void add();
              }}
              className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-3 sm:flex-row sm:items-end"
            >
              <div className="min-w-0 flex-1">
                {adding === 'piece' || (adding === 'encore' && pieces.length > 0) ? (
                  <Select
                    label={adding === 'piece' ? t('concertAddPiece') : t('concertAddEncore')}
                    value={pieceId}
                    onChange={(e) => setPieceId(e.target.value)}
                    autoFocus
                  >
                    <option value="">{adding === 'encore' ? t('concertEncoreFree') : t('concertChoosePiece')}</option>
                    {pieces.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.composer ? `${p.name} – ${p.composer}` : p.name}
                      </option>
                    ))}
                  </Select>
                ) : null}
                {(adding === 'heading' || (adding === 'encore' && !pieceId)) && (
                  <div className={adding === 'encore' && pieces.length > 0 ? 'mt-2' : undefined}>
                    <Input
                      label={adding === 'heading' ? t('concertAddHeading') : t('concertEncoreTitle')}
                      value={title}
                      maxLength={300}
                      onChange={(e) => setTitle(e.target.value)}
                      autoFocus={adding === 'heading' || pieces.length === 0}
                    />
                  </div>
                )}
                {adding === 'piece' && pieces.length === 0 && (
                  <p className="text-sm text-text-tertiary">{t('concertNoProjectPieces')}</p>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" type="button" onClick={() => setAdding(null)}>
                  {t('cancel')}
                </Button>
                <Button type="submit" disabled={(adding === 'piece' && !pieceId) || (adding === 'heading' && !title.trim())}>
                  {t('add')}
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap gap-2">
              <AddButton icon={Music} label={t('concertAddPiece')} onClick={() => void startAdding('piece')} />
              <AddButton icon={Heading} label={t('concertAddHeading')} onClick={() => void startAdding('heading')} />
              <AddButton icon={Coffee} label={t('concertBreak')} onClick={() => void startAdding('break')} />
              <AddButton icon={Sparkles} label={t('concertAddEncore')} onClick={() => void startAdding('encore')} />
            </div>
          )}
        </div>
      )}
    </section>
  );
};

const AddButton = ({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) => (
  <button
    type="button"
    onClick={onClick}
    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-dashed border-border-strong px-3 text-sm text-text-secondary transition-colors hover:bg-surface-muted hover:text-text max-md:h-11"
  >
    <Plus size={14} />
    <Icon size={14} />
    {label}
  </button>
);

const RemoveButton = ({ label, onClick }: { label: string; onClick: () => void }) => {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${t('remove')}: ${label}`}
      className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-text-tertiary transition-opacity hover:bg-surface-hover hover:text-text focus:opacity-100 lg:opacity-0 lg:group-hover/item:opacity-100"
    >
      <X size={15} />
    </button>
  );
};

// A programme item's note, saved when the field is left.
const NoteInput = ({ value, onSave }: { value: string; onSave: (note: string) => void }) => {
  const { t } = useI18n();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      value={draft}
      maxLength={1000}
      placeholder={t('concertItemNote')}
      aria-label={t('concertItemNote')}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onSave(draft.trim())}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      className="-ml-1 mt-0.5 w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-sm text-text-secondary placeholder:text-text-tertiary hover:border-border focus:border-black focus:outline-none"
    />
  );
};

// Recordings of the concert, for the whole concert or one programme item:
// played right here. Managers upload files or add links, sort and assign
// them; deleting moves them to the trash (restore, or delete for good).
const Recordings = ({
  bundle,
  manage,
  reload,
  showToast,
}: {
  bundle: ConcertBundle;
  manage: boolean;
  reload: () => Promise<void>;
  showToast: (text: string, undo?: () => Promise<void> | void) => void;
}) => {
  const { t, lang } = useI18n();
  const locale = localeOf(lang);
  const { concert } = bundle;
  const [recordings, setRecordings] = useState(bundle.recordings);
  const [uploads, setUploads] = useState<Array<{ name: string; share: number }>>([]);
  const [linkForm, setLinkForm] = useState<{ url: string; title: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [purging, setPurging] = useState<string[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => setRecordings(bundle.recordings), [bundle.recordings]);

  const itemLabel = (id: string | null) => {
    const item = bundle.items.find((i) => i.id === id);
    return item ? item.title || (item.kind === 'break' ? t('concertBreak') : t('concertEncore')) : null;
  };

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    const list = [...files];
    setUploads(list.map((f) => ({ name: f.name, share: 0 })));
    let position = recordings.length;
    for (const [index, file] of list.entries()) {
      const { path, error: uploadError } = await uploadConcertFile(concert.id, file, (share) =>
        setUploads((u) => u.map((x, i) => (i === index ? { ...x, share } : x))),
      );
      if (!path) {
        setError(uploadError === 'too-large' ? t('fileTooLarge') : `${t('uploadFailed')} (${uploadError})`);
        continue;
      }
      const { error: insertError } = await api.from('concert_recordings').insert({
        concert_id: concert.id,
        kind: 'file',
        title: file.name.replace(/\.[^.]+$/, ''),
        file_path: path,
        file_name: file.name,
        mime: file.type || null,
        position: position++,
      });
      if (insertError) setError(insertError.message);
    }
    setUploads([]);
    if (inputRef.current) inputRef.current.value = '';
    track('concert-recording-upload', { files: list.length });
    await reload();
  };

  const addLink = async () => {
    if (!linkForm) return;
    const { error: insertError } = await api.from('concert_recordings').insert({
      concert_id: concert.id,
      kind: 'link',
      url: linkForm.url.trim(),
      title: linkForm.title.trim(),
      position: recordings.length,
    });
    if (insertError) return setError(insertError.message);
    setLinkForm(null);
    await reload();
  };

  const update = async (r: ConcertRecording, patch: Partial<ConcertRecording>) => {
    setRecordings((list) => list.map((x) => (x.id === r.id ? { ...x, ...patch } : x)));
    const { error: saveError } = await api.from('concert_recordings').update(patch).eq('id', r.id);
    if (saveError) setError(saveError.message);
  };

  const reorder = async (next: ConcertRecording[]) => {
    setRecordings(next);
    await Promise.all(
      next.map((r, position) =>
        r.position === position ? null : api.from('concert_recordings').update({ position }).eq('id', r.id),
      ),
    );
    await reload();
  };

  const trash = async (r: ConcertRecording) => {
    setRecordings((list) => list.filter((x) => x.id !== r.id));
    const { data, error: trashError } = await api.rpc('trash_concert_recordings', { p_ids: [r.id] });
    if (trashError) return setError(trashError.message);
    await reload();
    showToast(t('recordingTrashed'), async () => {
      await api.rpc('restore_concert_recordings', { p_ids: data as string[] });
      await reload();
    });
  };

  const restore = async (ids: string[]) => {
    await api.rpc('restore_concert_recordings', { p_ids: ids });
    await reload();
  };

  const purge = async () => {
    if (!purging) return;
    await api.rpc('purge_concert_recordings', { p_ids: purging });
    setPurging(null);
    await reload();
  };

  if (!manage && recordings.length === 0) return null;

  // Participants: grouped as the programme runs, the whole concert first.
  const groups = [
    { id: 'concert', label: null as string | null, list: recordings.filter((r) => !r.item_id) },
    ...bundle.items.map((item) => ({
      id: item.id,
      label: itemLabel(item.id),
      list: recordings.filter((r) => r.item_id === item.id),
    })),
  ].filter((g) => g.list.length > 0);

  const row = (r: ConcertRecording) => (
    <RecordingRow
      recording={r}
      manage={manage}
      items={bundle.items}
      itemLabel={itemLabel}
      locale={locale}
      onUpdate={(patch) => void update(r, patch)}
      onTrash={() => void trash(r)}
    />
  );

  return (
    <section>
      <SectionTitle>{t('concertRecordings')}</SectionTitle>
      {recordings.length === 0 && manage && (
        <p className="mb-2 rounded-2xl border border-dashed border-border-strong px-4 py-6 text-center text-sm text-text-secondary">
          {t('concertRecordingsEmpty')}
        </p>
      )}
      {manage ? (
        recordings.length > 0 && (
          <SortableList items={recordings} getId={(r) => r.id} onReorder={(next) => void reorder(next)} renderItem={row} />
        )
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.id}>
              {g.label && <p className="mb-1.5 text-sm font-medium text-text-secondary">{g.label}</p>}
              <ul className="space-y-2">
                {g.list.map((r) => (
                  <li key={r.id} className="rounded-2xl border border-border bg-surface">
                    {row(r)}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {manage && (
        <div className="mt-2 space-y-2">
          {uploads.map((u) => (
            <div key={u.name} className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2 text-sm">
              <Loader2 size={14} className="animate-spin text-text-tertiary" />
              <span className="min-w-0 flex-1 truncate">{u.name}</span>
              <span className="tabular-nums text-text-tertiary">{Math.round(u.share * 100)} %</span>
            </div>
          ))}
          {linkForm ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void addLink();
              }}
              className="grid gap-2 rounded-2xl border border-border bg-surface p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
            >
              <Input
                label={t('linkUrl')}
                type="url"
                required
                placeholder="https://"
                value={linkForm.url}
                onChange={(e) => setLinkForm({ ...linkForm, url: e.target.value })}
                autoFocus
              />
              <Input
                label={`${t('title')} (${t('optional')})`}
                value={linkForm.title}
                maxLength={300}
                onChange={(e) => setLinkForm({ ...linkForm, title: e.target.value })}
              />
              <div className="flex gap-2">
                <Button variant="secondary" type="button" onClick={() => setLinkForm(null)}>
                  {t('cancel')}
                </Button>
                <Button type="submit" disabled={!linkForm.url.trim()}>
                  {t('add')}
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap gap-2">
              <AddButton icon={Upload} label={t('concertUploadRecording')} onClick={() => inputRef.current?.click()} />
              <AddButton icon={Link2} label={t('concertAddLink')} onClick={() => setLinkForm({ url: '', title: '' })} />
              <input
                ref={inputRef}
                type="file"
                multiple
                accept="audio/*,video/*"
                className="hidden"
                onChange={(e) => void upload(e.target.files)}
              />
            </div>
          )}
          {error && <p className="text-sm text-danger">{error}</p>}

          {bundle.trash.length > 0 && (
            <details className="rounded-2xl border border-border bg-surface px-4 py-3">
              <summary className="cursor-pointer text-sm font-medium text-text-secondary">
                {t('trash')} ({bundle.trash.length})
              </summary>
              <p className="mt-1 text-xs text-text-tertiary">{t('concertTrashHint')}</p>
              <ul className="mt-2 divide-y divide-border">
                {bundle.trash.map((entry) => (
                  <li key={entry.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">
                      {entry.row.title || entry.row.file_name || entry.row.url}
                      <span className="ml-2 text-xs text-text-tertiary">
                        {entry.deleted_by_name} ·{' '}
                        {new Date(entry.deleted_at).toLocaleDateString(locale, { day: 'numeric', month: 'short' })}
                      </span>
                    </span>
                    <Button variant="secondary" className="h-8 px-3" onClick={() => void restore([entry.id])}>
                      <RotateCcw size={14} />
                      {t('restore')}
                    </Button>
                    <Button variant="secondary" className="h-8 px-3" onClick={() => setPurging([entry.id])}>
                      <Trash2 size={14} />
                      {t('deletePermanently')}
                    </Button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <ConfirmDialog
        open={purging != null}
        title={t('deletePermanently')}
        message={t('confirmDeleteFile')}
        confirmLabel={t('deletePermanently')}
        destructive
        onConfirm={() => void purge()}
        onCancel={() => setPurging(null)}
      />
    </section>
  );
};

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};

const RecordingRow = ({
  recording: r,
  manage,
  items,
  itemLabel,
  locale,
  onUpdate,
  onTrash,
}: {
  recording: ConcertRecording;
  manage: boolean;
  items: ConcertProgramItem[];
  itemLabel: (id: string | null) => string | null;
  locale: string;
  onUpdate: (patch: Partial<ConcertRecording>) => void;
  onTrash: () => void;
}) => {
  const { t } = useI18n();
  const media = r.kind === 'file' ? recordingMedia(r) : null;
  const Icon = r.kind === 'link' ? ExternalLink : media === 'video' ? Film : FileAudio;
  const [title, setTitle] = useState(r.title);
  useEffect(() => setTitle(r.title), [r.title]);
  const name = r.title || r.file_name || r.url || '';
  const src = r.file_path ? concertFileUrl(r.file_path) : null;
  // Only web links become links (the server refuses others too).
  const href = r.url && /^https?:\/\//i.test(r.url) ? r.url : null;

  return (
    <div className="group/item space-y-2 px-3 py-2.5">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-surface-muted text-chart-4">
          <Icon size={15} />
        </span>
        <div className="min-w-0 flex-1">
          {manage ? (
            <input
              value={title}
              maxLength={300}
              aria-label={t('title')}
              placeholder={r.file_name ?? r.url ?? ''}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => title.trim() !== r.title && onUpdate({ title: title.trim() })}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              className="-ml-1 w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 font-medium hover:border-border focus:border-black focus:outline-none"
            />
          ) : r.kind === 'link' && href ? (
            <a href={href} target="_blank" rel="noopener noreferrer" className="block truncate font-medium hover:underline">
              {name}
            </a>
          ) : (
            <p className="truncate font-medium">{name}</p>
          )}
          <p className="flex flex-wrap items-center gap-x-2 truncate text-xs text-text-tertiary">
            {r.kind === 'link' ? (
              <span className="truncate">{r.url ? hostOf(r.url) : ''}</span>
            ) : (
              <>
                {r.size != null && <span>{formatBytes(r.size, locale)}</span>}
                {r.uploaded_by_name && <span>{r.uploaded_by_name}</span>}
              </>
            )}
            {manage && itemLabel(r.item_id) && <span>· {itemLabel(r.item_id)}</span>}
          </p>
        </div>
        {r.file_missing && (
          <span className="inline-flex items-center gap-1 rounded-full bg-danger-soft px-2 py-0.5 text-xs font-semibold text-danger-strong">
            <AlertTriangle size={12} />
            {t('fileMissing')}
          </span>
        )}
        {r.kind === 'link' && href && manage && (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t('openLink')}
            className="flex h-8 w-8 items-center justify-center rounded-md text-text-tertiary hover:bg-surface-hover hover:text-text"
          >
            <ExternalLink size={15} />
          </a>
        )}
        {manage && (
          <button
            type="button"
            onClick={onTrash}
            aria-label={`${t('delete')}: ${name}`}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-text-tertiary transition-opacity hover:bg-surface-hover hover:text-text focus:opacity-100 lg:opacity-0 lg:group-hover/item:opacity-100"
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>
      {manage && items.some((i) => i.kind !== 'heading') && (
        <select
          value={r.item_id ?? ''}
          aria-label={t('concertRecordingFor')}
          onChange={(e) => onUpdate({ item_id: e.target.value || null })}
          className="w-full rounded-md border border-border bg-white px-2 py-1 pr-8 text-sm sm:w-auto"
        >
          <option value="">{t('concertWholeConcert')}</option>
          {items
            .filter((i) => i.kind !== 'heading')
            .map((i) => (
              <option key={i.id} value={i.id}>
                {itemLabel(i.id)}
              </option>
            ))}
        </select>
      )}
      {src && !r.file_missing && media === 'audio' && <audio controls preload="none" src={src} className="w-full" />}
      {src && !r.file_missing && media === 'video' && (
        <video controls preload="metadata" src={src} className="max-h-[60vh] w-full rounded-xl bg-scrim" />
      )}
      {src && !r.file_missing && !media && (
        <a href={`${src}?download=${encodeURIComponent(r.file_name ?? '')}`} className="text-sm font-medium underline">
          {t('download')}
        </a>
      )}
    </div>
  );
};
