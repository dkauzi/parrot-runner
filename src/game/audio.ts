/**
 * Tiny WebAudio SFX. No files (keeps the playable self-contained), and the context is created
 * lazily on the first user gesture to respect mobile autoplay policy.
 */

let ctx: AudioContext | null = null;

export function unlockAudio(): void {
  if (!ctx) {
    const Ctor = window.AudioContext || (window as any).webkitAudioContext;
    if (Ctor) ctx = new Ctor();
  }
  if (ctx && ctx.state === 'suspended') void ctx.resume();
}

function tone(freq: number, durationMs: number, type: OscillatorType, gain = 0.06): void {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const vol = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  vol.gain.setValueAtTime(gain, ctx.currentTime);
  vol.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durationMs / 1000);
  osc.connect(vol).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + durationMs / 1000);
}

/** Pickup blip. Pitch rises with the combo chain for satisfying feedback. */
export function blip(chain = 1): void {
  tone(520 + chain * 70, 120, 'triangle');
}

export function startChime(): void {
  tone(440, 120, 'sine');
  setTimeout(() => tone(660, 160, 'sine'), 90);
}

export function endChime(): void {
  tone(330, 200, 'sine');
  setTimeout(() => tone(247, 260, 'sine'), 140);
}
