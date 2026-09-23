import { ChevronDown, IdCard, Mail, Tags, User, UserRound, type LucideIcon } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';

// Attributes an incoming column/field can be assigned to (CSV import and
// webhook registrations share them).
export type MapTarget = 'first_name' | 'last_name' | 'full_name' | 'email' | 'group_name';

type LabelKey = 'firstName' | 'lastName' | 'fullNameField' | 'email' | 'group';

export const MAP_TARGETS: { target: MapTarget; label: LabelKey; icon: LucideIcon; color: string }[] = [
  { target: 'first_name', label: 'firstName', icon: User, color: '#0284c7' },
  { target: 'last_name', label: 'lastName', icon: UserRound, color: '#4f46e5' },
  { target: 'full_name', label: 'fullNameField', icon: IdCard, color: '#0d9488' },
  { target: 'email', label: 'email', icon: Mail, color: '#ea580c' },
  { target: 'group_name', label: 'group', icon: Tags, color: '#9333ea' },
];

export const targetMeta = (target: MapTarget) => MAP_TARGETS.find((m) => m.target === target)!;

const NONE = '';

// A chip-styled select that assigns one attribute to a column/field. `auto`
// marks an assignment that was detected rather than chosen.
export const TargetSelect = ({
  value,
  auto = false,
  onChange,
  className,
}: {
  value: MapTarget | null;
  auto?: boolean;
  onChange: (target: MapTarget | null) => void;
  className?: string;
}) => {
  const { t } = useI18n();
  const meta = value ? targetMeta(value) : null;
  const Icon = meta?.icon;
  return (
    <label
      className={cn(
        'relative inline-flex h-7 max-w-full cursor-pointer items-center gap-1.5 rounded-full border pl-2.5 pr-7 text-xs font-medium transition-colors duration-150',
        meta ? 'text-text' : 'border-dashed border-border text-text-tertiary hover:border-text-tertiary',
        auto && 'border-dashed',
        className,
      )}
      style={meta ? { backgroundColor: `${meta.color}14`, borderColor: `${meta.color}66` } : undefined}
    >
      {Icon && <Icon size={13} style={{ color: meta!.color }} className="flex-shrink-0" />}
      <span className="truncate">{meta ? t(meta.label) : t('mapNotUsed')}</span>
      {auto && meta && (
        <span className="rounded bg-white/70 px-1 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">
          auto
        </span>
      )}
      <ChevronDown size={13} className="pointer-events-none absolute right-2 text-text-tertiary" />
      <select
        value={value ?? NONE}
        onChange={(e) => onChange((e.target.value || null) as MapTarget | null)}
        className="absolute inset-0 cursor-pointer opacity-0"
        aria-label={t('mapAssign')}
      >
        <option value={NONE}>{t('mapNotUsed')}</option>
        {MAP_TARGETS.map((m) => (
          <option key={m.target} value={m.target}>
            {t(m.label)}
          </option>
        ))}
      </select>
    </label>
  );
};

// A preview of tabular data where each column header carries a TargetSelect.
// Assigned columns are tinted in their attribute's color.
export const ColumnMapper = ({
  headers,
  rows,
  assignment,
  onAssign,
}: {
  headers: string[];
  rows: string[][];
  // Column index per target, or null.
  assignment: Record<MapTarget, number | null>;
  onAssign: (column: number, target: MapTarget | null) => void;
}) => {
  const targetOf = (col: number) =>
    (Object.keys(assignment) as MapTarget[]).find((k) => assignment[k] === col) ?? null;

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {headers.map((h, col) => {
              const target = targetOf(col);
              const color = target ? targetMeta(target).color : null;
              return (
                <th
                  key={col}
                  className="min-w-[150px] border-b border-border px-3 pb-2.5 pt-3 text-left align-top font-normal"
                  style={color ? { backgroundColor: `${color}0f`, boxShadow: `inset 0 3px 0 ${color}` } : undefined}
                >
                  <div className="mb-2 truncate text-xs font-semibold text-text-secondary" title={h}>
                    {h || `#${col + 1}`}
                  </div>
                  <TargetSelect value={target} onChange={(next) => onAssign(col, next)} />
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className="border-t border-border first:border-t-0">
              {headers.map((_, col) => {
                const target = targetOf(col);
                const color = target ? targetMeta(target).color : null;
                return (
                  <td
                    key={col}
                    className={cn('max-w-[220px] truncate px-3 py-1.5', target ? 'text-text' : 'text-text-tertiary')}
                    style={color ? { backgroundColor: `${color}0a` } : undefined}
                    title={row[col] ?? ''}
                  >
                    {row[col] || '—'}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
