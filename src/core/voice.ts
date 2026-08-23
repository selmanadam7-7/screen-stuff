/**
 * Letting the shot respond to whether you are talking.
 *
 * On a normal call your camera is a fixed box in a corner whether you are
 * mid-sentence or silently reading a stack trace. A human director would not do
 * that: when you speak, you get bigger; when you go quiet and start typing, the
 * screen takes over.
 *
 * The whole difficulty is hysteresis. Speech is not a steady signal — it has
 * gaps between words and pauses between sentences — so a gate that reacts to
 * the level directly pumps several times a second and is unwatchable. Two
 * separate timings fix it: it opens quickly, because being late to your own
 * sentence looks broken, and it closes slowly, because the gap between two
 * sentences is not the end of talking.
 */

import type { Rect, Tile } from "./types";

/** Above this, that is a voice rather than a fan. */
export const SPEAKING_LEVEL = 0.045;

/** How long a voice must be there before the shot reacts. */
export const ATTACK_MS = 140;

/** And how long the quiet has to last before it lets go. */
export const RELEASE_MS = 1400;

/** How much bigger the camera gets when you are speaking. */
export const EMPHASIS_SCALE = 1.85;

/** How fast the size follows the gate. Per millisecond, framerate-independent. */
export const EMPHASIS_RATE = 0.0042;

/**
 * Turns a stream of loudness readings into "is talking" / "is not".
 *
 * The clock is passed in rather than read, so the timings can be tested in
 * microseconds rather than in real seconds.
 */
export class SpeechGate {
  private open = false;
  private since = 0;
  private pending: boolean | null = null;

  constructor(
    private readonly threshold = SPEAKING_LEVEL,
    private readonly attackMs = ATTACK_MS,
    private readonly releaseMs = RELEASE_MS,
  ) {}

  get speaking(): boolean {
    return this.open;
  }

  /** Feed a level in 0..1. Returns whether the gate is open after this sample. */
  push(level: number, now: number): boolean {
    const loud = level >= this.threshold;
    if (loud === this.open) {
      // Whatever was being considered has been contradicted.
      this.pending = null;
      return this.open;
    }
    if (this.pending !== loud) {
      this.pending = loud;
      this.since = now;
      return this.open;
    }
    const wait = loud ? this.attackMs : this.releaseMs;
    if (now - this.since >= wait) {
      this.open = loud;
      this.pending = null;
    }
    return this.open;
  }

  reset(): void {
    this.open = false;
    this.pending = null;
  }
}

/**
 * Ease a value toward a target at a rate that does not depend on frame rate.
 *
 * A plain `current += (target - current) * 0.1` per frame moves twice as fast
 * on a 120 Hz machine as on a 60 Hz one, which is how animation ends up feeling
 * different on different desks.
 */
export function approach(current: number, target: number, dtMs: number, rate = EMPHASIS_RATE): number {
  const t = 1 - Math.exp(-rate * Math.max(0, dtMs));
  const next = current + (target - current) * t;
  return Math.abs(next - target) < 0.001 ? target : next;
}

/**
 * The camera's rectangle at a given emphasis, 0 to 1.
 *
 * Grown about its own centre and then nudged back inside the stage, so a camera
 * parked in a corner grows into the shot rather than out of it.
 */
export function emphasisedRect(tile: Tile, stage: Rect, emphasis: number): Rect {
  if (emphasis <= 0.001) return { x: tile.x, y: tile.y, w: tile.w, h: tile.h };
  const scale = 1 + (EMPHASIS_SCALE - 1) * Math.max(0, Math.min(1, emphasis));
  const w = tile.w * scale;
  const h = tile.h * scale;
  const cx = tile.x + tile.w / 2;
  const cy = tile.y + tile.h / 2;
  let x = cx - w / 2;
  let y = cy - h / 2;

  // Only pulled back in if it actually fits; a camera bigger than the stage
  // stays centred rather than being jammed against one corner.
  if (w <= stage.w) x = Math.max(stage.x, Math.min(stage.x + stage.w - w, x));
  else x = stage.x + (stage.w - w) / 2;
  if (h <= stage.h) y = Math.max(stage.y, Math.min(stage.y + stage.h - h, y));
  else y = stage.y + (stage.h - h) / 2;

  return { x, y, w, h };
}

/**
 * Loudness from a block of samples, as RMS.
 *
 * Peak would react to a single click of the keyboard; RMS is closer to what a
 * person would call "how loud is this".
 */
export function levelOf(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}
