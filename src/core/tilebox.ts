/**
 * Where a tile's *content* actually is.
 *
 * A tile's box is not where its picture ends up, and two features got that
 * wrong in the same way. A source tile is drawn as a window: a title bar takes
 * the top of the box, and the captured pixels are then fitted into what is
 * left, which letterboxes them whenever the tile's proportions and the source's
 * do not agree — and after the bar is taken off the top, they never do.
 *
 * So there are three rectangles, and only the last one is the picture:
 *
 *   box     the tile as positioned on the board
 *   body    the box minus the title bar
 *   content the source's pixels, fitted into the body
 *
 * The pointer ring was placed against the box, so it sat low by the height of a
 * title bar and drifted further the wider the letterboxing got. Redactions were
 * *stored* against the box and *drawn* against the body, so a rectangle drawn
 * over an API key covered something above it instead — a promise about privacy
 * that quietly did not hold.
 *
 * Everything that maps between a point on someone's screen and a point on the
 * board goes through here, so those two can never drift apart again.
 */

import { clamp, fitInto, tileRect } from "./geometry";
import type { Rect, Tile } from "./types";

/** Height of a tile's title bar, in board units, before zoom is applied. */
export const TILE_BAR = 34;

/** Tiles that read as a window and get a title bar drawn above their content. */
const WINDOWED: ReadonlySet<string> = new Set(["source", "web", "video", "pdf"]);

export function hasTitleBar(tile: Tile): boolean {
  return WINDOWED.has(tile.kind);
}

/** How tall this tile's title bar is. Zero for tiles that do not have one. */
export function titleBarHeight(tile: Tile): number {
  // The same clamp the renderer uses: on a very short tile a fixed bar would
  // be most of the tile.
  return hasTitleBar(tile) ? Math.min(TILE_BAR, tile.h * 0.16) : 0;
}

/** The box minus the title bar: everything that is not chrome. */
export function tileBody(tile: Tile): Rect {
  const box = tileRect(tile);
  const bar = titleBarHeight(tile);
  return { x: box.x, y: box.y + bar, w: box.w, h: box.h - bar };
}

/** What a tile knows about the shape of the thing it is showing. */
export function naturalSize(tile: Tile): { width: number; height: number } | null {
  if (tile.kind === "source" && tile.nativeW && tile.nativeH) {
    return { width: tile.nativeW, height: tile.nativeH };
  }
  if (tile.kind === "image" && tile.naturalW && tile.naturalH) {
    return { width: tile.naturalW, height: tile.naturalH };
  }
  return null;
}

/**
 * The board-space rectangle a tile's picture is drawn into.
 *
 * `natural` overrides what the tile knows, for callers that have the live
 * frame — a source tile learns its true size from the first frame, and until
 * one arrives the body is the best answer available.
 */
export function contentRect(
  tile: Tile,
  natural?: { width: number; height: number } | null,
): Rect {
  const body = tileBody(tile);
  const size = natural ?? naturalSize(tile);
  if (!size || size.width <= 0 || size.height <= 0) return body;
  return fitInto(body, size.width, size.height, tile.fit);
}

/**
 * A point on the source, as a fraction of it, from a point on the board.
 *
 * Outside the content — in the title bar, or in the letterboxing beside it —
 * returns null rather than a number off the end, because "just outside the
 * picture" and "at the edge of the picture" are different answers and only one
 * of them is true.
 */
export function pointInContent(
  tile: Tile,
  point: { x: number; y: number },
  natural?: { width: number; height: number } | null,
): { x: number; y: number } | null {
  const content = contentRect(tile, natural);
  if (content.w <= 0 || content.h <= 0) return null;
  const x = (point.x - content.x) / content.w;
  const y = (point.y - content.y) / content.h;
  // A hair of tolerance, then clamped. The edge of the picture is *on* the
  // picture: dragging a redaction to the very edge is the normal way to cover
  // a sidebar, and floating point makes "exactly 1" land at 1.0000000002.
  const slack = 1e-6;
  if (x < -slack || x > 1 + slack || y < -slack || y > 1 + slack) return null;
  return { x: clamp(x, 0, 1), y: clamp(y, 0, 1) };
}

/** And back: a fraction of the source, as a point on the board. */
export function contentPointToBoard(
  tile: Tile,
  fraction: { x: number; y: number },
  natural?: { width: number; height: number } | null,
): { x: number; y: number } {
  const content = contentRect(tile, natural);
  return { x: content.x + fraction.x * content.w, y: content.y + fraction.y * content.h };
}
