/**
 * Parts of a tile that are never shared.
 *
 * The reason to want this is mundane and constant: your Slack sidebar has
 * client names in it, your browser has a bookmarks bar, your terminal scrolled
 * an API key three commands ago. Today the answer is to close things before a
 * call and hope, or to not share that window at all.
 *
 * A redaction is a rectangle you draw once on a tile, and it is covered in the
 * output from then on — on the board, for every guest, in every scene, at every
 * zoom, whatever the window underneath does.
 *
 * Two decisions worth knowing:
 *
 *   * **Stored as fractions of the tile, not pixels.** The tile gets moved,
 *     resized, and re-tuned to a different capture resolution constantly. A
 *     rectangle in pixels would slide off the thing it was covering the first
 *     time any of that happened; a rectangle in proportions cannot.
 *   * **Solid by default, not blurred.** Blur looks better and is weaker: it is
 *     a reversible transform of the pixels underneath, and enough frames of a
 *     blurred region can reconstruct it. Blur is offered for the cases where it
 *     is about tidiness rather than secrecy, and the app says which is which.
 */

import type { Rect, Tile } from "./types";

/** A rectangle of a tile, in fractions of that tile's size. */
export interface Redaction {
  id: string;
  /** All four in 0..1, relative to the tile's own box. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** `solid` hides. `blur` tidies. They are not the same promise. */
  style: "solid" | "blur";
  /** What it is covering, for the list in the inspector. */
  label: string;
}

export const MIN_REDACTION = 0.01;

/** The redactions on a tile, or nothing. */
export function redactionsOf(tile: Tile): Redaction[] {
  return (tile as { redactions?: Redaction[] }).redactions ?? [];
}

/**
 * Turn a board-space rectangle into one stored against a tile.
 *
 * `basis` is the rectangle the fractions are measured against, and it is the
 * tile's *content* rather than its box: a source tile has a title bar above the
 * picture and letterboxing beside it, and a redaction covers the picture. This
 * took a rectangle when it took a whole tile, which is how it came to disagree
 * with the renderer about where the same redaction was.
 */
export function toTileFraction(
  basis: Rect,
  rect: Rect,
): Omit<Redaction, "id" | "style" | "label"> | null {
  if (basis.w <= 0 || basis.h <= 0) return null;
  const x = (rect.x - basis.x) / basis.w;
  const y = (rect.y - basis.y) / basis.h;
  const w = rect.w / basis.w;
  const h = rect.h / basis.h;
  if (w < MIN_REDACTION || h < MIN_REDACTION) return null;
  // Clamped to the tile: a redaction is a promise about this tile, and one that
  // hangs over the edge is covering something it does not own.
  const left = Math.max(0, Math.min(1, x));
  const top = Math.max(0, Math.min(1, y));
  const right = Math.max(0, Math.min(1, x + w));
  const bottom = Math.max(0, Math.min(1, y + h));
  if (right - left < MIN_REDACTION || bottom - top < MIN_REDACTION) return null;
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/**
 * And back again, for drawing and hit-testing.
 *
 * `basis` has no default any more. It used to fall back to the tile's box,
 * which is never right for a windowed tile, and a silent wrong answer is how
 * the storing side and the drawing side ended up measuring against different
 * rectangles without anything failing.
 */
export function toBoardRect(tile: Tile, redaction: Redaction, basis: Rect): Rect {
  void tile;
  const box = basis;
  return {
    x: box.x + redaction.x * box.w,
    y: box.y + redaction.y * box.h,
    w: redaction.w * box.w,
    h: redaction.h * box.h,
  };
}

/** True when anything on this board is being held back from the audience. */
export function boardHasRedactions(tiles: Tile[]): boolean {
  return tiles.some((tile) => redactionsOf(tile).length > 0);
}

export function countRedactions(tiles: Tile[]): number {
  return tiles.reduce((total, tile) => total + redactionsOf(tile).length, 0);
}

/**
 * A name for a new redaction, so the inspector list is readable.
 *
 * Positional rather than numbered: "the top strip" tells you what you covered
 * without having to hover it, and "Redaction 3" never does.
 */
export function describeRedaction(r: { x: number; y: number; w: number; h: number }): string {
  const wide = r.w > 0.75;
  const tall = r.h > 0.75;
  if (wide && tall) return "most of it";
  if (wide) return r.y < 0.25 ? "the top strip" : r.y + r.h > 0.75 ? "the bottom strip" : "a band across it";
  if (tall) return r.x < 0.25 ? "the left column" : r.x + r.w > 0.75 ? "the right column" : "a column";
  const vertical = r.y + r.h / 2 < 0.5 ? "top" : "bottom";
  const horizontal = r.x + r.w / 2 < 0.5 ? "left" : "right";
  return `the ${vertical} ${horizontal}`;
}
