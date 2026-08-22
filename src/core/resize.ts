/**
 * Resize maths for tile handles.
 *
 * Pulled out of the editor because the rules here have real edge cases —
 * aspect locking on an edge handle behaves differently from a corner, and
 * resizing from the centre doubles the delta — and edge cases deserve tests.
 */

import { clamp } from "./geometry";
import type { Rect, Vec2 } from "./types";

export type HandleName = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

/** The eight handles, clockwise from the top-left. */
export const HANDLE_NAMES: HandleName[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export const CURSOR_FOR_HANDLE: Record<HandleName, string> = {
  nw: "nwse-resize",
  n: "ns-resize",
  ne: "nesw-resize",
  e: "ew-resize",
  se: "nwse-resize",
  s: "ns-resize",
  sw: "nesw-resize",
  w: "ew-resize",
};

/** Nothing may be resized smaller than this, in board units. */
export const MIN_TILE = 24;

export function resizeRect(
  original: Rect,
  handle: HandleName,
  delta: Vec2,
  options: { keepAspect: boolean; fromCenter: boolean },
): Rect {
  const aspect = original.w / Math.max(1, original.h);
  let { x, y, w, h } = original;

  const west = handle.includes("w");
  const east = handle.includes("e");
  const north = handle.startsWith("n");
  const south = handle.startsWith("s");

  const scale = options.fromCenter ? 2 : 1;
  if (east) w = original.w + delta.x * scale;
  if (west) w = original.w - delta.x * scale;
  if (south) h = original.h + delta.y * scale;
  if (north) h = original.h - delta.y * scale;

  const MIN = MIN_TILE;
  w = Math.max(MIN, w);
  h = Math.max(MIN, h);

  if (options.keepAspect) {
    // Corner handles follow whichever axis moved further; edges drive the other.
    if ((east || west) && (north || south)) {
      if (Math.abs(w / aspect - h) > 0.001) h = w / aspect;
    } else if (east || west) {
      h = w / aspect;
    } else {
      w = h * aspect;
    }
  }

  if (options.fromCenter) {
    const center = { x: original.x + original.w / 2, y: original.y + original.h / 2 };
    return { x: center.x - w / 2, y: center.y - h / 2, w, h };
  }

  if (west) x = original.x + original.w - w;
  if (north) y = original.y + original.h - h;
  // Edge handles keep the opposite edge pinned; aspect-locked ones re-centre the free axis.
  if (options.keepAspect && (east || west) && !north && !south) {
    y = original.y + (original.h - h) / 2;
  }
  if (options.keepAspect && (north || south) && !east && !west) {
    x = original.x + (original.w - w) / 2;
  }

  return { x, y, w: clamp(w, MIN, 200000), h: clamp(h, MIN, 200000) };
}
