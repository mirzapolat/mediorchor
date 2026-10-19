import { api } from './api';
import { config } from './config';
import type {
  LinkPreview,
  Piece,
  PieceCredit,
  PieceFile,
  PieceFileFolder,
  PieceFileKind,
  PieceFileTrashEntry,
  PieceTrack,
  ProjectPiece,
} from '@/types';

const BUCKET = 'piece-files';

// Whether a file is too large for the server (checked before uploading).
export const exceedsUploadLimit = (file: Blob) => file.size > config.maxUploadBytes;

// Uploads an attachment to the "piece-files" bucket, reporting progress
// (0…1). Like uploadImage, the object key is a fresh UUID + sanitised
// extension; raw file names (spaces, umlauts, …) are never storage keys.
// `error` is 'too-large' for a file over the server's limit.
export const uploadPieceFile = (
  pieceId: string,
  file: File,
  onProgress?: (share: number) => void,
): Promise<{ path: string | null; error: string | null }> => {
  if (exceedsUploadLimit(file)) return Promise.resolve({ path: null, error: 'too-large' });
  const rawExt = file.name.includes('.') ? file.name.split('.').pop() ?? '' : '';
  const ext = rawExt.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  const path = `${pieceId}/${crypto.randomUUID()}.${ext}`;

  // XMLHttpRequest, as fetch can't report upload progress.
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/storage/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve({ path, error: null });
      let message = xhr.statusText || 'Upload failed';
      try {
        message = (JSON.parse(xhr.responseText) as { error?: { message?: string } }).error?.message ?? message;
      } catch {
        /* not JSON */
      }
      resolve({ path: null, error: xhr.status === 413 ? 'too-large' : message });
    };
    xhr.onerror = () => resolve({ path: null, error: 'Network error: the server is unreachable' });
    xhr.send(file);
  });
};

export const pieceFileUrl = (path: string): string =>
  api.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

// Public URL that forces a download under the original file name.
export const pieceFileDownloadUrl = (path: string, fileName: string): string =>
  api.storage.from(BUCKET).getPublicUrl(path, { download: fileName }).data.publicUrl;

// Download name of a piece file, independent of what the uploader called it:
// "Piece – Composer – Title.ext" (empty parts left out), keeping the stored
// file's extension. Characters file systems reject are replaced.
export const pieceDownloadName = (
  piece: Pick<Piece, 'name' | 'composer'>,
  title: string,
  storedName: string,
): string => {
  const ext = /\.[a-z0-9]{1,8}$/i.exec(storedName)?.[0].toLowerCase() ?? '';
  const base = [piece.name, piece.composer, title]
    .map((part) => part.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' – ');
  return (base || 'Download') + ext;
};

export const removePieceFiles = async (paths: string[]): Promise<void> => {
  if (paths.length === 0) return;
  await api.storage.from(BUCKET).remove(paths);
};

// A piece's file rows, or why they couldn't be read.
export const queryPieceFiles = async (pieceId: string): Promise<{ files: PieceFile[]; error: string | null }> => {
  const { data, error } = await api
    .from('piece_files')
    .select('*')
    .eq('piece_id', pieceId)
    .order('position')
    .order('created_at');
  return { files: (data as PieceFile[] | null) ?? [], error: error?.message ?? null };
};

export const loadPieceFiles = async (pieceId: string): Promise<PieceFile[]> => (await queryPieceFiles(pieceId)).files;

// Stored objects of a file row: its file, or a link's preview image.
const storedPaths = (file: Pick<PieceFile, 'file_path' | 'link_preview'>): string[] =>
  [file.file_path, file.link_preview?.image ?? null].filter((p): p is string => Boolean(p));

// Has the server read (again) what a link points to; the new preview, or
// the reason it couldn't.
export const fetchLinkPreview = async (fileId: string): Promise<{ preview: LinkPreview | null; error?: string }> => {
  try {
    const res = await fetch('/api/link-preview', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: fileId }),
    });
    const body = (await res.json().catch(() => ({}))) as { preview?: LinkPreview; error?: { message?: string } };
    return res.ok ? { preview: body.preview ?? null } : { preview: null, error: body.error?.message ?? String(res.status) };
  } catch {
    return { preview: null, error: 'offline' };
  }
};

export const loadPieceTracks = async (pieceId: string): Promise<PieceTrack[]> => {
  const { data } = await api
    .from('piece_tracks')
    .select('*')
    .eq('piece_id', pieceId)
    .order('position')
    .order('created_at');
  return (data as PieceTrack[] | null) ?? [];
};

export const loadPieceCredits = async (pieceId: string): Promise<PieceCredit[]> => {
  const { data } = await api
    .from('piece_credits')
    .select('*')
    .eq('piece_id', pieceId)
    .order('position')
    .order('created_at');
  return (data as PieceCredit[] | null) ?? [];
};

// The four recording slots of a voice: other voices muted or quiet, each
// without and with metronome click.
export const TRACK_RECORDING_FIELDS = ['file_id', 'click_file_id', 'quiet_file_id', 'quiet_click_file_id'] as const;
export type TrackRecordingField = (typeof TRACK_RECORDING_FIELDS)[number];

export const trackRecordingField = (quiet: boolean, click: boolean): TrackRecordingField =>
  quiet ? (click ? 'quiet_click_file_id' : 'quiet_file_id') : click ? 'click_file_id' : 'file_id';

// A voice as the player plays it: its recordings resolved to stored files.
export interface PlayerTrack {
  id: string;
  title: string;
  recordings: Partial<Record<TrackRecordingField, string>>;
  offset_s: number;
}

// The playable voices (those with at least one recording), in order.
export const playerTracks = (tracks: PieceTrack[], files: PieceFile[]): PlayerTrack[] =>
  tracks.flatMap((track) => {
    const recordings: PlayerTrack['recordings'] = {};
    for (const field of TRACK_RECORDING_FIELDS) {
      const path = files.find((f) => f.id === track[field])?.file_path;
      if (path) recordings[field] = path;
    }
    if (Object.keys(recordings).length === 0) return [];
    return [{ id: track.id, title: track.title, recordings, offset_s: track.offset_s }];
  });

// The recording to play for the wanted mix; when the voice lacks it, the
// closest one (keeping the metronome choice before the background voices).
export const trackRecordingChoice = (
  track: PlayerTrack | null,
  quiet: boolean,
  click: boolean,
): { path: string; quiet: boolean; click: boolean } | null => {
  if (!track) return null;
  const order: Array<[boolean, boolean]> = [
    [quiet, click],
    [!quiet, click],
    [quiet, !click],
    [!quiet, !click],
  ];
  for (const [q, c] of order) {
    const path = track.recordings[trackRecordingField(q, c)];
    if (path) return { path, quiet: q, click: c };
  }
  return null;
};

export const trackRecording = (track: PlayerTrack | null, quiet: boolean, click: boolean): string | null =>
  trackRecordingChoice(track, quiet, click)?.path ?? null;

// Whether a folder is public (members see it): it and every folder above it
// are public on the "Dateien" page. Mirrors folderIsPublic in
// server/policies.ts, which enforces it.
export const isFolderDownloadable = (
  folderId: string,
  folders: Array<Pick<PieceFileFolder, 'id' | 'parent_id' | 'downloadable'>>,
): boolean => {
  const seen = new Set<string>();
  let id: string | null = folderId;
  while (id && !seen.has(id)) {
    seen.add(id);
    const folder = folders.find((d) => d.id === id);
    // A folder that is gone counts as the top.
    if (!folder) return true;
    if (!folder.downloadable) return false;
    id = folder.parent_id;
  }
  return true;
};

// Whether a file is public (members see and download it): it is, and so
// are its folders.
export const isFileDownloadable = (
  file: Pick<PieceFile, 'downloadable' | 'folder_id'>,
  folders: Array<Pick<PieceFileFolder, 'id' | 'parent_id' | 'downloadable'>>,
): boolean => file.downloadable && (!file.folder_id || isFolderDownloadable(file.folder_id, folders));

// The score PDF shown on the piece page: the picked one, else the first.
export const pieceScoreFile = (piece: Pick<Piece, 'score_file_id'>, files: PieceFile[]): PieceFile | null =>
  files.find((f) => f.id === piece.score_file_id && f.file_path) ??
  files.find((f) => f.kind === 'score' && f.file_path) ??
  null;

// Moves files to their piece's trash (restorable for 30 days; the server
// removes the stored objects after that). The trash entries, or the error.
export const trashPieceFiles = async (
  ids: string[],
): Promise<{ trashIds: string[]; error: string | null }> => {
  const { data, error } = await api.rpc('trash_piece_files', { p_ids: ids });
  return {
    trashIds: ((data as Array<{ trash_id: string }> | null) ?? []).map((d) => d.trash_id),
    error: error?.message ?? null,
  };
};

// Deletes a file (into the trash). The error, if any.
export const deletePieceFile = async (file: PieceFile): Promise<string | null> =>
  (await trashPieceFiles([file.id])).error;

export const restorePieceFiles = async (trashIds: string[]): Promise<string | null> =>
  (await api.rpc('restore_piece_files', { p_ids: trashIds })).error?.message ?? null;

// Deletes trashed files for good.
export const purgePieceTrash = async (trashIds: string[]): Promise<string | null> =>
  (await api.rpc('purge_piece_file_trash', { p_ids: trashIds })).error?.message ?? null;

export const loadPieceTrash = async (pieceId: string): Promise<PieceFileTrashEntry[]> => {
  const { data } = await api
    .from('piece_file_trash')
    .select('*')
    .eq('piece_id', pieceId)
    .order('deleted_at', { ascending: false });
  return (data as PieceFileTrashEntry[] | null) ?? [];
};

// Where folders and files of a piece sit, written all at once (one refused
// change keeps everything as it was). The error, if any.
export const arrangePieceFiles = async (
  pieceId: string,
  folders: Array<Pick<PieceFileFolder, 'id' | 'parent_id' | 'position'>>,
  files: Array<Pick<PieceFile, 'id' | 'folder_id' | 'position'>>,
): Promise<string | null> => {
  if (folders.length === 0 && files.length === 0) return null;
  const { error } = await api.rpc('arrange_piece_files', { p_piece_id: pieceId, p_folders: folders, p_files: files });
  return error?.message ?? null;
};

// A ZIP of a folder (null = all of the piece) or of a selection, built and
// streamed by the server with what the caller may download.
export const pieceZipUrl = (
  pieceId: string,
  what: { folder: string | null } | { folders: string[]; files: string[] },
  name: string,
): string => {
  const query = new URLSearchParams({ name });
  if ('folder' in what) {
    if (what.folder) query.set('folder', what.folder);
  } else {
    if (what.folders.length) query.set('folders', what.folders.join(','));
    if (what.files.length) query.set('files', what.files.join(','));
  }
  return `/api/piece-zip/${encodeURIComponent(pieceId)}?${query}`;
};

// Writes the list order into `position` for rows whose position changed.
export const persistOrder = async (
  table: 'project_pieces' | 'piece_files' | 'piece_tracks' | 'event_pieces',
  rows: Array<{ id: string; position: number }>,
): Promise<void> => {
  await Promise.all(
    rows.map((row, index) =>
      row.position === index ? null : api.from(table).update({ position: index }).eq('id', row.id),
    ),
  );
};

// Creates a piece in the collection; with a project it is added to the end
// of that project's running order. Returns the new id, or the error.
export const createPiece = async (fields: {
  projectId: string | null;
  name: string;
  composer: string;
}): Promise<{ id: string | null; error: string | null }> => {
  const { data, error } = await api.rpc('create_piece', {
    p_project_id: fields.projectId,
    p_name: fields.name,
    p_composer: fields.composer,
  });
  if (error || !data) return { id: null, error: error?.message ?? 'error' };
  return { id: (data as { id: string }).id, error: null };
};

// Collection pieces a project can still add (not archived, not in it yet).
export const loadPieceCatalog = async (
  projectId: string,
): Promise<Array<Pick<Piece, 'id' | 'name' | 'composer'>>> => {
  const { data } = await api.rpc('piece_catalog', { p_project_id: projectId });
  return (data as Array<Pick<Piece, 'id' | 'name' | 'composer'>> | null) ?? [];
};

export const addPieceToProject = async (projectId: string, pieceId: string, position: number) =>
  api.from('project_pieces').insert({ project_id: projectId, piece_id: pieceId, position });

// Takes a piece out of a project (and its rehearsal programmes); the piece
// stays in the collection.
export const removePieceFromProject = async (projectId: string, pieceId: string) =>
  api.from('project_pieces').delete().eq('project_id', projectId).eq('piece_id', pieceId);

// Deletes a piece from the collection (and so from every project); its file
// rows cascade, the stored objects are removed here.
export const deletePiece = async (pieceId: string): Promise<void> => {
  const files = await loadPieceFiles(pieceId);
  await api.from('pieces').delete().eq('id', pieceId);
  void removePieceFiles(files.flatMap(storedPaths));
};

// The loaders below are shared by the pages and the offline download, so the
// download asks exactly the same questions the pages ask later (offline
// answers are looked up by the exact request).

export const loadPiece = async (pieceId: string): Promise<Piece | null> => {
  const { data } = await api.from('pieces').select('*').eq('id', pieceId).maybeSingle();
  return (data as Piece | null) ?? null;
};

// Whether a project uses a piece. Piece pages inside a project only open the
// project's own pieces, even for someone who may see the piece elsewhere.
export const isPieceInProject = async (projectId: string, pieceId: string): Promise<boolean> => {
  const { data } = await api
    .from('project_pieces')
    .select('id')
    .eq('project_id', projectId)
    .eq('piece_id', pieceId)
    .maybeSingle();
  return Boolean(data);
};

// A piece as a piece page opens it: inside a project only if the project
// uses it (null otherwise).
export const loadPieceInScope = async (pieceId: string, projectId: string | null): Promise<Piece | null> => {
  const [piece, inProject] = await Promise.all([
    loadPiece(pieceId),
    projectId ? isPieceInProject(projectId, pieceId) : Promise.resolve(true),
  ]);
  return inProject ? piece : null;
};

export interface PieceOverviewFile {
  id: string;
  piece_id: string;
  kind: PieceFileKind;
  title: string;
  file_name: string | null;
  file_path: string | null;
  // See isFileDownloadable.
  downloadable: boolean;
}

// A project's piece with its place in the project (`link`).
export interface ProjectPieceItem extends Piece {
  link: ProjectPiece;
}

// A project's pieces in its running order, plus the file rows the list
// summarises and which pieces have recordings to play along with the score.
export const loadPiecesOverview = async (
  projectId: string,
): Promise<{ pieces: ProjectPieceItem[]; files: PieceOverviewFile[]; withRecordings: Set<string> }> => {
  const { data } = await api
    .from('project_pieces')
    .select('*, pieces(*)')
    .eq('project_id', projectId)
    .order('position')
    .order('created_at');
  const pieces = ((data as Array<ProjectPiece & { pieces: Piece | null }> | null) ?? []).flatMap(
    ({ pieces: piece, ...link }) => (piece ? [{ ...piece, link }] : []),
  );
  if (pieces.length === 0) return { pieces, files: [], withRecordings: new Set() };
  const ids = pieces.map((p) => p.id);
  const [{ data: files }, { data: folderRows }, { data: trackRows }] = await Promise.all([
    api
      .from('piece_files')
      .select('id, piece_id, kind, title, file_name, file_path, downloadable, folder_id, position')
      .in('piece_id', ids)
      .order('position'),
    api.from('piece_file_folders').select('id, piece_id, parent_id, downloadable').in('piece_id', ids),
    api.from('piece_tracks').select(`piece_id, ${TRACK_RECORDING_FIELDS.join(', ')}`).in('piece_id', ids),
  ]);
  const folders = (folderRows as PieceFileFolder[] | null) ?? [];
  const withRecordings = new Set(
    ((trackRows as Array<Pick<PieceTrack, 'piece_id' | TrackRecordingField>> | null) ?? [])
      .filter((t) => TRACK_RECORDING_FIELDS.some((field) => t[field]))
      .map((t) => t.piece_id),
  );
  return {
    pieces,
    withRecordings,
    files: ((files as Array<PieceOverviewFile & { folder_id: string | null }> | null) ?? []).map(
      ({ folder_id, ...f }) => ({
        ...f,
        downloadable: isFileDownloadable({ ...f, folder_id }, folders.filter((d) => d.piece_id === f.piece_id)),
      }),
    ),
  };
};
