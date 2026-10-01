import type { PlayedBar } from '@/lib/pieceTimeline';

// One metronome click in recording time; the downbeat of a bar is accented.
export interface Click {
  time: number;
  accent: boolean;
}

export const clicksFromBars = (bars: PlayedBar[]): Click[] =>
  bars.flatMap((b) => b.beats.map((time, i) => ({ time, accent: i === 0 && b.downbeat })));

export const createAudioContext = (): AudioContext | null => {
  const Ctx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return Ctx ? new Ctx() : null;
};

// A short, woodblock-like tick.
const tick = (ctx: AudioContext, at: number, accent: boolean): OscillatorNode => {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = accent ? 1760 : 1180;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(accent ? 0.8 : 0.5, at + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
  osc.connect(gain).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + 0.06);
  return osc;
};

// First click at or after `time` (binary search).
const firstClickFrom = (clicks: Click[], time: number) => {
  let lo = 0;
  let hi = clicks.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (clicks[mid].time < time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

// Plays the clicks in time with an <audio> element: a look-ahead scheduler
// maps recording time to the audio clock (respecting the playback speed) and
// starts over after seeks and loop jumps. `limit` is where playback jumps
// back (end of the loop section), so no click past it is scheduled.
// Returns a stop function.
export const runMetronome = (
  ctx: AudioContext,
  audio: HTMLAudioElement,
  clicks: Click[],
  limit: () => number | null,
): (() => void) => {
  const pending = new Set<OscillatorNode>();
  let next = 0;
  let last = { time: audio.currentTime, clock: ctx.currentTime };

  const cancelPending = () => {
    for (const osc of pending) {
      try {
        osc.stop();
      } catch {
        /* already stopped */
      }
    }
    pending.clear();
  };
  const resync = (time: number) => {
    cancelPending();
    next = firstClickFrom(clicks, time - 0.02);
  };
  resync(audio.currentTime);

  const schedule = () => {
    if (audio.paused) return;
    const now = audio.currentTime;
    const clock = ctx.currentTime;
    const rate = audio.playbackRate || 1;
    // Further than expected from the last look: a seek or loop jump.
    const expected = last.time + (clock - last.clock) * rate;
    if (Math.abs(now - expected) > 0.25) resync(now);
    last = { time: now, clock };

    // Timers run rarely in background tabs: look further ahead there.
    const ahead = (document.hidden ? 1.5 : 0.2) * rate;
    const end = limit();
    while (next < clicks.length && clicks[next].time < now + ahead) {
      const click = clicks[next++];
      if (end != null && click.time >= end - 0.03) continue;
      const when = clock + (click.time - now) / rate;
      if (when < clock - 0.05) continue;
      const osc = tick(ctx, Math.max(when, clock), click.accent);
      pending.add(osc);
      osc.onended = () => pending.delete(osc);
    }
  };

  schedule();
  const id = window.setInterval(schedule, 25);
  return () => {
    window.clearInterval(id);
    cancelPending();
  };
};
