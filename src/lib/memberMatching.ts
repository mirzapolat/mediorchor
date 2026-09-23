// Duplicate detection: is an incoming person (registration, CSV row) someone
// the project already has? Same rule as the server (server/rpc.ts,
// findMatchingMember) so the "already a member" hint predicts the transfer.

export interface PersonLike {
  first_name: string;
  last_name: string;
  email: string | null;
  user_id?: string | null;
}

// Case-, accent- and whitespace-insensitive ("  Jürgen " → "jurgen").
const norm = (value: string | null | undefined) =>
  (value ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

// Same person when the email matches, or first and last name match and the
// emails don't contradict each other (both given but different).
export const samePerson = (a: PersonLike, b: PersonLike): boolean => {
  const emailA = norm(a.email);
  const emailB = norm(b.email);
  if (emailA && emailB) return emailA === emailB;
  return norm(a.first_name) === norm(b.first_name) && norm(a.last_name) === norm(b.last_name);
};

// The member an incoming person corresponds to: the member linked to the same
// account first, then an email match, then a name match; active rows before
// archived ones. A member linked to a different account never matches a
// person who came with an account.
export const findMatchingMember = <M extends PersonLike & { status: string }>(
  person: PersonLike,
  members: M[],
): M | null => {
  if (person.user_id) {
    const linked = members.find((m) => m.user_id === person.user_id);
    if (linked) return linked;
  }
  const candidates = members.filter(
    (m) => samePerson(person, m) && !(person.user_id && m.user_id && m.user_id !== person.user_id),
  );
  const rank = (m: M) =>
    (norm(m.email) && norm(m.email) === norm(person.email) ? 0 : 2) + (m.status === 'active' ? 0 : 1);
  return candidates.sort((a, b) => rank(a) - rank(b))[0] ?? null;
};
