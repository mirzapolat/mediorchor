// Finds how far the metronome beats sit from where the music in a
// recording actually starts its notes: an onset envelope of the audio
// (rises in loudness) is matched against the beat times for a range of
// shifts, and the shift where beats land on onsets best wins.

const HOP_S = 0.005; // envelope resolution (nominal)

// Frame length in samples; its exact duration (hop / sampleRate, e.g.
// 221 / 44100 ≈ 5.011 ms) is what frame indices are converted with —
// rounding it to 5 ms would drift by seconds' worth over a whole piece.
const hopSamples = (buffer: AudioBuffer) => Math.max(1, Math.round(buffer.sampleRate * HOP_S));

// Onset strength per ~5 ms frame: positive change of log energy.
export const onsetEnvelope = (buffer: AudioBuffer): Float32Array => {
  const hop = hopSamples(buffer);
  const frames = Math.floor(buffer.length / hop);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const energy = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let i = f * hop; i < (f + 1) * hop; i++) {
      let v = 0;
      for (const data of channels) v += data[i];
      sum += v * v;
    }
    energy[f] = Math.log(1e-9 + sum / hop);
  }
  const rise = new Float32Array(frames);
  for (let f = 2; f < frames; f++) {
    // Over two frames, so slower attacks still count.
    rise[f] = Math.max(0, energy[f] - energy[f - 2]);
  }
  // Smoothed (triangle over ±10 ms) so each onset is one clear peak.
  const kernel = [1, 2, 3, 2, 1];
  const onset = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let v = 0;
    for (let k = 0; k < kernel.length; k++) {
      const i = f + k - 2;
      if (i >= 0 && i < frames) v += rise[i] * kernel[k];
    }
    onset[f] = v / 9;
  }
  return onset;
};

export interface Alignment {
  shift: number; // seconds to add to the beat times
  confidence: number; // best score relative to the average over all shifts
}

// Best shift within ±range for the beats (seconds in the recording).
export const estimateBeatShift = (
  buffer: AudioBuffer,
  beats: number[],
  range = 0.5,
): Alignment | null => {
  if (beats.length < 4) return null;
  const onset = onsetEnvelope(buffer);
  const frame = hopSamples(buffer) / buffer.sampleRate;
  const steps = Math.round(range / frame);
  const scores: number[] = [];
  let best = -Infinity;
  let bestStep = 0;
  // Smallest shifts first; a larger one only wins when clearly better, so a
  // steady beat doesn't snap a whole beat off (every beat fits there too).
  const order = Array.from({ length: 2 * steps + 1 }, (_, i) => (i % 2 ? (i + 1) / 2 : -i / 2));
  for (const s of order) {
    let score = 0;
    for (const t of beats) {
      const f = Math.round(t / frame) + s;
      if (f >= 0 && f < onset.length) score += onset[f];
    }
    scores.push(score);
    if (score > best * 1.1 || best === -Infinity) {
      best = score;
      bestStep = s;
    }
  }
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  return { shift: bestStep * frame, confidence: mean > 0 ? best / mean : 0 };
};
