import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { BedDouble, Check, DoorOpen, LogOut, Pencil, Plus, Trash2, UserRound } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Input, Select } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { PageSpinner } from '@/components/Spinner';
import { NoAccess } from '@/components/NoAccess';
import { GroupPill } from '@/components/GroupPill';
import { ContactRow } from '@/components/AccountContacts';
import { Toast, useToast } from '@/components/Toast';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useI18n, type TranslationKey } from '@/lib/i18n';
import { contactKindLabel } from '@/lib/contacts';
import { useWeekendContext, type Room, type RoomPerson, type RoomsView } from '@/lib/weekends';
import type { AccountContact } from '@/types';

type Share = 'private' | 'weekend' | 'room';

const SHARE_LABEL: Record<Share, TranslationKey> = {
  private: 'roomSharePrivate',
  weekend: 'roomShareWeekend',
  room: 'roomShareRoom',
};

// "Zimmer": cards with free places and who sleeps where. Confirmed
// participants take a free place, switch or free theirs (the server checks
// the room's capacity at that moment); managers set up the rooms and place
// anyone. A click on a person shows what they share with you.
export const WeekendRoomsPage = () => {
  const { t } = useI18n();
  const { weekend, reloadWeekend, reloadNav } = useWeekendContext();
  const [view, setView] = useState<RoomsView | null | undefined>(undefined);
  const [person, setPerson] = useState<RoomPerson | null>(null);
  const [editing, setEditing] = useState<Partial<Room> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    const { data, error: rpcError } = await api.rpc('weekend_rooms_view', { p_weekend_id: weekend.id });
    setView(rpcError ? null : (data as RoomsView));
  }, [weekend.id]);
  useEffect(() => {
    void load();
  }, [load]);

  if (view === undefined) return <PageSpinner />;
  if (view === null) return <NoAccess />;

  const after = async () => {
    await load();
    void reloadWeekend();
    void reloadNav?.();
  };

  const choose = async (roomId: string | null) => {
    setBusy(true);
    setError(null);
    const previous = view.me?.room_id ?? null;
    const { data, error: rpcError } = await api.rpc('weekend_choose_room', { p_weekend_id: weekend.id, p_room_id: roomId });
    setBusy(false);
    if (rpcError) return setError(rpcError.message);
    if ((data as { state: string }).state === 'full') {
      setError(t('roomFullNow'));
      return load();
    }
    await after();
    toast.show(roomId ? t('roomChosen') : t('roomLeft'), () =>
      void api.rpc('weekend_choose_room', { p_weekend_id: weekend.id, p_room_id: previous }).then(after),
    );
  };

  const place = async (participantId: string, roomId: string | null) => {
    setError(null);
    const { data, error: rpcError } = await api.rpc('weekend_place', { p_participant_id: participantId, p_room_id: roomId });
    if (rpcError) return setError(rpcError.message);
    if ((data as { state: string }).state === 'full') setError(t('roomFullNow'));
    await after();
  };

  const saveRoom = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setError(null);
    const values = { name: editing.name?.trim(), description: editing.description?.trim() ?? '', capacity: Number(editing.capacity) };
    const { error: saveError } = editing.id
      ? await api.from('weekend_rooms').update(values).eq('id', editing.id)
      : await api.from('weekend_rooms').insert({ ...values, weekend_id: weekend.id, position: view.rooms.length });
    if (saveError) return setError(saveError.code === 'room_overfull' ? t('roomShrinkBlocked') : saveError.message);
    setEditing(null);
    await after();
  };

  const removeRoom = async (room: Room) => {
    if (room.occupants.length > 0) return setError(t('roomDeleteBlocked'));
    await api.from('weekend_rooms').delete().eq('id', room.id);
    await after();
  };

  const manager = view.manager;
  const free = view.rooms.reduce((sum, r) => sum + Math.max(0, r.capacity - r.occupants.length), 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-bold sm:text-2xl">{t('weekendRooms')}</h1>
          <p className="mt-1 text-sm text-text-secondary">
            {t('roomsSummary').replace('{rooms}', String(view.rooms.length)).replace('{free}', String(free))}
          </p>
        </div>
        {manager && (
          <Button onClick={() => setEditing({ name: '', description: '', capacity: 2 })}>
            <Plus size={16} />
            {t('roomAdd')}
          </Button>
        )}
      </div>

      {view.me && !view.can_choose && !manager && <p className="rounded-xl bg-info-soft px-3 py-2 text-sm">{t('roomsFrozen')}</p>}
      {view.me && view.can_choose && !view.me.room_id && view.rooms.length > 0 && (
        <p className="rounded-xl border border-accent/50 bg-accent/10 px-3 py-2 text-sm">{t('roomPickHint')}</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      {view.rooms.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-border-strong px-6 py-12 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-muted text-text-secondary">
            <BedDouble size={22} />
          </span>
          <p className="mt-3 font-semibold">{t('roomsNone')}</p>
          <p className="mt-1 text-sm text-text-secondary">{manager ? t('roomsNoneHintManager') : t('roomsNoneHint')}</p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {view.rooms.map((room) => {
            const mine = view.me?.room_id === room.id;
            const full = room.occupants.length >= room.capacity;
            return (
              <li
                key={room.id}
                className={cn('group/item flex flex-col rounded-2xl border bg-surface p-4', mine ? 'border-accent bg-accent/10' : 'border-border')}
              >
                <div className="flex items-start gap-3">
                  <span className={cn('flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl', mine ? 'bg-accent/15 text-accent' : 'bg-surface-muted text-text-secondary')}>
                    <BedDouble size={18} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{room.name}</p>
                    <p className={cn('text-xs', full ? 'text-text-tertiary' : 'text-text-secondary')}>
                      {t('roomPlaces').replace('{n}', String(room.occupants.length)).replace('{max}', String(room.capacity))}
                      {full && ` · ${t('roomFull')}`}
                    </p>
                  </div>
                  {manager && (
                    <div className="flex">
                      <button
                        type="button"
                        onClick={() => setEditing(room)}
                        aria-label={`${t('edit')}: ${room.name}`}
                        className="flex h-8 w-8 items-center justify-center rounded-md text-text-tertiary hover:bg-surface-hover hover:text-text"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeRoom(room)}
                        aria-label={`${t('delete')}: ${room.name}`}
                        className="flex h-8 w-8 items-center justify-center rounded-md text-text-tertiary hover:bg-surface-hover hover:text-text"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </div>
                {room.description && <p className="mt-2 text-sm text-text-secondary">{room.description}</p>}
                <ul className="mt-3 flex-1 space-y-1">
                  {room.occupants.map((p) => (
                    <li key={p.participant_id} className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setPerson(p)}
                        className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-1 text-left hover:bg-surface-subtle"
                      >
                        <Avatar name={p.name} photoUrl={p.photo_url} size={26} />
                        <span className={cn('min-w-0 truncate text-sm', p.mine && 'font-semibold')}>
                          {p.name}
                          {p.mine && ` (${t('you')})`}
                        </span>
                      </button>
                      {manager && (
                        <select
                          value={room.id}
                          aria-label={`${t('roomMove')}: ${p.name}`}
                          onChange={(e) => void place(p.participant_id, e.target.value || null)}
                          className="h-8 max-w-[7.5rem] rounded-md border border-border bg-white px-1.5 pr-6 text-xs"
                        >
                          <option value="">{t('roomUnassign')}</option>
                          {view.rooms.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </li>
                  ))}
                  {Array.from({ length: Math.max(0, room.capacity - room.occupants.length) }, (_, i) => (
                    <li key={`free-${i}`} className="flex items-center gap-2 px-1 py-1 text-sm text-text-tertiary">
                      <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full border border-dashed border-border-strong">
                        <UserRound size={13} />
                      </span>
                      {t('roomFreePlace')}
                    </li>
                  ))}
                </ul>
                {view.me && view.can_choose && (
                  <div className="mt-3 border-t border-border pt-3">
                    {mine ? (
                      <Button variant="secondary" className="w-full" disabled={busy} onClick={() => void choose(null)}>
                        <LogOut size={15} />
                        {t('roomLeave')}
                      </Button>
                    ) : (
                      <Button variant={view.me.room_id ? 'secondary' : 'primary'} className="w-full" disabled={busy || full} onClick={() => void choose(room.id)}>
                        {view.me.room_id ? <DoorOpen size={15} /> : <Check size={15} />}
                        {full ? t('roomFull') : view.me.room_id ? t('roomSwitch') : t('roomTake')}
                      </Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {manager && view.unassigned.length > 0 && (
        <section className="rounded-2xl border border-border bg-surface p-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-tertiary">
            {t('roomUnassigned')} ({view.unassigned.length})
          </h2>
          <ul className="divide-y divide-border">
            {view.unassigned.map((p) => (
              <li key={p.participant_id} className="flex items-center gap-2 py-1.5">
                <Avatar name={p.name} photoUrl={p.photo_url} size={26} />
                <span className="min-w-0 flex-1 truncate text-sm">
                  {p.name}
                  {p.kind === 'guest' && <span className="ml-1.5 text-xs text-text-tertiary">{t('weekendKindGuest')}</span>}
                </span>
                <select
                  value=""
                  aria-label={`${t('roomPlace')}: ${p.name}`}
                  onChange={(e) => e.target.value && void place(p.participant_id, e.target.value)}
                  className="h-8 rounded-md border border-border bg-white px-2 pr-7 text-xs"
                >
                  <option value="">{t('roomPlace')}</option>
                  {view.rooms
                    .filter((r) => r.occupants.length < r.capacity)
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                </select>
              </li>
            ))}
          </ul>
        </section>
      )}

      {view.me && <MyContactSharing />}

      <PersonDialog weekendId={weekend.id} person={person} onClose={() => setPerson(null)} />

      <Modal
        open={editing != null}
        title={editing?.id ? t('roomEdit') : t('roomAdd')}
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              {t('cancel')}
            </Button>
            <Button type="submit" form="room-form" disabled={!editing?.name?.trim() || !(Number(editing?.capacity) > 0)}>
              {t('save')}
            </Button>
          </>
        }
      >
        {editing && (
          <form id="room-form" onSubmit={saveRoom} className="space-y-4">
            <Input label={t('name')} value={editing.name ?? ''} maxLength={120} required autoFocus onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            <Input
              type="number"
              min={Math.max(1, editing.occupants?.length ?? 1)}
              max={100}
              label={t('roomCapacity')}
              value={editing.capacity ?? ''}
              onChange={(e) => setEditing({ ...editing, capacity: Number(e.target.value) })}
            />
            <Input
              label={`${t('concertDescription')} (${t('optional')})`}
              value={editing.description ?? ''}
              maxLength={1000}
              onChange={(e) => setEditing({ ...editing, description: e.target.value })}
            />
            {editing.occupants && editing.occupants.length > 0 && <p className="text-xs text-text-tertiary">{t('roomShrinkHint')}</p>}
          </form>
        )}
      </Modal>
      <Toast toast={toast.toast} onClose={toast.hide} />
    </div>
  );
};

// A person of the weekend: photo, name, group and the contacts they share
// with you (read by the server for exactly this relation).
const PersonDialog = ({ weekendId, person, onClose }: { weekendId: string; person: RoomPerson | null; onClose: () => void }) => {
  const { t } = useI18n();
  const [info, setInfo] = useState<{
    name: string;
    group_name: string | null;
    photo_url: string | null;
    has_account: boolean;
    self: boolean;
    contacts: AccountContact[];
  } | null>(null);
  useEffect(() => {
    setInfo(null);
    if (!person) return;
    void api.rpc('weekend_person', { p_weekend_id: weekendId, p_participant_id: person.participant_id }).then(({ data }) => setInfo(data as typeof info));
  }, [person, weekendId]);
  if (!person) return null;
  return (
    <Modal open title={person.name} onClose={onClose}>
      {!info ? (
        <PageSpinner />
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Avatar name={info.name} photoUrl={info.photo_url} size={56} />
            <div className="min-w-0">
              <p className="truncate text-lg font-semibold">{info.name}</p>
              {info.group_name && <GroupPill name={info.group_name} />}
            </div>
          </div>
          {info.contacts.length > 0 ? (
            <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border">
              {info.contacts.map((c) => (
                <li key={c.id}>
                  <ContactRow contact={c} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-xl bg-surface-subtle px-3 py-3 text-sm text-text-secondary">
              {info.has_account ? t('personNoSharedContacts') : t('personGuestNoContacts')}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
};

// One's own contacts and who in a weekend may see each — set per contact
// (it holds for every weekend).
const MyContactSharing = () => {
  const { t } = useI18n();
  const { user } = useAuth();
  const [contacts, setContacts] = useState<(AccountContact & { room_share: Share })[]>([]);
  const load = useCallback(async () => {
    if (!user) return;
    const { data } = await api.from('account_contacts').select('*').eq('user_id', user.id).order('position');
    setContacts((data as (AccountContact & { room_share: Share })[] | null) ?? []);
  }, [user]);
  useEffect(() => {
    void load();
  }, [load]);
  const set = async (id: string, room_share: Share) => {
    setContacts((list) => list.map((c) => (c.id === id ? { ...c, room_share } : c)));
    await api.from('account_contacts').update({ room_share }).eq('id', id);
  };
  return (
    <section className="rounded-2xl border border-border bg-surface p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">{t('roomShareTitle')}</h2>
      <p className="mb-3 mt-0.5 text-sm text-text-secondary">{t('roomShareHint')}</p>
      {contacts.length === 0 ? (
        <p className="text-sm text-text-tertiary">{t('roomShareNoContacts')}</p>
      ) : (
        <ul className="space-y-2">
          {contacts.map((c) => (
            <li key={c.id} className="flex flex-col gap-1.5 sm:flex-row sm:items-center">
              <span className="min-w-0 flex-1 truncate text-sm">
                <span className="font-medium">{c.value}</span>
                <span className="ml-2 text-xs text-text-tertiary">{c.label || t(contactKindLabel(c.kind))}</span>
              </span>
              <Select
                aria-label={`${t('roomShareTitle')}: ${c.value}`}
                value={c.room_share}
                onChange={(e) => void set(c.id, e.target.value as Share)}
                className="h-9 py-1 text-sm sm:w-64"
              >
                {(Object.keys(SHARE_LABEL) as Share[]).map((s) => (
                  <option key={s} value={s}>
                    {t(SHARE_LABEL[s])}
                  </option>
                ))}
              </Select>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
