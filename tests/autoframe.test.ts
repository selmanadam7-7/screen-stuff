/**
 * Auto-framing.
 *
 * The interesting behaviour is all in when it declines to move: alt-tabbing
 * through windows, nudging one pane, or focusing something that is not on the
 * board at all. Every one of those must leave the shot where it is.
 */

import { describe, expect, it } from "vitest";
import { emptyBoard, makeNoteTile, makeSourceTile } from "../src/core/doc";
import {
  AutoFramer,
  RESTFUL_OVERLAP,
  SETTLE_MS,
  overlapFraction,
  targetFor,
  windowWithinMonitor,
  worthMoving,
  type Focus,
} from "../src/core/autoframe";
import type { BoardDoc, Rect, Tile } from "../src/core/types";

const MONITORS = [
  { id: "monitor:1", x: 0, y: 0, width: 2560, height: 1440 },
  { id: "monitor:2", x: -1920, y: 0, width: 1920, height: 1080 },
];

/** A board with each monitor as a tile, laid out side by side. */
function board(...tiles: Tile[]): BoardDoc {
  return { ...emptyBoard(), tiles };
}

const monitorTile = (id: string, x: number, w = 1600, h = 900) =>
  makeSourceTile(id, { x, y: 0, w, h }) as Tile;

const focus = (over: Partial<Focus> = {}): Focus => ({
  window: "window:4242",
  title: "Terminal",
  x: 100,
  y: 100,
  width: 1200,
  height: 800,
  monitor: "monitor:1",
  ...over,
});

describe("choosing a shot", () => {
  it("frames the monitor you are working on", () => {
    const doc = board(monitorTile("monitor:1", 0), monitorTile("monitor:2", 2000));
    const target = targetFor(doc, focus(), "monitor", MONITORS)!;
    expect(target.tileId).toBe(doc.tiles[0].id);
    expect(target.rect.w / target.rect.h).toBeCloseTo(doc.aspect);
  });

  it("follows to the other monitor when you move there", () => {
    const doc = board(monitorTile("monitor:1", 0), monitorTile("monitor:2", 2000));
    const target = targetFor(doc, focus({ monitor: "monitor:2", x: -1800 }), "monitor", MONITORS)!;
    expect(target.tileId).toBe(doc.tiles[1].id);
  });

  it("frames a window's own tile when there is one", () => {
    const own = makeSourceTile("window:4242", { x: 5000, y: 0, w: 800, h: 600 }) as Tile;
    const doc = board(monitorTile("monitor:1", 0), own);
    const target = targetFor(doc, focus(), "window", MONITORS)!;
    expect(target.tileId).toBe(own.id);
    expect(target.label).toBe("Terminal");
  });

  it("finds the window inside a monitor tile when it was never added on its own", () => {
    // The case that makes window-follow useful on a normal board: only the
    // monitors are tiles, but the window's pixels are right there inside one.
    const tile = monitorTile("monitor:1", 0, 2560, 1440);
    const doc = board(tile);
    const target = targetFor(doc, focus({ x: 1280, y: 720, width: 1280, height: 720 }), "window", MONITORS)!;
    expect(target.tileId).toBe(tile.id);
    // Bottom-right quarter of the monitor, so the shot sits in that quarter.
    expect(target.rect.x).toBeGreaterThan(tile.x + tile.w / 2 - target.rect.w);
    expect(target.rect.w).toBeLessThan(tile.w);
  });

  it("holds when the thing you focused is not on the board", () => {
    const doc = board(monitorTile("monitor:2", 0));
    expect(targetFor(doc, focus({ monitor: "monitor:1" }), "monitor", MONITORS)).toBeNull();
  });

  it("holds when nothing has focus", () => {
    const doc = board(monitorTile("monitor:1", 0));
    expect(targetFor(doc, null, "monitor", MONITORS)).toBeNull();
  });

  it("does nothing at all when switched off", () => {
    const doc = board(monitorTile("monitor:1", 0));
    expect(targetFor(doc, focus(), "off", MONITORS)).toBeNull();
  });

  it("ignores hidden tiles, because a hidden tile is not on air", () => {
    const tile = { ...monitorTile("monitor:1", 0), hidden: true } as Tile;
    expect(targetFor(board(tile), focus(), "monitor", MONITORS)).toBeNull();
  });

  it("ignores tiles that are not captures", () => {
    const note = { ...makeNoteTile("hello"), x: 0, y: 0 } as Tile;
    expect(targetFor(board(note), focus(), "monitor", MONITORS)).toBeNull();
  });

  it("matches a region tile to the monitor it was cut from", () => {
    const region = makeSourceTile("region:monitor:1@100,100,800,600", { x: 0, y: 0 }) as Tile;
    const target = targetFor(board(region), focus(), "monitor", MONITORS)!;
    expect(target.tileId).toBe(region.id);
  });

  it("always hands back a rectangle at the output shape", () => {
    const doc = board(monitorTile("monitor:1", 0, 2560, 1440));
    for (const mode of ["monitor", "window"] as const) {
      const target = targetFor(doc, focus(), mode, MONITORS)!;
      expect(target.rect.w / target.rect.h, mode).toBeCloseTo(doc.aspect);
    }
  });
});

describe("mapping a window into a monitor tile", () => {
  const tile = monitorTile("monitor:1", 0, 2560, 1440);
  const monitor = MONITORS[0];

  it("puts a full-screen window over the whole tile", () => {
    const rect = windowWithinMonitor(tile, monitor, focus({ x: 0, y: 0, width: 2560, height: 1440 }))!;
    expect(rect).toEqual({ x: tile.x, y: tile.y, w: tile.w, h: tile.h });
  });

  it("scales a window into the tile in proportion", () => {
    const rect = windowWithinMonitor(tile, monitor, focus({ x: 640, y: 360, width: 1280, height: 720 }))!;
    expect(rect.x).toBeCloseTo(tile.x + tile.w * 0.25);
    expect(rect.w).toBeCloseTo(tile.w * 0.5);
  });

  it("refuses a window with no area", () => {
    expect(windowWithinMonitor(tile, monitor, focus({ width: 0, height: 0 }))).toBeNull();
  });
});

describe("deciding a move is worth it", () => {
  const shot: Rect = { x: 0, y: 0, w: 1000, h: 562 };

  it("is not worth moving to nearly the same shot", () => {
    expect(worthMoving(shot, { x: 10, y: 4, w: 1000, h: 562 })).toBe(false);
  });

  it("is worth moving to a different screen", () => {
    expect(worthMoving(shot, { x: 3000, y: 0, w: 1000, h: 562 })).toBe(true);
  });

  it("is worth zooming in, even though the new shot is inside the old one", () => {
    // Fully contained, so one direction reads as complete overlap. Checking
    // both directions is what catches this.
    expect(worthMoving(shot, { x: 300, y: 160, w: 300, h: 168 })).toBe(true);
  });

  it("measures overlap as a fraction of the first rectangle", () => {
    expect(overlapFraction(shot, shot)).toBeCloseTo(1);
    expect(overlapFraction(shot, { x: 500, y: 0, w: 1000, h: 562 })).toBeCloseTo(0.5);
    expect(overlapFraction(shot, { x: 9000, y: 0, w: 10, h: 10 })).toBe(0);
  });

  it("uses a generous threshold, so small changes never re-aim anything", () => {
    expect(RESTFUL_OVERLAP).toBeGreaterThan(0.8);
  });
});

describe("settling before it commits", () => {
  const shot: Rect = { x: 0, y: 0, w: 1000, h: 562 };
  const target = (id: string, x: number) => ({
    rect: { x, y: 0, w: 1000, h: 562 },
    tileId: id,
    label: id,
  });

  it("does not move on the first sighting", () => {
    const framer = new AutoFramer();
    expect(framer.offer(target("a", 5000), shot, 0)).toBeNull();
  });

  it("moves once the target has held still", () => {
    const framer = new AutoFramer();
    framer.offer(target("a", 5000), shot, 0);
    expect(framer.offer(target("a", 5000), shot, SETTLE_MS + 1)).not.toBeNull();
  });

  it("makes one move out of alt-tabbing through five windows", () => {
    // The whole point. Each window is seen briefly, none settles, and the shot
    // only goes to the one you land on.
    const framer = new AutoFramer();
    let moves = 0;
    let now = 0;
    for (const id of ["a", "b", "c", "d"]) {
      now += 120;
      if (framer.offer(target(id, 5000), shot, now)) moves += 1;
    }
    expect(moves).toBe(0);
    now += SETTLE_MS + 1;
    expect(framer.offer(target("e", 5000), shot, now)).toBeNull(); // first sighting
    now += SETTLE_MS + 1;
    expect(framer.offer(target("e", 5000), shot, now)).not.toBeNull();
  });

  it("does not move twice to the same place", () => {
    const framer = new AutoFramer();
    framer.offer(target("a", 5000), shot, 0);
    expect(framer.offer(target("a", 5000), shot, SETTLE_MS + 1)).not.toBeNull();
    expect(framer.offer(target("a", 5000), shot, SETTLE_MS * 3)).toBeNull();
  });

  it("holds the shot when focus goes somewhere off the board", () => {
    const framer = new AutoFramer();
    framer.offer(target("a", 5000), shot, 0);
    framer.offer(target("a", 5000), shot, SETTLE_MS + 1);
    expect(framer.offer(null, shot, SETTLE_MS * 2)).toBeNull();
    expect(framer.holding).not.toBeNull();
  });

  it("does not re-aim for a shot that is already effectively up", () => {
    const framer = new AutoFramer();
    // Target is within the resting threshold of what is on air.
    framer.offer(target("a", 12), shot, 0);
    expect(framer.offer(target("a", 12), shot, SETTLE_MS + 1)).toBeNull();
  });

  it("starts over when the operator takes the stage back", () => {
    const framer = new AutoFramer();
    framer.offer(target("a", 5000), shot, 0);
    framer.offer(target("a", 5000), shot, SETTLE_MS + 1);
    framer.reset();
    expect(framer.holding).toBeNull();
    framer.offer(target("a", 5000), shot, SETTLE_MS * 2);
    expect(framer.offer(target("a", 5000), shot, SETTLE_MS * 4)).not.toBeNull();
  });

  it("settles slowly enough to be watchable", () => {
    expect(SETTLE_MS).toBeGreaterThanOrEqual(400);
  });
});
