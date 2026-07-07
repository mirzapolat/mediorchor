import type { AttendanceCounts } from './memberAttendance';

// Absence condition model, shared between the Fehlzeiten page (editor +
// filtering) and "Meine Teilnahme" (evaluating public labels for oneself).

export type Metric = keyof AttendanceCounts;
export type Comparison = 'gte' | 'gt' | 'eq' | 'lt' | 'lte';
export type Connector = 'and' | 'or';

// One condition as persisted inside absence_labels.conditions.
export interface StoredCondition {
  connector: Connector;
  metric: Metric;
  comparison: Comparison;
  value: number;
}

export const compare = (actual: number, comparison: Comparison, expected: number) => {
  if (comparison === 'gte') return actual >= expected;
  if (comparison === 'gt') return actual > expected;
  if (comparison === 'eq') return actual === expected;
  if (comparison === 'lt') return actual < expected;
  return actual <= expected;
};

// AND binds more tightly than OR: A OR B AND C is evaluated as A OR (B AND C).
export const matchesConditions = (counts: AttendanceCounts, conditions: StoredCondition[]) => {
  if (conditions.length === 0) return true;

  const groups: StoredCondition[][] = [[]];
  for (const [index, condition] of conditions.entries()) {
    if (index > 0 && condition.connector === 'or') groups.push([]);
    groups[groups.length - 1].push(condition);
  }
  return groups.some((group) =>
    group.every((condition) => compare(counts[condition.metric], condition.comparison, condition.value)),
  );
};
