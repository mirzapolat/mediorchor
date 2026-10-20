import { Input, Textarea } from './Input';
import { MarkdownEditor } from './MarkdownEditor';
import { useI18n } from '@/lib/i18n';

export interface ConcertValues {
  title: string;
  date: string;
  time: string;
  end_time: string;
  location: string;
  description: string;
  dress_code: string;
}

export const blankConcert: ConcertValues = {
  title: '',
  date: '',
  time: '',
  end_time: '',
  location: '',
  description: '',
  dress_code: '',
};

// The row as stored: empty optional fields as null, an end only with a start.
export const concertPayload = (v: ConcertValues) => ({
  title: v.title.trim(),
  date: v.date || null,
  time: v.time || null,
  end_time: v.time && v.end_time ? v.end_time : null,
  location: v.location.trim(),
  description: v.description.trim(),
  dress_code: v.dress_code.trim(),
});

// A concert's fields. `compact`: a short plain description and no dress
// code (creating one, the project set-up); otherwise both as Markdown.
export const ConcertFields = ({
  value,
  onChange,
  compact = false,
  idPrefix = 'concert',
}: {
  value: ConcertValues;
  onChange: (value: ConcertValues) => void;
  compact?: boolean;
  idPrefix?: string;
}) => {
  const { t } = useI18n();
  const set = (patch: Partial<ConcertValues>) => onChange({ ...value, ...patch });
  const optional = (label: string) => `${label} (${t('optional')})`;
  return (
    <div className="space-y-4">
      <Input
        id={`${idPrefix}-title`}
        label={t('concertTitle')}
        value={value.title}
        maxLength={200}
        required
        onChange={(e) => set({ title: e.target.value })}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <Input
          id={`${idPrefix}-date`}
          type="date"
          label={optional(t('date'))}
          value={value.date}
          onChange={(e) => set({ date: e.target.value })}
        />
        <Input
          id={`${idPrefix}-time`}
          type="time"
          label={optional(t('startTime'))}
          value={value.time}
          onChange={(e) => set({ time: e.target.value })}
        />
        <Input
          id={`${idPrefix}-end`}
          type="time"
          label={optional(t('endTime'))}
          value={value.end_time}
          disabled={!value.time}
          onChange={(e) => set({ end_time: e.target.value })}
        />
      </div>
      <Input
        id={`${idPrefix}-location`}
        label={optional(t('eventLocation'))}
        placeholder={t('concertLocationPlaceholder')}
        maxLength={300}
        value={value.location}
        onChange={(e) => set({ location: e.target.value })}
      />
      {compact ? (
        <Textarea
          id={`${idPrefix}-description`}
          label={optional(t('concertDescription'))}
          rows={2}
          maxLength={2000}
          value={value.description}
          onChange={(e) => set({ description: e.target.value })}
        />
      ) : (
        <>
          <MarkdownEditor
            id={`${idPrefix}-description`}
            label={optional(t('concertDescription'))}
            value={value.description}
            onChange={(description) => set({ description })}
            minHeight={140}
          />
          <MarkdownEditor
            id={`${idPrefix}-dress`}
            label={optional(t('concertDressCode'))}
            hint={t('concertDressCodeHint')}
            value={value.dress_code}
            onChange={(dress_code) => set({ dress_code })}
            minHeight={100}
          />
        </>
      )}
    </div>
  );
};
