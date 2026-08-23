/**
 * Layout presets.
 *
 * A grid says everything on screen matters equally, which is almost never true.
 * These are the shapes with a hierarchy, so the tests are mostly about that
 * hierarchy holding: the first tile is the big one, and nothing overlaps or
 * escapes the stage.
 */

import { describe, expect, it } from "vitest";
import { emptyBoard, makeSourceTile } from "../src/core/doc";
import { LAYOUTS, applyLayout, layoutsFor, slotsFor, type LayoutKind } from "../src/core/layouts";
import type { BoardDoc, Rect, Tile } from "../src/core/types";

const STAGE: Rect = { x: 0, y: 0, w: 1920, h: 1080 };

const screens = (n: number): Tile[] =>
  Array.from({ length: n }, (_, i) => makeSourceTile(`monitor:${i + 1}`, { w: 1600, h: 900 }) as Tile);

const inside = (slot: Rect, stage: Rect) =>
  slot.x >= stage.x - 1 &&
  slot.y >= stage.y - 1 &&
  slot.x + slot.w <= stage.x + stage.w + 1 &&
  slot.y + slot.h <= stage.y + stage.h + 1;

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1;

const KINDS: LayoutKind[] = ["grid", "two-up", "focus", "pip"];

describe("every layout", () => {
  for (const kind of KINDS) {
    it(`${kind}: keeps every tile inside the stage`, () => {
      const slots = slotsFor(kind, screens(4), STAGE, 24);
      expect(slots).toHaveLength(4);
      for (const slot of slots) expect(inside(slot, STAGE), JSON.stringify(slot)).toBe(true);
    });

    it(`${kind}: gives every tile a real size`, () => {
      for (const slot of slotsFor(kind, screens(3), STAGE, 24)) {
        expect(slot.w).toBeGreaterThan(0);
        expect(slot.h).toBeGreaterThan(0);
      }
    });

    it(`${kind}: copes with a single tile`, () => {
      expect(slotsFor(kind, screens(1), STAGE, 24)).toHaveLength(1);
    });

    it(`${kind}: copes with no tiles at all`, () => {
      expect(slotsFor(kind, [], STAGE, 24)).toEqual([]);
    });
  }
});

describe("the hierarchy", () => {
  it("focus makes the first tile much bigger than the rest", () => {
    const [hero, ...strip] = slotsFor("focus", screens(4), STAGE, 24);
    for (const small of strip) {
      expect(hero.w * hero.h).toBeGreaterThan(small.w * small.h * 4);
    }
  });

  it("focus puts the strip along the bottom, below the hero", () => {
    const [hero, ...strip] = slotsFor("focus", screens(3), STAGE, 24);
    for (const small of strip) expect(small.y).toBeGreaterThan(hero.y);
  });

  it("picture in picture stacks the small ones instead of piling them up", () => {
    // The common failure of every hand-made PiP: the third one lands on the
    // second.
    const [, ...pips] = slotsFor("pip", screens(4), STAGE, 24);
    for (let i = 0; i < pips.length; i++) {
      for (let j = i + 1; j < pips.length; j++) {
        expect(overlaps(pips[i], pips[j]), `pip ${i} and ${j}`).toBe(false);
      }
    }
  });

  it("picture in picture puts the small ones in a corner, not the middle", () => {
    const [full, pip] = slotsFor("pip", screens(2), STAGE, 24);
    expect(pip.x + pip.w).toBeGreaterThan(full.x + full.w * 0.6);
    expect(pip.w).toBeLessThan(full.w * 0.5);
  });

  it("two up puts them side by side without touching", () => {
    const [left, right] = slotsFor("two-up", screens(2), STAGE, 24);
    expect(right.x).toBeGreaterThan(left.x);
    expect(overlaps(left, right)).toBe(false);
  });
});

describe("applying one", () => {
  const doc = (): BoardDoc => ({ ...emptyBoard(), tiles: screens(3) });

  it("moves the tiles it is given and leaves the rest alone", () => {
    const d = doc();
    const untouched = { ...d.tiles[2] };
    const after = applyLayout(d, [d.tiles[0].id, d.tiles[1].id], "two-up");
    expect(after.tiles[2]).toEqual(untouched);
    expect(after.tiles[0].x).not.toBe(d.tiles[0].x);
  });

  it("treats the first id as the hero, so selection order decides", () => {
    const d = doc();
    const [a, b, c] = d.tiles;
    const heroIsB = applyLayout(d, [b.id, a.id, c.id], "focus");
    const bSlot = heroIsB.tiles.find((t) => t.id === b.id)!;
    const aSlot = heroIsB.tiles.find((t) => t.id === a.id)!;
    expect(bSlot.w * bSlot.h).toBeGreaterThan(aSlot.w * aSlot.h);
  });

  it("straightens anything that had been rotated", () => {
    const d = doc();
    d.tiles[0] = { ...d.tiles[0], rotation: 12 };
    expect(applyLayout(d, [d.tiles[0].id], "grid").tiles[0].rotation).toBe(0);
  });

  it("does nothing when given ids that are not on the board", () => {
    const d = doc();
    expect(applyLayout(d, ["nope"], "grid")).toBe(d);
  });
});

describe("offering the right ones", () => {
  it("only offers layouts that need fewer tiles than there are", () => {
    expect(layoutsFor(1)).toEqual(["grid"]);
    expect(layoutsFor(2)).toEqual(["grid", "two-up", "focus", "pip"]);
  });

  it("every layout explains itself", () => {
    for (const l of LAYOUTS) {
      expect(l.label.length, l.kind).toBeGreaterThan(0);
      expect(l.hint.length, l.kind).toBeGreaterThan(0);
    }
  });
});
