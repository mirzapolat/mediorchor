import { api } from '@/lib/api';
import type { PracticeStorage, ScorePrefs, SessionRecord } from '@/tonetrainer/core';

// The singing trainer's memory, kept on the server per account: its runs
// (practice_sessions) and per-piece preferences (practice_prefs). The
// trainer's score id is the piece id.
export const createPracticeStorage = (userId: string): PracticeStorage => {
  const loadPrefs = async (pieceId: string): Promise<ScorePrefs> => {
    const { data } = await api
      .from('practice_prefs')
      .select('prefs')
      .eq('user_id', userId)
      .eq('piece_id', pieceId)
      .maybeSingle();
    return (data as { prefs: ScorePrefs } | null)?.prefs ?? {};
  };
  return {
    getPrefs: loadPrefs,
    async savePrefs(pieceId, prefs) {
      const merged = { ...(await loadPrefs(pieceId)), ...prefs };
      await api
        .from('practice_prefs')
        .upsert({ user_id: userId, piece_id: pieceId, prefs: merged }, { onConflict: 'user_id,piece_id' });
    },
    async addSession(session) {
      await api.from('practice_sessions').insert({
        id: session.id,
        user_id: userId,
        piece_id: session.songId,
        started_at: session.startedAt,
        data: session,
      });
    },
    async sessions(pieceId) {
      let query = api.from('practice_sessions').select('data').eq('user_id', userId);
      if (pieceId) query = query.eq('piece_id', pieceId);
      const { data } = await query.order('started_at');
      return ((data as Array<{ data: SessionRecord }> | null) ?? []).map((row) => row.data);
    },
  };
};
