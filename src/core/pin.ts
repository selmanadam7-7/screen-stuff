/**
 * Tiles parked in a corner of the shot.
 *
 * The problem this solves: with auto-framing on, the stage follows your work
 * between monitors, and your camera — sitting at a fixed spot on the board —
 * gets left behind. You end up on a call where your face is on screen only
 * while you happen to be working on the monitor it was parked on.
 *
 * A pinned tile has no fixed place on the board. Its position is *derived* from
 * wherever the stage currently is, every frame, so it rides along: auto-framing,
 * a scene, a punch-in, a take, a drag of the stage handles. Anything that moves
 * the shot brings it with it.
 *
 * Derived rather than stored, and that is the whole design. Writing the new
 * position into the document on every stage change would fill the undo stack
 * with camera moves nobody made, and — worse — during a fly the camera would
 * jump to the destination while the shot was still travelling. Computing it
 * from the *animated* frame means it flies with the shot instead.
 */

import { clamp } from "./geometry";
import type { BoardDoc, Rect, Tile } from "./types";

export type PinCorner = "tl" | "tr" | "bl" | "br";

export interface Pin {
  corner: PinCorner;
  /** Width, as a fraction of the stage width. */
  size: number;
  /** Gap from the stage edges, as a fraction of the stage width. */
  margin: number;
}

/**
 * Big enough to read a face, small enough to leave the work visible.
 *
 * Bottom-right because that is where a webcam sits in every broadcast anyone
 * has ever watched, and because the top of a shot is where windows keep their
 * title bars and tabs.
 */
export const DEFAULT_PIN: Pin = { corner: "br", size: 0.22, margin: 0.03 };

/** Below this a face is a smudge; above it the tile is the shot. */
export const MIN_SIZE = 0.08;
export const MAX_SIZE = 0.5;
export const MAX_MARGIN = 0.2;

export const CORNERS: Array<{ value: PinCorner; label: string }> = [
  { value: "tl", label: "Top left" },
  { value: "tr", label: "Top right" },
  { value: "bl", label: "Bottom left" },
  { value: "br", label: "Bottom right" },
];

/** A pin with anything out of range brought back into it. */
export function normalisePin(pin: Pin): Pin {
  return {
    corner: CORNERS.some((c) => c.value === pin.corner) ? pin.corner : DEFAULT_PIN.corner,
    size: clamp(Number.isFinite(pin.size) ? pin.size : DEFAULT_PIN.size, MIN_SIZE, MAX_SIZE),
    margin: clamp(
      Number.isFinite(pin.margin) ? pin.margin : DEFAULT_PIN.margin,
      0,
      MAX_MARGIN,
    ),
  };
}

/**
 * Where a pinned tile sits, given where the shot is.
 *
 * `aspect` is the tile's own width over height, so a circular camera stays
 * circular and a tall phone capture stays tall. Both are measured against the
 * stage *width*, so the tile keeps the same apparent size whatever shape the
 * stage is.
 */
export function pinnedRect(stage: Rect, pin: Pin, aspect: number): Rect {
  const safe = normalisePin(pin);
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
  const w = stage.w * safe.size;
  const h = w / ratio;
  const gap = stage.w * safe.margin;

  const left = stage.x + gap;
  const right = stage.x + stage.w - gap - w;
  const top = stage.y + gap;
  const bottom = stage.y + stage.h - gap - h;

  switch (safe.corner) {
    case "tl":
      return { x: left, y: top, w, h };
    case "tr":
      return { x: right, y: top, w, h };
    case "bl":
      return { x: left, y: bottom, w, h };
    default:
      return { x: right, y: bottom, w, h };
  }
}

/** Whether anything in this document is pinned. Cheap enough to ask per frame. */
export const hasPins = (doc: BoardDoc): boolean => doc.tiles.some((t) => t.pin);

/**
 * The document as it should be drawn, with every pinned tile moved into place.
 *
 * Idempotent: pinning is computed from the stage, never from where the tile
 * already is, so applying this twice is the same as applying it once. That
 * matters because the renderer does it and a caller may have done it too.
 *
 * Returns the original document untouched when nothing is pinned, so the
 * common case allocates nothing and reference equality still holds for anything
 * downstream that memoises on it.
 */
export function applyPins(doc: BoardDoc, stage: Rect): BoardDoc {
  if (!hasPins(doc)) return doc;
  const tiles = doc.tiles.map((tile) => {
    if (!tile.pin) return tile;
    // The tile's own proportions, from its stored box. A tile that has never
    // had a size falls back to the stage's shape rather than dividing by zero.
    const aspect = tile.h > 0 ? tile.w / tile.h : stage.w / Math.max(1, stage.h);
    return { ...tile, ...pinnedRect(stage, tile.pin, aspect) } as Tile;
  });
  return { ...doc, tiles };
}

/**
 * Pinning brings a tile to the front.
 *
 * A picture-in-picture behind the picture is not a picture-in-picture, and
 * discovering that by pinning a camera and seeing nothing happen is a bad first
 * five seconds with the feature.
 */
export function pinTile(doc: BoardDoc, id: string, pin: Pin | null): BoardDoc {
  const top = doc.tiles.reduce((z, t) => Math.max(z, t.z), 0) + 1;
  return {
    ...doc,
    tiles: doc.tiles.map((t) =>
      t.id === id
        ? ({ ...t, pin: pin ? normalisePin(pin) : null, z: pin ? top : t.z } as Tile)
        : t,
    ),
  };
}

/** The corner a point falls in, for dropping a tile into one. */
export function cornerAt(stage: Rect, point: { x: number; y: number }): PinCorner {
  const right = point.x > stage.x + stage.w / 2;
  const below = point.y > stage.y + stage.h / 2;
  if (below) return right ? "br" : "bl";
  return right ? "tr" : "tl";
}
