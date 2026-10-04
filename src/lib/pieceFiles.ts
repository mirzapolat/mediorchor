import { api } from './api';
import type { Piece, PieceCredit, PieceFile, PieceFileKind, PieceTrack, ProjectPiece } from '@/types';

const BUCKET = 'piece-files';

// Uploads an attachment to the public "piece-files" bucket. Like uploadImage,
// the object key is a fresh UUID + sanitised extension; raw file names (spaces,
// umlauts, …) are never used as storage keys.
export const uploadPieceFile = async (
  pieceId: string,
  file: File,
): Promise<{ path: string | null; error: string | null }> => {
  const rawExt = file.name.includes('.') ? file.name.split('.').pop() ?? '' : '';
  const ext = rawExt.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  const path = `${pieceId}/${crypto.randomUUID()}.${ext}`;

  const { error } = await api.storage.from(BUCKET).upload(path, file, {
    cacheControl: '3600',
    contentType: file.type || undefined,
  });
  if (error) return { path: null, error: error.message };
  return { path, error: null };
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

export const loadPieceFiles = async (pieceId: string): Promise<PieceFile[]> => {
  const { data } = await api
    .from('piece_files')
    .select('*')
    .eq('piece_id', pieceId)
    .order('position')
    .order('created_at');
  return (data as PieceFile[] | null) ?? [];
};

// Stored object of a file row (links have none).
const storedPaths = (file: Pick<PieceFile, 'file_path'>): string[] => (file.file_path ? [file.file_path] : []);

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

// A voice as the player plays it: its recordings resolved to stored files.
export interface PlayerTrack {
  id: string;
  title: string;
  file_path: string;
  click_file_path: string | null;
  offset_s: number;
}

// The playable voices (those with a recording without click), in order.
export const playerTracks = (tracks: PieceTrack[], files: PieceFile[]): PlayerTrack[] =>
  tracks.flatMap((track) => {
    const file = files.find((f) => f.id === track.file_id);
    if (!file?.file_path) return [];
    const click = files.find((f) => f.id === track.click_file_id);
    return [
      {
        id: track.id,
        title: track.title,
        file_path: file.file_path,
        click_file_path: click?.file_path ?? null,
        offset_s: track.offset_s,
      },
    ];
  });

// The score PDF shown on the piece page: the picked one, else the first.
export const pieceScoreFile = (piece: Pick<Piece, 'score_file_id'>, files: PieceFile[]): PieceFile | null =>
  files.find((f) => f.id === piece.score_file_id && f.file_path) ??
  files.find((f) => f.kind === 'score' && f.file_path) ??
  null;

// Deletes a file row together with its stored objects.
export const deletePieceFile = async (file: PieceFile): Promise<void> => {
  await api.from('piece_files').delete().eq('id', file.id);
  void removePieceFiles(storedPaths(file));
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
  piece_id: string;
  kind: PieceFileKind;
  title: string;
  file_name: string | null;
  file_path: string | null;
}

// A project's piece with its place in the project (`link`).
export interface ProjectPieceItem extends Piece {
  link: ProjectPiece;
}

// A project's pieces in its running order, plus the file rows the list
// summarises.
export const loadPiecesOverview = async (
  projectId: string,
): Promise<{ pieces: ProjectPieceItem[]; files: PieceOverviewFile[] }> => {
  const { data } = await api
    .from('project_pieces')
    .select('*, pieces(*)')
    .eq('project_id', projectId)
    .order('position')
    .order('created_at');
  const pieces = ((data as Array<ProjectPiece & { pieces: Piece | null }> | null) ?? []).flatMap(
    ({ pieces: piece, ...link }) => (piece ? [{ ...piece, link }] : []),
  );
  if (pieces.length === 0) return { pieces, files: [] };
  const { data: files } = await api
    .from('piece_files')
    .select('piece_id, kind, title, file_name, file_path, position')
    .in(
      'piece_id',
      pieces.map((p) => p.id),
    )
    .order('position');
  return { pieces, files: (files as PieceOverviewFile[] | null) ?? [] };
};
