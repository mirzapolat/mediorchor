import { Trash2 } from 'lucide-react';
import { Input, Select } from './Input';
import { useI18n } from '@/lib/i18n';
import type { Comparison, Connector, Metric, StoredCondition } from '@/lib/absenceConditions';

// Editor rows carry a client-side id on top of the stored shape.
export interface EditableCondition extends StoredCondition {
  id: string;
}

let nextConditionId = 1;
export const createCondition = (patch: Partial<StoredCondition> = {}): EditableCondition => ({
  id: `condition-${nextConditionId++}`,
  connector: 'and',
  metric: 'absent',
  comparison: 'gte',
  value: 1,
  ...patch,
});

export const withIds = (conditions: StoredCondition[]): EditableCondition[] => conditions.map((c) => createCondition(c));

// Strips editor ids so only the stored shape is persisted.
export const toStoredConditions = (conditions: EditableCondition[]): StoredCondition[] =>
  conditions.map(({ connector, metric, comparison, value }) => ({ connector, metric, comparison, value }));

// The attendance conditions ("when … unexcused ≥ 3 …"), one row each: the
// editor of the Fehlzeiten page, also used where a project is set up.
export const ConditionRows = ({
  conditions,
  onChange,
}: {
  conditions: EditableCondition[];
  onChange: (conditions: EditableCondition[]) => void;
}) => {
  const { t } = useI18n();
  const update = (id: string, patch: Partial<StoredCondition>) =>
    onChange(conditions.map((condition) => (condition.id === id ? { ...condition, ...patch } : condition)));
  return (
    <div className="space-y-3">
      {conditions.map((condition, index) => (
        <div
          key={condition.id}
          className="grid items-end gap-2 border-b border-border pb-3 last:border-b-0 sm:grid-cols-[110px_minmax(140px,1fr)_minmax(150px,1fr)_110px_36px]"
        >
          {index === 0 ? (
            <div className="pb-2 text-sm font-medium text-text-secondary">{t('when')}</div>
          ) : (
            <Select
              aria-label={`${t('and')} / ${t('or')}`}
              value={condition.connector}
              onChange={(event) => update(condition.id, { connector: event.target.value as Connector })}
            >
              <option value="and">{t('and')}</option>
              <option value="or">{t('or')}</option>
            </Select>
          )}

          <Select
            label={t('conditionMetric')}
            value={condition.metric}
            onChange={(event) => update(condition.id, { metric: event.target.value as Metric })}
          >
            <option value="attended">{t('metricAttended')}</option>
            <option value="excused">{t('metricExcused')}</option>
            <option value="absent">{t('metricUnexcused')}</option>
            <option value="missed">{t('metricMissed')}</option>
          </Select>

          <Select
            label={t('comparison')}
            value={condition.comparison}
            onChange={(event) => update(condition.id, { comparison: event.target.value as Comparison })}
          >
            <option value="gte">≥ {t('atLeast')}</option>
            <option value="gt">&gt; {t('moreThan')}</option>
            <option value="eq">= {t('exactly')}</option>
            <option value="lt">&lt; {t('lessThan')}</option>
            <option value="lte">≤ {t('atMost')}</option>
          </Select>

          <Input
            type="number"
            min={0}
            step={1}
            label={t('count')}
            value={condition.value}
            onChange={(event) => update(condition.id, { value: Math.max(0, Math.floor(Number(event.target.value) || 0)) })}
          />

          <button
            type="button"
            aria-label={t('remove')}
            onClick={() => onChange(conditions.filter((item) => item.id !== condition.id))}
            className="mb-0.5 flex h-9 w-9 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-hover hover:text-text"
          >
            <Trash2 size={16} />
          </button>
        </div>
      ))}
    </div>
  );
};
