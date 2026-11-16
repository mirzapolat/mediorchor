import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Check, RotateCcw, ScrollText, SlidersVertical, Volume2, VolumeX, X } from 'lucide-react';
import { PLAYBACK_RATES, type MixerVoice, type PracticePlayer } from '@/hooks/usePracticePlayer';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import type { ZoomBridge } from '@/lib/zoomBridge';

// The practice player's controls in Apple's "liquid glass" look (see
// .liquid-glass in index.css): round glass buttons above the score (mixer,
// score following, metronome) and the speed menu in the player.

type IconType = ComponentType<{ size?: number | string; strokeWidth?: number | string; className?: string }>;

// A metronome in the line style of the other (lucide) icons.
export const MetronomeIcon: IconType = ({ size = 24, strokeWidth = 2, className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M9.5 3h5l4.5 18H5L9.5 3Z" />
    <path d="M7 15h10" />
    <path d="m12 15 5-9" />
  </svg>
);

export const glassButton =
  'liquid-glass relative flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-text transition-[transform,background-color] duration-150 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent';

export const GlassButton = ({
  icon: Icon,
  label,
  onClick,
  active,
  dot = false,
  title,
  buttonRef,
  expanded,
}: {
  icon: IconType;
  label: string;
  onClick: () => void;
  // Set (true/false) for a toggle; left out for a plain action.
  active?: boolean;
  // Something set differently (shown as a small dot).
  dot?: boolean;
  title?: string;
  buttonRef?: RefObject<HTMLButtonElement>;
  // Opens a panel (instead of being a toggle).
  expanded?: boolean;
}) => (
  <button
    ref={buttonRef}
    type="button"
    onClick={onClick}
    aria-label={label}
    title={title ?? label}
    aria-pressed={expanded === undefined ? active : undefined}
    aria-expanded={expanded}
    className={cn(glassButton, active && 'liquid-glass-on')}
  >
    <Icon size={19} strokeWidth={2} />
    {dot && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-accent ring-2 ring-surface" />}
  </button>
);

// Closes on a press outside `refs` and on Escape.
const useDismiss = (open: boolean, close: () => void, refs: Array<RefObject<HTMLElement>>) => {
  const closeRef = useRef(close);
  closeRef.current = close;
  const refsRef = useRef(refs);
  refsRef.current = refs;
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!refsRef.current.some((r) => r.current?.contains(e.target as Node))) closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Before the page's Escape (which would end the fullscreen).
      e.stopPropagation();
      closeRef.current();
    };
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);
};

// Fixed position next to an anchor, clamped into the viewport (16px gutter).
const useAnchored = (open: boolean, anchor: RefObject<HTMLElement>, width: number, above: boolean) => {
  const [style, setStyle] = useState<CSSProperties>({ top: -9999, left: -9999 });
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const gutter = 16;
      const w = Math.min(width, window.innerWidth - 2 * gutter);
      const left = Math.min(Math.max(above ? r.right - w : r.left, gutter), window.innerWidth - gutter - w);
      setStyle(
        above
          ? { left, width: w, bottom: window.innerHeight - r.top + 10, maxHeight: r.top - 10 - gutter }
          : { left, width: w, top: r.bottom + 10, maxHeight: window.innerHeight - r.bottom - 10 - gutter },
      );
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, anchor, width, above]);
  return style;
};

// --- Mixer ------------------------------------------------------------------

// One voice: switch, name, solo, and its volume slider.
const VoiceRow = ({ voice, mixer }: { voice: MixerVoice; mixer: PracticePlayer['mixer'] }) => {
  const { t } = useI18n();
  const pct = Math.round(voice.volume * 100);
  const loading = voice.status === 'loading';
  const failed = voice.status === 'error';
  const title = voice.title || t('fileKindAudio');
  return (
    <li className={cn('rounded-2xl px-3 pb-1.5 pt-2.5 transition-colors duration-150', voice.on ? 'bg-surface/70' : 'bg-surface/30')}>
      <div className="flex items-center gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={voice.on}
          aria-label={`${title}: ${voice.on ? t('voiceOn') : t('voiceOff')}`}
          onClick={() => mixer.setOn(voice.id, !voice.on)}
          className={cn(
            'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full transition-colors duration-150 active:scale-95',
            voice.on ? 'bg-black text-white shadow-sm' : 'bg-surface-muted text-text-tertiary',
          )}
        >
          {voice.on ? <Volume2 size={18} /> : <VolumeX size={18} />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={cn('truncate text-base font-semibold', !voice.on && 'text-text-secondary')} title={title}>
              {title}
            </span>
            {voice.click && (
              <span className="flex-shrink-0 rounded bg-surface-muted px-1.5 py-px text-[10px] font-semibold text-text-secondary">
                {t('slotClick')}
              </span>
            )}
          </div>
          <p className="text-xs tabular-nums text-text-tertiary">
            {failed ? (
              <button type="button" onClick={() => mixer.retry(voice.id)} className="inline-flex items-center gap-1 text-danger">
                <AlertTriangle size={12} />
                {t('voiceLoadFailed')} · {t('retry')}
              </button>
            ) : loading ? (
              `${t('loading')} ${Math.round(voice.progress * 100)} %`
            ) : (
              `${pct} %`
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => mixer.solo(voice.id)}
          className="h-8 flex-shrink-0 rounded-full px-3 text-sm font-medium text-text-secondary transition-colors duration-150 hover:bg-surface-muted hover:text-text"
        >
          {t('mixerSolo')}
        </button>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={pct}
        aria-label={`${t('volume')}: ${title}`}
        onChange={(e) => mixer.setVolume(voice.id, Number(e.target.value) / 100)}
        className="mixer-range w-full"
        style={{ '--fill': `${voice.on ? pct : 0}%` } as CSSProperties}
      />
      {loading && (
        <div className="mb-1 h-0.5 overflow-hidden rounded-full bg-surface-muted">
          <div className="h-full bg-accent transition-[width] duration-200" style={{ width: `${voice.progress * 100}%` }} />
        </div>
      )}
    </li>
  );
};

const MixerBody = ({ player }: { player: PracticePlayer }) => {
  const { t } = useI18n();
  const { mixer, metronome } = player;
  return (
    <>
      <ul className="space-y-1.5">
        {mixer.voices.map((v) => (
          <VoiceRow key={v.id} voice={v} mixer={mixer} />
        ))}
      </ul>
      {metronome.available && (
        <div className={cn('mt-1.5 rounded-2xl px-3 pb-1.5 pt-2.5', metronome.on ? 'bg-surface/70' : 'bg-surface/30')}>
          <button
            type="button"
            role="switch"
            aria-checked={metronome.on}
            onClick={() => metronome.setOn(!metronome.on)}
            className="flex w-full items-center gap-3 text-left"
          >
            <span
              className={cn(
                'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full transition-colors duration-150',
                metronome.on ? 'bg-black text-white shadow-sm' : 'bg-surface-muted text-text-tertiary',
              )}
            >
              <MetronomeIcon size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className={cn('block text-base font-semibold', !metronome.on && 'text-text-secondary')}>{t('metronome')}</span>
              <span className="block truncate text-xs tabular-nums text-text-tertiary">
                {metronome.on && !metronome.audible
                  ? t('metronomeNoVoice')
                  : metronome.source?.status === 'loading'
                    ? `${t('loading')} ${Math.round(metronome.source.progress * 100)} %`
                    : `${Math.round(metronome.volume * 100)} %`}
              </span>
            </span>
          </button>
          {metronome.source?.status === 'error' && (
            <button type="button" onClick={metronome.source.retry} className="mt-1 inline-flex items-center gap-1 text-xs text-danger">
              <AlertTriangle size={12} />
              {t('voiceLoadFailed')} · {t('retry')}
            </button>
          )}
          {/* The click's own level (with recorded click versions: faded
              between the voice's recordings with and without click). */}
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(metronome.volume * 100)}
            aria-label={`${t('volume')}: ${t('metronome')}`}
            onChange={(e) => {
              metronome.setVolume(Number(e.target.value) / 100);
              if (!metronome.on && Number(e.target.value) > 0) metronome.setOn(true);
            }}
            className="mixer-range w-full"
            style={{ '--fill': `${metronome.on ? Math.round(metronome.volume * 100) : 0}%` } as CSSProperties}
          />
        </div>
      )}
    </>
  );
};

// Top left of the player: the mixer. A glass popover below the button on
// larger screens, a full-screen glass sheet on phones.
export const MixerButton = ({ player }: { player: PracticePlayer }) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const phone = useMediaQuery('(max-width: 767px)');
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const style = useAnchored(open && !phone, button, 360, false);
  useDismiss(open, () => setOpen(false), [button, panel]);
  const { mixer } = player;
  const loading = mixer.voices.some((v) => v.on && v.status === 'loading');

  const header = (
    <div className="flex items-center gap-2 px-1 pb-2">
      <h2 className="flex-1 text-lg font-bold">{t('mixer')}</h2>
      {mixer.changed && (
        <button
          type="button"
          onClick={mixer.reset}
          className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-text-secondary hover:bg-surface-muted hover:text-text"
        >
          <RotateCcw size={14} />
          {t('mixerAllOn')}
        </button>
      )}
      {phone && (
        <button type="button" onClick={() => setOpen(false)} aria-label={t('close')} className={glassButton}>
          <X size={19} />
        </button>
      )}
    </div>
  );

  return (
    <>
      <GlassButton
        buttonRef={button}
        icon={SlidersVertical}
        label={t('mixer')}
        onClick={() => setOpen((v) => !v)}
        expanded={open}
        active={open}
        dot={mixer.changed || loading}
      />
      {open &&
        createPortal(
          <div
            ref={panel}
            role="dialog"
            aria-modal={phone || undefined}
            aria-label={t('mixer')}
            style={phone ? undefined : style}
            className={cn(
              'liquid-glass liquid-glass-strong fixed z-[95] overflow-y-auto overscroll-contain',
              phone
                ? 'inset-0 rounded-none px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-[calc(0.75rem+env(safe-area-inset-top))]'
                : 'rounded-[28px] p-3',
            )}
          >
            {header}
            <MixerBody player={player} />
          </div>,
          document.body,
        )}
    </>
  );
};

// Bottom right of the player: the speed as "1×"; the choice opens upwards.
export const SpeedButton = ({ player }: { player: PracticePlayer }) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const style = useAnchored(open, button, 200, true);
  useDismiss(open, () => setOpen(false), [button, panel]);
  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`${t('playbackSpeed')}: ${player.rate}×`}
        title={t('playbackSpeed')}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          'flex h-10 min-w-[3.25rem] items-center justify-center rounded-full px-3 text-sm font-semibold tabular-nums transition-[transform,background-color] duration-150 active:scale-95',
          player.rate !== 1 || open ? 'bg-black text-white' : 'text-text-secondary hover:bg-surface-muted hover:text-text',
        )}
      >
        {player.rate}×
      </button>
      {open &&
        createPortal(
          <div
            ref={panel}
            role="dialog"
            aria-label={t('playbackSpeed')}
            style={style}
            className="liquid-glass liquid-glass-strong fixed z-[95] overflow-y-auto rounded-3xl p-1.5"
          >
            <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-text-tertiary">{t('playbackSpeed')}</p>
            {[...PLAYBACK_RATES].reverse().map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={player.rate === r}
                onClick={() => {
                  player.setRate(r);
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-2xl px-3 py-2 text-left text-base tabular-nums transition-colors duration-150 hover:bg-surface/70',
                  player.rate === r && 'font-semibold',
                )}
              >
                <Check size={16} className={player.rate === r ? 'text-text' : 'invisible'} />
                {r}×
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
};

// Following the score as it plays: a glass toggle (on the right side).
export const FollowButton = ({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) => {
  const { t } = useI18n();
  return <GlassButton icon={ScrollText} label={t('followScore')} active={on} onClick={() => onChange(!on)} />;
};

// The left group of glass buttons above the score: mixer and metronome
// (each only when it applies).
export const PracticeButtons = ({ player, children }: { player: PracticePlayer; children?: ReactNode }) => {
  const { t } = useI18n();
  const { metronome } = player;
  return (
    <div className="flex items-center gap-2">
      {player.mixer.voices.length > 0 && <MixerButton player={player} />}
      {metronome.available && (
        <GlassButton
          icon={MetronomeIcon}
          label={t('metronome')}
          title={metronome.on && !metronome.audible ? `${t('metronome')} · ${t('metronomeNoVoice')}` : t('metronome')}
          active={metronome.on}
          dot={metronome.on && !metronome.audible}
          onClick={() => metronome.setOn(!metronome.on)}
        />
      )}
      {children}
    </div>
  );
};

// Round glass button with the score's zoom in it; a tap offers going back
// to 100 % or 80 %.
export const ZoomButton = ({ bridge }: { bridge: ZoomBridge }) => {
  const { t } = useI18n();
  const { zoom, ready } = useSyncExternalStore(bridge.subscribe, bridge.get);
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const style = useAnchored(open, button, 180, false);
  useDismiss(open, () => setOpen(false), [button, panel]);
  if (!ready) return null;
  const pct = Math.round(zoom * 100);
  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`${t('zoom')}: ${pct} %`}
        title={t('resetZoom')}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(glassButton, 'text-[11px] font-semibold tabular-nums tracking-tight', open && 'liquid-glass-on')}
      >
        {pct}%
      </button>
      {open &&
        createPortal(
          <div
            ref={panel}
            role="dialog"
            aria-label={t('zoom')}
            style={style}
            className="liquid-glass liquid-glass-strong fixed z-[95] overflow-y-auto rounded-3xl p-1.5"
          >
            <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-text-tertiary">{t('resetZoom')}</p>
            {[1, 0.8].map((z) => {
              const active = Math.abs(zoom - z) < 0.01;
              return (
                <button
                  key={z}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    bridge.set(z);
                    setOpen(false);
                  }}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-2xl px-3 py-2 text-left text-base tabular-nums transition-colors duration-150 hover:bg-surface/70',
                    active && 'font-semibold',
                  )}
                >
                  <Check size={16} className={active ? 'text-text' : 'invisible'} />
                  {Math.round(z * 100)} %
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
};
