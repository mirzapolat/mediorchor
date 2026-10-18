import { Flame } from 'lucide-react'
import { useMemo, useState } from 'react'
import { formatMinutes, practiceBuckets, streak, type Range } from '../core/stats'
import type { SessionRecord } from '../core/types'
import { Segmented } from './ui'

const CURRENT_LABEL: Record<Range, string> = { day: 'heute', week: 'diese Woche', month: 'diesen Monat' }

/**
 * Practice minutes per day (last 14), week (last 12) or month (last 12), plus the day streak.
 * Load sessions with `storage.sessions()` (all scores) and place this where the host shows its overview.
 */
export default function PracticeTimeChart({ sessions }: { sessions: SessionRecord[] }) {
  const [range, setRange] = useState<Range>('day')
  const buckets = useMemo(() => practiceBuckets(sessions, range), [sessions, range])
  const days = useMemo(() => streak(sessions), [sessions])
  const max = Math.max(10, ...buckets.map((b) => b.minutes))
  const current = buckets[buckets.length - 1]

  return (
    <section aria-label="Übungszeit" className="tt-root tt-surface tt-pad tt-time">
      <div className="tt-time__head">
        <h2 className="tt-card-title">Übungszeit</h2>
        <Segmented
          size="sm"
          label="Zeitraum"
          value={range}
          onChange={setRange}
          options={[
            { value: 'day', label: 'Tag' },
            { value: 'week', label: 'Woche' },
            { value: 'month', label: 'Monat' },
          ]}
        />
      </div>
      <div className="tt-time__summary">
        <p>
          <span className="tt-time__total">{formatMinutes(current.minutes)}</span> <span className="tt-muted">{CURRENT_LABEL[range]}</span>
        </p>
        {days > 0 && (
          <p className="tt-time__streak" title="Tage in Folge geübt">
            <Flame size={16} /> {days} {days === 1 ? 'Tag' : 'Tage'}
          </p>
        )}
      </div>
      <div className="tt-time__bars" role="img" aria-label={`Übungsminuten ${CURRENT_LABEL[range]} und davor`}>
        {buckets.map((b) => (
          <div key={b.key} className={`tt-time__col ${b.current ? 'tt-time__col--current' : ''}`} title={`${b.title}: ${formatMinutes(b.minutes)}`}>
            <div className="tt-time__bar" style={{ height: `${Math.max(b.minutes > 0 ? 4 : 1.5, (b.minutes / max) * 100)}%`, opacity: b.minutes > 0 ? 1 : 0.25 }} />
            <span className="tt-time__label">{b.label}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
