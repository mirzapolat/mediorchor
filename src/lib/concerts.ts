import { api } from './api';
import { localToday } from './eventTiming';
import { uploadBucketFile } from './pieceFiles';
import type { Concert, ConcertProgramItem, ConcertRecording, ConcertRecordingTrashEntry } from '@/types';

export const CONCERT_BUCKET = 'concert-files';

// Upcoming first (the next one on top, undated ones after the dated), then
// past ones, most recent first. A past date archives nothing.
export const sortConcerts = (concerts: Concert[]) => {
  const today = localToday();
  const upcoming = concerts.filter((c) => !c.date || c.date >= today);
  const past = concerts.filter((c) => c.date && c.date < today);
  const key = (c: Concert) => `${c.date ?? '9999-99-99'} ${c.time ?? ''}`;
  upcoming.sort((a, b) => key(a).localeCompare(key(b)));
  past.sort((a, b) => key(b).localeCompare(key(a)));
  return { upcoming, past };
};

export const isPastConcert = (c: Concert) => Boolean(c.date && c.date < localToday());

export const loadConcerts = async (projectId: string): Promise<Concert[]> => {
  const { data } = await api.from('concerts').select('*').eq('project_id', projectId).order('date').order('time');
  return (data as Concert[] | null) ?? [];
};

export interface ConcertBundle {
  concert: Concert;
  items: ConcertProgramItem[];
  recordings: ConcertRecording[];
  // Managers only (empty for others).
  trash: ConcertRecordingTrashEntry[];
}

export const loadConcert = async (concertId: string, withTrash: boolean): Promise<ConcertBundle | null> => {
  const [{ data: concert }, { data: items }, { data: recordings }, trash] = await Promise.all([
    api.from('concerts').select('*').eq('id', concertId).maybeSingle(),
    api.from('concert_program_items').select('*').eq('concert_id', concertId).order('position').order('created_at'),
    api.from('concert_recordings').select('*').eq('concert_id', concertId).order('position').order('created_at'),
    withTrash
      ? api.from('concert_recording_trash').select('*').eq('concert_id', concertId).order('deleted_at', { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);
  if (!concert) return null;
  return {
    concert: concert as Concert,
    items: (items as ConcertProgramItem[] | null) ?? [],
    recordings: (recordings as ConcertRecording[] | null) ?? [],
    trash: (trash.data as ConcertRecordingTrashEntry[] | null) ?? [],
  };
};

export const uploadConcertFile = (concertId: string, file: File, onProgress?: (share: number) => void) =>
  uploadBucketFile(CONCERT_BUCKET, concertId, file, onProgress);

export const concertFileUrl = (path: string) => api.storage.from(CONCERT_BUCKET).getPublicUrl(path).data.publicUrl;

// What a recording plays as: audio, video or neither (a download).
export const recordingMedia = (r: ConcertRecording): 'audio' | 'video' | null => {
  const type = r.mime ?? '';
  if (type.startsWith('audio/')) return 'audio';
  if (type.startsWith('video/')) return 'video';
  const ext = /\.([a-z0-9]+)$/i.exec(r.file_name ?? '')?.[1]?.toLowerCase();
  if (ext && ['mp3', 'm4a', 'wav', 'ogg', 'oga', 'aac', 'flac', 'opus'].includes(ext)) return 'audio';
  if (ext && ['mp4', 'm4v', 'mov', 'webm', 'ogv'].includes(ext)) return 'video';
  return null;
};

// Size for people ("12,3 MB").
export const formatBytes = (bytes: number, locale: string) => {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${value.toLocaleString(locale, { maximumFractionDigits: unit ? 1 : 0 })} ${units[unit]}`;
};
