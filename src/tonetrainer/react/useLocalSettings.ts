import { useCallback, useSyncExternalStore } from 'react'
import { DEFAULT_SETTINGS, type PracticeSettings } from '../core/settings'

/**
 * Default settings persistence in localStorage. Hosts with their own settings system can skip this
 * and pass `settings` + `onSettingsChange` to <PracticeView> instead.
 */
const KEY = 'tonetrainer-settings'
const listeners = new Set<() => void>()
let state: PracticeSettings = load()

function load(): PracticeSettings {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return { ...DEFAULT_SETTINGS, ...(parsed.state ?? parsed) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export const settingsStore = {
  get: () => state,
  set(patch: Partial<PracticeSettings>) {
    state = { ...state, ...patch }
    try {
      localStorage.setItem(KEY, JSON.stringify(state))
    } catch {
      // Private mode or blocked storage: settings stay in memory for this visit.
    }
    for (const l of listeners) l()
  },
  subscribe(l: () => void) {
    listeners.add(l)
    return () => void listeners.delete(l)
  },
}

export function useLocalSettings(): [PracticeSettings, (patch: Partial<PracticeSettings>) => void] {
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.get)
  return [settings, useCallback((patch: Partial<PracticeSettings>) => settingsStore.set(patch), [])]
}
