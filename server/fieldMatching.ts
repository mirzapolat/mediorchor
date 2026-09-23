// Matching incoming form fields (webhook payloads) to registration attributes.
// Shared by the webhook endpoint and by re-mapping stored registrations when a
// page's field mapping changes, so both always follow the same rules.

export type Fields = Record<string, string>;
export type Target = 'first_name' | 'last_name' | 'full_name' | 'email' | 'group_name';
export const TARGETS: Target[] = ['first_name', 'last_name', 'full_name', 'email', 'group_name'];

// Lower-case, keep letters/digits only ("E-Mail-Adresse" → "emailadresse").
const norm = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]/g, '');

// Synonyms per target (normalized). Exact matches win over "contains" matches.
const SYNONYMS: Record<Target, string[]> = {
  first_name: ['firstname', 'first', 'vorname', 'givenname', 'forename', 'prenom'],
  last_name: ['lastname', 'last', 'nachname', 'surname', 'familyname', 'familienname', 'nom'],
  full_name: ['name', 'fullname', 'vollername', 'vollstaendigername', 'deinname', 'ihrname', 'yourname'],
  email: ['email', 'emailaddress', 'emailadresse', 'mail', 'mailadresse', 'respondentemail'],
  group_name: ['group', 'gruppe', 'stimme', 'stimmgruppe', 'stimmlage', 'voice', 'instrument', 'register', 'section'],
};

// A "name" field only counts as the full name when it isn't qualified.
const NAME_QUALIFIERS = ['vor', 'nach', 'first', 'last', 'sur', 'given', 'famil', 'user', 'nick'];

// Field whose full key or last path segment matches `wanted`.
const findKey = (fields: Fields, wanted: string): string | null => {
  const target = norm(wanted);
  if (!target) return null;
  return (
    Object.keys(fields).find((k) => norm(k) === target) ??
    Object.keys(fields).find((k) => norm(k.split('.').pop() ?? '') === target) ??
    null
  );
};

const guessKey = (fields: Fields, target: Target, taken: Set<string>): string | null => {
  const keys = Object.keys(fields).filter((k) => !taken.has(k) && fields[k] !== '');
  const leaf = (k: string) => norm(k.split('.').pop() ?? k);
  const exact = keys.find((k) => SYNONYMS[target].includes(leaf(k)));
  if (exact) return exact;
  return (
    keys.find((k) => {
      const n = leaf(k);
      if (target === 'full_name') {
        return n.includes('name') && !NAME_QUALIFIERS.some((q) => n.includes(q));
      }
      // Short synonyms ("last", "mail", "nom") only match exactly.
      return SYNONYMS[target].some((s) => s.length >= 5 && n.includes(s));
    }) ?? null
  );
};

// Which incoming field feeds which target: explicit mapping first, then guesses.
// A mapping of "-" switches a target off: it matches no field and isn't guessed.
export const matchFields = (fields: Fields, mapping: Partial<Record<Target, string>>) => {
  const matched = {} as Record<Target, string | null>;
  const taken = new Set<string>();
  for (const target of TARGETS) {
    const explicit = mapping[target]?.trim();
    matched[target] = explicit ? findKey(fields, explicit) : null;
    if (matched[target]) taken.add(matched[target]!);
  }
  for (const target of TARGETS) {
    if (mapping[target]?.trim() || matched[target]) continue;
    // A full name is only needed when first/last aren't both there.
    if (target === 'full_name' && matched.first_name && matched.last_name) continue;
    matched[target] = guessKey(fields, target, taken);
    if (matched[target]) taken.add(matched[target]!);
  }
  return matched;
};

// Same rule as the rest of the app: split at the last space.
export const splitName = (full: string) => {
  const trimmed = full.trim().replace(/\s+/g, ' ');
  const at = trimmed.lastIndexOf(' ');
  return at === -1
    ? { first: trimmed, last: '' }
    : { first: trimmed.slice(0, at), last: trimmed.slice(at + 1) };
};

export const parseMapping = (raw: unknown): Partial<Record<Target, string>> => {
  try {
    const parsed = JSON.parse(typeof raw === 'string' ? raw : '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

export type Extracted =
  | { ok: false; error: 'missing_name' | 'invalid_input' }
  | {
      ok: true;
      firstName: string;
      lastName: string;
      email: string | null;
      // Canonical project group, or the raw value when the project lacks it.
      groupName: string | null;
      // False when a group was given that isn't one of the project's groups.
      knownGroup: boolean;
    };

// Registration values from incoming fields under a page's mapping.
export const extractRegistration = (
  fields: Fields,
  matched: Record<Target, string | null>,
  groups: string[],
): Extracted => {
  const value = (target: Target) => (matched[target] ? (fields[matched[target]!] ?? '').trim() : '');
  let firstName = value('first_name');
  let lastName = value('last_name');
  // Fill whatever is missing from a full-name field ("Anna Maria Müller").
  if ((!firstName || !lastName) && value('full_name')) {
    const split = splitName(value('full_name'));
    firstName ||= split.first;
    lastName ||= firstName === split.first ? split.last : value('full_name');
  }
  const email = value('email') || null;
  const rawGroup = value('group_name');

  if (!firstName) return { ok: false, error: 'missing_name' };
  if (firstName.length > 120 || lastName.length > 120 || (email ?? '').length > 200 || rawGroup.length > 120) {
    return { ok: false, error: 'invalid_input' };
  }

  // Match the project's groups ignoring case; unknown groups stay on the
  // registration for a manager to resolve.
  const known = groups.find((g) => g.toLowerCase() === rawGroup.toLowerCase());
  return {
    ok: true,
    firstName,
    lastName,
    email,
    groupName: known ?? (rawGroup || null),
    knownGroup: !rawGroup || Boolean(known),
  };
};
