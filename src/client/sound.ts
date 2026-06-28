/* Tiny square-wave "blips" for that Game-Boy menu feel. No assets — just a
   short oscillator per press. Lazily creates (and resumes) one AudioContext on
   first use, so it works after the user's first interaction. */

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    if (!ctx) ctx = new (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null; // no Web Audio (or blocked) — stay silent
  }
}

/** A short square blip at `freq` Hz. */
export function blip(freq = 440, dur = 0.06): void {
  const c = audio();
  if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = "square";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.05, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
  osc.connect(gain).connect(c.destination);
  osc.start();
  osc.stop(c.currentTime + dur);
}

export const blipMove = () => blip(330, 0.04);
export const blipSelect = () => blip(660, 0.08);
export const blipBack = () => blip(200, 0.05);
