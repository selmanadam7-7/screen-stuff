/**
 * Arranging tiles into a shot that looks composed.
 *
 * A grid is the honest default and the wrong answer most of the time. Four
 * equal boxes says everything on screen matters equally, which is almost never
 * true: usually one thing is what you are talking about and the rest is
 * context. These are the three shapes that come up over and over in anything
 * produced, and they take one click instead of a minute of dragging.
 *
 * All of them lay out inside the stage, in board space, and leave the tiles as
 * tiles — nothing here is a special mode. You can grab any of them afterwards
 * and nudge it, and nothing snaps back.
 */

import { gridLayout } from "./geometry";
import type { BoardDoc, Rect, Tile } from "./types";

export type LayoutKind = "grid" | "two-up" | "focus" | "pip";

export const LAYOUTS: Array<{ kind: LayoutKind; label: string; hint: string; min: number }> = [
  { kind: "grid", label: "Even grid", hint: "Everything the same size.", min: 1 },
  { kind: "two-up", label: "Two up", hint: "Side by side, equal weight.", min: 2 },
  {
    kind: "focus",
    label: "Focus and strip",
    hint: "One big, the rest along the bottom.",
    min: 2,
  },
  { kind: "pip", label: "Picture in picture", hint: "One full, one in the corner.", min: 2 },
];

/** Which layouts make sense for this many tiles. */
export function layoutsFor(count: number): LayoutKind[] {
  return LAYOUTS.filter((l) => count >= l.min).map((l) => l.kind);
}

/** Fit a box of `aspect` inside `into`, centred. */
function fitBox(into: Rect, aspect: number): Rect {
  const byWidth = into.w / aspect;
  const w = byWidth <= into.h ? into.w : into.h * aspect;
  const h = w / aspect;
  return { x: into.x + (into.w - w) / 2, y: into.y + (into.h - h) / 2, w, h };
}

const aspectOf = (tile: Tile) => tile.w / Math.max(1, tile.h);

/**
 * Where each tile goes, in the order given.
 *
 * The first tile is the important one in every layout that has a hierarchy —
 * so "make this the big one" is "select it first", with no extra concept.
 */
export function slotsFor(
  kind: LayoutKind,
  tiles: Tile[],
  stage: Rect,
  gap: number,
): Rect[] {
  const inner: Rect = {
    x: stage.x + gap,
    y: stage.y + gap,
    w: stage.w - gap * 2,
    h: stage.h - gap * 2,
  };
  if (tiles.length === 0 || inner.w <= 0 || inner.h <= 0) return [];

  switch (kind) {
    case "two-up": {
      // Two columns, rows as needed. Laying them out in one row put the third
      // tile off the side of the stage, and silently dropping the extras would
      // be worse than showing them small.
      const half = (inner.w - gap) / 2;
      const rows = Math.ceil(tiles.length / 2);
      const rowHeight = (inner.h - gap * (rows - 1)) / rows;
      return tiles.map((tile, i) =>
        fitBox(
          {
            x: inner.x + (i % 2) * (half + gap),
            y: inner.y + Math.floor(i / 2) * (rowHeight + gap),
            w: half,
            h: rowHeight,
          },
          aspectOf(tile),
        ),
      );
    }

    case "focus": {
      if (tiles.length === 1) return [fitBox(inner, aspectOf(tiles[0]))];
      // The strip takes a quarter of the height, which leaves the hero big
      // enough to actually read and the strip big enough to recognise.
      const stripHeight = inner.h * 0.24;
      const heroBox: Rect = { ...inner, h: inner.h - stripHeight - gap };
      const hero = fitBox(heroBox, aspectOf(tiles[0]));

      const rest = tiles.slice(1);
      const cellWidth = (inner.w - gap * (rest.length - 1)) / rest.length;
      const strip = rest.map((tile, i) =>
        fitBox(
          {
            x: inner.x + i * (cellWidth + gap),
            y: inner.y + inner.h - stripHeight,
            w: cellWidth,
            h: stripHeight,
          },
          aspectOf(tile),
        ),
      );
      return [hero, ...strip];
    }

    case "pip": {
      const full = fitBox(inner, aspectOf(tiles[0]));
      const rest = tiles.slice(1);
      const inset = inner.h * 0.04;
      const pipHeight = inner.h * 0.26;
      // Stacked up the right edge, so a third and fourth tile do not overlap
      // the second — the common failure of every hand-made picture-in-picture.
      return [
        full,
        ...rest.map((tile, i) => {
          const h = pipHeight;
          const w = h * aspectOf(tile);
          return {
            x: inner.x + inner.w - inset - w,
            y: inner.y + inset + i * (h + inset),
            w,
            h,
          };
        }),
      ];
    }

    case "grid":
    default: {
      const aspect =
        tiles.reduce((sum, t) => sum + aspectOf(t), 0) / tiles.length;
      return gridLayout(tiles.length, inner, aspect, gap);
    }
  }
}

/** Apply a layout to the given tiles, in the order given. */
export function applyLayout(
  doc: BoardDoc,
  ids: string[],
  kind: LayoutKind,
  gap = 24,
): BoardDoc {
  // Ordered by the caller's list, not by document order: the first id is the
  // hero, and that is how the operator says which one matters.
  const ordered = ids
    .map((id) => doc.tiles.find((t) => t.id === id))
    .filter((t): t is Tile => Boolean(t));
  if (ordered.length === 0) return doc;

  const slots = slotsFor(kind, ordered, doc.frame, gap);
  const byId = new Map(ordered.map((t, i) => [t.id, slots[i]]));

  return {
    ...doc,
    tiles: doc.tiles.map((tile) => {
      const slot = byId.get(tile.id);
      if (!slot) return tile;
      return { ...tile, x: slot.x, y: slot.y, w: slot.w, h: slot.h, rotation: 0 };
    }),
  };
}
