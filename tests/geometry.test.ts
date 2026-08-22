import { describe, expect, it } from "vitest";
import {
  boundingRect,
  containsPoint,
  distanceToSegment,
  fitAspect,
  fitInto,
  frameFor,
  gridLayout,
  lerpRect,
  rectsOverlap,
  rotatePoint,
  screenToBoard,
  simplifyPoints,
  snapToNeighbours,
  tileAt,
  tileContains,
  zoomAround,
  ZOOM_LIMITS,
} from "../src/core/geometry";
import { makeNoteTile, makeSourceTile } from "../src/core/doc";
import type { Rect, Tile } from "../src/core/types";

const r = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

describe("rectangles", () => {
  it("finds the box around several rectangles", () => {
    expect(boundingRect([r(0, 0, 10, 10), r(20, 5, 10, 10)])).toEqual(r(0, 0, 30, 15));
  });

  it("returns null for nothing at all", () => {
    expect(boundingRect([])).toBeNull();
  });

  it("knows overlap from adjacency", () => {
    expect(rectsOverlap(r(0, 0, 10, 10), r(5, 5, 10, 10))).toBe(true);
    expect(rectsOverlap(r(0, 0, 10, 10), r(10, 0, 10, 10))).toBe(false);
  });

  it("tests point containment inclusively on the edge", () => {
    expect(containsPoint(r(0, 0, 10, 10), { x: 10, y: 10 })).toBe(true);
    expect(containsPoint(r(0, 0, 10, 10), { x: 10.1, y: 5 })).toBe(false);
  });
});

describe("aspect fitting", () => {
  it("grows rather than crops, so framing never cuts anything off", () => {
    // A square asked for 16:9 gets wider; it must not get shorter, or the
    // bottom of whatever you just framed would fall outside the shot.
    const fitted = fitAspect(r(0, 0, 100, 100), 16 / 9);
    expect(fitted.h).toBe(100);
    expect(fitted.w).toBeCloseTo(177.78, 1);
    expect(fitted.w).toBeGreaterThanOrEqual(100);
    // The centre must not move — that is what makes framing feel stable.
    expect(fitted.x + fitted.w / 2).toBeCloseTo(50);
    expect(fitted.y + fitted.h / 2).toBeCloseTo(50);
  });

  it("grows height when the rectangle is too wide", () => {
    const fitted = fitAspect(r(0, 0, 400, 100), 16 / 9);
    expect(fitted.w).toBe(400);
    expect(fitted.h).toBeCloseTo(225);
  });

  it("grows width when the rectangle is too tall", () => {
    const fitted = fitAspect(r(0, 0, 50, 100), 16 / 9);
    expect(fitted.h).toBe(100);
    expect(fitted.w).toBeCloseTo(177.78, 1);
  });

  it("frames a target with padding and the right shape", () => {
    const framed = frameFor(r(0, 0, 160, 90), 16 / 9, 0.1);
    expect(framed.w / framed.h).toBeCloseTo(16 / 9);
    expect(framed.w).toBeGreaterThan(160);
  });

  it("contain letterboxes and cover overflows", () => {
    const box = r(0, 0, 100, 100);
    const contained = fitInto(box, 200, 100, "contain");
    expect(contained.w).toBe(100);
    expect(contained.h).toBe(50);

    const covered = fitInto(box, 200, 100, "cover");
    expect(covered.h).toBe(100);
    expect(covered.w).toBe(200);
  });

  it("survives content with no size", () => {
    expect(fitInto(r(0, 0, 10, 10), 0, 0, "contain")).toEqual(r(0, 0, 10, 10));
  });
});

describe("view transforms", () => {
  it("maps screen pixels back onto the board", () => {
    const view = r(100, 50, 200, 100);
    expect(screenToBoard({ x: 0, y: 0 }, view, 400, 200)).toEqual({ x: 100, y: 50 });
    expect(screenToBoard({ x: 400, y: 200 }, view, 400, 200)).toEqual({ x: 300, y: 150 });
  });

  it("keeps the anchor point still while zooming", () => {
    const view = r(0, 0, 1000, 500);
    const anchor = { x: 250, y: 125 };
    const zoomed = zoomAround(view, anchor, 2);
    // The anchor should sit at the same fraction across the view as before.
    const before = (anchor.x - view.x) / view.w;
    const after = (anchor.x - zoomed.x) / zoomed.w;
    expect(after).toBeCloseTo(before, 6);
    expect(zoomed.w).toBeCloseTo(500);
  });

  it("refuses to zoom past its limits", () => {
    const tiny = zoomAround(r(0, 0, 100, 50), { x: 50, y: 25 }, 1000);
    expect(tiny.w).toBeGreaterThanOrEqual(ZOOM_LIMITS.minWidth);
    const huge = zoomAround(r(0, 0, 100, 50), { x: 50, y: 25 }, 0.000001);
    expect(huge.w).toBeLessThanOrEqual(ZOOM_LIMITS.maxWidth);
  });

  it("eases between two frames and lands exactly", () => {
    const from = r(0, 0, 100, 100);
    const to = r(100, 100, 200, 200);
    expect(lerpRect(from, to, 0)).toEqual(from);
    expect(lerpRect(from, to, 1)).toEqual(to);
    const mid = lerpRect(from, to, 0.5);
    expect(mid.x).toBeCloseTo(50);
  });
});

describe("hit testing", () => {
  const tile = makeSourceTile("monitor:1", { x: 0, y: 0, w: 100, h: 100 });

  it("hits inside an unrotated tile", () => {
    expect(tileContains(tile, { x: 50, y: 50 })).toBe(true);
    expect(tileContains(tile, { x: 150, y: 50 })).toBe(false);
  });

  it("respects rotation", () => {
    const rotated = { ...tile, rotation: 45 } as Tile;
    // A corner of the unrotated box falls outside once the tile spins.
    expect(tileContains(rotated, { x: 2, y: 2 })).toBe(false);
    expect(tileContains(rotated, { x: 50, y: 50 })).toBe(true);
  });

  it("rotates a point about a centre", () => {
    const p = rotatePoint({ x: 1, y: 0 }, { x: 0, y: 0 }, 90);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(1);
  });

  it("picks the topmost tile and skips locked and hidden ones", () => {
    const bottom = { ...makeNoteTile("under"), x: 0, y: 0, w: 100, h: 100, z: 1 } as Tile;
    const top = { ...makeNoteTile("over"), x: 0, y: 0, w: 100, h: 100, z: 5 } as Tile;
    expect(tileAt([bottom, top], { x: 50, y: 50 })?.id).toBe(top.id);

    const lockedTop = { ...top, locked: true } as Tile;
    expect(tileAt([bottom, lockedTop], { x: 50, y: 50 })?.id).toBe(bottom.id);
    expect(tileAt([bottom, lockedTop], { x: 50, y: 50 }, true)?.id).toBe(lockedTop.id);

    const hiddenTop = { ...top, hidden: true } as Tile;
    expect(tileAt([bottom, hiddenTop], { x: 50, y: 50 })?.id).toBe(bottom.id);
  });

  it("returns nothing when the point is empty", () => {
    expect(tileAt([tile], { x: 900, y: 900 })).toBeNull();
  });
});

describe("snapping", () => {
  it("snaps to a neighbour's edge and reports the guide", () => {
    const moving = r(98, 0, 50, 50);
    const result = snapToNeighbours(moving, [r(0, 0, 100, 50)], 6);
    expect(result.x).toBe(100);
    expect(result.guides.vertical).toContain(100);
  });

  it("leaves the position alone when nothing is close", () => {
    const moving = r(500, 500, 50, 50);
    const result = snapToNeighbours(moving, [r(0, 0, 100, 50)], 6);
    expect(result.x).toBe(500);
    expect(result.guides.vertical).toHaveLength(0);
  });

  it("snaps centres to centres, not just edges", () => {
    // Moving tile's centre is at 122; the neighbour's centre is at 125.
    const result = snapToNeighbours(r(97, 0, 50, 20), [r(100, 0, 50, 20)], 6);
    expect(result.x).toBe(100);
  });
});

describe("grid layout", () => {
  it("lays four 16:9 tiles into two rows of two", () => {
    const slots = gridLayout(4, r(0, 0, 1000, 1000), 16 / 9, 10);
    expect(slots).toHaveLength(4);
    expect(slots[0].y).toBeLessThan(slots[2].y);
    expect(slots[0].x).toBeLessThan(slots[1].x);
    // Every slot is the same size.
    for (const slot of slots) {
      expect(slot.w).toBeCloseTo(slots[0].w);
      expect(slot.w / slot.h).toBeCloseTo(16 / 9);
    }
  });

  it("centres a short final row", () => {
    const slots = gridLayout(3, r(0, 0, 1000, 1000), 16 / 9, 10);
    expect(slots).toHaveLength(3);
    // Row two holds one tile, and it should sit between the two above it.
    const centreOfLast = slots[2].x + slots[2].w / 2;
    const centreOfRowAbove = (slots[0].x + slots[1].x + slots[1].w) / 2;
    expect(centreOfLast).toBeCloseTo(centreOfRowAbove, 0);
  });

  it("returns nothing for nothing", () => {
    expect(gridLayout(0, r(0, 0, 100, 100), 1, 0)).toEqual([]);
  });

  it("stays inside the box it was given", () => {
    const into = r(50, 50, 800, 400);
    for (const slot of gridLayout(5, into, 16 / 9, 12)) {
      expect(slot.x).toBeGreaterThanOrEqual(into.x - 0.01);
      expect(slot.y).toBeGreaterThanOrEqual(into.y - 0.01);
      expect(slot.x + slot.w).toBeLessThanOrEqual(into.x + into.w + 0.01);
      expect(slot.y + slot.h).toBeLessThanOrEqual(into.y + into.h + 0.01);
    }
  });
});

describe("ink helpers", () => {
  it("measures distance to a segment, including past its ends", () => {
    expect(distanceToSegment({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
    expect(distanceToSegment({ x: -5, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
    expect(distanceToSegment({ x: 5, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 0 })).toBe(0);
  });

  it("drops points a straight line does not need", () => {
    const straight = [0, 0, 1, 0, 2, 0, 3, 0, 4, 0, 5, 0];
    expect(simplifyPoints(straight, 0.1)).toEqual([0, 0, 5, 0]);
  });

  it("keeps the points that carry the shape", () => {
    const zigzag = [0, 0, 5, 20, 10, 0, 15, 20, 20, 0];
    const simplified = simplifyPoints(zigzag, 1);
    expect(simplified.length).toBe(zigzag.length);
  });

  it("leaves very short strokes alone", () => {
    expect(simplifyPoints([0, 0, 1, 1], 5)).toEqual([0, 0, 1, 1]);
  });
});
