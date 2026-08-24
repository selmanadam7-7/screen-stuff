/**
 * Showing the audience where you are pointing, and letting you punch in on it.
 *
 * Both come from the same fact: on a four-monitor board zoomed out to fit, your
 * cursor is about two pixels wide in the output. "It's right there" is the most
 * repeated sentence on any screen share, and it is the app's fault.
 *
 * Two answers, from one piece of information:
 *
 *   * **The spotlight** draws a soft ring where the cursor is, and a ripple
 *     when you click, on the output only. The operator already knows where
 *     their own mouse is; drawing it in the cockpit would be noise.
 *   * **The punch-in** flies the stage to a tight shot around the cursor while
 *     a key is held, and back when it is let go. Sharp rather than upscaled,
 *     because the capture ladder re-requests resolution by on-screen size.
 */

import type { BoardDoc, Rect, Tile } from "./types";
import { fitAspect } from "./geometry";
import { contentPointToBoard } from "./tilebox";

/** Where the pointer is on the desk, and whether a button is down. */
export interface Cursor {
  x: number;
  y: number;
  down: boolean;
}

/** A monitor as the engine reports it, in desktop pixels. */
export interface MonitorBounds {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** How wide a punched-in shot is, as a fraction of the monitor it is on. */
export const PUNCH_FRACTION = 0.28;

/** How long a click ripple lives. */
export const RIPPLE_MS = 620;

/** The source id a tile captures, or null. */
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
 * Where the cursor is *on the board*, given where it is on the desk.
 *
 * Returns null when the cursor is over something that is not on the board,
 * which is most of the time and is exactly when nothing should be drawn.
 */
export function cursorOnBoard(
  doc: BoardDoc,
  cursor: Cursor | null,
  monitors: MonitorBounds[],
): { x: number; y: number; tile: Tile } | null {
  if (!cursor) return null;
  const monitor = monitors.find(
    (m) =>
      cursor.x >= m.x && cursor.x < m.x + m.width && cursor.y >= m.y && cursor.y < m.y + m.height,
  );
  if (!monitor) return null;

  const tile = doc.tiles.find((t) => {
    const source = sourceOf(t);
    return !t.hidden && source && monitorOf(source) === monitor.id;
  });
  if (!tile || monitor.width <= 0 || monitor.height <= 0) return null;

  // Through the tile's *content* rectangle rather than its box. A source tile
  // has a title bar above the picture and letterboxing beside it, so mapping
  // into the box put the ring low and slightly adrift -- which on a shared
  // screen reads as the app pointing at the wrong thing.
  const at = contentPointToBoard(tile, {
    x: (cursor.x - monitor.x) / monitor.width,
    y: (cursor.y - monitor.y) / monitor.height,
  });
  return { x: at.x, y: at.y, tile };
}

/**
 * A tight shot around the cursor, at the output shape.
 *
 * Sized from the monitor rather than the tile, so punching in on a 4K display
 * and on a 1080p one show a comparable amount of desk.
 */
export function punchRect(
  doc: BoardDoc,
  cursor: Cursor | null,
  monitors: MonitorBounds[],
): Rect | null {
  const at = cursorOnBoard(doc, cursor, monitors);
  if (!at) return null;
  // Built at the output shape directly. Building a square and fitting it grows
  // the width -- fitAspect grows the short side -- and PUNCH_FRACTION would
  // quietly mean half the screen instead of the quarter it says.
  const width = at.tile.w * PUNCH_FRACTION;
  const height = width / doc.aspect;
  const shot = fitAspect(
    { x: at.x - width / 2, y: at.y - height / 2, w: width, h: height },
    doc.aspect,
  );
  // Kept inside the tile, so a punch near an edge shows the edge rather than
  // half a shot of empty board.
  const x = Math.max(at.tile.x, Math.min(at.tile.x + at.tile.w - shot.w, shot.x));
  const y = Math.max(at.tile.y, Math.min(at.tile.y + at.tile.h - shot.h, shot.y));
  return { ...shot, x, y };
}

/** A click, remembered long enough to draw a ripple for it. */
export interface Ripple {
  x: number;
  y: number;
  at: number;
}

/**
 * Turns a stream of cursor samples into ripples.
 *
 * Only the moment a button goes down counts. Holding it — dragging a window,
 * selecting text — should not machine-gun rings across the output.
 */
export class ClickRipples {
  private wasDown = false;
  private ripples: Ripple[] = [];

  /** Feed a sample. Returns true when it started a new ripple. */
  sample(at: { x: number; y: number } | null, down: boolean, now: number): boolean {
    const started = down && !this.wasDown && at !== null;
    this.wasDown = down;
    if (started && at) {
      this.ripples.push({ x: at.x, y: at.y, at: now });
      // A handful is plenty; anything older is invisible anyway.
      if (this.ripples.length > 6) this.ripples.shift();
    }
    return started;
  }

  /** The ripples still worth drawing, newest last. */
  live(now: number): Ripple[] {
    this.ripples = this.ripples.filter((r) => now - r.at < RIPPLE_MS);
    return this.ripples;
  }

  clear(): void {
    this.ripples = [];
    this.wasDown = false;
  }
}

/** How far through its life a ripple is, 0 to 1. */
export function rippleProgress(ripple: Ripple, now: number): number {
  return Math.max(0, Math.min(1, (now - ripple.at) / RIPPLE_MS));
}
