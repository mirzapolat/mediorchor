import type { Member } from '@/types';

const normalize = (value: string) => value.trim().replace(/\s+/g, ' ');

// Returns the linked account's name when it deviates from the member's name
// in the project (member rows are auto-renamed on account name changes, but a
// manager may rename them within a project afterwards). Null when there is no
// linked account or the names match.
export const accountNameDeviation = (
  member: Member,
  accountName: string | undefined,
): string | null => {
  if (!accountName || !normalize(accountName)) return null;
  return normalize(`${member.first_name} ${member.last_name}`) !== normalize(accountName)
    ? accountName
    : null;
};

// Split a full name at the last space: everything before is the first name, the
// trailing token is the last name (same rule the server uses for account names).
// Single-token names keep an empty last name.
export const splitName = (full: string): { first: string; last: string } => {
  const trimmed = normalize(full);
  const at = trimmed.lastIndexOf(' ');
  if (at === -1) return { first: trimmed, last: '' };
  return { first: trimmed.slice(0, at), last: trimmed.slice(at + 1) };
};
