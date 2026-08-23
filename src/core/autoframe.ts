/**
 * Pointing the stage at whatever you are actually working in.
 *
 * A camera operator, not a security camera. The hard part is not finding the
 * window — Windows will tell you that — it is deciding when *not* to move. A
 * shot that chases every focus change is unwatchable, and one that lags behind
 * the work is worse than none at all.
 *
 * Three rules do most of that work:
 *
 *   * **Settle before committing.** Alt-tabbing through five windows to reach
 *     the sixth should be one move, not five. A target has to hold still for a
 *     moment before the shot goes to it.
 *   * **Ignore small differences.** Clicking between two panes of the same
 *     editor is not a new shot. If the new rectangle mostly overlaps the one
 *     already on air, stay put.
 *   * **Only ever frame what is on the board.** If the operator tabs to
 *     something they never added, the shot holds. This is what makes it safe to
 *     leave switched on: auto-framing can move the stage, but it can never
 *     reveal anything the operator did not already choose to show.
 */

import { fitAspect, rectsOverlap, tileRect } from "./geometry";
import type { BoardDoc, Rect, Tile } from "./types";

/** How the stage follows the work. */
export type AutoFrameMode = "off" | "monitor" | "window";

/** What the engine reports about the focused window, in desktop pixels. */
export interface Focus {
  window: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  monitor: string | null;
}

/** How long a new target must hold before the shot commits to it. */
export const SETTLE_MS = 700;

/** Breathing room around a followed window, as a fraction of its size. */
export const WINDOW_PADDING = 0.06;

/**
 * Below this much overlap with the shot already on air, it is a new shot.
 *
 * Generous on purpose: switching panes inside one editor, or a window growing a
 * sidebar, should not re-aim anything.
 */
export const RESTFUL_OVERLAP = 0.86;

export interface AutoFrameTarget {
  /** Where the stage should go. */
  rect: Rect;
  /** The tile it is framing, for the operator-facing readout. */
  tileId: string;
  /** What to call it: "Display 2", or the window's title. */
  label: string;
}

/** The source id a tile captures, or null for anything that is not a capture. */
function sourceOf(tile: Tile): string | null {
  return tile.kind === "source" ? tile.source : null;
}

/** The monitor a `monitor:<n>` or `region:monitor:<n>@…` tile shows. */
function monitorOf(source: string): string | null {
  if (source.startsWith("monitor:")) return source;
  const region = /^region:(monitor:\d+)@/.exec(source);
  return region ? region[1] : null;
}

/**
 * Map a desktop rectangle onto the part of a monitor tile showing it.
 *
 * This is what lets window-follow work on a board that only has monitors on it:
 * the window was never added as a tile, but the pixels are right there inside
 * the monitor tile, and the maths to find them is a proportion.
 */
export function windowWithinMonitor(
  tile: Tile,
  monitor: { x: number; y: number; width: number; height: number },
  focus: Focus,
): Rect | null {
  if (monitor.width <= 0 || monitor.height <= 0) return null;
  const fx = (focus.x - monitor.x) / monitor.width;
  const fy = (focus.y - monitor.y) / monitor.height;
  const fw = focus.width / monitor.width;
  const fh = focus.height / monitor.height;
  // A window mostly off the monitor is not something to frame.
  if (fw <= 0.01 || fh <= 0.01) return null;
  return {
    x: tile.x + fx * tile.w,
    y: tile.y + fy * tile.h,
    w: fw * tile.w,
    h: fh * tile.h,
  };
}

/** Grow a rectangle by a fraction of itself, keeping the centre. */
function pad(rect: Rect, fraction: number): Rect {
  const dx = rect.w * fraction;
  const dy = rect.h * fraction;
  return { x: rect.x - dx, y: rect.y - dy, w: rect.w + dx * 2, h: rect.h + dy * 2 };
}

/**
 * Where the stage should point, given what the operator is working in.
 *
 * Returns null when there is nothing on the board showing that work — which is
 * the common case for a chat window or a password manager, and the reason this
 * can be left on.
 */
export function targetFor(
  doc: BoardDoc,
  focus: Focus | null,
  mode: AutoFrameMode,
  monitors: Array<{ id: string; x: number; y: number; width: number; height: number }>,
): AutoFrameTarget | null {
  if (!focus || mode === "off") return null;

  const visible = doc.tiles.filter((t) => !t.hidden && sourceOf(t));

  // A tile of the window itself always wins: it is the closest possible shot,
  // and the operator put it there on purpose.
  if (mode === "window") {
    const exact = visible.find((t) => sourceOf(t) === focus.window);
    if (exact) {
      return {
        rect: fitAspect(pad(tileRect(exact), WINDOW_PADDING), doc.aspect),
        tileId: exact.id,
        label: focus.title || "that window",
      };
    }
  }

  if (!focus.monitor) return null;
  const monitor = monitors.find((m) => m.id === focus.monitor);
  const tile = visible.find((t) => monitorOf(sourceOf(t)!) === focus.monitor);
  if (!tile) return null;

  if (mode === "window" && monitor) {
    const within = windowWithinMonitor(tile, monitor, focus);
    if (within) {
      return {
        rect: fitAspect(pad(within, WINDOW_PADDING), doc.aspect),
        tileId: tile.id,
        label: focus.title || "that window",
      };
    }
  }

  return {
    rect: fitAspect(tileRect(tile), doc.aspect),
    tileId: tile.id,
    label: tile.label || "that screen",
  };
}

/**
 * How much of `a` is covered by `b`, 0 to 1.
 *
 * Used to decide whether a proposed shot is really a different shot.
 */
export function overlapFraction(a: Rect, b: Rect): number {
  if (!rectsOverlap(a, b)) return 0;
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  const area = a.w * a.h;
  if (area <= 0) return 0;
  return Math.max(0, Math.min(1, (w * h) / area));
}

/** True when moving from `current` to `next` is worth doing to the audience. */
export function worthMoving(current: Rect, next: Rect): boolean {
  // Both directions: a shot that zooms right in on part of what is already up
  // covers the old one completely but is still a different shot.
  return (
    overlapFraction(current, next) < RESTFUL_OVERLAP ||
    overlapFraction(next, current) < RESTFUL_OVERLAP
  );
}

/**
 * The settling rule, as a small state machine.
 *
 * Kept separate from the store so the timing can be tested without waiting in
 * real seconds for anything.
 */
export class AutoFramer {
  private pendingId: string | null = null;
  private pendingSince = 0;
  private committedId: string | null = null;

  constructor(private readonly settleMs: number = SETTLE_MS) {}

  /** What the shot is currently held on, if anything. */
  get holding(): string | null {
    return this.committedId;
  }

  /**
   * Offer a target. Returns it only once it has settled and is worth a move.
   *
   * `now` is passed in rather than read, so tests do not sleep.
   */
  offer(target: AutoFrameTarget | null, currentStage: Rect, now: number): AutoFrameTarget | null {
    if (!target) {
      // Nothing to follow: forget what was pending, but keep holding the shot.
      this.pendingId = null;
      return null;
    }

    const key = `${target.tileId}|${Math.round(target.rect.x)},${Math.round(target.rect.y)},${Math.round(target.rect.w)}`;
    if (key !== this.pendingId) {
      this.pendingId = key;
      this.pendingSince = now;
      return null;
    }
    if (now - this.pendingSince < this.settleMs) return null;
    if (key === this.committedId) return null;
    if (!worthMoving(currentStage, target.rect)) {
      // Close enough to what is already on air. Treat it as committed so the
      // same target is not reconsidered every tick.
      this.committedId = key;
      return null;
    }

    this.committedId = key;
    return target;
  }

  /** Called when the operator takes the stage back by hand. */
  reset(): void {
    this.pendingId = null;
    this.committedId = null;
  }
}
