import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ArrowLeftRight, BedDouble, ChevronRight, Copy, LogOut, Search } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Input, Select } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { OverflowMenu, type OverflowMenuItem } from '@/components/OverflowMenu';
import { PageSpinner } from '@/components/Spinner';
import { NoAccess } from '@/components/NoAccess';
import { GroupPill } from '@/components/GroupPill';
import { ContactRow } from '@/components/AccountContacts';
import { RoomsStatusPill, roomsTransitions, useWeekendLink } from '@/components/WeekendRelease';
import { PersonRow, RoomGrid, fits, roomPeak } from '@/components/WeekendRoomGrid';
import { useRoomDrag, type DropTarget } from '@/components/WeekendRoomDrag';
import { Toast, useToast } from '@/components/Toast';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
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

const byName = (a: RoomPerson, b: RoomPerson) => a.name.localeCompare(b.name);

// The view with people moved ([participant, room or null]) — shown right
// away, before the server's answer (which then replaces it).
const moveLocally = (view: RoomsView, moves: [string, string | null][]): RoomsView => {
  const people = new Map([...view.rooms.flatMap((r) => r.occupants), ...view.unassigned].map((p) => [p.participant_id, p]));
  const target = new Map(moves);
  const keep = (list: RoomPerson[]) => list.filter((p) => !target.has(p.participant_id));
  const into = (room: string | null) => moves.filter(([, to]) => to === room).flatMap(([id]) => people.get(id) ?? []);
  const myMove = view.me && target.has(view.me.participant_id) ? (target.get(view.me.participant_id) ?? null) : undefined;
  return {
    ...view,
    me: view.me && myMove !== undefined ? { ...view.me, room_id: myMove } : view.me,
    rooms: view.rooms.map((r) => ({ ...r, occupants: [...keep(r.occupants), ...into(r.id)].sort(byName) })),
    unassigned: [...keep(view.unassigned), ...into(null)].sort(byName),
  };
};

// "Zimmer": cards with their places and who sleeps where. People whose
// booked nights don't overlap share a place. Confirmed participants take a
// free place, switch or free theirs (the server checks the room's capacity
// night by night at that moment). Managers release the allocation, set up
// the rooms and move anyone: by drag and drop between the rooms and "Ohne
// Zimmer" (onto a person in a full room: swap), or with a person's move
// button. Moves happen at once, with undo in the toast. A click on a person
// shows what they share with you.
export const WeekendRoomsPage = () => {
  const { t } = useI18n();
  const { weekend, reloadWeekend, reloadNav } = useWeekendContext();
  const [view, setView] = useState<RoomsView | null | undefined>(undefined);
  const [person, setPerson] = useState<RoomPerson | null>(null);
  const [moving, setMoving] = useState<{ person: RoomPerson; from: string | null } | null>(null);
  const [editing, setEditing] = useState<Partial<Room> | null>(null);
  const [poolQuery, setPoolQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const link = useWeekendLink(weekend, () => void reloadWeekend(), (m) => toast.show(m));

  const load = useCallback(async () => {
    const { data, error: rpcError } = await api.rpc('weekend_rooms_view', { p_weekend_id: weekend.id });
    setView(rpcError ? null : (data as RoomsView));
  }, [weekend.id]);
  useEffect(() => {
    void load();
  }, [load]);

  const after = async () => {
    await load();
    void reloadWeekend();
    void reloadNav?.();
  };

  const roomName = (id: string | null) => view?.rooms.find((r) => r.id === id)?.name ?? '';

  // Managers: someone into a room (null: out of theirs).
  const place = async (p: RoomPerson, from: string | null, to: string | null, undoable = true) => {
    if (from === to) return;
    setError(null);
    const name = roomName(to);
    setView((v) => v && moveLocally(v, [[p.participant_id, to]]));
    const { data, error: rpcError } = await api.rpc('weekend_place', { p_participant_id: p.participant_id, p_room_id: to });
    const full = !rpcError && (data as { state: string }).state === 'full';
    if (rpcError || full) {
      setError(full ? t('roomFullNow') : rpcError!.message);
      return after();
    }
    void after();
    if (undoable) {
      toast.show(to ? t('roomMovedTo').replace('{name}', p.name).replace('{room}', name) : t('roomTakenOut').replace('{name}', p.name), () =>
        place(p, to, from, false),
      );
    }
  };

  // Managers: two people trade places (for full rooms).
  const swap = async (p: RoomPerson, from: string | null, other: RoomPerson, otherRoom: string | null, undoable = true) => {
    setError(null);
    setView((v) => v && moveLocally(v, [[p.participant_id, otherRoom], [other.participant_id, from]]));
    const { error: rpcError } = await api.rpc('weekend_swap', { p_a: p.participant_id, p_b: other.participant_id });
    if (rpcError) {
      setError(rpcError.code === 'room_full' ? t('roomSwapBlocked') : rpcError.message);
      return after();
    }
    void after();
    if (undoable) toast.show(t('roomSwapped').replace('{a}', p.name).replace('{b}', other.name), () => swap(p, otherRoom, other, from, false));
  };

  // Let go over a room: in if there's a place, else swap with the person
  // under the pointer; over "Ohne Zimmer": out of the room.
  const drop = (p: RoomPerson, from: string | null, target: DropTarget) => {
    if (!view || target.room === from) return;
    if (!target.room) return void place(p, from, null);
    const room = view.rooms.find((r) => r.id === target.room);
    if (!room) return;
    if (fits(room, p.nights, p.participant_id)) return void place(p, from, room.id);
    const other = room.occupants.find((o) => o.participant_id === target.person);
    if (other) return void swap(p, from, other, room.id);
    setError(t('roomFullDrop'));
  };
  const drag = useRoomDrag(drop);

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

  // Only empty rooms; undone by creating it again.
  const removeRoom = async (room: Room) => {
    if (room.occupants.length > 0) return setError(t('roomDeleteBlocked'));
    const { error: deleteError } = await api.from('weekend_rooms').delete().eq('id', room.id);
    if (deleteError) return setError(deleteError.message);
    await after();
    toast.show(t('roomDeleted').replace('{name}', room.name), () =>
      void api
        .from('weekend_rooms')
        .insert({ weekend_id: weekend.id, name: room.name, description: room.description, capacity: room.capacity, position: room.position })
        .then(after),
    );
  };

  const manager = view.manager;
  const free = view.rooms.reduce((sum, r) => sum + Math.max(0, r.capacity - roomPeak(r)), 0);
  const summary = [
    t('roomsSummary').replace('{rooms}', String(view.rooms.length)).replace('{free}', String(free)),
    manager && view.unassigned.length > 0 && t('roomsUnplaced').replace('{n}', String(view.unassigned.length)),
  ]
    .filter(Boolean)
    .join(' · ');

  const transitions = roomsTransitions(weekend.rooms_status);
  const primary = transitions.find((x) => x.primary);
  const menu: OverflowMenuItem[] = [
    ...transitions
      .filter((x) => !x.primary)
      .map((x) => ({ icon: x.icon, label: t(x.label), onSelect: () => void setStatus(x.to), disabled: busy })),
    ...(weekend.rooms_status !== 'hidden'
      ? [
          {
            icon: Copy,
            label: weekend.link_token ? t('weekendLinkCopy') : t('weekendLinkCreate'),
            onSelect: () => void link.copy(),
            separated: transitions.length > 1,
          },
        ]
      : []),
  ];

  const q = poolQuery.trim().toLowerCase();
  const pool = view.unassigned.filter((p) => !q || `${p.name} ${p.group_name ?? ''}`.toLowerCase().includes(q));
  const poolDrop = drag.dragging?.from != null && drag.over != null && drag.over.room === null;
  const manage = manager
    ? {
        drag,
        onMove: (p: RoomPerson, from: string | null) => setMoving({ person: p, from }),
        onEdit: setEditing,
        onRemove: (room: Room) => void removeRoom(room),
        onAdd: () => setEditing({ name: '', description: '', capacity: 2 }),
      }
    : undefined;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold sm:text-2xl">{t('weekendRooms')}</h1>
            {manager && (
              <span title={t(ROOMS_HINT[weekend.rooms_status])}>
                <RoomsStatusPill status={weekend.rooms_status} />
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-text-secondary">{summary}</p>
        </div>
        {manager && (
          <div className="flex flex-shrink-0 items-center gap-2">
            {primary && (
              <Button disabled={busy} onClick={() => void setStatus(primary.to)}>
                <primary.icon size={16} />
                {t(primary.label)}
              </Button>
            )}
            {menu.length > 0 && <OverflowMenu label={t('moreActions')} items={menu} />}
          </div>
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

      <div className={cn(manager && 'grid gap-4 lg:grid-cols-[17rem_minmax(0,1fr)] lg:items-start')}>
        {manager && (
          <aside
            data-drop-room=""
            className={cn(
              'rounded-2xl border bg-surface p-3 transition-shadow lg:sticky lg:top-6',
              poolDrop ? 'border-accent ring-2 ring-accent/40' : 'border-border',
            )}
          >
            <div className="flex items-center justify-between gap-2 px-1">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">{t('roomUnassigned')}</h2>
              <span className="text-xs tabular-nums text-text-tertiary">{view.unassigned.length}</span>
            </div>
            {view.unassigned.length > 8 && (
              <div className="relative mt-2">
                <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
                <input
                  type="search"
                  value={poolQuery}
                  onChange={(e) => setPoolQuery(e.target.value)}
                  placeholder={t('search')}
                  aria-label={`${t('search')}: ${t('roomUnassigned')}`}
                  className="h-9 w-full rounded-lg border border-border bg-surface pl-8 pr-2 text-sm"
                />
              </div>
            )}
            {view.unassigned.length === 0 ? (
              <p className="px-1 py-5 text-center text-sm text-text-tertiary">{drag.dragging ? t('roomPoolDrop') : t('roomPoolEmpty')}</p>
            ) : (
              <div className="mt-2 max-h-72 space-y-0.5 overflow-y-auto lg:max-h-[calc(100dvh-14rem)]">
                {pool.map((p) => (
                  <PersonRow key={p.participant_id} person={p} from={null} nightCount={view.night_count} onPerson={setPerson} manage={manage} />
                ))}
              </div>
            )}
          </aside>
        )}

        <RoomGrid view={view} busy={busy} onChoose={(roomId) => void choose(roomId)} onPerson={setPerson} manage={manage} />
      </div>

      {view.me && <MyContactSharing />}

      <PersonDialog weekendId={weekend.id} person={person} onClose={() => setPerson(null)} />

      <MoveDialog
        view={view}
        moving={moving}
        onClose={() => setMoving(null)}
        onPlace={(to) => {
          if (moving) void place(moving.person, moving.from, to);
          setMoving(null);
        }}
        onSwap={(other, room) => {
          if (moving) void swap(moving.person, moving.from, other, room);
          setMoving(null);
        }}
      />

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
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
              <Input label={t('name')} value={editing.name ?? ''} maxLength={120} required autoFocus onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              <Input
                type="number"
                min={Math.max(1, editing.occupants?.length ?? 1)}
                max={100}
                label={t('roomCapacity')}
                value={editing.capacity ?? ''}
                onChange={(e) => setEditing({ ...editing, capacity: Number(e.target.value) })}
              />
            </div>
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
      {drag.ghost}
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

// Managers: where to put someone — any room with a place for their nights,
// or, in a full one, a swap with someone who'd fit their old place; or out
// of their room. The way to move without dragging (keyboard, small screens).
const MoveDialog = ({
  view,
  moving,
  onClose,
  onPlace,
  onSwap,
}: {
  view: RoomsView;
  moving: { person: RoomPerson; from: string | null } | null;
  onClose: () => void;
  onPlace: (room: string | null) => void;
  onSwap: (other: RoomPerson, room: string) => void;
}) => {
  const { t } = useI18n();
  if (!moving) return null;
  const { person: p, from } = moving;
  const fromRoom = view.rooms.find((r) => r.id === from) ?? null;
  return (
    <Modal
      open
      title={`${t('roomMove')}: ${p.name}`}
      onClose={onClose}
      footer={
        from ? (
          <Button variant="secondary" onClick={() => onPlace(null)}>
            <LogOut size={15} />
            {t('roomTakeOut')}
          </Button>
        ) : undefined
      }
    >
      {view.rooms.length === 0 ? (
        <p className="text-sm text-text-secondary">{t('roomsNone')}</p>
      ) : (
        <ul className="space-y-2">
          {view.rooms.map((room) => {
            const current = room.id === from;
            const ok = !current && fits(room, p.nights, p.participant_id);
            // Full: swap with someone who would fit the place left behind.
            const swaps =
              current || ok
                ? []
                : room.occupants.filter(
                    (o) =>
                      fits(room, p.nights, p.participant_id, o.participant_id) && (!fromRoom || fits(fromRoom, o.nights, o.participant_id, p.participant_id)),
                  );
            return (
              <li key={room.id} className={cn('rounded-xl border', current ? 'border-accent bg-accent/10' : 'border-border')}>
                <button
                  type="button"
                  disabled={!ok}
                  onClick={() => onPlace(room.id)}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left enabled:hover:bg-surface-subtle disabled:cursor-default"
                >
                  <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-surface-muted text-text-secondary">
                    <BedDouble size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{room.name}</span>
                    <span className="block text-xs text-text-tertiary">
                      {t('roomPlaces').replace('{n}', String(roomPeak(room))).replace('{max}', String(room.capacity))}
                    </span>
                  </span>
                  {current ? (
                    <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-semibold">{t('roomCurrent')}</span>
                  ) : ok ? (
                    <ChevronRight size={16} className="text-text-tertiary" />
                  ) : (
                    <span className="text-xs text-text-tertiary">{t('roomFull')}</span>
                  )}
                </button>
                {swaps.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 border-t border-border px-3 py-2">
                    {swaps.map((o) => (
                      <button
                        key={o.participant_id}
                        type="button"
                        onClick={() => onSwap(o, room.id)}
                        className="inline-flex max-w-full items-center gap-1 rounded-full bg-surface-muted px-2.5 py-1 text-xs hover:bg-surface-hover"
                      >
                        <ArrowLeftRight size={12} className="flex-shrink-0" />
                        <span className="truncate">{t('roomSwapWith').replace('{name}', o.name)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
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
