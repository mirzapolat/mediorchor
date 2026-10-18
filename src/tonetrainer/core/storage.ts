import type { ScorePrefs, SessionRecord } from './types'

/**
 * Persistence the trainer needs. The host app implements this against its backend
 * (src/lib/practiceStorage.ts).
 */
export interface PracticeStorage {
  getPrefs(scoreId: string): Promise<ScorePrefs>
  /** Merges `prefs` into what is stored for the score. */
  savePrefs(scoreId: string, prefs: ScorePrefs): Promise<void>
  addSession(session: SessionRecord): Promise<void>
  /** Sessions sorted by `startedAt` ascending; all scores when `scoreId` is omitted. */
  sessions(scoreId?: string): Promise<SessionRecord[]>
  /** Called when the host deletes a score. */
  deleteScore?(scoreId: string): Promise<void>
}
