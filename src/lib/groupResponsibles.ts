import { useCallback, useEffect, useState } from 'react';
import { api, type ApiError } from '@/lib/api';
import { isContactKind } from '@shared/contactKinds';
import type { AccountContact, GroupResponsible, PersonOption } from '@/types';

// Who looks after each group of a project and the groups' internal notes
// (managers only; see server/groupResponsibles.ts).
export interface GroupResponsibilities {
  byGroup: Map<string, GroupResponsible[]>;
  notes: Map<string, string>;
  // What the responsibility covers, for the group's participants.
  publicNotes: Map<string, string>;
}

const EMPTY: GroupResponsibilities = { byGroup: new Map(), notes: new Map(), publicNotes: new Map() };

export const loadGroupResponsibilities = async (projectId: string): Promise<GroupResponsibilities> => {
  const { data } = await api.rpc('group_responsibilities', { p_project_id: projectId });
  const result = data as {
    people: GroupResponsible[];
    notes: { group_id: string; note: string; public_note: string }[];
  } | null;
  if (!result) return EMPTY;
  const byGroup = new Map<string, GroupResponsible[]>();
  for (const person of result.people) byGroup.set(person.group_id, [...(byGroup.get(person.group_id) ?? []), person]);
  return {
    byGroup,
    notes: new Map(result.notes.map((n) => [n.group_id, n.note])),
    publicNotes: new Map(result.notes.map((n) => [n.group_id, n.public_note])),
  };
};

// The account's own group on "Meine Teilnahme" (server my_group_responsibles).
export interface MyGroupResponsibles {
  group_name: string;
  note: string;
  people: { user_id: string; name: string; photo_url: string | null; contacts: AccountContact[] }[];
}

export const loadMyGroupResponsibles = async (projectId: string): Promise<MyGroupResponsibles | null> => {
  const { data } = await api.rpc('my_group_responsibles', { p_project_id: projectId });
  const result = data as MyGroupResponsibles | null;
  if (!result) return null;
  // A kind the app no longer offers is shown as "other" (as in loadContacts).
  return {
    ...result,
    people: result.people.map((p) => ({
      ...p,
      contacts: p.contacts.map((c) => (isContactKind(c.kind) ? c : { ...c, kind: 'other' })),
    })),
  };
};

export const useGroupResponsibilities = (projectId: string) => {
  const [value, setValue] = useState<GroupResponsibilities>(EMPTY);
  const reload = useCallback(async () => setValue(await loadGroupResponsibilities(projectId)), [projectId]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { ...value, reload };
};

export const asPersonOption = (r: GroupResponsible): PersonOption => ({
  id: r.user_id,
  name: r.name,
  email: r.email,
  photo_url: r.photo_url,
  member: r.member,
});

// Saves a group's responsible people (in the given order) and its notes:
// only what changed is written.
export const saveGroupResponsibilities = async (
  groupId: string,
  people: PersonOption[],
  note: string,
  publicNote: string,
  previous: { people: GroupResponsible[]; note: string; publicNote: string },
): Promise<ApiError | null> => {
  const keep = new Set(people.map((p) => p.id));
  const removed = previous.people.filter((p) => !keep.has(p.user_id));
  if (removed.length) {
    const { error } = await api.from('group_responsibles').delete().in('id', removed.map((p) => p.id));
    if (error) return error;
  }
  const existing = new Map(previous.people.map((p) => [p.user_id, p]));
  for (const [position, person] of people.entries()) {
    const row = existing.get(person.id);
    if (row && row.position === position) continue;
    const { error } = row
      ? await api.from('group_responsibles').update({ position }).eq('id', row.id)
      : await api.from('group_responsibles').insert({ group_id: groupId, user_id: person.id, position });
    if (error) return error;
  }
  if (note.trim() !== previous.note.trim() || publicNote.trim() !== previous.publicNote.trim()) {
    const { error } = await api
      .from('group_notes')
      .upsert({ group_id: groupId, note: note.trim(), public_note: publicNote.trim() }, { onConflict: 'group_id' });
    if (error) return error;
  }
  return null;
};
