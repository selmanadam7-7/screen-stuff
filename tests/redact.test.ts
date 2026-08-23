/**
 * Never-shared regions.
 *
 * The whole value is that the promise holds. So the tests are mostly about the
 * ways a rectangle could quietly stop covering what it was drawn over: the tile
 * moving, the tile resizing, the capture changing resolution, the board being
 * saved and reopened, or a malformed file loading a redaction that does nothing.
 */

import { describe, expect, it } from "vitest";
import {
  addRedaction,
  clearRedactions,
  emptyBoard,
  makeSourceTile,
  removeRedaction,
  reviveBoard,
  updateTile,
} from "../src/core/doc";
import {
  boardHasRedactions,
  countRedactions,
  describeRedaction,
  redactionsOf,
  toBoardRect,
  toTileFraction,
  type Redaction,
} from "../src/core/redact";
import type { BoardDoc, Tile } from "../src/core/types";

const tile = () => makeSourceTile("monitor:1", { x: 100, y: 50, w: 800, h: 450 }) as Tile;

const region = (over: Partial<Redaction> = {}): Redaction => ({
  id: "r1",
  x: 0.5,
  y: 0,
  w: 0.5,
  h: 0.25,
  style: "solid",
  label: "the top right",
  ...over,
});

function withTile(t: Tile): BoardDoc {
  return { ...emptyBoard(), tiles: [t] };
}

describe("storing a region against a tile", () => {
  it("converts a board rectangle into fractions of the tile", () => {
    const t = tile();
    const f = toTileFraction(t, { x: 500, y: 50, w: 400, h: 112.5 })!;
    expect(f.x).toBeCloseTo(0.5);
    expect(f.y).toBeCloseTo(0);
    expect(f.w).toBeCloseTo(0.5);
    expect(f.h).toBeCloseTo(0.25);
  });

  it("survives the tile being moved", () => {
    const before = tile();
    const f = region();
    const rectBefore = toBoardRect(before, f);
    const moved = { ...before, x: before.x + 900, y: before.y - 300 } as Tile;
    const rectAfter = toBoardRect(moved, f);
    // Same place on the tile, wherever the tile went.
    expect(rectAfter.x - moved.x).toBeCloseTo(rectBefore.x - before.x);
    expect(rectAfter.w).toBeCloseTo(rectBefore.w);
  });

  it("survives the tile being resized", () => {
    const small = tile();
    const big = { ...small, w: small.w * 2, h: small.h * 2 } as Tile;
    const r = toBoardRect(big, region());
    // Still the top-right quarter-height half-width, just bigger.
    expect(r.w).toBeCloseTo(big.w * 0.5);
    expect(r.h).toBeCloseTo(big.h * 0.25);
    expect(r.x).toBeCloseTo(big.x + big.w * 0.5);
  });

  it("clamps a rectangle dragged past the edge of the tile", () => {
    const t = tile();
    const f = toTileFraction(t, { x: t.x - 500, y: t.y - 500, w: 2000, h: 2000 })!;
    expect(f.x).toBe(0);
    expect(f.y).toBe(0);
    expect(f.w).toBeCloseTo(1);
    expect(f.h).toBeCloseTo(1);
  });

  it("refuses a rectangle too small to be deliberate", () => {
    const t = tile();
    expect(toTileFraction(t, { x: 100, y: 50, w: 1, h: 1 })).toBeNull();
  });

  it("refuses a tile with no size rather than dividing by zero", () => {
    const flat = { ...tile(), w: 0, h: 0 } as Tile;
    expect(toTileFraction(flat, { x: 0, y: 0, w: 10, h: 10 })).toBeNull();
  });
});

describe("the document", () => {
  it("adds, removes and clears", () => {
    const t = tile();
    let doc = withTile(t);
    doc = addRedaction(doc, t.id, region());
    doc = addRedaction(doc, t.id, region({ id: "r2" }));
    expect(countRedactions(doc.tiles)).toBe(2);
    expect(boardHasRedactions(doc.tiles)).toBe(true);

    doc = removeRedaction(doc, t.id, "r1");
    expect(redactionsOf(doc.tiles[0]).map((r) => r.id)).toEqual(["r2"]);

    doc = clearRedactions(doc, t.id);
    expect(boardHasRedactions(doc.tiles)).toBe(false);
  });

  it("keeps them through a save and a reload", () => {
    const t = tile();
    const doc = addRedaction(withTile(t), t.id, region());
    const reloaded = reviveBoard(JSON.parse(JSON.stringify(doc)));
    expect(redactionsOf(reloaded.tiles[0])).toHaveLength(1);
    expect(redactionsOf(reloaded.tiles[0])[0].w).toBeCloseTo(0.5);
  });

  it("drops a malformed region rather than loading one that hides nothing", () => {
    const t = tile();
    const doc = withTile(t) as BoardDoc;
    const raw = JSON.parse(JSON.stringify(doc));
    raw.tiles[0].redactions = [
      region(),
      { id: "bad", x: "left", y: 0, w: 1, h: 1 },
      { x: 0, y: 0, w: 1, h: 1 },
      { id: "out", x: 0, y: 0, w: 4, h: 1 },
    ];
    const reloaded = reviveBoard(raw);
    expect(redactionsOf(reloaded.tiles[0]).map((r) => r.id)).toEqual(["r1"]);
  });

  it("does not disturb the rest of the tile", () => {
    const t = tile();
    let doc = addRedaction(withTile(t), t.id, region());
    doc = updateTile(doc, t.id, { x: 4000 });
    expect(doc.tiles[0].x).toBe(4000);
    expect(redactionsOf(doc.tiles[0])).toHaveLength(1);
  });
});

describe("naming a region", () => {
  it("describes where it is rather than numbering it", () => {
    expect(describeRedaction({ x: 0, y: 0, w: 1, h: 0.1 })).toBe("the top strip");
    expect(describeRedaction({ x: 0, y: 0.9, w: 1, h: 0.1 })).toBe("the bottom strip");
    expect(describeRedaction({ x: 0, y: 0, w: 0.15, h: 1 })).toBe("the left column");
    expect(describeRedaction({ x: 0.85, y: 0, w: 0.15, h: 1 })).toBe("the right column");
    expect(describeRedaction({ x: 0, y: 0, w: 1, h: 1 })).toBe("most of it");
    expect(describeRedaction({ x: 0.6, y: 0.6, w: 0.2, h: 0.2 })).toBe("the bottom right");
    expect(describeRedaction({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 })).toBe("the top left");
  });
});
