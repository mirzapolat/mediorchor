import { api } from './api';
import type { EventPiece, Piece } from '@/types';

// A programme entry with the bits of its piece the lists show.
export interface ProgramItem extends EventPiece {
  pieces: Pick<Piece, 'id' | 'name' | 'composer'> | null;
}

// Programme entries of the given events in running order.
export const loadEventPrograms = async (eventIds: string[]): Promise<ProgramItem[]> => {
  if (eventIds.length === 0) return [];
  const { data } = await api
    .from('event_pieces')
    .select('*, pieces(id, name, composer)')
    .in('event_id', eventIds)
    .order('position')
    .order('created_at');
  return (data as ProgramItem[] | null) ?? [];
};
