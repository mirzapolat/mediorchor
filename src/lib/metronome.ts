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

// Plays the clicks in time with an <audio> element. The recording position
// is not read off `audio.currentTime` for every click — some browsers only
// update it in coarse steps — but carried along on the audio clock from an
// anchor (recording time ↔ clock time, at the playback speed) and gently
// pulled towards fresh `currentTime` readings. Seeks, loop jumps and speed
// changes set a new anchor. `limit` is where playback jumps back (end of
// the loop section), so no click past it is scheduled. Returns a stop
// function.
export const runMetronome = (
  ctx: AudioContext,
  audio: HTMLAudioElement,
  clicks: Click[],
  limit: () => number | null,
): (() => void) => {
  // Scheduled ticks and when they start on the audio clock.
  const pending = new Map<OscillatorNode, number>();
  let next = 0;
  let anchor = { time: audio.currentTime, clock: ctx.currentTime };
  let lastReading = audio.currentTime;

  const positionAt = (clock: number) => anchor.time + (clock - anchor.clock) * (audio.playbackRate || 1);

  // Ticks that haven't started yet are dropped; one already sounding
  // plays out (cutting it off would swallow the beat).
  const cancelUpcoming = () => {
    const clock = ctx.currentTime;
    for (const [osc, at] of pending) {
      if (at <= clock + 0.005) continue;
      try {
        osc.stop();
      } catch {
        /* already stopped */
      }
      pending.delete(osc);
    }
  };
  const reanchor = () => {
    cancelUpcoming();
    anchor = { time: audio.currentTime, clock: ctx.currentTime };
    lastReading = anchor.time;
    next = firstClickFrom(clicks, anchor.time - 0.01);
  };
  reanchor();

  const schedule = () => {
    if (audio.paused) return;
    const clock = ctx.currentTime;
    const reading = audio.currentTime;
    // A fresh reading: far off means a jump the events missed; otherwise
    // drift is pulled in slowly, so coarse readings don't cause jitter.
    if (reading !== lastReading) {
      lastReading = reading;
      const error = reading - positionAt(clock);
      if (Math.abs(error) > 0.3) {
        reanchor();
      } else {
        anchor = { time: anchor.time + error * 0.1, clock: anchor.clock };
      }
    }

    const rate = audio.playbackRate || 1;
    const now = positionAt(clock);
    // Timers run rarely in background tabs: look further ahead there.
    const ahead = (document.hidden ? 1.5 : 0.25) * rate;
    const end = limit();
    while (next < clicks.length && clicks[next].time < now + ahead) {
      const click = clicks[next++];
      if (end != null && click.time >= end - 0.03) continue;
      const when = clock + (click.time - now) / rate;
      if (when < clock - 0.03) continue; // missed (e.g. a stalled timer)
      const at = Math.max(when, clock);
      const osc = tick(ctx, at, click.accent);
      pending.set(osc, at);
      osc.onended = () => pending.delete(osc);
    }
  };

  // Jumps and speed changes the element reports itself.
  const onJump = () => {
    reanchor();
    schedule();
  };
  audio.addEventListener('seeked', onJump);
  audio.addEventListener('ratechange', onJump);
  audio.addEventListener('playing', onJump);

  schedule();
  const id = window.setInterval(schedule, 25);
  return () => {
    audio.removeEventListener('seeked', onJump);
    audio.removeEventListener('ratechange', onJump);
    audio.removeEventListener('playing', onJump);
    window.clearInterval(id);
    cancelUpcoming();
  };
};
