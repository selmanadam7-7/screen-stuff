/**
 * The last minute of the shot, so "wait, go back to that" is a button.
 *
 * It happens on every call: you move on, somebody asks to see the thing again,
 * and you spend twenty seconds finding your way back to a window you have since
 * closed. The app is already compositing every frame the audience sees, so the
 * only thing missing is remembering a few of them.
 *
 * Deliberately not a recording, and the distinction is the whole design:
 *
 *   * It lives in memory and never touches the disk.
 *   * It is a fixed-length ring — the oldest frame falls off the end
 *     continuously, so there is never a growing pile of your screen anywhere.
 *   * It ends when the app does. Nothing to find later, nothing to leak, no
 *     file to forget about.
 *
 * That is a different thing from recording a session, and it is why this can be
 * on without a decision attached to it.
 */

/** How far back you can go. */
export const REPLAY_SECONDS = 45;

/** Frames a second. Enough to follow a cursor; cheap enough to be free. */
export const REPLAY_FPS = 4;

export const REPLAY_CAPACITY = REPLAY_SECONDS * REPLAY_FPS;

/** How wide a remembered frame is. Small on purpose — this is a jog, not a master. */
export const REPLAY_WIDTH = 960;

export interface ReplayFrame {
  /** A JPEG data URL of the shot as it was. */
  image: string;
  /** When it was taken, in wall-clock milliseconds. */
  at: number;
}

/**
 * A fixed-length ring of frames.
 *
 * Fixed length rather than "keep the last 45 seconds by timestamp": the memory
 * this uses has to have a ceiling that does not depend on how fast the machine
 * happens to be feeding it.
 */
export class ReplayBuffer {
  private frames: ReplayFrame[] = [];

  constructor(private readonly capacity = REPLAY_CAPACITY) {}

  push(image: string, at: number): void {
    this.frames.push({ image, at });
    if (this.frames.length > this.capacity) this.frames.shift();
  }

  get length(): number {
    return this.frames.length;
  }

  /** How much history there is, in seconds. */
  seconds(now: number): number {
    const first = this.frames[0];
    return first ? Math.max(0, (now - first.at) / 1000) : 0;
  }

  at(index: number): ReplayFrame | null {
    if (index < 0 || index >= this.frames.length) return null;
    return this.frames[index];
  }

  /** The frame nearest a moment in time, for scrubbing by seconds rather than index. */
  nearest(at: number): number {
    if (this.frames.length === 0) return -1;
    let best = 0;
    let bestGap = Infinity;
    for (let i = 0; i < this.frames.length; i++) {
      const gap = Math.abs(this.frames[i].at - at);
      if (gap < bestGap) {
        bestGap = gap;
        best = i;
      }
    }
    return best;
  }

  /** Everything, oldest first. */
  all(): readonly ReplayFrame[] {
    return this.frames;
  }

  clear(): void {
    this.frames = [];
  }

  /** Roughly how much memory this is holding, in bytes. */
  bytes(): number {
    // A data URL is base64: four characters for every three bytes.
    return this.frames.reduce((sum, f) => sum + Math.round((f.image.length * 3) / 4), 0);
  }
}

/** How far through the buffer an index is, 0 to 1. */
export function positionOf(index: number, length: number): number {
  if (length <= 1) return 1;
  return Math.max(0, Math.min(1, index / (length - 1)));
}

/** "12s ago", for the scrubber. */
export function agoLabel(frame: ReplayFrame, now: number): string {
  const seconds = Math.max(0, Math.round((now - frame.at) / 1000));
  if (seconds <= 0) return "now";
  return `${seconds}s ago`;
}
