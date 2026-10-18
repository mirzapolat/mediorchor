import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  EyeOff,
  Folder,
  FolderInput,
  FolderPlus,
  LayoutGrid,
  Link as LinkIcon,
  List,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Modal } from '@/components/Modal';
import { OverflowMenu } from '@/components/OverflowMenu';
import { PageSpinner } from '@/components/Spinner';
import { Switch } from '@/components/Switch';
import { MultiDropzone, fileIcon, usePieceUploads } from '@/components/PieceFileParts';
import { usePieceLayout } from '@/layouts/PieceLayout';
import { usePieceScope } from '@/layouts/pieceScope';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import { track } from '@/lib/analytics';
import {
  deletePieceFile,
  fetchLinkPreview,
  isFileDownloadable,
  isFolderDownloadable,
  loadPieceFiles,
  pieceDownloadName,
  pieceFileDownloadUrl,
  pieceFileUrl,
} from '@/lib/pieceFiles';
import { createZip, safeFileName } from '@/lib/zip';
import type { Piece, PieceFile, PieceFileFolder } from '@/types';

type View = 'grid' | 'list';
// Something on the page: a folder or a file (links count as files).
type Item = { kind: 'folder'; folder: PieceFileFolder } | { kind: 'file'; file: PieceFile };
// Where a dragged item lands: into a folder (null = the top), or next to a
// sibling of its kind.
type DropAt = { into: string | null } | { beside: Item; after: boolean };

const VIEW_KEY = 'anwesenheit.pieceFiles.view';
const collapsedKey = (pieceId: string) => `anwesenheit.pieceFiles.collapsed.${pieceId}`;

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

const itemId = (item: Item) => (item.kind === 'folder' ? item.folder.id : item.file.id);
const byPosition = <T extends { position: number; created_at: string }>(a: T, b: T) =>
  a.position - b.position || a.created_at.localeCompare(b.created_at);

// A link without its own name (or named like its address) shows the
// linked page's title.
const fileName = (f: PieceFile) => {
  const own = f.title.trim();
  if (f.kind === 'link' && (!own || own === f.url)) return f.link_preview?.title || f.url || '—';
  return own || f.file_name || f.url || '—';
};
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
const fileHref = (piece: Piece, f: PieceFile) =>
  f.kind === 'link'
    ? /^https?:\/\//i.test(f.url ?? '')
      ? (f.url as string)
      : '#'
    : f.file_path
      ? pieceFileDownloadUrl(f.file_path, pieceDownloadName(piece, f.title.trim(), f.file_name ?? f.file_path))
      : '#';

// A piece's "Dateien": a folder tree, browsed as a grid (folders opened with
// breadcrumbs and back) or as a list with collapsible folders. Everyone
// downloads what is switched on; its editors upload (with "+", or by
// dropping files onto the page or a folder), make folders, rename, delete,
// switch folders (and files outside any folder) to downloadable, and move
// and order everything by dragging — onto a folder or a breadcrumb moves
// it there. On touch screens "Move to …" does the same.
export const PieceFilesPage = () => {
  const { t } = useI18n();
  const { canEdit } = usePieceScope();
  const { piece } = usePieceLayout();
  const [searchParams, setSearchParams] = useSearchParams();
  const [files, setFiles] = useState<PieceFile[]>([]);
  const [folders, setFolders] = useState<PieceFileFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setViewState] = useState<View>(() => readStored<View>(VIEW_KEY, 'grid'));
  const [collapsed, setCollapsed] = useState<string[]>(() => readStored(collapsedKey(piece.id), []));
  const [showUpload, setShowUpload] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [moving, setMoving] = useState<Item | null>(null);
  const [toDelete, setToDelete] = useState<Item | null>(null);
  // A folder being packed as a ZIP (files fetched so far), or why it failed.
  const [zipping, setZipping] = useState<{ done: number; total: number } | null>(null);
  const [zipNote, setZipNote] = useState<string | null>(null);
  // Adding a link, and links whose preview is being read.
  const [linkUrl, setLinkUrl] = useState('');
  const [linkName, setLinkName] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState<string[]>([]);
  // Drag and drop: what is dragged (null while files come from outside)
  // and where it would land.
  const dragged = useRef<Item | null>(null);
  const [dropAt, setDropAt] = useState<{ key: string; at: DropAt } | null>(null);

  const load = useCallback(async () => {
    const [pieceFiles, { data: folderRows }] = await Promise.all([
      loadPieceFiles(piece.id),
      api.from('piece_file_folders').select('*').eq('piece_id', piece.id),
    ]);
    setFiles(pieceFiles);
    setFolders((folderRows as PieceFileFolder[] | null) ?? []);
    setLoading(false);
  }, [piece.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const setView = (next: View) => {
    setViewState(next);
    store(VIEW_KEY, next);
  };
  const toggleCollapsed = (id: string) =>
    setCollapsed((list) => {
      const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
      store(collapsedKey(piece.id), next);
      return next;
    });

  // A folder or file whose folder is gone is at the top.
  const known = useMemo(() => new Set(folders.map((d) => d.id)), [folders]);
  const parentOf = (d: PieceFileFolder) => (d.parent_id && known.has(d.parent_id) ? d.parent_id : null);
  const folderOf = (f: PieceFile) => (f.folder_id && known.has(f.folder_id) ? f.folder_id : null);

  // What members see: switched-on folders and files only.
  const visibleFolder = (d: PieceFileFolder) => canEdit || isFolderDownloadable(d.id, folders);
  const visibleFile = (f: PieceFile) => canEdit || ((f.file_path != null || f.kind === 'link') && isFileDownloadable(f, folders));
  const subfolders = (parentId: string | null) =>
    folders.filter((d) => parentOf(d) === parentId && visibleFolder(d)).sort(byPosition);
  const filesIn = (folderId: string | null) =>
    files.filter((f) => folderOf(f) === folderId && visibleFile(f)).sort(byPosition);
  const itemsIn = (folderId: string | null): Item[] => [
    ...subfolders(folderId).map((folder): Item => ({ kind: 'folder', folder })),
    ...filesIn(folderId).map((file): Item => ({ kind: 'file', file })),
  ];
  const countIn = (folderId: string) => subfolders(folderId).length + filesIn(folderId).length;

  // The open folder (?folder=…) and the way there.
  const openId = searchParams.get('folder');
  const current = openId && known.has(openId) && folders.some((d) => d.id === openId && visibleFolder(d)) ? openId : null;
  const trail: PieceFileFolder[] = [];
  for (let id = current; id; ) {
    const d = folders.find((x) => x.id === id);
    if (!d || trail.includes(d)) break;
    trail.unshift(d);
    id = parentOf(d);
  }
  const open = (folderId: string | null) => {
    setSearchParams(folderId ? { folder: folderId } : {});
    setShowUpload(false);
  };

  const { addFiles, uploadList } = usePieceUploads(
    piece.id,
    () => files.length,
    (row) => setFiles((list) => [...list, row]),
    current,
  );

  // A folder and everything in it (so it can't be moved into itself).
  const isInside = (folderId: string | null, ancestorId: string): boolean => {
    for (let id = folderId; id; ) {
      if (id === ancestorId) return true;
      const d = folders.find((x) => x.id === id);
      id = d ? parentOf(d) : null;
    }
    return false;
  };

  // --- writes (the API runs a query once it is awaited or then'd) ----------

  const saveFile = (id: string, patch: Partial<PieceFile>) => {
    setFiles((list) => list.map((f) => (f.id === id ? { ...f, ...patch } : f)));
    void api.from('piece_files').update(patch).eq('id', id).then(() => undefined);
  };
  const saveFolder = (id: string, patch: Partial<PieceFileFolder>) => {
    setFolders((list) => list.map((d) => (d.id === id ? { ...d, ...patch } : d)));
    void api.from('piece_file_folders').update(patch).eq('id', id).then(() => undefined);
  };

  // Puts `item` into `parentId`, at `index` among its kind there (end when
  // omitted), and numbers that list again.
  const place = (item: Item, parentId: string | null, index?: number) => {
    if (item.kind === 'folder') {
      if (parentId && isInside(parentId, item.folder.id)) return;
      const siblings = folders.filter((d) => parentOf(d) === parentId && d.id !== item.folder.id).sort(byPosition);
      siblings.splice(index ?? siblings.length, 0, item.folder);
      siblings.forEach((d, position) => {
        const parent_id = d.id === item.folder.id ? parentId : d.parent_id;
        if (d.position !== position || d.parent_id !== parent_id) saveFolder(d.id, { position, parent_id });
      });
    } else {
      const siblings = files.filter((f) => folderOf(f) === parentId && f.id !== item.file.id).sort(byPosition);
      siblings.splice(index ?? siblings.length, 0, item.file);
      siblings.forEach((f, position) => {
        const folder_id = f.id === item.file.id ? parentId : f.folder_id;
        if (f.position !== position || f.folder_id !== folder_id) saveFile(f.id, { position, folder_id });
      });
    }
  };

  const addFolder = async () => {
    const { data } = await api
      .from('piece_file_folders')
      .insert({ piece_id: piece.id, parent_id: current, name: t('newFolderName'), position: subfolders(current).length })
      .select('*')
      .single();
    if (!data) return;
    const folder = data as PieceFileFolder;
    setFolders((list) => [...list, folder]);
    setRenaming(folder.id);
  };

  // Deleting a folder keeps what is in it: it moves up one level.
  const removeFolder = async (folder: PieceFileFolder) => {
    const up = parentOf(folder);
    for (const d of folders.filter((x) => parentOf(x) === folder.id)) saveFolder(d.id, { parent_id: up });
    for (const f of files.filter((x) => folderOf(x) === folder.id)) saveFile(f.id, { folder_id: up });
    setFolders((list) => list.filter((d) => d.id !== folder.id));
    await api.from('piece_file_folders').delete().eq('id', folder.id);
  };

  // --- links ----------------------------------------------------------------

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
    void refreshPreview(link);
  };

  // --- folders as ZIP ---------------------------------------------------------

  // Everything one may see in a folder (null = all), its folders kept as
  // paths in the ZIP; links are left out. Built in the browser.
  const zipFolder = async (folderId: string | null, name: string) => {
    if (zipping) return;
    const entries: Array<{ name: string; path: string }> = [];
    const walk = (id: string | null, prefix: string) => {
      for (const f of filesIn(id)) {
        if (!f.file_path || f.kind === 'link') continue;
        const base = f.title.trim() ? safeFileName(f.title.trim()) + fileExt(f) : safeFileName(f.file_name ?? '');
        entries.push({ name: prefix + base, path: f.file_path });
      }
      for (const d of subfolders(id)) walk(d.id, `${prefix}${safeFileName(d.name)}/`);
    };
    walk(folderId, '');
    if (entries.length === 0) return setZipNote(t('zipEmpty'));
    setZipNote(null);
    setZipping({ done: 0, total: entries.length });
    try {
      const used = new Set<string>();
      const packed: Array<{ name: string; data: Uint8Array }> = [];
      for (const [i, entry] of entries.entries()) {
        const response = await fetch(pieceFileUrl(entry.path));
        // A file missing on the server is left out; the rest still comes.
        if (response.ok) {
          let unique = entry.name;
          for (let n = 2; used.has(unique); n++) unique = entry.name.replace(/(\.[^./]+)?$/, ` (${n})$1`);
          used.add(unique);
          packed.push({ name: unique, data: new Uint8Array(await response.arrayBuffer()) });
        }
        setZipping({ done: i + 1, total: entries.length });
      }
      if (packed.length === 0) throw new Error('nothing');
      const url = URL.createObjectURL(createZip(packed));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeFileName(`${piece.name} – ${name}`)}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      track('folder-zip');
    } catch {
      setZipNote(t('zipError'));
    }
    setZipping(null);
  };

  // --- drag and drop --------------------------------------------------------

  const fromOutside = (e: DragEvent) => !dragged.current && e.dataTransfer.types.includes('Files');

  const dragProps = (item: Item) =>
    canEdit && renaming !== itemId(item)
      ? {
          draggable: true,
          onDragStart: (e: DragEvent) => {
            dragged.current = item;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', itemId(item));
          },
          onDragEnd: () => {
            dragged.current = null;
            setDropAt(null);
          },
        }
      : {};

  // Where something dropped onto `target` lands: a folder takes what is
  // dropped on its middle (and any file); near its edges, a dragged folder
  // goes beside it. Files order among files, folders among folders.
  const landing = (e: DragEvent, target: Item, horizontal: boolean): DropAt | null => {
    const moved = dragged.current;
    if (!moved) return target.kind === 'folder' ? { into: target.folder.id } : null;
    if (itemId(moved) === itemId(target)) return null;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const share = horizontal ? (e.clientX - r.left) / r.width : (e.clientY - r.top) / r.height;
    if (target.kind === 'folder') {
      if (moved.kind === 'folder' && (share < 0.25 || share > 0.75)) return { beside: target, after: share > 0.5 };
      if (moved.kind === 'folder' && isInside(target.folder.id, moved.folder.id)) return null;
      return { into: target.folder.id };
    }
    return moved.kind === 'file' ? { beside: target, after: share > 0.5 } : null;
  };

  const drop = (at: DropAt, e: DragEvent) => {
    const moved = dragged.current;
    dragged.current = null;
    setDropAt(null);
    if (!moved) {
      // Files from the computer: uploaded into that folder.
      const picked = Array.from(e.dataTransfer.files);
      if (picked.length && 'into' in at) void addFiles(picked, at.into);
      return;
    }
    if ('into' in at) return place(moved, at.into);
    const parentId = at.beside.kind === 'folder' ? parentOf(at.beside.folder) : folderOf(at.beside.file);
    const siblings = (moved.kind === 'folder' ? subfolders(parentId) : filesIn(parentId))
      .map((x) => x.id)
      .filter((id) => id !== itemId(moved));
    const index = siblings.indexOf(itemId(at.beside)) + (at.after ? 1 : 0);
    place(moved, parentId, index);
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

  // A folder in the breadcrumbs (or the page itself) takes drops too.
  const folderTargetProps = (key: string, folderId: string | null) =>
    canEdit
      ? {
          onDragOver: (e: DragEvent) => {
            const moved = dragged.current;
            if (!moved && !fromOutside(e)) return;
            if (moved?.kind === 'folder' && folderId && isInside(folderId, moved.folder.id)) return;
            e.preventDefault();
            if (dropAt?.key !== key) setDropAt({ key, at: { into: folderId } });
          },
          onDragLeave: (e: DragEvent) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropAt((d) => (d?.key === key ? null : d));
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

  // --- pieces of an item ----------------------------------------------------

  const renameInput = (item: Item, className: string) => {
    const name = item.kind === 'folder' ? item.folder.name : fileName(item.file);
    return (
      <input
        autoFocus
        defaultValue={name}
        // Typing replaces the name (a new folder's placeholder too).
        onFocus={(e) => e.target.select()}
        aria-label={t('rename')}
        onClick={(e) => e.stopPropagation()}
        onBlur={(e) => {
          setRenaming(null);
          const v = e.target.value.trim();
          if (!v || v === name) return;
          if (item.kind === 'folder') saveFolder(item.folder.id, { name: v });
          else saveFile(item.file.id, { title: v, ...(item.file.file_name ? { file_name: v + fileExt(item.file) } : {}) });
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') setRenaming(null);
        }}
        className={cn(
          'min-w-0 rounded-md border border-black bg-white px-2 text-base font-medium focus:outline-none sm:text-sm',
          className,
        )}
      />
    );
  };

  // Members see whether a folder (or a file outside any) is visible to them.
  const hiddenBadge = (item: Item) => {
    const hidden =
      item.kind === 'folder' ? !item.folder.downloadable : !folderOf(item.file) && !item.file.downloadable;
    return hidden ? (
      <span title={t('hiddenFromMembers')} className="flex-shrink-0 text-text-tertiary">
        <EyeOff size={14} aria-label={t('hiddenFromMembers')} />
      </span>
    ) : null;
  };

  const downloadSwitch = (item: Item) => {
    if (item.kind === 'folder') {
      return (
        <Switch
          checked={item.folder.downloadable}
          onChange={(downloadable) => saveFolder(item.folder.id, { downloadable })}
          label={t('downloadSwitch')}
          title={t('folderDownloadHint')}
          icon={Download}
        />
      );
    }
    // In a folder, the folder decides.
    if (folderOf(item.file)) return null;
    return (
      <Switch
        checked={item.file.downloadable}
        onChange={(downloadable) => saveFile(item.file.id, { downloadable })}
        label={t('downloadSwitch')}
        title={t('downloadSwitchHint')}
        icon={Download}
      />
    );
  };

  // Downloading, for everyone: a file as it is, a folder as a ZIP. Links
  // have nothing to download.
  const downloadItem = (item: Item) => {
    if (item.kind === 'folder') return void zipFolder(item.folder.id, item.folder.name);
    const a = document.createElement('a');
    a.href = fileHref(piece, item.file);
    document.body.appendChild(a);
    a.click();
    a.remove();
    track('file-download', { kind: item.file.kind });
  };

  const menu = (item: Item) => {
    const isLink = item.kind === 'file' && item.file.kind === 'link';
    return (
      // Inside a file's link: a click here neither opens nor downloads it.
      <span
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        className="flex-shrink-0"
      >
        <OverflowMenu
          label={t('moreActions')}
          items={[
            // A link opens (it has nothing to download); the rest downloads.
            isLink
              ? {
                  icon: ExternalLink,
                  label: t('openLink'),
                  onSelect: () => window.open(fileHref(piece, item.file), '_blank', 'noopener,noreferrer'),
                }
              : {
                  icon: Download,
                  label: item.kind === 'folder' ? t('downloadZip') : t('downloadFile'),
                  onSelect: () => downloadItem(item),
                },
            ...(canEdit && isLink
              ? [{ icon: RefreshCw, label: t('refreshPreview'), onSelect: () => void refreshPreview(item.file) }]
              : []),
            ...(canEdit ? editItems(item) : []),
          ]}
        />
      </span>
    );
  };

  const editItems = (item: Item) => [
            { icon: Pencil, label: t('rename'), onSelect: () => setRenaming(itemId(item)), separated: true },
            { icon: FolderInput, label: t('moveTo'), onSelect: () => setMoving(item) },
            ...(item.kind === 'folder' || !folderOf(item.file)
              ? [
                  {
                    icon: item.kind === 'folder' ? (item.folder.downloadable ? EyeOff : Download) : item.file.downloadable ? EyeOff : Download,
                    label: (item.kind === 'folder' ? item.folder.downloadable : item.file.downloadable)
                      ? t('hideFromMembers')
                      : t('showToMembers'),
                    onSelect: () =>
                      item.kind === 'folder'
                        ? saveFolder(item.folder.id, { downloadable: !item.folder.downloadable })
                        : saveFile(item.file.id, { downloadable: !item.file.downloadable }),
                  },
                ]
              : []),
            { icon: Trash2, label: t('delete'), onSelect: () => setToDelete(item), separated: true },
  ];

  const openItem = (item: Item) => {
    if (item.kind === 'folder') return open(item.folder.id);
    if (item.file.kind !== 'link') track('file-download', { kind: item.file.kind });
  };

  // --- grid -----------------------------------------------------------------

  // A link's tile: the linked page's image across the top (or a link icon),
  // its title and site below.
  const linkTile = (item: Extract<Item, { kind: 'file' }>) => {
    const f = item.file;
    const image = f.link_preview?.image;
    return (
      <>
        <div className="relative -mx-3 -mt-3 h-[4.25rem] flex-shrink-0 overflow-hidden rounded-t-xl bg-surface-muted">
          {image ? (
            <img src={pieceFileUrl(image)} alt="" loading="lazy" draggable={false} className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full items-center justify-center text-text-tertiary">
              {previewBusy.includes(f.id) ? <Loader2 size={20} className="animate-spin" /> : <LinkIcon size={22} />}
            </span>
          )}
          <div className="absolute right-1 top-1 flex items-center gap-1 rounded-lg bg-surface/85 backdrop-blur">
            {canEdit && hiddenBadge(item)}
            {menu(item)}
          </div>
        </div>
        <div className="mt-auto min-w-0 pt-2">
          {renaming === f.id ? (
            renameInput(item, 'h-8 w-full')
          ) : (
            <p className="truncate text-sm font-medium" title={f.link_preview?.description || fileName(f)}>
              {fileName(f)}
            </p>
          )}
          <p className="flex items-center gap-1 truncate text-xs text-text-tertiary">
            <ExternalLink size={11} className="flex-shrink-0" aria-hidden />
            <span className="truncate">{linkSite(f)}</span>
          </p>
        </div>
      </>
    );
  };

  const tile = (item: Item) => {
    const key = `tile:${itemId(item)}`;
    const side = besideHere(key);
    const Icon = item.kind === 'folder' ? Folder : item.file.kind === 'link' ? LinkIcon : fileIcon(item.file);
    const body = item.kind === 'file' && item.file.kind === 'link' ? linkTile(item) : (
      <>
        <div className="flex items-start justify-between gap-1">
          <Icon
            size={item.kind === 'folder' ? 30 : 26}
            className={cn('flex-shrink-0', item.kind === 'folder' ? 'text-accent' : 'text-text-secondary')}
            aria-hidden
          />
          <div className="-mr-1 -mt-1 flex items-center gap-1">
            {canEdit && hiddenBadge(item)}
            {menu(item)}
          </div>
        </div>
        <div className="mt-auto min-w-0 pt-3">
          {renaming === itemId(item) ? (
            renameInput(item, 'h-8 w-full')
          ) : (
            <p className="truncate text-sm font-medium" title={item.kind === 'folder' ? item.folder.name : fileName(item.file)}>
              {item.kind === 'folder' ? item.folder.name : fileName(item.file)}
            </p>
          )}
          <p className="truncate text-xs text-text-tertiary">
            {item.kind === 'folder'
              ? t('folderItems').replace('{n}', String(countIn(item.folder.id)))
              : item.file.kind === 'link'
                ? item.file.url
                : fileExt(item.file).slice(1).toUpperCase()}
          </p>
        </div>
      </>
    );
    const className = cn(
      'relative flex h-32 flex-col rounded-xl border bg-surface p-3 text-left transition-colors duration-150 hover:bg-surface-subtle',
      intoHere(key) ? 'border-accent bg-accent/10' : 'border-border',
    );
    const marker = side && (
      <span
        aria-hidden
        className={cn('absolute bottom-2 top-2 w-0.5 rounded-full bg-accent', side === 'before' ? '-left-2' : '-right-2')}
      />
    );
    return (
      <li key={key} {...dragProps(item)} {...targetProps(key, item, true)} className="relative">
        {item.kind === 'folder' || renaming === itemId(item) ? (
          <div
            role="button"
            tabIndex={0}
            onClick={() => renaming !== itemId(item) && openItem(item)}
            onKeyDown={(e) => e.key === 'Enter' && renaming !== itemId(item) && openItem(item)}
            className={cn(className, 'cursor-pointer')}
          >
            {body}
          </div>
        ) : (
          <a draggable={false}
            href={fileHref(piece, item.file)}
            onClick={() => openItem(item)}
            {...(item.file.kind === 'link' ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
            className={className}
          >
            {body}
          </a>
        )}
        {marker}
      </li>
    );
  };

  const grid = (items: Item[]) => (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">{items.map(tile)}</ul>
  );

  // --- list -----------------------------------------------------------------

  const row = (item: Item, depth: number): ReactNode => {
    const key = `row:${itemId(item)}`;
    const side = besideHere(key);
    const isFolder = item.kind === 'folder';
    const shut = isFolder && collapsed.includes(item.folder.id);
    const Icon = isFolder ? Folder : item.kind === 'file' && item.file.kind === 'link' ? LinkIcon : fileIcon(item.file);
    const name = isFolder ? item.folder.name : fileName(item.file);
    // A link shows a small copy of its page's image.
    const thumb = !isFolder && item.file.kind === 'link' ? item.file.link_preview?.image : null;
    const line = (
      <div
        {...dragProps(item)}
        {...targetProps(key, item, false)}
        style={{ paddingLeft: `${0.5 + depth * 1.25}rem` }}
        className={cn(
          'relative flex min-h-[2.75rem] items-center gap-2 border-b border-border pr-1.5 transition-colors duration-150',
          isFolder ? 'bg-surface-subtle' : 'bg-surface',
          intoHere(key) && 'bg-accent/10',
        )}
      >
        {side && (
          <span aria-hidden className={cn('absolute inset-x-0 h-0.5 bg-accent', side === 'before' ? '-top-px' : '-bottom-px')} />
        )}
        {isFolder ? (
          <button
            type="button"
            onClick={() => toggleCollapsed(item.folder.id)}
            aria-label={shut ? t('expand') : t('collapse')}
            aria-expanded={!shut}
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-text-tertiary hover:bg-surface-hover hover:text-text"
          >
            {shut ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
          </button>
        ) : (
          <span className="w-7 flex-shrink-0" />
        )}
        {thumb ? (
          <img src={pieceFileUrl(thumb)} alt="" loading="lazy" draggable={false} className="h-6 w-6 flex-shrink-0 rounded object-cover" />
        ) : (
          <Icon size={17} className={cn('flex-shrink-0', isFolder ? 'text-accent' : 'text-text-secondary')} aria-hidden />
        )}
        {renaming === itemId(item) ? (
          renameInput(item, 'h-8 flex-1')
        ) : isFolder ? (
          <button
            type="button"
            onClick={() => toggleCollapsed(item.folder.id)}
            className="min-w-0 flex-1 truncate text-left text-sm font-semibold"
          >
            {name}
          </button>
        ) : (
          <a draggable={false}
            href={fileHref(piece, item.file)}
            onClick={() => openItem(item)}
            {...(item.file.kind === 'link' ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
            className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
          >
            {name}
            {item.file.kind !== 'link' ? (
              <span className="font-normal text-text-tertiary">{fileExt(item.file)}</span>
            ) : (
              <span className="ml-2 font-normal text-text-tertiary">{linkSite(item.file)}</span>
            )}
          </a>
        )}
        {canEdit && downloadSwitch(item)}
        {!isFolder && item.file.kind === 'link' && !canEdit && (
          <ExternalLink size={15} className="flex-shrink-0 text-text-tertiary" aria-hidden />
        )}
        {menu(item)}
      </div>
    );
    return (
      <li key={key}>
        {line}
        {isFolder && !shut && itemsIn(item.folder.id).length > 0 && (
          <ul>{itemsIn(item.folder.id).map((child) => row(child, depth + 1))}</ul>
        )}
      </li>
    );
  };

  const list = (items: Item[]) => (
    <ul className="overflow-hidden rounded-md border border-border border-b-0 bg-surface">{items.map((i) => row(i, 0))}</ul>
  );

  // --- the page ---------------------------------------------------------------

  const items = itemsIn(current);
  const crumb = (key: string, label: string, folderId: string | null, last: boolean) => (
    <li key={key} className="flex min-w-0 items-center gap-1">
      {last ? (
        <span className="truncate font-semibold text-text">{label}</span>
      ) : (
        <button
          type="button"
          onClick={() => open(folderId)}
          {...folderTargetProps(`crumb:${key}`, folderId)}
          className={cn(
            'truncate rounded px-1 text-text-secondary hover:text-text',
            intoHere(`crumb:${key}`) && 'bg-accent/15 text-text',
          )}
        >
          {label}
        </button>
      )}
      {!last && <ChevronRight size={14} className="flex-shrink-0 text-text-tertiary" />}
    </li>
  );

  // Folders to move into (not the item itself or what is in it).
  const moveTargets = (item: Item) => {
    const out: Array<{ id: string; name: string; depth: number }> = [];
    const walk = (parentId: string | null, depth: number) => {
      for (const d of folders.filter((x) => parentOf(x) === parentId).sort(byPosition)) {
        if (item.kind === 'folder' && d.id === item.folder.id) continue;
        out.push({ id: d.id, name: d.name, depth });
        walk(d.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  };
  const movingParent = moving ? (moving.kind === 'folder' ? parentOf(moving.folder) : folderOf(moving.file)) : null;

  return (
    <div className="max-w-5xl space-y-5" {...folderTargetProps('page', current)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold sm:text-2xl">{t('files')}</h1>
        <div className="flex items-center gap-2">
          <div role="group" aria-label={t('view')} className="flex rounded-md border border-border bg-surface-muted p-0.5">
            {(
              [
                ['grid', LayoutGrid, t('viewGrid')],
                ['list', List, t('viewList')],
              ] as const
            ).map(([id, Icon, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setView(id)}
                aria-pressed={view === id}
                aria-label={label}
                title={label}
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded transition-colors duration-150',
                  view === id ? 'bg-surface text-text shadow-sm' : 'text-text-secondary hover:text-text',
                )}
              >
                <Icon size={16} />
              </button>
            ))}
          </div>
          {/* The open folder (or everything) as one ZIP. */}
          {items.length > 0 && (
            <Button
              variant="secondary"
              disabled={zipping != null}
              onClick={() => void zipFolder(current, trail[trail.length - 1]?.name ?? t('files'))}
              aria-label={t('downloadZip')}
              title={t('downloadZip')}
            >
              <Download size={15} />
              <span className="hidden sm:inline">{t('downloadZip')}</span>
            </Button>
          )}
          {canEdit && (
            <>
              <Button variant="secondary" onClick={() => void addFolder()} aria-label={t('newFolder')} title={t('newFolder')}>
                <FolderPlus size={15} />
                <span className="hidden sm:inline">{t('newFolder')}</span>
              </Button>
              <Button onClick={() => setShowUpload((v) => !v)} aria-expanded={showUpload} aria-label={t('addFiles')} title={t('addFiles')}>
                {showUpload ? <X size={15} /> : <Plus size={15} />}
                <span className="hidden sm:inline">{t('addFiles')}</span>
              </Button>
            </>
          )}
        </div>
      </div>


      {/* Where you are: back and the way here (both take drops). */}
      {current && (
        <nav aria-label={t('breadcrumbs')} className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => open(trail.length > 1 ? trail[trail.length - 2].id : null)}
            aria-label={t('back')}
            title={t('back')}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-text-secondary hover:bg-surface-hover hover:text-text"
          >
            <ArrowLeft size={17} />
          </button>
          <ol className="flex min-w-0 flex-wrap items-center gap-1 text-sm">
            {crumb('root', t('files'), null, false)}
            {trail.map((d, i) => crumb(d.id, d.name, d.id, i === trail.length - 1))}
          </ol>
        </nav>
      )}

      {canEdit && showUpload && (
        <div className="space-y-3">
          <MultiDropzone compact onFiles={(picked) => void addFiles(picked)} />
          {/* Or a link: shown like a file, with a preview of its page. */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void addLink();
            }}
            className="flex flex-wrap items-start gap-2"
          >
            <LinkIcon size={16} className="mt-3 flex-shrink-0 text-text-secondary" aria-hidden />
            <input
              value={linkUrl}
              onChange={(e) => {
                setLinkUrl(e.target.value);
                setLinkError(null);
              }}
              placeholder="https://"
              aria-label={t('linkUrl')}
              inputMode="url"
              className="h-10 min-w-0 flex-[2_1_14rem] rounded-md border border-border bg-white px-3 text-base focus:border-black focus:outline-none sm:text-sm"
            />
            <input
              value={linkName}
              onChange={(e) => setLinkName(e.target.value)}
              placeholder={t('linkNameOptional')}
              aria-label={t('displayName')}
              className="h-10 min-w-0 flex-[1_1_10rem] rounded-md border border-border bg-white px-3 text-base focus:border-black focus:outline-none sm:text-sm"
            />
            <Button type="submit" variant="secondary" disabled={!linkUrl.trim() || linkBusy} className="h-10">
              {linkBusy ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
              {t('addLink')}
            </Button>
            {linkError && <p className="w-full text-sm text-danger">{linkError}</p>}
          </form>
          {current && (
            <p className="text-xs text-text-secondary">
              {t('uploadIntoFolder').replace('{name}', trail[trail.length - 1]?.name ?? '')}
            </p>
          )}
        </div>
      )}
      {uploadList}
      {(zipping || zipNote) && (
        <p className={cn('flex items-center gap-2 text-sm', zipNote ? 'text-danger' : 'text-text-secondary')}>
          {zipping && <Loader2 size={14} className="animate-spin" />}
          {zipping ? t('zipProgress').replace('{done}', String(zipping.done)).replace('{total}', String(zipping.total)) : zipNote}
        </p>
      )}

      <div className={cn('rounded-xl transition-colors duration-150', intoHere('page') && 'bg-accent/5 ring-2 ring-accent/40')}>
        {items.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-text-secondary">
            {current ? t('emptyFolder') : t('noFiles')}
          </p>
        ) : view === 'grid' ? (
          grid(items)
        ) : (
          list(items)
        )}
      </div>

      <Modal open={moving != null} title={t('moveTo')} onClose={() => setMoving(null)}>
        {moving && (
          <ul className="space-y-0.5">
            {[{ id: null as string | null, name: t('files'), depth: 0 }, ...moveTargets(moving).map((d) => ({ ...d, depth: d.depth + 1 }))].map(
              (d) => (
                <li key={d.id ?? 'root'}>
                  <button
                    type="button"
                    disabled={d.id === movingParent}
                    onClick={() => {
                      place(moving, d.id);
                      setMoving(null);
                    }}
                    style={{ paddingLeft: `${0.75 + d.depth * 1.25}rem` }}
                    className="flex h-10 w-full items-center gap-2 rounded-md pr-3 text-left text-sm hover:bg-surface-hover disabled:opacity-40"
                  >
                    <Folder size={15} className="flex-shrink-0 text-accent" />
                    <span className="truncate">{d.name}</span>
                  </button>
                </li>
              ),
            )}
          </ul>
        )}
      </Modal>

      <ConfirmDialog
        open={toDelete != null}
        title={toDelete?.kind === 'folder' ? t('removeFolder') : t('deleteFile')}
        message={toDelete?.kind === 'folder' ? t('removeFolderHint') : t('confirmDeleteFile')}
        confirmLabel={t('delete')}
        destructive
        onConfirm={async () => {
          const item = toDelete;
          setToDelete(null);
          if (!item) return;
          if (item.kind === 'folder') return removeFolder(item.folder);
          setFiles((list) => list.filter((f) => f.id !== item.file.id));
          await deletePieceFile(item.file);
        }}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
};
