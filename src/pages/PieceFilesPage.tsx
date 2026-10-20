import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  FilePlus2,
  Folder,
  FolderInput,
  FolderPlus,
  FolderUp,
  Globe,
  LayoutGrid,
  Link as LinkIcon,
  List,
  ListFilter,
  Loader2,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Share,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Modal } from '@/components/Modal';
import { OverflowMenu, type OverflowMenuItem } from '@/components/OverflowMenu';
import { PageSpinner } from '@/components/Spinner';
import { MultiDropzone, fileIcon, fileTone, pickedFromDrop, usePieceUploads, type PickedFile } from '@/components/PieceFileParts';
import { usePieceLayout } from '@/layouts/PieceLayout';
import { usePieceScope } from '@/layouts/pieceScope';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import { sizeBucket, track } from '@/lib/analytics';
import { shareFile, sharesDownloads } from '@/lib/pwa';
import { localeOf } from '@shared/languages';
import {
  arrangePieceFiles,
  fetchLinkPreview,
  isFileDownloadable,
  isFolderDownloadable,
  loadPieceTrash,
  pieceDownloadName,
  pieceFileDownloadUrl,
  pieceFileUrl,
  pieceZipUrl,
  purgePieceTrash,
  queryPieceFiles,
  restorePieceFiles,
  trashPieceFiles,
} from '@/lib/pieceFiles';
import type { PieceFile, PieceFileFolder, PieceFileTrashEntry } from '@/types';

type View = 'grid' | 'list';
type SortKey = 'manual' | 'name' | 'modified' | 'size' | 'type';
interface Sort {
  key: SortKey;
  // 1 ascending, -1 descending.
  dir: 1 | -1;
}
// Something on the page: a folder or a file (links count as files).
type Item = { kind: 'folder'; folder: PieceFileFolder } | { kind: 'file'; file: PieceFile };
// Where dragged items land: into a folder (null = the top), or next to an
// item of their kind (custom order only).
type DropAt = { into: string | null } | { beside: Item; after: boolean };

const VIEW_KEY = 'anwesenheit.pieceFiles.view';
const SORT_KEY = 'anwesenheit.pieceFiles.sort';

const readStored = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};
const store = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
};

// Items are told apart by kind and id ("d:…", "f:…").
const keyOf = (item: Item) => (item.kind === 'folder' ? `d:${item.folder.id}` : `f:${item.file.id}`);
const idOf = (item: Item) => (item.kind === 'folder' ? item.folder.id : item.file.id);
const byPosition = <T extends { position: number; created_at: string }>(a: T, b: T) =>
  a.position - b.position || a.created_at.localeCompare(b.created_at);
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

// A link without its own name (or named like its address) shows the
// linked page's title.
const fileName = (f: PieceFile) => {
  const own = f.title.trim();
  if (f.kind === 'link' && (!own || own === f.url)) return f.link_preview?.title || f.url || '—';
  return own || f.file_name || f.url || '—';
};
const itemName = (item: Item) => (item.kind === 'folder' ? item.folder.name : fileName(item.file));
// Where a link leads, shortly: the site's name or its host.
const linkSite = (f: PieceFile) => {
  if (f.link_preview?.site) return f.link_preview.site;
  try {
    return new URL(f.url ?? '').hostname.replace(/^www\./, '');
  } catch {
    return f.url ?? '';
  }
};
const fileExt = (f: PieceFile) => /\.[a-z0-9]{1,8}$/i.exec(f.file_name ?? '')?.[0] ?? '';
const modifiedAt = (item: Item) =>
  item.kind === 'folder' ? item.folder.created_at : item.file.replaced_at ?? item.file.created_at;
const isLink = (item: Item) => item.kind === 'file' && item.file.kind === 'link';

const formatSize = (bytes: number | null, locale: string) => {
  if (bytes == null) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toLocaleString(locale, { maximumFractionDigits: unit > 1 ? 1 : 0 })} ${units[unit]}`;
};

// Opened in the browser rather than downloaded.
const INLINE = /\.(pdf|png|jpe?g|gif|webp|avif|mp3|m4a|aac|wav|ogg|oga|opus|flac|mp4|webm|txt)$/i;

const clickLink = (href: string, newTab = false) => {
  const a = document.createElement('a');
  a.href = href;
  if (newTab) {
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  }
  document.body.appendChild(a);
  a.click();
  a.remove();
};

// A menu at the pointer (right click), styled like OverflowMenu's.
const PointMenu = ({
  at,
  items,
  onClose,
}: {
  at: { x: number; y: number };
  items: OverflowMenuItem[];
  onClose: () => void;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const margin = 8;
    setPosition({
      left: Math.max(margin, Math.min(at.x, window.innerWidth - el.offsetWidth - margin)),
      top: Math.max(margin, Math.min(at.y, window.innerHeight - el.offsetHeight - margin)),
    });
    el.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true });
  }, [at]);
  useEffect(() => {
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);
  return createPortal(
    <div
      ref={ref}
      role="menu"
      className="fixed z-[70] min-w-[12rem] rounded-xl border border-border bg-surface p-1 shadow-lg"
      style={position ?? { top: -9999, left: -9999 }}
      onKeyDown={(e) => {
        const list = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
        const at = list.indexOf(document.activeElement as HTMLButtonElement);
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          list[(at + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus();
        }
      }}
    >
      {items.map(({ icon: Icon, label, onSelect, disabled, separated }) => (
        <div key={label}>
          {separated && <div role="separator" className="-mx-1 my-1 border-t border-border" />}
          <button
            type="button"
            role="menuitem"
            disabled={disabled}
            onClick={() => {
              onClose();
              onSelect();
            }}
            className="flex w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm transition-colors duration-150 hover:bg-surface-muted focus:bg-surface-muted focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Icon size={16} className="text-text-secondary" />
            {label}
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
};

// "Ansicht": grid or list, the sort order and (for editors) the trash, in
// one menu so the toolbar stays calm.
const ViewMenu = ({
  view,
  onView,
  sort,
  onSort,
  onTrash,
}: {
  view: View;
  onView: (view: View) => void;
  sort: Sort;
  onSort: (sort: Sort) => void;
  onTrash?: () => void;
}) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return setPosition(null);
    const place = () => {
      const trigger = ref.current?.getBoundingClientRect();
      if (!trigger) return;
      const width = panel.current?.offsetWidth ?? 240;
      setPosition({
        top: trigger.bottom + 4,
        left: Math.max(8, Math.min(trigger.right - width, window.innerWidth - width - 8)),
      });
    };
    place();
    const frame = requestAnimationFrame(place);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!ref.current?.contains(target) && !panel.current?.contains(target)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const sorts: Array<[SortKey, string]> = [
    ['manual', t('sortManual')],
    ['name', t('name')],
    ['modified', t('sortModified')],
    ['size', t('sortSize')],
    ['type', t('sortType')],
  ];
  const sectionTitle = 'px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-text-tertiary';
  const row =
    'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors duration-150 hover:bg-surface-muted focus:bg-surface-muted focus:outline-none';

  return (
    <div ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={t('view')}
        className={cn(
          'inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-surface px-3 text-sm font-medium transition-colors duration-150 hover:bg-surface-muted max-sm:w-9 max-sm:px-0',
          open && 'bg-surface-muted',
        )}
      >
        <ListFilter size={16} />
        <span className="hidden sm:inline">{t('view')}</span>
        <ChevronDown size={15} className={cn('hidden text-text-secondary transition-transform duration-150 sm:inline', open && 'rotate-180')} />
      </button>
      {open &&
        createPortal(
          <div
            ref={panel}
            role="dialog"
            aria-label={t('view')}
            className="fixed z-[70] w-60 rounded-xl border border-border bg-surface p-1 shadow-lg"
            style={position ?? { top: -9999, left: -9999 }}
          >
            <p className={sectionTitle}>{t('view')}</p>
            <div className="grid grid-cols-2 gap-1 px-1 pb-1">
              {(
                [
                  ['grid', LayoutGrid, t('viewGrid')],
                  ['list', List, t('viewList')],
                ] as const
              ).map(([id, Icon, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => onView(id)}
                  aria-pressed={view === id}
                  className={cn(
                    'flex h-9 items-center justify-center gap-2 rounded-lg border text-sm transition-colors duration-150',
                    view === id ? 'border-black bg-surface-muted font-medium' : 'border-border text-text-secondary hover:text-text',
                  )}
                >
                  <Icon size={15} />
                  {label}
                </button>
              ))}
            </div>
            <div role="separator" className="-mx-1 my-1 border-t border-border" />
            <p className={sectionTitle}>{t('sortBy')}</p>
            {sorts.map(([key, label]) => {
              const active = sort.key === key;
              const Arrow = sort.dir === 1 ? ArrowUp : ArrowDown;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={active}
                  // A second click on the active one turns the direction.
                  onClick={() =>
                    onSort(
                      active && key !== 'manual'
                        ? { key, dir: sort.dir === 1 ? -1 : 1 }
                        : { key, dir: key === 'modified' ? -1 : 1 },
                    )
                  }
                  className={cn(row, active && 'font-medium')}
                >
                  <Check size={15} className={cn('flex-shrink-0', active ? 'text-text' : 'invisible')} />
                  <span className="flex-1">{label}</span>
                  {active && key !== 'manual' && <Arrow size={14} className="text-text-secondary" />}
                </button>
              );
            })}
            {onTrash && (
              <>
                <div role="separator" className="-mx-1 my-1 border-t border-border" />
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onTrash();
                  }}
                  className={row}
                >
                  <Trash2 size={15} className="text-text-secondary" />
                  {t('trash')}
                </button>
              </>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
};

// A piece's "Dateien" as a file browser: folders opened with breadcrumbs, in
// a grid or a list with columns. A click selects (Ctrl/⌘ and Shift add to
// it), a double click — or a tap on touch screens — opens; right click shows
// the actions. Everyone downloads what is public (a file, a folder or a
// selection as one ZIP); the piece's editors upload (also whole folders,
// dropped anywhere), make folders and links, rename, replace a file by a new
// version, switch items public or private, move them (dragging onto a folder
// or a breadcrumb, or "Move to …") and delete them into the trash. Moves,
// deletions and visibility changes can be undone.
export const PieceFilesPage = () => {
  const { t, lang } = useI18n();
  const locale = localeOf(lang);
  const { canEdit } = usePieceScope();
  const { piece } = usePieceLayout();
  const touch = useMediaQuery('(pointer: coarse)');
  const [searchParams, setSearchParams] = useSearchParams();
  const [files, setFiles] = useState<PieceFile[]>([]);
  const [folders, setFolders] = useState<PieceFileFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setViewState] = useState<View>(() => readStored<View>(VIEW_KEY, 'grid'));
  const [sort, setSortState] = useState<Sort>(() => readStored<Sort>(SORT_KEY, { key: 'manual', dir: 1 }));
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const anchor = useRef<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [moving, setMoving] = useState<Item[] | null>(null);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number; items: Item[] } | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkName, setLinkName] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [toast, setToast] = useState<{ id: number; text: string; undo?: () => Promise<void>; share?: File } | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const [trash, setTrash] = useState<PieceFileTrashEntry[] | null>(null);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  // Drag and drop: the items dragged (null while files come from outside),
  // where they would land, and whether files from outside hover the page.
  const dragged = useRef<Item[] | null>(null);
  const [dropAt, setDropAt] = useState<{ key: string; at: DropAt } | null>(null);
  const [outsideOver, setOutsideOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const replacing = useRef<PieceFile | null>(null);

  // A failed read keeps what is shown and says so (with a retry).
  const load = useCallback(async () => {
    const [pieceFiles, { data: folderRows, error: folderError }] = await Promise.all([
      queryPieceFiles(piece.id),
      api.from('piece_file_folders').select('*').eq('piece_id', piece.id),
    ]);
    const error = pieceFiles.error ?? folderError?.message ?? null;
    setLoadError(error);
    if (!error) {
      setFiles(pieceFiles.files);
      setFolders((folderRows as PieceFileFolder[] | null) ?? []);
    }
    setLoading(false);
  }, [piece.id]);

  useEffect(() => {
    void load();
  }, [load]);

  // A write the server refused: say so and show what is really stored.
  const failed = (message: string) => {
    setNotice(`${t('saveFailed')} (${message})`);
    void load();
  };

  // Something done, for a few seconds, with "Undo" when it can be.
  const toastTimer = useRef<number>();
  const showToast = (text: string, undo?: () => Promise<void>, share?: File) => {
    window.clearTimeout(toastTimer.current);
    const id = Date.now();
    setToast({ id, text, undo, share });
    toastTimer.current = window.setTimeout(() => setToast((x) => (x?.id === id ? null : x)), 8000);
  };

  const setView = (next: View) => {
    setViewState(next);
    store(VIEW_KEY, next);
    track('files-view', { view: next });
  };
  const setSort = (next: Sort) => {
    setSortState(next);
    store(SORT_KEY, next);
    track('files-sort', { key: next.key });
  };

  // A folder or file whose folder is gone is at the top.
  const known = useMemo(() => new Set(folders.map((d) => d.id)), [folders]);
  const parentOf = (d: PieceFileFolder) => (d.parent_id && known.has(d.parent_id) ? d.parent_id : null);
  const folderOf = (f: PieceFile) => (f.folder_id && known.has(f.folder_id) ? f.folder_id : null);
  const parentOfItem = (item: Item) => (item.kind === 'folder' ? parentOf(item.folder) : folderOf(item.file));

  // Public: it and every folder above (members see only that); private
  // because of a folder above, while itself public.
  const isPublic = (item: Item) =>
    item.kind === 'folder' ? isFolderDownloadable(item.folder.id, folders) : isFileDownloadable(item.file, folders);
  const ownPublic = (item: Item) => (item.kind === 'folder' ? item.folder.downloadable : item.file.downloadable);
  const visible = (item: Item) =>
    canEdit || (isPublic(item) && (item.kind === 'folder' || item.file.file_path != null || item.file.kind === 'link'));

  const compare = (a: Item, b: Item) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    const byName = collator.compare(itemName(a), itemName(b));
    switch (sort.key) {
      case 'manual':
        return a.kind === 'folder' && b.kind === 'folder'
          ? byPosition(a.folder, b.folder)
          : byPosition((a as { file: PieceFile }).file, (b as { file: PieceFile }).file);
      case 'name':
        return sort.dir * byName;
      case 'modified':
        return sort.dir * modifiedAt(a).localeCompare(modifiedAt(b)) || byName;
      case 'size':
        return a.kind === 'file' && b.kind === 'file' ? sort.dir * ((a.file.size ?? -1) - (b.file.size ?? -1)) || byName : byName;
      case 'type':
        return a.kind === 'file' && b.kind === 'file'
          ? sort.dir * collator.compare(fileExt(a.file) || a.file.kind, fileExt(b.file) || b.file.kind) || byName
          : byName;
    }
  };

  const allItems = useMemo<Item[]>(
    () => [
      ...folders.map((folder): Item => ({ kind: 'folder', folder })),
      ...files.map((file): Item => ({ kind: 'file', file })),
    ],
    [folders, files],
  );
  const itemsIn = (folderId: string | null) =>
    allItems.filter((i) => parentOfItem(i) === folderId && visible(i)).sort(compare);
  const subfolders = (parentId: string | null) =>
    folders.filter((d) => parentOf(d) === parentId).sort(byPosition);
  const filesIn = (folderId: string | null) => files.filter((f) => folderOf(f) === folderId).sort(byPosition);

  // The open folder (?folder=…) and the way there.
  const openId = searchParams.get('folder');
  const current =
    openId && known.has(openId) && visible({ kind: 'folder', folder: folders.find((d) => d.id === openId)! }) ? openId : null;
  const pathTo = (folderId: string | null) => {
    const trail: PieceFileFolder[] = [];
    for (let id = folderId; id; ) {
      const d = folders.find((x) => x.id === id);
      if (!d || trail.includes(d)) break;
      trail.unshift(d);
      id = parentOf(d);
    }
    return trail;
  };
  const trail = pathTo(current);
  const open = (folderId: string | null) => {
    setSearchParams(folderId ? { folder: folderId } : {});
    setSelected([]);
    setQuery('');
    setLinkOpen(false);
  };

  // Searching looks through every folder.
  const searching = query.trim().length > 0;
  const items = searching
    ? allItems.filter((i) => visible(i) && fold(itemName(i)).includes(fold(query.trim()))).sort(compare)
    : itemsIn(current);
  const reorderable = canEdit && sort.key === 'manual' && !searching;

  // A folder and everything in it (so it can't be moved into itself).
  const isInside = (folderId: string | null, ancestorId: string): boolean => {
    for (let id = folderId, guard = 0; id && guard < 1000; guard++) {
      if (id === ancestorId) return true;
      const d = folders.find((x) => x.id === id);
      id = d ? parentOf(d) : null;
    }
    return false;
  };

  // Selected items still on the page, in page order.
  const selectedItems = items.filter((i) => selected.includes(keyOf(i)));

  // --- uploads ----------------------------------------------------------------

  // Folders for files of dropped folders: an existing one of the same name,
  // else a new one (made once, however many files go into it).
  const foldersRef = useRef(folders);
  foldersRef.current = folders;
  const making = useRef(new Map<string, Promise<string | null>>());
  const folderFor = async (parentId: string | null, dirs: string[]): Promise<string | null> => {
    let parent = parentId;
    for (let depth = 0; depth < dirs.length; depth++) {
      const path = `${parentId}/${dirs.slice(0, depth + 1).join('/')}`;
      const name = dirs[depth];
      const under = parent;
      let pending = making.current.get(path);
      if (!pending) {
        pending = (async () => {
          const existing = foldersRef.current.find((d) => d.parent_id === under && d.name.toLowerCase() === name.toLowerCase());
          if (existing) return existing.id;
          const { data } = await api
            .from('piece_file_folders')
            .insert({
              piece_id: piece.id,
              parent_id: under,
              name,
              position: foldersRef.current.filter((d) => d.parent_id === under).length,
            })
            .select('*')
            .single();
          if (!data) return null;
          setFolders((list) => [...list, data as PieceFileFolder]);
          return (data as PieceFileFolder).id;
        })();
        making.current.set(path, pending);
      }
      parent = await pending;
      if (!parent) {
        making.current.delete(path);
        return null;
      }
    }
    return parent;
  };

  const { addFiles, replaceFile, uploadList } = usePieceUploads(piece.id, {
    nextPosition: (folderId) => files.filter((f) => folderOf(f) === folderId).length,
    onAdded: (row) => setFiles((list) => [...list, row]),
    onReplaced: (row) => setFiles((list) => list.map((f) => (f.id === row.id ? row : f))),
    folderFor,
    folderId: current,
  });
  const upload = (picked: PickedFile[], into: string | null = current) => {
    making.current.clear();
    void addFiles(picked, into);
  };

  // --- writes -------------------------------------------------------------------

  // Puts `moved` into `parentId` (at `index` among their kind there, the end
  // when omitted) and numbers the lists again — written all at once, with
  // Undo.
  const moveItems = (moved: Item[], parentId: string | null, index?: number) => {
    const movedFolders = moved.flatMap((i) => (i.kind === 'folder' ? [i.folder] : []));
    const movedFiles = moved.flatMap((i) => (i.kind === 'file' ? [i.file] : []));
    if (parentId && movedFolders.some((d) => isInside(parentId, d.id))) return;
    const folderRows: Array<Pick<PieceFileFolder, 'id' | 'parent_id' | 'position'>> = [];
    const fileRows: Array<Pick<PieceFile, 'id' | 'folder_id' | 'position'>> = [];
    const undoFolders: typeof folderRows = [];
    const undoFiles: typeof fileRows = [];
    if (movedFolders.length) {
      const list = subfolders(parentId).filter((d) => !movedFolders.includes(d));
      list.splice(index ?? list.length, 0, ...movedFolders);
      list.forEach((d, position) => {
        if (d.position !== position || parentOf(d) !== parentId) {
          folderRows.push({ id: d.id, parent_id: parentId, position });
          undoFolders.push({ id: d.id, parent_id: d.parent_id, position: d.position });
        }
      });
    }
    if (movedFiles.length) {
      const list = filesIn(parentId).filter((f) => !movedFiles.includes(f));
      list.splice(index ?? list.length, 0, ...movedFiles);
      list.forEach((f, position) => {
        if (f.position !== position || folderOf(f) !== parentId) {
          fileRows.push({ id: f.id, folder_id: parentId, position });
          undoFiles.push({ id: f.id, folder_id: f.folder_id, position: f.position });
        }
      });
    }
    if (folderRows.length === 0 && fileRows.length === 0) return;
    const apply = (fr: typeof folderRows, fl: typeof fileRows) => {
      setFolders((all) => all.map((d) => ({ ...d, ...fr.find((r) => r.id === d.id) })));
      setFiles((all) => all.map((f) => ({ ...f, ...fl.find((r) => r.id === f.id) })));
    };
    apply(folderRows, fileRows);
    void arrangePieceFiles(piece.id, folderRows, fileRows).then((error) => {
      if (error) return failed(error);
      const movedAway = moved.some((i) => parentOfItem(i) !== parentId);
      if (!movedAway) return;
      track('files-move', { count: sizeBucket(moved.length) });
      showToast(t('movedCount').replace('{n}', String(moved.length)), async () => {
        apply(undoFolders, undoFiles);
        const undoError = await arrangePieceFiles(piece.id, undoFolders, undoFiles);
        if (undoError) failed(undoError);
      });
    });
  };

  // Files go to the trash; a deleted folder's content moves up. With Undo:
  // the folders come back (same ids) with their content, the files out of
  // the trash.
  const deleteItems = async (doomed: Item[]) => {
    if (doomed.length === 0) return;
    const doomedFolders = doomed.flatMap((i) => (i.kind === 'folder' ? [i.folder] : []));
    const doomedFiles = doomed.flatMap((i) => (i.kind === 'file' ? [i.file] : []));
    const gone = new Set(doomedFolders.map((d) => d.id));
    // Where content of deleted folders ends up: the nearest folder above
    // that stays.
    const survivor = (id: string | null): string | null => {
      for (let at = id, guard = 0; at && guard < 1000; guard++) {
        if (!gone.has(at)) return at;
        const d = folders.find((x) => x.id === at);
        at = d ? parentOf(d) : null;
      }
      return null;
    };
    const keptFolders = folders.filter((d) => !gone.has(d.id) && d.parent_id && gone.has(d.parent_id));
    const keptFiles = files.filter((f) => !doomedFiles.includes(f) && f.folder_id && gone.has(f.folder_id));
    setSelected([]);
    setFolders((all) =>
      all.filter((d) => !gone.has(d.id)).map((d) => (d.parent_id && gone.has(d.parent_id) ? { ...d, parent_id: survivor(d.parent_id) } : d)),
    );
    setFiles((all) =>
      all
        .filter((f) => !doomedFiles.includes(f))
        .map((f) => (f.folder_id && gone.has(f.folder_id) ? { ...f, folder_id: survivor(f.folder_id) } : f)),
    );

    const { trashIds, error } = doomedFiles.length ? await trashPieceFiles(doomedFiles.map((f) => f.id)) : { trashIds: [], error: null };
    if (error) return failed(error);
    if (gone.size) {
      const { error: folderError } = await api.from('piece_file_folders').delete().in('id', [...gone]);
      if (folderError) return failed(folderError.message);
    }
    track('files-delete', { count: sizeBucket(doomed.length) });
    showToast(t('deletedCount').replace('{n}', String(doomed.length)), async () => {
      // Parents before the folders inside them.
      const depth = (d: PieceFileFolder) => pathTo(d.id).length;
      for (const d of [...doomedFolders].sort((a, b) => depth(a) - depth(b))) {
        const { error: insertError } = await api.from('piece_file_folders').insert({
          id: d.id,
          piece_id: d.piece_id,
          parent_id: d.parent_id,
          name: d.name,
          position: d.position,
          downloadable: d.downloadable,
        });
        if (insertError) return failed(insertError.message);
      }
      const arrangeError = await arrangePieceFiles(
        piece.id,
        keptFolders.map((d) => ({ id: d.id, parent_id: d.parent_id, position: d.position })),
        keptFiles.map((f) => ({ id: f.id, folder_id: f.folder_id, position: f.position })),
      );
      const restoreError = trashIds.length ? await restorePieceFiles(trashIds) : null;
      if (arrangeError || restoreError) return failed(arrangeError ?? restoreError ?? '');
      void load();
    });
  };

  // Public or private, with Undo.
  const setPublic = async (targets: Item[], value: boolean) => {
    const changed = targets.filter((i) => ownPublic(i) !== value);
    if (changed.length === 0) return;
    const folderIds = changed.flatMap((i) => (i.kind === 'folder' ? [i.folder.id] : []));
    const fileIds = changed.flatMap((i) => (i.kind === 'file' ? [i.file.id] : []));
    const write = async (to: boolean) => {
      setFolders((all) => all.map((d) => (folderIds.includes(d.id) ? { ...d, downloadable: to } : d)));
      setFiles((all) => all.map((f) => (fileIds.includes(f.id) ? { ...f, downloadable: to } : f)));
      const results = await Promise.all([
        folderIds.length ? api.from('piece_file_folders').update({ downloadable: to }).in('id', folderIds) : null,
        fileIds.length ? api.from('piece_files').update({ downloadable: to }).in('id', fileIds) : null,
      ]);
      const error = results.find((r) => r?.error)?.error;
      if (error) failed(error.message);
      return !error;
    };
    if (!(await write(value))) return;
    track('files-visibility', { public: value, count: sizeBucket(changed.length) });
    showToast(t(value ? 'madePublicCount' : 'madePrivateCount').replace('{n}', String(changed.length)), async () => {
      await write(!value);
    });
  };

  const rename = (item: Item, name: string) => {
    const patch =
      item.kind === 'folder'
        ? { name }
        : { title: name, ...(item.file.file_name ? { file_name: name + fileExt(item.file) } : {}) };
    if (item.kind === 'folder') setFolders((all) => all.map((d) => (d.id === item.folder.id ? { ...d, ...patch } : d)));
    else setFiles((all) => all.map((f) => (f.id === item.file.id ? { ...f, ...patch } : f)));
    void api
      .from(item.kind === 'folder' ? 'piece_file_folders' : 'piece_files')
      .update(patch)
      .eq('id', idOf(item))
      .then(({ error }) => error && failed(error.message));
  };

  const addFolder = async () => {
    const { data, error } = await api
      .from('piece_file_folders')
      .insert({ piece_id: piece.id, parent_id: current, name: t('newFolderName'), position: subfolders(current).length })
      .select('*')
      .single();
    if (error || !data) return failed(error?.message ?? t('uploadError'));
    const folder = data as PieceFileFolder;
    setFolders((list) => [...list, folder]);
    setSelected([`d:${folder.id}`]);
    setRenaming(`d:${folder.id}`);
    track('files-new-folder');
  };

  // Has the server read the linked page (title, site, image) again.
  const refreshPreview = async (file: PieceFile) => {
    setPreviewBusy((list) => [...list, file.id]);
    const { preview } = await fetchLinkPreview(file.id);
    setPreviewBusy((list) => list.filter((id) => id !== file.id));
    if (preview) setFiles((list) => list.map((f) => (f.id === file.id ? { ...f, link_preview: preview } : f)));
  };

  // A web link into the open folder; its preview follows.
  const addLink = async () => {
    const raw = linkUrl.trim();
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
    let url: string | null = null;
    try {
      const parsed = new URL(withScheme);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') url = parsed.toString();
    } catch {
      url = null;
    }
    if (!url) return setLinkError(t('invalidUrl'));
    setLinkBusy(true);
    const { data, error } = await api
      .from('piece_files')
      .insert({
        piece_id: piece.id,
        kind: 'link',
        title: linkName.trim(),
        url,
        folder_id: current,
        position: filesIn(current).length,
      })
      .select('*')
      .single();
    setLinkBusy(false);
    if (error || !data) return setLinkError(error?.message ?? t('uploadError'));
    const link = data as PieceFile;
    setFiles((list) => [...list, link]);
    setLinkUrl('');
    setLinkName('');
    setLinkOpen(false);
    track('files-add-link');
    void refreshPreview(link);
  };

  // --- trash ----------------------------------------------------------------------

  const openTrash = async () => {
    setTrashOpen(true);
    setTrash(null);
    setTrash(await loadPieceTrash(piece.id));
    track('files-trash-open');
  };
  const restore = async (entries: PieceFileTrashEntry[]) => {
    const error = await restorePieceFiles(entries.map((e) => e.id));
    if (error) return failed(error);
    setTrash((list) => list?.filter((e) => !entries.includes(e)) ?? null);
    showToast(t('restoredCount').replace('{n}', String(entries.length)));
    track('files-restore', { count: sizeBucket(entries.length) });
    void load();
  };
  const purge = async (entries: PieceFileTrashEntry[]) => {
    const error = await purgePieceTrash(entries.map((e) => e.id));
    if (error) return failed(error);
    setTrash((list) => list?.filter((e) => !entries.includes(e)) ?? null);
    track('files-purge', { count: sizeBucket(entries.length) });
  };

  // --- opening and downloading --------------------------------------------------------

  // A file opens in the browser where it can (PDF, pictures, audio) and
  // downloads otherwise; a link opens its page; a folder opens. In the
  // installed iPhone app every file goes to the share sheet (see
  // shareDownload): shown in the app window it has no way to share or save.
  const openItem = (item: Item) => {
    if (item.kind === 'folder') return open(item.folder.id);
    const f = item.file;
    if (f.kind === 'link') {
      if (/^https?:\/\//i.test(f.url ?? '')) clickLink(f.url as string, true);
      track('file-open-link');
      return;
    }
    if (!f.file_path) return;
    if (INLINE.test(f.file_name ?? '') && !sharesDownloads()) {
      clickLink(pieceFileUrl(f.file_path), true);
      track('file-open', { type: fileExt(f).slice(1).toLowerCase() || f.kind });
    } else downloadItems([item]);
  };

  // One file downloads as it is; several, or folders, as one ZIP made by the
  // server.
  const downloadItems = (targets: Item[]) => {
    const real = targets.filter((i) => !isLink(i));
    if (real.length === 0) return;
    const only = real[0];
    if (real.length === 1 && only.kind === 'file') {
      if (!only.file.file_path) return;
      const name = pieceDownloadName(piece, only.file.title.trim(), only.file.file_name ?? only.file.file_path);
      if (sharesDownloads()) void shareDownload(only.file.file_path, name, only.file.kind);
      else clickLink(pieceFileDownloadUrl(only.file.file_path, name));
      track('file-download', { kind: only.file.kind });
      return;
    }
    const name = real.length === 1 ? `${piece.name} – ${itemName(only)}` : piece.name;
    clickLink(
      real.length === 1 && only.kind === 'folder'
        ? pieceZipUrl(piece.id, { folder: only.folder.id }, name)
        : pieceZipUrl(
            piece.id,
            {
              folders: real.flatMap((i) => (i.kind === 'folder' ? [i.folder.id] : [])),
              files: real.flatMap((i) => (i.kind === 'file' ? [i.file.id] : [])),
            },
            name,
          ),
    );
    track('files-zip', { count: sizeBucket(real.length), folders: real.some((i) => i.kind === 'folder') });
  };

  // The installed iPhone app: the file goes to the share sheet instead. When
  // loading it took longer than Safari keeps the tap, the toast asks for one.
  const shareDownload = async (path: string, name: string, kind: string) => {
    const response = await fetch(pieceFileUrl(path)).catch(() => null);
    if (!response?.ok) return failed(response ? `HTTP ${response.status}` : 'Network error');
    const blob = await response.blob();
    const file = new File([blob], name, { type: blob.type });
    const result = await shareFile(file);
    if (result === 'retry') showToast(t('readyToShare'), undefined, file);
    else if (result === 'unsupported') clickLink(pieceFileDownloadUrl(path, name));
    if (result !== 'unsupported') track('file-share', { kind });
  };

  // Something to download in a folder (any file, in it or its folders).
  const hasDownloads = (folderId: string): boolean =>
    itemsIn(folderId).some((i) => (i.kind === 'folder' ? hasDownloads(i.folder.id) : !isLink(i) && Boolean(i.file.file_path)));

  // --- selection ------------------------------------------------------------------

  const toggle = (item: Item) =>
    setSelected((list) => (list.includes(keyOf(item)) ? list.filter((k) => k !== keyOf(item)) : [...list, keyOf(item)]));

  const onItemClick = (item: Item, e: MouseEvent) => {
    if (renaming === keyOf(item)) return;
    const key = keyOf(item);
    // Touch: a tap opens, unless something is being selected.
    if (touch && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      if (selected.length) toggle(item);
      else openItem(item);
      return;
    }
    if (e.shiftKey && anchor.current) {
      const keys = items.map(keyOf);
      const [from, to] = [keys.indexOf(anchor.current), keys.indexOf(key)].sort((a, b) => a - b);
      if (from >= 0) {
        setSelected(keys.slice(from, to + 1));
        return;
      }
    }
    anchor.current = key;
    if (e.metaKey || e.ctrlKey) toggle(item);
    else setSelected([key]);
  };

  const onItemContextMenu = (item: Item, e: MouseEvent) => {
    e.preventDefault();
    const targets = selected.includes(keyOf(item)) ? selectedItems : [item];
    if (!selected.includes(keyOf(item))) setSelected([keyOf(item)]);
    setMenuAt({ x: e.clientX, y: e.clientY, items: targets });
  };

  const onItemKey = (item: Item, e: KeyboardEvent) => {
    if (renaming === keyOf(item)) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      openItem(item);
    } else if (e.key === ' ') {
      e.preventDefault();
      toggle(item);
    }
  };

  // Keyboard on the page: Delete, Escape, Ctrl/⌘+A, F2.
  const onPageKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, textarea, [role="menu"]')) return;
    if (e.key === 'Escape' && selected.length) setSelected([]);
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      setSelected(items.map(keyOf));
    } else if (canEdit && (e.key === 'Delete' || e.key === 'Backspace') && selectedItems.length) {
      e.preventDefault();
      void deleteItems(selectedItems);
    } else if (canEdit && e.key === 'F2' && selectedItems.length === 1) {
      e.preventDefault();
      setRenaming(keyOf(selectedItems[0]));
    }
  };

  // What can be done with some items (the "⋯" menu, right click, the bar).
  const actionsFor = (targets: Item[]): OverflowMenuItem[] => {
    const one = targets.length === 1 ? targets[0] : null;
    const out: OverflowMenuItem[] = [];
    if (one) {
      out.push(
        isLink(one)
          ? { icon: ExternalLink, label: t('openLink'), onSelect: () => openItem(one) }
          : { icon: one.kind === 'folder' ? Folder : ExternalLink, label: t('openItem'), onSelect: () => openItem(one) },
      );
    }
    if (targets.some((i) => !isLink(i))) {
      out.push({ icon: Download, label: t('downloadFile'), onSelect: () => downloadItems(targets) });
    }
    if (!canEdit) return out;
    if (one?.kind === 'file' && one.file.kind === 'link') {
      out.push({ icon: RefreshCw, label: t('refreshPreview'), onSelect: () => void refreshPreview(one.file) });
    }
    if (one?.kind === 'file' && one.file.file_path) {
      out.push({
        icon: Upload,
        label: t('uploadNewVersion'),
        onSelect: () => {
          replacing.current = one.file;
          replaceInput.current?.click();
        },
      });
    }
    if (one) out.push({ icon: Pencil, label: t('rename'), onSelect: () => setRenaming(keyOf(one)), separated: true });
    out.push({ icon: FolderInput, label: t('moveTo'), onSelect: () => setMoving(targets), separated: !one });
    const allPublic = targets.every(ownPublic);
    out.push(
      allPublic
        ? { icon: Lock, label: t('makePrivate'), onSelect: () => void setPublic(targets, false) }
        : { icon: Globe, label: t('makePublic'), onSelect: () => void setPublic(targets, true) },
    );
    out.push({ icon: Trash2, label: t('delete'), onSelect: () => void deleteItems(targets), separated: true });
    return out;
  };

  // --- drag and drop ------------------------------------------------------------------

  const fromOutside = (e: DragEvent) => !dragged.current && e.dataTransfer.types.includes('Files');

  const dragProps = (item: Item) =>
    canEdit && renaming !== keyOf(item) && !touch
      ? {
          draggable: true,
          onDragStart: (e: DragEvent) => {
            // A selected item takes the whole selection along.
            dragged.current = selected.includes(keyOf(item)) ? selectedItems : [item];
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', itemName(item));
          },
          onDragEnd: () => {
            dragged.current = null;
            setDropAt(null);
          },
        }
      : {};

  // Where something dropped onto `target` lands: a folder takes what is
  // dropped on its middle; in custom order, near its edges (and onto files)
  // items of the same kind go beside it.
  const landing = (e: DragEvent, target: Item, horizontal: boolean): DropAt | null => {
    const moved = dragged.current;
    if (!moved) return target.kind === 'folder' ? { into: target.folder.id } : null;
    if (moved.some((m) => keyOf(m) === keyOf(target))) return null;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const share = horizontal ? (e.clientX - r.left) / r.width : (e.clientY - r.top) / r.height;
    const sameKind = moved.every((m) => m.kind === target.kind);
    if (target.kind === 'folder') {
      if (reorderable && sameKind && (share < 0.25 || share > 0.75)) return { beside: target, after: share > 0.5 };
      if (moved.some((m) => m.kind === 'folder' && isInside(target.folder.id, m.folder.id))) return null;
      return { into: target.folder.id };
    }
    return reorderable && sameKind ? { beside: target, after: share > 0.5 } : null;
  };

  const drop = (at: DropAt, e: DragEvent) => {
    const moved = dragged.current;
    dragged.current = null;
    setDropAt(null);
    setOutsideOver(false);
    if (!moved) {
      // Files and folders from the computer: uploaded there.
      if ('into' in at) void pickedFromDrop(e.dataTransfer).then((picked) => upload(picked, at.into));
      return;
    }
    if ('into' in at) return moveItems(moved, at.into);
    const parentId = parentOfItem(at.beside);
    const siblings = (at.beside.kind === 'folder' ? subfolders(parentId) : filesIn(parentId))
      .map((x) => x.id)
      .filter((id) => !moved.some((m) => idOf(m) === id));
    moveItems(moved, parentId, siblings.indexOf(idOf(at.beside)) + (at.after ? 1 : 0));
  };

  const targetProps = (key: string, item: Item, horizontal: boolean) =>
    canEdit
      ? {
          onDragOver: (e: DragEvent) => {
            if (!dragged.current && !fromOutside(e)) return;
            const at = landing(e, item, horizontal);
            if (!at) return;
            e.preventDefault();
            e.stopPropagation();
            if (dropAt?.key !== key || JSON.stringify(dropAt.at) !== JSON.stringify(at)) setDropAt({ key, at });
          },
          onDragLeave: (e: DragEvent) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropAt((d) => (d?.key === key ? null : d));
          },
          onDrop: (e: DragEvent) => {
            const at = landing(e, item, horizontal);
            if (!at) return;
            e.preventDefault();
            e.stopPropagation();
            drop(at, e);
          },
        }
      : {};

  // A breadcrumb (or the page itself) takes drops too.
  const folderTargetProps = (key: string, folderId: string | null) =>
    canEdit
      ? {
          onDragOver: (e: DragEvent) => {
            const moved = dragged.current;
            if (!moved && !fromOutside(e)) return;
            if (moved?.some((m) => m.kind === 'folder' && folderId && isInside(folderId, m.folder.id))) return;
            e.preventDefault();
            if (!moved) setOutsideOver(true);
            if (dropAt?.key !== key) setDropAt({ key, at: { into: folderId } });
          },
          onDragLeave: (e: DragEvent) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              setDropAt((d) => (d?.key === key ? null : d));
              if (key === 'page') setOutsideOver(false);
            }
          },
          onDrop: (e: DragEvent) => {
            e.preventDefault();
            drop({ into: folderId }, e);
          },
        }
      : {};

  const intoHere = (key: string) => dropAt?.key === key && 'into' in dropAt.at;
  const besideHere = (key: string) =>
    dropAt?.key === key && 'beside' in dropAt.at ? (dropAt.at.after ? 'after' : 'before') : null;

  if (loading) return <PageSpinner />;

  // --- pieces of an item ------------------------------------------------------------

  const renameInput = (item: Item, className: string) => {
    const name = itemName(item);
    return (
      <input
        autoFocus
        defaultValue={name}
        // Typing replaces the name (a new folder's placeholder too).
        onFocus={(e) => e.target.select()}
        aria-label={t('rename')}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onBlur={(e) => {
          setRenaming(null);
          const v = e.target.value.trim();
          if (v && v !== name) rename(item, v);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            e.currentTarget.value = name;
            e.currentTarget.blur();
          }
        }}
        className={cn(
          'min-w-0 rounded-md border border-black bg-surface px-2 text-base font-medium focus:outline-none sm:text-sm',
          className,
        )}
      />
    );
  };

  const iconOf = (item: Item, size: number, className?: string) => {
    if (item.kind === 'folder') return <Folder size={size} className={cn('flex-shrink-0 fill-accent/20 text-accent', className)} aria-hidden />;
    const Icon = item.file.kind === 'link' ? LinkIcon : fileIcon(item.file);
    return <Icon size={size} className={cn('flex-shrink-0', fileTone(item.file), className)} aria-hidden />;
  };

  // A check box in place of the icon: on hover, and always while something
  // is selected.
  const checkbox = (item: Item, isSelected: boolean, className?: string) => (
    <button
      type="button"
      role="checkbox"
      aria-checked={isSelected}
      aria-label={`${t('selectItem')}: ${itemName(item)}`}
      onClick={(e) => {
        e.stopPropagation();
        anchor.current = keyOf(item);
        toggle(item);
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      className={cn(
        'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border transition-colors duration-150',
        isSelected ? 'border-accent bg-accent text-white' : 'border-border-strong bg-surface',
        className,
      )}
    >
      {isSelected && <Check size={13} strokeWidth={3} />}
    </button>
  );

  // The visibility of an item: a switch-like pill for editors.
  const visibilityPill = (item: Item) => {
    const byFolder = ownPublic(item) && !isPublic(item);
    const pub = isPublic(item);
    const Icon = pub ? Globe : Lock;
    return (
      <button
        type="button"
        disabled={byFolder}
        onClick={(e) => {
          e.stopPropagation();
          void setPublic([item], !ownPublic(item));
        }}
        onDoubleClick={(e) => e.stopPropagation()}
        title={byFolder ? t('visibilityByFolderHint') : pub ? t('visibilityPublicHint') : t('visibilityPrivateHint')}
        className={cn(
          'inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors duration-150',
          pub
            ? 'bg-success-soft text-success-strong hover:bg-success-soft-strong'
            : 'bg-surface-muted text-text-secondary hover:bg-surface-hover hover:text-text',
          byFolder && 'cursor-default opacity-70 hover:bg-surface-muted hover:text-text-secondary',
        )}
      >
        <Icon size={13} />
        {byFolder ? t('visibilityPrivateByFolder') : pub ? t('visibilityPublic') : t('visibilityPrivate')}
      </button>
    );
  };

  const privateBadge = (item: Item) =>
    canEdit && !isPublic(item) ? (
      <span title={ownPublic(item) ? t('visibilityByFolderHint') : t('visibilityPrivateHint')} className="flex-shrink-0 text-text-tertiary">
        <Lock size={13} aria-label={t('visibilityPrivate')} />
      </span>
    ) : null;

  const missingBadge = (item: Item) =>
    item.kind === 'file' && item.file.file_missing ? (
      <span title={t('fileMissing')} className="flex-shrink-0 text-danger">
        <AlertTriangle size={14} aria-label={t('fileMissing')} />
      </span>
    ) : null;

  const folderDownloadButton = (folder: PieceFileFolder) =>
    hasDownloads(folder.id) ? (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          downloadItems([{ kind: 'folder', folder }]);
        }}
        onDoubleClick={(e) => e.stopPropagation()}
        aria-label={`${t('downloadZip')}: ${folder.name}`}
        title={t('downloadZip')}
        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-text-secondary transition-colors duration-150 hover:bg-surface-hover hover:text-text"
      >
        <Download size={16} />
      </button>
    ) : null;

  const menu = (item: Item) => (
    <span onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} className="flex-shrink-0">
      <OverflowMenu label={t('moreActions')} items={actionsFor(selected.includes(keyOf(item)) ? selectedItems : [item])} />
    </span>
  );

  // Where a search result lies.
  const locationOf = (item: Item) => {
    const parent = parentOfItem(item);
    return [t('files'), ...pathTo(parent).map((d) => d.name)].join(' / ');
  };

  const subtitle = (item: Item) => {
    if (searching) return locationOf(item);
    if (item.kind === 'folder') {
      const n = itemsIn(item.folder.id).length;
      return t('folderItems').replace('{n}', String(n));
    }
    if (item.file.kind === 'link') return linkSite(item.file);
    return [fileExt(item.file).slice(1).toUpperCase(), formatSize(item.file.size, locale)].filter(Boolean).join(' · ');
  };

  // The element an item is: selectable, opens on double click, drags.
  const itemProps = (item: Item, key: string, horizontal: boolean) => ({
    role: 'option' as const,
    'aria-selected': selected.includes(keyOf(item)),
    tabIndex: 0,
    onClick: (e: MouseEvent) => onItemClick(item, e),
    onDoubleClick: () => !touch && renaming !== keyOf(item) && openItem(item),
    onContextMenu: (e: MouseEvent) => onItemContextMenu(item, e),
    onKeyDown: (e: KeyboardEvent) => onItemKey(item, e),
    ...dragProps(item),
    ...targetProps(key, item, horizontal),
  });

  const anySelected = selected.length > 0;

  // --- grid ---------------------------------------------------------------------------

  const folderCard = (item: Extract<Item, { kind: 'folder' }>) => {
    const key = `tile:${keyOf(item)}`;
    const isSelected = selected.includes(keyOf(item));
    const side = besideHere(key);
    return (
      <li key={key} className="relative">
        <div
          {...itemProps(item, key, true)}
          className={cn(
            'group flex h-14 cursor-default select-none items-center gap-3 rounded-xl border px-3 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-black',
            isSelected ? 'border-accent bg-accent/10' : 'border-border bg-surface-subtle hover:bg-surface-hover',
            intoHere(key) && 'border-accent bg-accent/15',
          )}
        >
          <span className="relative flex h-6 w-6 flex-shrink-0 items-center justify-center">
            <span className={cn(anySelected || isSelected ? 'hidden' : 'group-hover:hidden')}>{iconOf(item, 22)}</span>
            {checkbox(item, isSelected, cn(!anySelected && !isSelected && 'hidden group-hover:flex'))}
          </span>
          <div className="min-w-0 flex-1">
            {renaming === keyOf(item) ? (
              renameInput(item, 'h-8 w-full')
            ) : (
              <>
                <p className="truncate text-sm font-medium" title={item.folder.name}>
                  {item.folder.name}
                </p>
                {searching && <p className="truncate text-xs text-text-tertiary">{locationOf(item)}</p>}
              </>
            )}
          </div>
          {privateBadge(item)}
          {folderDownloadButton(item.folder)}
          {menu(item)}
        </div>
        {side && (
          <span aria-hidden className={cn('absolute bottom-2 top-2 w-0.5 rounded-full bg-accent', side === 'before' ? '-left-1.5' : '-right-1.5')} />
        )}
      </li>
    );
  };

  const fileCard = (item: Extract<Item, { kind: 'file' }>) => {
    const key = `tile:${keyOf(item)}`;
    const f = item.file;
    const isSelected = selected.includes(keyOf(item));
    const side = besideHere(key);
    const image = f.kind === 'link' ? f.link_preview?.image : null;
    return (
      <li key={key} className="relative">
        <div
          {...itemProps(item, key, true)}
          className={cn(
            'group flex cursor-default select-none flex-col overflow-hidden rounded-xl border bg-surface transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-black',
            isSelected ? 'border-accent ring-1 ring-accent' : 'border-border hover:border-border-strong',
          )}
        >
          <div className={cn('relative flex h-28 items-center justify-center', isSelected ? 'bg-accent/10' : 'bg-surface-muted')}>
            {image ? (
              <img src={pieceFileUrl(image)} alt="" loading="lazy" draggable={false} className="h-full w-full object-cover" />
            ) : previewBusy.includes(f.id) ? (
              <Loader2 size={24} className="animate-spin text-text-tertiary" />
            ) : (
              iconOf(item, 40)
            )}
            <span className="absolute left-2 top-2">
              {checkbox(item, isSelected, cn(!anySelected && !isSelected && 'opacity-0 group-hover:opacity-100 focus:opacity-100'))}
            </span>
            {(privateBadge(item) || missingBadge(item)) && (
              <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-surface/90 px-1.5 py-1 backdrop-blur">
                {missingBadge(item)}
                {privateBadge(item)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 py-1.5 pl-3 pr-1">
            {iconOf(item, 16)}
            <div className="min-w-0 flex-1">
              {renaming === keyOf(item) ? (
                renameInput(item, 'h-8 w-full')
              ) : (
                <p className="truncate text-sm font-medium" title={f.link_preview?.description || fileName(f)}>
                  {fileName(f)}
                </p>
              )}
              <p className="truncate text-xs text-text-tertiary">{subtitle(item)}</p>
            </div>
            {menu(item)}
          </div>
        </div>
        {side && (
          <span aria-hidden className={cn('absolute bottom-2 top-2 w-0.5 rounded-full bg-accent', side === 'before' ? '-left-1.5' : '-right-1.5')} />
        )}
      </li>
    );
  };

  const grid = () => {
    const folderItems = items.filter((i): i is Extract<Item, { kind: 'folder' }> => i.kind === 'folder');
    const fileItems = items.filter((i): i is Extract<Item, { kind: 'file' }> => i.kind === 'file');
    return (
      <div role="listbox" aria-multiselectable aria-label={t('files')} className="space-y-6">
        {folderItems.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">{t('folderSection')}</h2>
            <ul className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">{folderItems.map(folderCard)}</ul>
          </section>
        )}
        {fileItems.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">{t('files')}</h2>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">{fileItems.map(fileCard)}</ul>
          </section>
        )}
      </div>
    );
  };

  // --- list ---------------------------------------------------------------------------

  const sortHeader = (key: SortKey, label: string, className: string) => {
    const active = sort.key === key;
    const Arrow = sort.dir === 1 ? ArrowUp : ArrowDown;
    return (
      <button
        type="button"
        onClick={() => setSort(active ? { key, dir: sort.dir === 1 ? -1 : 1 } : { key, dir: key === 'modified' ? -1 : 1 })}
        className={cn('inline-flex items-center gap-1 rounded hover:text-text', active && 'text-text', className)}
      >
        {label}
        {active && <Arrow size={12} />}
      </button>
    );
  };

  const listHeader = (
    <div className="flex h-10 items-center gap-3 border-b border-border px-3 text-xs font-medium text-text-secondary">
      <span className="flex w-6 flex-shrink-0 justify-center">
        {items.length > 0 && (
          <button
            type="button"
            role="checkbox"
            aria-checked={selected.length === items.length ? true : selected.length ? 'mixed' : false}
            aria-label={t('selectAll')}
            onClick={() => setSelected(selected.length === items.length ? [] : items.map(keyOf))}
            className={cn(
              'flex h-5 w-5 items-center justify-center rounded border transition-colors duration-150',
              selected.length ? 'border-accent bg-accent text-white' : 'border-border-strong bg-surface',
            )}
          >
            {selected.length === items.length ? <Check size={13} strokeWidth={3} /> : selected.length ? <span className="h-0.5 w-2.5 rounded bg-white" /> : null}
          </button>
        )}
      </span>
      <span className="min-w-0 flex-1">{sortHeader('name', t('name'), '')}</span>
      {canEdit && <span className="hidden w-36 md:block">{t('columnVisibility')}</span>}
      <span className="hidden w-32 sm:block">{sortHeader('modified', t('sortModified'), '')}</span>
      <span className="hidden w-20 justify-end sm:flex">{sortHeader('size', t('sortSize'), 'justify-end')}</span>
      <span className="hidden w-40 pl-4 lg:block">{t('columnOwner')}</span>
      <span className="w-[4.5rem] flex-shrink-0" />
    </div>
  );

  const row = (item: Item) => {
    const key = `row:${keyOf(item)}`;
    const isSelected = selected.includes(keyOf(item));
    const side = besideHere(key);
    const thumb = item.kind === 'file' && item.file.kind === 'link' ? item.file.link_preview?.image : null;
    const date = new Date(modifiedAt(item)).toLocaleDateString(locale, { dateStyle: 'medium' });
    const size = item.kind === 'file' && item.file.kind !== 'link' ? formatSize(item.file.size, locale) : '—';
    return (
      <li key={key} className="relative">
        <div
          {...itemProps(item, key, false)}
          className={cn(
            'group flex min-h-[3.25rem] cursor-default select-none items-center gap-3 border-b border-border px-3 transition-colors duration-150 focus:outline-none focus-visible:bg-surface-hover',
            isSelected ? 'bg-accent/10' : 'hover:bg-surface-subtle',
            intoHere(key) && 'bg-accent/15',
          )}
        >
          <span className="relative flex w-6 flex-shrink-0 items-center justify-center">
            <span className={cn(anySelected || isSelected ? 'hidden' : 'group-hover:hidden')}>
              {thumb ? (
                <img src={pieceFileUrl(thumb)} alt="" loading="lazy" draggable={false} className="h-6 w-6 rounded object-cover" />
              ) : (
                iconOf(item, 20)
              )}
            </span>
            {checkbox(item, isSelected, cn(!anySelected && !isSelected && 'hidden group-hover:flex'))}
          </span>
          <div className="min-w-0 flex-1 py-1.5">
            {renaming === keyOf(item) ? (
              renameInput(item, 'h-8 w-full max-w-md')
            ) : (
              <p className="flex min-w-0 items-center gap-1.5 text-sm">
                <span className={cn('truncate', item.kind === 'folder' ? 'font-semibold' : 'font-medium')}>{itemName(item)}</span>
                {item.kind === 'file' && item.file.kind !== 'link' && (
                  <span className="flex-shrink-0 text-text-tertiary">{fileExt(item.file)}</span>
                )}
                {missingBadge(item)}
                {/* Without the column (small screens) a lock still tells. */}
                <span className="md:hidden">{privateBadge(item)}</span>
              </p>
            )}
            <p className="truncate text-xs text-text-tertiary sm:hidden">
              {searching ? locationOf(item) : item.kind === 'folder' ? subtitle(item) : `${date} · ${size}`}
            </p>
            {searching && <p className="hidden truncate text-xs text-text-tertiary sm:block">{locationOf(item)}</p>}
          </div>
          {canEdit && <span className="hidden w-36 md:block">{visibilityPill(item)}</span>}
          <span className="hidden w-32 truncate text-sm text-text-secondary sm:block">{date}</span>
          <span className="hidden w-20 text-right text-sm tabular-nums text-text-secondary sm:block">{size}</span>
          <span className="hidden w-40 truncate pl-4 text-sm text-text-secondary lg:block">
            {item.kind === 'file' ? item.file.uploaded_by_name || '—' : '—'}
          </span>
          <span className="flex w-[4.5rem] flex-shrink-0 items-center justify-end">
            {item.kind === 'folder' && folderDownloadButton(item.folder)}
            {menu(item)}
          </span>
        </div>
        {side && (
          <span aria-hidden className={cn('absolute inset-x-0 h-0.5 bg-accent', side === 'before' ? '-top-px' : '-bottom-px')} />
        )}
      </li>
    );
  };

  const list = () => (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      {listHeader}
      <ul role="listbox" aria-multiselectable aria-label={t('files')} className="-mb-px">
        {items.map(row)}
      </ul>
    </div>
  );

  // --- the page -------------------------------------------------------------------------

  const crumb = (key: string, label: string, folderId: string | null, last: boolean) => (
    <li key={key} className="flex min-w-0 items-center gap-1">
      {last ? (
        <span className="truncate rounded px-1.5 py-0.5 font-semibold text-text">{label}</span>
      ) : (
        <button
          type="button"
          onClick={() => open(folderId)}
          {...folderTargetProps(`crumb:${key}`, folderId)}
          className={cn(
            'truncate rounded px-1.5 py-0.5 text-text-secondary transition-colors duration-150 hover:bg-surface-hover hover:text-text',
            intoHere(`crumb:${key}`) && 'bg-accent/15 text-text',
          )}
        >
          {label}
        </button>
      )}
      {!last && <ChevronRight size={14} className="flex-shrink-0 text-text-tertiary" />}
    </li>
  );

  // Folders to move into (not a moved folder or what is in it).
  const moveTargets = (moved: Item[]) => {
    const out: Array<{ id: string; name: string; depth: number }> = [];
    const walk = (parentId: string | null, depth: number) => {
      for (const d of subfolders(parentId)) {
        if (moved.some((m) => m.kind === 'folder' && m.folder.id === d.id)) continue;
        out.push({ id: d.id, name: d.name, depth });
        walk(d.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  };
  const movingFrom = moving && new Set(moving.map(parentOfItem)).size === 1 ? parentOfItem(moving[0]) : undefined;

  const newMenu: OverflowMenuItem[] = [
    { icon: FolderPlus, label: t('newFolder'), onSelect: () => void addFolder() },
    { icon: FilePlus2, label: t('uploadFiles'), onSelect: () => fileInput.current?.click(), separated: true },
    { icon: FolderUp, label: t('uploadFolder'), onSelect: () => folderInput.current?.click() },
    { icon: LinkIcon, label: t('addLink'), onSelect: () => setLinkOpen(true), separated: true },
  ];

  const hasAnyDownload = items.some((i) => (i.kind === 'folder' ? hasDownloads(i.folder.id) : !isLink(i) && i.file.file_path));

  return (
    <div
      className="relative min-h-[60vh] max-w-6xl space-y-4 outline-none"
      tabIndex={-1}
      onKeyDown={onPageKey}
      onClick={(e) => {
        // A click on empty space clears the selection.
        if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.empty) setSelected([]);
      }}
      {...folderTargetProps('page', current)}
    >
      <input
        ref={fileInput}
        type="file"
        multiple
        className="sr-only"
        onChange={(e) => {
          upload(Array.from(e.target.files ?? []).map((file) => ({ file, dirs: [] })));
          e.target.value = '';
        }}
      />
      <input
        ref={folderInput}
        type="file"
        multiple
        className="sr-only"
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
        onChange={(e) => {
          upload(
            Array.from(e.target.files ?? []).map((file) => ({
              file,
              dirs: file.webkitRelativePath.split('/').slice(0, -1).filter(Boolean),
            })),
          );
          e.target.value = '';
        }}
      />
      <input
        ref={replaceInput}
        type="file"
        className="sr-only"
        onChange={(e) => {
          const picked = e.target.files?.[0];
          const row = replacing.current;
          e.target.value = '';
          if (picked && row) void replaceFile(row, picked);
        }}
      />

      {/* Title and tools, or — while something is selected — what to do with it. */}
      <div className="flex min-h-[2.5rem] flex-wrap items-center gap-2">
        {anySelected ? (
          <div className="flex w-full flex-wrap items-center gap-1 rounded-full bg-surface-muted py-1 pl-1 pr-2">
            <button
              type="button"
              onClick={() => setSelected([])}
              aria-label={t('clearSelection')}
              title={t('clearSelection')}
              className="flex h-8 w-8 items-center justify-center rounded-full text-text-secondary hover:bg-surface-hover hover:text-text"
            >
              <X size={16} />
            </button>
            <span className="mr-2 text-sm font-medium">{t('selectedCount').replace('{n}', String(selectedItems.length))}</span>
            {selectedItems.some((i) => !isLink(i)) && (
              <button type="button" onClick={() => downloadItems(selectedItems)} title={t('downloadZip')} className="flex h-8 items-center gap-1.5 rounded-full px-3 text-sm hover:bg-surface-hover">
                <Download size={15} />
                <span className="hidden sm:inline">{t('downloadZip')}</span>
              </button>
            )}
            {canEdit && (
              <>
                <button type="button" onClick={() => setMoving(selectedItems)} title={t('moveTo')} className="flex h-8 items-center gap-1.5 rounded-full px-3 text-sm hover:bg-surface-hover">
                  <FolderInput size={15} />
                  <span className="hidden sm:inline">{t('moveTo')}</span>
                </button>
                {selectedItems.every(ownPublic) ? (
                  <button type="button" onClick={() => void setPublic(selectedItems, false)} title={t('makePrivate')} className="flex h-8 items-center gap-1.5 rounded-full px-3 text-sm hover:bg-surface-hover">
                    <Lock size={15} />
                    <span className="hidden sm:inline">{t('makePrivate')}</span>
                  </button>
                ) : (
                  <button type="button" onClick={() => void setPublic(selectedItems, true)} title={t('makePublic')} className="flex h-8 items-center gap-1.5 rounded-full px-3 text-sm hover:bg-surface-hover">
                    <Globe size={15} />
                    <span className="hidden sm:inline">{t('makePublic')}</span>
                  </button>
                )}
                <button type="button" onClick={() => void deleteItems(selectedItems)} title={t('delete')} className="flex h-8 items-center gap-1.5 rounded-full px-3 text-sm text-danger hover:bg-danger-soft">
                  <Trash2 size={15} />
                  <span className="hidden sm:inline">{t('delete')}</span>
                </button>
              </>
            )}
          </div>
        ) : (
          <>
            <h1 className="mr-auto text-xl font-bold sm:text-2xl">{t('files')}</h1>
            <label className="relative order-last w-full sm:order-none sm:w-56">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('filesSearch')}
                aria-label={t('filesSearch')}
                className="h-9 w-full rounded-full border border-border bg-surface-subtle pl-9 pr-3 text-base focus:border-black focus:bg-surface focus:outline-none sm:text-sm"
              />
            </label>
            <ViewMenu
              view={view}
              onView={setView}
              sort={sort}
              onSort={setSort}
              onTrash={canEdit ? () => void openTrash() : undefined}
            />
            {hasAnyDownload && !searching && (
              <Button
                variant="secondary"
                className="h-9"
                onClick={() =>
                  clickLink(pieceZipUrl(piece.id, { folder: current }, [piece.name, ...trail.map((d) => d.name)].join(' – ')))
                }
                aria-label={t('downloadZip')}
                title={t('downloadZip')}
              >
                <Download size={15} />
                <span className="hidden lg:inline">{t('downloadZip')}</span>
              </Button>
            )}
            {canEdit && (
              <>
                <OverflowMenu label={t('filesNew')} buttonIcon={Plus} items={newMenu} />
              </>
            )}
          </>
        )}
      </div>

      {/* Where you are, inside a folder (every step takes drops). */}
      {!searching && current && (
        <nav aria-label={t('breadcrumbs')} className="flex min-w-0 items-center gap-1">
          {current && (
            <button
              type="button"
              onClick={() => open(trail.length > 1 ? trail[trail.length - 2].id : null)}
              aria-label={t('back')}
              title={t('back')}
              className="mr-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-text-secondary hover:bg-surface-hover hover:text-text"
            >
              <ArrowLeft size={17} />
            </button>
          )}
          <ol className="flex min-w-0 flex-wrap items-center gap-0.5 text-sm">
            {crumb('root', t('files'), null, !current)}
            {trail.map((d, i) => crumb(d.id, d.name, d.id, i === trail.length - 1))}
          </ol>
        </nav>
      )}

      {loadError && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger">
          <span className="min-w-0 flex-1">{t('filesLoadError')}</span>
          <Button variant="secondary" onClick={() => void load()}>
            <RefreshCw size={14} />
            {t('retry')}
          </Button>
        </div>
      )}
      {notice && (
        <p role="alert" className="flex items-center gap-2 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
          <span className="min-w-0 flex-1">{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label={t('close')} className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-surface-hover">
            <X size={14} />
          </button>
        </p>
      )}

      {canEdit && linkOpen && (
        // A link: shown like a file, with a preview of its page.
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void addLink();
          }}
          className="flex flex-wrap items-start gap-2 rounded-xl border border-border bg-surface-subtle p-3"
        >
          <LinkIcon size={16} className="mt-3 flex-shrink-0 text-text-secondary" aria-hidden />
          <input
            autoFocus
            value={linkUrl}
            onChange={(e) => {
              setLinkUrl(e.target.value);
              setLinkError(null);
            }}
            placeholder="https://"
            aria-label={t('linkUrl')}
            inputMode="url"
            className="h-10 min-w-0 flex-[2_1_14rem] rounded-md border border-border bg-surface px-3 text-base focus:border-black focus:outline-none sm:text-sm"
          />
          <input
            value={linkName}
            onChange={(e) => setLinkName(e.target.value)}
            placeholder={t('linkNameOptional')}
            aria-label={t('displayName')}
            className="h-10 min-w-0 flex-[1_1_10rem] rounded-md border border-border bg-surface px-3 text-base focus:border-black focus:outline-none sm:text-sm"
          />
          <Button type="submit" disabled={!linkUrl.trim() || linkBusy} className="h-10">
            {linkBusy ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
            {t('addLink')}
          </Button>
          <button type="button" onClick={() => setLinkOpen(false)} aria-label={t('close')} className="flex h-10 w-10 items-center justify-center rounded-md text-text-secondary hover:bg-surface-hover">
            <X size={16} />
          </button>
          {linkError && <p className="w-full text-sm text-danger">{linkError}</p>}
        </form>
      )}
      {uploadList}

      <div data-empty="1" className="relative min-h-[12rem]">
        {items.length === 0 ? (
          searching ? (
            <p className="py-10 text-center text-sm text-text-secondary">{t('filesNoMatches')}</p>
          ) : canEdit ? (
            <MultiDropzone onPicked={(picked) => upload(picked)} />
          ) : (
            <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-text-secondary">
              {current ? t('emptyFolder') : t('noFiles')}
            </p>
          )
        ) : view === 'grid' ? (
          grid()
        ) : (
          list()
        )}
        {/* Files from the computer over the page: where they will go. */}
        {outsideOver && intoHere('page') && (
          <div className="pointer-events-none absolute inset-0 flex items-start justify-center rounded-xl bg-accent/5 ring-2 ring-accent/50">
            <span className="mt-6 flex items-center gap-2 rounded-full bg-black px-4 py-2 text-sm font-medium text-white shadow-lg">
              <Upload size={15} />
              {current ? t('uploadIntoFolder').replace('{name}', trail[trail.length - 1]?.name ?? '') : t('dropFilesHere')}
            </span>
          </div>
        )}
      </div>

      {menuAt && <PointMenu at={menuAt} items={actionsFor(menuAt.items)} onClose={() => setMenuAt(null)} />}

      {/* Done, with Undo. */}
      {toast && (
        <div
          role="status"
          className="fixed bottom-4 left-1/2 z-[60] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-xl bg-black py-2.5 pl-4 pr-2 text-sm text-white shadow-lg"
        >
          <span className="min-w-0 truncate">{toast.text}</span>
          {toast.share && (
            <button
              type="button"
              onClick={() => {
                const file = toast.share;
                setToast(null);
                if (file) void shareFile(file);
              }}
              className="flex h-8 items-center gap-1.5 rounded-lg px-3 font-semibold text-accent hover:bg-white/10"
            >
              <Share size={14} />
              {t('shareFile')}
            </button>
          )}
          {toast.undo && (
            <button
              type="button"
              onClick={() => {
                const undo = toast.undo;
                setToast(null);
                track('files-undo');
                void undo?.();
              }}
              className="flex h-8 items-center gap-1.5 rounded-lg px-3 font-semibold text-accent hover:bg-white/10"
            >
              <RotateCcw size={14} />
              {t('undo')}
            </button>
          )}
          <button type="button" onClick={() => setToast(null)} aria-label={t('close')} className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-white/10">
            <X size={15} />
          </button>
        </div>
      )}

      <Modal open={moving != null} title={t('moveTo')} onClose={() => setMoving(null)}>
        {moving && (
          <ul className="max-h-[60vh] space-y-0.5 overflow-y-auto">
            {[{ id: null as string | null, name: t('files'), depth: 0 }, ...moveTargets(moving).map((d) => ({ ...d, depth: d.depth + 1 }))].map(
              (d) => (
                <li key={d.id ?? 'root'}>
                  <button
                    type="button"
                    disabled={d.id === movingFrom}
                    onClick={() => {
                      moveItems(moving, d.id);
                      setMoving(null);
                      setSelected([]);
                    }}
                    style={{ paddingLeft: `${0.75 + d.depth * 1.25}rem` }}
                    className="flex h-10 w-full items-center gap-2 rounded-md pr-3 text-left text-sm hover:bg-surface-hover disabled:opacity-40"
                  >
                    <Folder size={15} className="flex-shrink-0 fill-accent/20 text-accent" />
                    <span className="truncate">{d.name}</span>
                  </button>
                </li>
              ),
            )}
          </ul>
        )}
      </Modal>

      <Modal open={trashOpen} title={t('trash')} onClose={() => setTrashOpen(false)}>
        <div className="space-y-3">
          <p className="text-sm text-text-secondary">{t('trashHint')}</p>
          {trash == null ? (
            <div className="flex justify-center py-6">
              <Loader2 size={20} className="animate-spin text-text-tertiary" />
            </div>
          ) : trash.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-text-secondary">{t('trashEmpty')}</p>
          ) : (
            <>
              <ul className="max-h-[50vh] divide-y divide-border overflow-y-auto rounded-xl border border-border">
                {trash.map((entry) => {
                  const item: Item = { kind: 'file', file: entry.row };
                  return (
                    <li key={entry.id} className="flex items-center gap-3 px-3 py-2">
                      {iconOf(item, 18)}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{fileName(entry.row)}</p>
                        <p className="truncate text-xs text-text-tertiary">
                          {new Date(entry.deleted_at).toLocaleDateString(locale, { dateStyle: 'medium' })}
                          {entry.deleted_by_name && ` · ${t('deletedBy').replace('{name}', entry.deleted_by_name)}`}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void restore([entry])}
                        title={t('restore')}
                        className="flex h-8 items-center gap-1.5 rounded-md px-2 text-sm text-text-secondary hover:bg-surface-hover hover:text-text"
                      >
                        <RotateCcw size={14} />
                        <span className="hidden sm:inline">{t('restore')}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void purge([entry])}
                        aria-label={t('deleteForever')}
                        title={t('deleteForever')}
                        className="flex h-8 w-8 items-center justify-center rounded-md text-text-secondary hover:bg-danger-soft hover:text-danger"
                      >
                        <Trash2 size={14} />
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="flex justify-end">
                <Button variant="secondary" onClick={() => setConfirmEmpty(true)}>
                  <Trash2 size={15} />
                  {t('emptyTrash')}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmEmpty}
        title={t('emptyTrash')}
        message={t('confirmEmptyTrash')}
        confirmLabel={t('deleteForever')}
        destructive
        onConfirm={async () => {
          setConfirmEmpty(false);
          if (trash) await purge(trash);
        }}
        onCancel={() => setConfirmEmpty(false)}
      />
    </div>
  );
};

