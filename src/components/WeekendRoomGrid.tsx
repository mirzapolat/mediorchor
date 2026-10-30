import { AlertTriangle, ArrowLeftRight, BedDouble, Check, DoorOpen, GripVertical, LogOut, Pencil, Plus, Trash2, UserRound } from 'lucide-react';
import { packSlots, peakOccupancy, type NightRange } from '@shared/weekendNights';
import { Avatar } from './Avatar';
import { Button } from './Button';
import type { RoomDrag } from './WeekendRoomDrag';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import { nightsLabel, type Room, type RoomPerson, type RoomsView } from '@/lib/weekends';

// Does someone fit into the room: in each of their nights fewer than its
// capacity sleep there (they themselves, and `also`, left out).
export const fits = (room: Room, nights: NightRange, participantId: string | null, also: string | null = null) =>
  peakOccupancy(
    room.occupants.filter((o) => o.participant_id !== participantId && o.participant_id !== also).map((o) => o.nights),
    nights,
  ) < room.capacity;

export const roomPeak = (r: Room) => peakOccupancy(r.occupants.map((o) => o.nights));

// The nights of a place nobody sleeps in, as ranges.
const freeNights = (slot: RoomPerson[], count: number) => {
  const free: NightRange[] = [];
  for (let night = 0; night < count; night++) {
    if (slot.some((p) => p.nights[0] <= night && night <= p.nights[1])) continue;
    const last = free[free.length - 1];
    if (last && last[1] === night - 1) last[1] = night;
    else free.push([night, night]);
  }
  return free;
};

// The weekend's nights as small cells, the booked ones filled — only for
// someone not staying every night.
export const NightStrip = ({ nights, count, label }: { nights: NightRange; count: number; label: string | null }) => {
  const { t } = useI18n();
  if (count < 2 || (nights[0] === 0 && nights[1] === count - 1)) return null;
  const text = label ?? nightsLabel(nights, t('weekendNight'));
  return (
    <span className="ml-auto flex flex-shrink-0 items-center gap-0.5" title={text} aria-label={text}>
      {Array.from({ length: count }, (_, night) => (
        <span
          key={night}
          className={cn('h-2.5 w-2.5 rounded-sm', nights[0] <= night && night <= nights[1] ? 'bg-accent' : 'bg-surface-muted')}
        />
      ))}
    </span>
  );
};

// What managers can do with rooms and the people in them.
export interface RoomManage {
  drag: RoomDrag;
  onMove: (person: RoomPerson, from: string | null) => void;
  onEdit: (room: Room) => void;
  onRemove: (room: Room) => void;
  onAdd: () => void;
}

// One person: avatar, name and nights (a click shows them). For managers also
// a grip to drag them (the whole row with a mouse) and a button to move them;
// both faded until hover on large screens.
export const PersonRow = ({
  person: p,
  from,
  nightCount,
  onPerson,
  manage,
  highlight,
}: {
  person: RoomPerson;
  from: string | null;
  nightCount: number;
  onPerson: (person: RoomPerson) => void;
  manage?: Pick<RoomManage, 'drag' | 'onMove'>;
  highlight?: boolean;
}) => {
  const { t } = useI18n();
  const dragged = manage?.drag.dragging?.person.participant_id === p.participant_id;
  return (
    <div
      data-drop-person={p.participant_id}
      {...manage?.drag.handle(p, from)}
      className={cn(
        'group/person flex items-center rounded-lg transition-colors',
        manage && 'cursor-grab active:cursor-grabbing',
        dragged && 'opacity-40',
        highlight && 'bg-accent/10 ring-1 ring-accent',
      )}
    >
      {manage && (
        <span
          data-grip
          aria-hidden
          style={{ touchAction: 'none' }}
          className="flex h-8 w-5 flex-shrink-0 items-center justify-center text-text-tertiary lg:opacity-0 lg:group-hover/person:opacity-100"
        >
          <GripVertical size={14} />
        </span>
      )}
      <button
        type="button"
        onClick={() => onPerson(p)}
        className={cn('flex min-w-0 flex-1 items-center gap-2 rounded-lg py-1 text-left hover:bg-surface-subtle', manage ? 'pl-0.5 pr-1' : 'px-1')}
      >
        <Avatar name={p.name} photoUrl={p.photo_url} size={26} />
        <span className={cn('min-w-0 truncate text-sm', p.mine && 'font-semibold')} title={p.name}>
          {p.name}
          {p.mine && ` (${t('you')})`}
          {p.kind === 'guest' && <span className="ml-1.5 text-xs font-normal text-text-tertiary">{t('weekendKindGuest')}</span>}
        </span>
        <NightStrip nights={p.nights} count={nightCount} label={p.booking} />
      </button>
      {manage && (
        <button
          type="button"
          onClick={() => manage.onMove(p, from)}
          aria-label={`${t('roomMove')}: ${p.name}`}
          title={t('roomMove')}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-text-tertiary hover:bg-surface-hover hover:text-text focus:opacity-100 lg:opacity-0 lg:group-hover/person:opacity-100"
        >
          <ArrowLeftRight size={14} />
        </button>
      )}
    </div>
  );
};

// A weekend's rooms as cards: their places with who sleeps there (people
// whose nights don't overlap share one), a button to take, switch or free
// one's own place, and — with `manage` — editing rooms and moving people by
// drag and drop (a full room swaps with the person dropped on). Used inside
// the app and on the shared link for guests.
export const RoomGrid = ({
  view,
  busy,
  onChoose,
  onPerson,
  manage,
}: {
  view: RoomsView;
  busy: boolean;
  onChoose: (roomId: string | null) => void;
  onPerson: (person: RoomPerson) => void;
  manage?: RoomManage;
}) => {
  const { t } = useI18n();
  const nightCount = view.night_count;
  const dragging = manage?.drag.dragging ?? null;
  const over = manage?.drag.over ?? null;

  // What letting go over the room would do.
  const dropOn = (room: Room) => {
    if (!dragging || over?.room !== room.id || dragging.from === room.id) return null;
    if (fits(room, dragging.person.nights, dragging.person.participant_id)) return 'move';
    return over.person ? 'swap' : 'full';
  };

  if (view.rooms.length === 0 && !manage) {
    return (
      <div className="flex flex-col items-center rounded-2xl border border-dashed border-border-strong px-6 py-12 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-muted text-text-secondary">
          <BedDouble size={22} />
        </span>
        <p className="mt-3 font-semibold">{t('roomsNone')}</p>
        <p className="mt-1 text-sm text-text-secondary">{t('roomsNoneHint')}</p>
      </div>
    );
  }

  return (
    <ul className={cn('grid gap-3 sm:grid-cols-2', !manage && 'xl:grid-cols-3')}>
      {view.rooms.map((room) => {
        const mine = view.me?.room_id === room.id;
        const used = roomPeak(room);
        const full = used >= room.capacity;
        // Full for me: one of my nights has no place left.
        const fullForMe = view.me ? !fits(room, view.me.nights, view.me.participant_id) : full;
        const slots = packSlots(room.occupants, room.capacity);
        const drop = dropOn(room);
        return (
          <li
            key={room.id}
            data-drop-room={manage ? room.id : undefined}
            className={cn(
              'group/item flex flex-col rounded-2xl border bg-surface p-4 transition-shadow',
              mine ? 'border-accent bg-accent/10' : 'border-border',
              drop === 'move' && 'border-accent ring-2 ring-accent/40',
              drop === 'full' && 'border-danger/50 ring-2 ring-danger/20',
            )}
          >
            <div className="flex items-start gap-3">
              <span
                className={cn(
                  'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl',
                  mine ? 'bg-accent/15 text-accent' : 'bg-surface-muted text-text-secondary',
                )}
              >
                <BedDouble size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium" title={room.name}>
                  {room.name}
                </p>
                <p className={cn('text-xs', drop === 'full' ? 'text-danger' : full ? 'text-text-tertiary' : 'text-text-secondary')}>
                  {drop === 'full'
                    ? t('roomFullDrop')
                    : `${t('roomPlaces').replace('{n}', String(used)).replace('{max}', String(room.capacity))}${full ? ` · ${t('roomFull')}` : ''}`}
                </p>
              </div>
              {manage && (
                <div className="flex lg:opacity-0 lg:focus-within:opacity-100 lg:group-hover/item:opacity-100">
                  <button
                    type="button"
                    onClick={() => manage.onEdit(room)}
                    aria-label={`${t('edit')}: ${room.name}`}
                    title={t('edit')}
                    className="flex h-8 w-8 items-center justify-center rounded-md text-text-tertiary hover:bg-surface-hover hover:text-text"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => manage.onRemove(room)}
                    disabled={room.occupants.length > 0}
                    aria-label={`${t('delete')}: ${room.name}`}
                    title={room.occupants.length > 0 ? t('roomDeleteBlocked') : t('delete')}
                    className="flex h-8 w-8 items-center justify-center rounded-md text-text-tertiary hover:bg-surface-hover hover:text-text disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </div>
            {room.description && <p className="mt-2 text-sm text-text-secondary">{room.description}</p>}
            {slots.length > room.capacity && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-danger">
                <AlertTriangle size={13} />
                {t('roomOverbooked')}
              </p>
            )}
            <ul className="mt-3 flex-1 space-y-1">
              {slots.map((slot, i) => {
                const gaps = slot.length > 0 ? freeNights(slot, nightCount) : [];
                // A place shared by night (or partly free) is framed as one.
                const shared = slot.length > 1 || gaps.length > 0;
                return (
                  <li key={i} className={cn(shared && 'rounded-lg border border-dashed border-border')}>
                    {slot.length === 0 ? (
                      <span className="flex items-center gap-2 px-1 py-1 text-sm text-text-tertiary">
                        <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full border border-dashed border-border-strong">
                          <UserRound size={13} />
                        </span>
                        {t('roomFreePlace')}
                      </span>
                    ) : (
                      <>
                        {slot.map((p) => (
                          <PersonRow
                            key={p.participant_id}
                            person={p}
                            from={room.id}
                            nightCount={nightCount}
                            onPerson={onPerson}
                            manage={manage}
                            highlight={drop === 'swap' && over?.person === p.participant_id}
                          />
                        ))}
                        {gaps.map((range) => (
                          <span key={range[0]} className="flex items-center gap-2 px-1 py-1 text-xs text-text-tertiary">
                            <span className="flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-full border border-dashed border-border-strong">
                              <UserRound size={13} />
                            </span>
                            {t('roomFreeIn').replace('{nights}', nightsLabel(range, t('weekendNight')))}
                          </span>
                        ))}
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
            {view.me && view.can_choose && (
              <div className="mt-3 border-t border-border pt-3">
                {mine ? (
                  <Button variant="secondary" className="w-full" disabled={busy} onClick={() => onChoose(null)}>
                    <LogOut size={15} />
                    {t('roomLeave')}
                  </Button>
                ) : (
                  <Button
                    variant={view.me.room_id ? 'secondary' : 'primary'}
                    className="w-full"
                    disabled={busy || fullForMe}
                    onClick={() => onChoose(room.id)}
                  >
                    {view.me.room_id ? <DoorOpen size={15} /> : <Check size={15} />}
                    {fullForMe ? t('roomFull') : view.me.room_id ? t('roomSwitch') : t('roomTake')}
                  </Button>
                )}
              </div>
            )}
          </li>
        );
      })}
      {manage && (
        <li>
          <button
            type="button"
            onClick={manage.onAdd}
            className="flex h-full min-h-[7rem] w-full flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-border-strong text-sm font-medium text-text-secondary transition-colors hover:bg-surface-subtle hover:text-text"
          >
            <Plus size={18} />
            {t('roomAdd')}
          </button>
        </li>
      )}
    </ul>
  );
};
