import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Input, Select } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { PageSpinner } from '@/components/Spinner';
import { NoAccess } from '@/components/NoAccess';
import { GroupPill } from '@/components/GroupPill';
import { ContactRow } from '@/components/AccountContacts';
import { RoomsStatusActions, RoomsStatusPill, WeekendLinkControls } from '@/components/WeekendRelease';
import { NightStrip, RoomGrid, fits, roomPeak } from '@/components/WeekendRoomGrid';
import { Toast, useToast } from '@/components/Toast';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { useI18n, type TranslationKey } from '@/lib/i18n';
import { contactKindLabel } from '@/lib/contacts';
import { useWeekendContext, type Room, type RoomPerson, type RoomsStatus, type RoomsView } from '@/lib/weekends';
import type { AccountContact } from '@/types';

type Share = 'private' | 'weekend' | 'room';

const SHARE_LABEL: Record<Share, TranslationKey> = {
  private: 'roomSharePrivate',
  weekend: 'roomShareWeekend',
  room: 'roomShareRoom',
};

// "Zimmer": cards with their places and who sleeps where. People whose
// booked nights don't overlap share a place. Confirmed participants take a
// free place, switch or free theirs (the server checks the room's capacity
// night by night at that moment); managers release the allocation, set up
// the rooms and place anyone. A click on a person shows what they share
// with you.
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

  const setStatus = async (rooms_status: RoomsStatus) => {
    const previous = weekend.rooms_status;
    setBusy(true);
    const { error: saveError } = await api.from('weekends').update({ rooms_status }).eq('id', weekend.id);
    setBusy(false);
    if (saveError) return setError(`${t('saveFailed')} (${saveError.message})`);
    await after();
    toast.show(t(ROOMS_TOAST[rooms_status]), () =>
      void api.from('weekends').update({ rooms_status: previous }).eq('id', weekend.id).then(after),
    );
  };

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
  const nightCount = view.night_count;
  const free = view.rooms.reduce((sum, r) => sum + Math.max(0, r.capacity - roomPeak(r)), 0);

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
          <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
            <RoomsStatusActions status={weekend.rooms_status} onChange={(next) => void setStatus(next)} busy={busy} />
            {weekend.rooms_status !== 'hidden' && (
              <WeekendLinkControls weekend={weekend} onChanged={() => void reloadWeekend()} onMessage={(m) => toast.show(m)} />
            )}
            <Button variant="secondary" onClick={() => setEditing({ name: '', description: '', capacity: 2 })}>
              <Plus size={16} />
              {t('roomAdd')}
            </Button>
          </div>
        )}
      </div>
      {manager && (
        <p className="-mt-2 flex flex-wrap items-center gap-2 text-xs text-text-tertiary">
          <RoomsStatusPill status={weekend.rooms_status} />
          {t(ROOMS_HINT[weekend.rooms_status])}
        </p>
      )}

      {view.me && !view.can_choose && !manager && <p className="rounded-xl bg-info-soft px-3 py-2 text-sm">{t('roomsFrozen')}</p>}
      {view.me && view.can_choose && !view.me.room_id && view.rooms.length > 0 && (
        <p className="rounded-xl border border-accent/50 bg-accent/10 px-3 py-2 text-sm">{t('roomPickHint')}</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <RoomGrid
        view={view}
        busy={busy}
        onChoose={(roomId) => void choose(roomId)}
        onPerson={setPerson}
        manage={manager ? { onEdit: setEditing, onRemove: (room) => void removeRoom(room), onPlace: (pid, roomId) => void place(pid, roomId) } : undefined}
      />

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
                <NightStrip nights={p.nights} count={nightCount} label={p.booking} />
                <select
                  value=""
                  aria-label={`${t('roomPlace')}: ${p.name}`}
                  onChange={(e) => e.target.value && void place(p.participant_id, e.target.value)}
                  className="h-8 rounded-md border border-border bg-white px-2 pr-7 text-xs"
                >
                  <option value="">{t('roomPlace')}</option>
                  {view.rooms
                    .filter((r) => fits(r, p.nights, p.participant_id))
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

const ROOMS_TOAST: Record<RoomsStatus, TranslationKey> = {
  hidden: 'weekendRoomsDisabledToast',
  open: 'weekendRoomsReleasedToast',
  locked: 'weekendRoomsLockedToast',
};

const ROOMS_HINT: Record<RoomsStatus, TranslationKey> = {
  hidden: 'weekendRoomsHiddenHint',
  open: 'weekendRoomsOpenHint',
  locked: 'weekendRoomsLockedHint',
};

// A person of the weekend: photo, name, group and the contacts they share
// with you (read by the server for exactly this relation). A guest of the
// shared link passes their key as `access`.
export const PersonDialog = ({
  weekendId,
  person,
  onClose,
  access,
}: {
  weekendId: string;
  person: RoomPerson | null;
  onClose: () => void;
  access?: { p_guest_key: string };
}) => {
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
    void api
      .rpc('weekend_person', { p_weekend_id: weekendId, p_participant_id: person.participant_id, ...access })
      .then(({ data }) => setInfo(data as typeof info));
  }, [person, weekendId, access]);
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
