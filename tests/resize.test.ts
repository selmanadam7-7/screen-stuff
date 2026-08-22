import { describe, expect, it } from "vitest";
import { HANDLE_NAMES, MIN_TILE, resizeRect } from "../src/core/resize";
import type { Rect } from "../src/core/types";

const start: Rect = { x: 100, y: 100, w: 400, h: 200 }; // 2:1
const free = { keepAspect: false, fromCenter: false };

describe("resize handles", () => {
  it("drags the east edge without moving the west one", () => {
    const next = resizeRect(start, "e", { x: 60, y: 0 }, free);
    expect(next.x).toBe(100);
    expect(next.w).toBe(460);
    expect(next.h).toBe(200);
  });

  it("drags the west edge and keeps the east one pinned", () => {
    const next = resizeRect(start, "w", { x: 50, y: 0 }, free);
    expect(next.x).toBe(150);
    expect(next.w).toBe(350);
    expect(next.x + next.w).toBe(start.x + start.w);
  });

  it("drags the north edge and keeps the south one pinned", () => {
    const next = resizeRect(start, "n", { x: 0, y: 40 }, free);
    expect(next.y).toBe(140);
    expect(next.y + next.h).toBe(start.y + start.h);
  });

  it("moves two edges at once from a corner", () => {
    const next = resizeRect(start, "se", { x: 100, y: 50 }, free);
    expect(next.w).toBe(500);
    expect(next.h).toBe(250);
    expect(next.x).toBe(100);
    expect(next.y).toBe(100);
  });

  it("never shrinks below the minimum", () => {
    for (const handle of HANDLE_NAMES) {
      const next = resizeRect(start, handle, { x: -9999, y: -9999 }, free);
      expect(next.w).toBeGreaterThanOrEqual(MIN_TILE);
      expect(next.h).toBeGreaterThanOrEqual(MIN_TILE);
    }
  });
});

describe("holding shift", () => {
  const locked = { keepAspect: true, fromCenter: false };

  it("keeps the aspect from a corner", () => {
    const next = resizeRect(start, "se", { x: 200, y: 0 }, locked);
    expect(next.w / next.h).toBeCloseTo(2);
  });

  it("keeps the aspect from an edge and re-centres the free axis", () => {
    const next = resizeRect(start, "e", { x: 200, y: 0 }, locked);
    expect(next.w / next.h).toBeCloseTo(2);
    // Growing width grows height too; the box stays vertically centred.
    const centreBefore = start.y + start.h / 2;
    const centreAfter = next.y + next.h / 2;
    expect(centreAfter).toBeCloseTo(centreBefore);
  });

  it("keeps the aspect on a vertical edge", () => {
    const next = resizeRect(start, "s", { x: 0, y: 100 }, locked);
    expect(next.w / next.h).toBeCloseTo(2);
    expect(next.x + next.w / 2).toBeCloseTo(start.x + start.w / 2);
  });
});

describe("holding alt", () => {
  const centred = { keepAspect: false, fromCenter: true };

  it("grows both ways about the centre", () => {
    const next = resizeRect(start, "e", { x: 50, y: 0 }, centred);
    expect(next.w).toBe(500); // delta counts twice
    expect(next.x + next.w / 2).toBeCloseTo(start.x + start.w / 2);
    expect(next.y + next.h / 2).toBeCloseTo(start.y + start.h / 2);
  });

  it("combines with shift to scale about the centre at a fixed aspect", () => {
    const next = resizeRect(start, "se", { x: 100, y: 0 }, {
      keepAspect: true,
      fromCenter: true,
    });
    expect(next.w / next.h).toBeCloseTo(2);
    expect(next.x + next.w / 2).toBeCloseTo(start.x + start.w / 2);
  });
});
