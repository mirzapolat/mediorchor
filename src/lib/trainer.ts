import { api } from '@/lib/api';
import { pieceFileUrl } from '@/lib/pieceFiles';
import { readXmlText } from '@/lib/musicxml';
import { parseScore } from '@/tonetrainer/core';
import type { Piece, PieceFile } from '@/types';

// The singing trainer's MusicXML of a piece (connected to the trainer node
// in the setup); null = the piece isn't open for practice.
export const trainerFile = (piece: Pick<Piece, 'trainer_file_id'>, files: PieceFile[]): PieceFile | null =>
  files.find((f) => f.id === piece.trainer_file_id && f.file_path) ?? null;

export const loadTrainerXml = async (file: PieceFile): Promise<string> =>
  readXmlText(await (await fetch(pieceFileUrl(file.file_path as string))).blob());

export interface TrainerVoice {
  // The trainer's voice id ("<part index>:<voice>"), as mapped to groups.
  id: string;
  name: string;
  // Lowest and highest sung pitch (MIDI).
  low: number;
  high: number;
}

// The voices the trainer offers for a score (throws with the trainer's
// German message when it can't be practised).
export const trainerVoices = (xml: string): TrainerVoice[] =>
  parseScore(xml)
    .tracks.filter((track) => track.notes.length > 0)
    .map((track) => {
      const pitches = track.notes.map((n) => n.midi);
      return { id: track.id, name: track.name, low: Math.min(...pitches), high: Math.max(...pitches) };
    });

// Which voices each of a project's groups sings for a piece: group id →
// voice ids (groups without any are absent).
export const loadVoiceMapping = async (pieceId: string, groupIds: string[]): Promise<Map<string, string[]>> => {
  const map = new Map<string, string[]>();
  if (groupIds.length === 0) return map;
  const { data } = await api
    .from('piece_trainer_voices')
    .select('group_id, track_id')
    .eq('piece_id', pieceId)
    .in('group_id', groupIds);
  for (const row of (data as Array<{ group_id: string; track_id: string }> | null) ?? []) {
    map.set(row.group_id, [...(map.get(row.group_id) ?? []), row.track_id]);
  }
  return map;
};

// The voices the signed-in member may sing in the trainer, from their group
// in the project the piece is opened in. Empty = all (no project, no group,
// or the group isn't mapped).
export const allowedTrainerVoices = async (pieceId: string, projectId: string | null, userId: string): Promise<string[]> => {
  if (!projectId) return [];
  const { data: member } = await api
    .from('members')
    .select('group_name')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .maybeSingle();
  const groupName = (member as { group_name: string | null } | null)?.group_name;
  if (!groupName) return [];
  const { data: group } = await api
    .from('project_groups')
    .select('id')
    .eq('project_id', projectId)
    .eq('name', groupName)
    .maybeSingle();
  const groupId = (group as { id: string } | null)?.id;
  if (!groupId) return [];
  return (await loadVoiceMapping(pieceId, [groupId])).get(groupId) ?? [];
};
