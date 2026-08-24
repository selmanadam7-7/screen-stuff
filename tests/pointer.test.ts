/**
 * The pointer: showing it, and punching in on it.
 *
 * The rules that matter are about restraint again — nothing is drawn when the
 * cursor is over something that is not on the board, and holding a mouse button
 * down produces one ripple rather than a stream of them.
 */

import { describe, expect, it } from "vitest";
import { emptyBoard, makeNoteTile, makeSourceTile } from "../src/core/doc";
import {
  ClickRipples,
  PUNCH_FRACTION,
  RIPPLE_MS,
  cursorOnBoard,
  punchRect,
  rippleProgress,
} from "../src/core/pointer";
import { contentRect } from "../src/core/tilebox";
import type { BoardDoc, Tile } from "../src/core/types";

const MONITORS = [
  { id: "monitor:1", x: 0, y: 0, width: 2560, height: 1440 },
  { id: "monitor:2", x: -1920, y: 0, width: 1920, height: 1080 },
];

const board = (...tiles: Tile[]): BoardDoc => ({ ...emptyBoard(), tiles });
const screen = (id: string, x = 0) =>
  makeSourceTile(id, { x, y: 0, w: 1600, h: 900 }) as Tile;

describe("finding the cursor on the board", () => {
  it("maps a desktop point onto the tile's picture, not its box", () => {
    // This test used to assert the centre of the tile's *box*, which is what
    // shipped and what was visibly wrong: a source tile has a title bar above
    // the picture, so the ring sat a title bar too low and drifted further
    // wherever the picture was letterboxed. The centre of a monitor has to land
    // on the centre of the picture of that monitor.
    const tile = screen("monitor:1");
    const content = contentRect(tile);
    const at = cursorOnBoard(board(tile), { x: 1280, y: 720, down: false }, MONITORS)!;
    expect(at.x).toBeCloseTo(content.x + content.w / 2);
    expect(at.y).toBeCloseTo(content.y + content.h / 2);
    expect(at.tile.id).toBe(tile.id);
    // And that really is different from the box, or this test proves nothing.
    expect(at.y).not.toBeCloseTo(tile.y + tile.h / 2, 1);
  });

  it("puts the corners of a screen on the corners of its picture", () => {
    const tile = screen("monitor:1");
    const content = contentRect(tile);
    const topLeft = cursorOnBoard(board(tile), { x: 0, y: 0, down: false }, MONITORS)!;
    expect(topLeft.x).toBeCloseTo(content.x);
    expect(topLeft.y).toBeCloseTo(content.y);
  });

  it("finds the right tile when the cursor is on the other monitor", () => {
    const one = screen("monitor:1", 0);
    const two = screen("monitor:2", 2000);
    const at = cursorOnBoard(board(one, two), { x: -960, y: 540, down: false }, MONITORS)!;
    expect(at.tile.id).toBe(two.id);
  });

  it("draws nothing when that monitor is not on the board", () => {
    expect(cursorOnBoard(board(screen("monitor:2")), { x: 100, y: 100, down: false }, MONITORS))
      .toBeNull();
  });

  it("draws nothing when the cursor is off every monitor", () => {
    expect(cursorOnBoard(board(screen("monitor:1")), { x: 99999, y: 0, down: false }, MONITORS))
      .toBeNull();
  });

  it("draws nothing without a cursor at all", () => {
    expect(cursorOnBoard(board(screen("monitor:1")), null, MONITORS)).toBeNull();
  });

  it("ignores tiles that are not captures", () => {
    const note = { ...makeNoteTile("hi"), x: 0, y: 0 } as Tile;
    expect(cursorOnBoard(board(note), { x: 10, y: 10, down: false }, MONITORS)).toBeNull();
  });
});

describe("punching in", () => {
  const doc = board(screen("monitor:1"));

  it("returns a tight shot at the output shape", () => {
    const shot = punchRect(doc, { x: 1280, y: 720, down: false }, MONITORS)!;
    expect(shot.w / shot.h).toBeCloseTo(doc.aspect);
    expect(shot.w).toBeCloseTo(doc.tiles[0].w * PUNCH_FRACTION);
  });

  it("centres on the cursor", () => {
    const shot = punchRect(doc, { x: 1280, y: 720, down: false }, MONITORS)!;
    const tile = doc.tiles[0];
    expect(shot.x + shot.w / 2).toBeCloseTo(tile.x + tile.w / 2, 0);
  });

  it("stays inside the tile near an edge, rather than showing empty board", () => {
    const shot = punchRect(doc, { x: 4, y: 4, down: false }, MONITORS)!;
    const tile = doc.tiles[0];
    expect(shot.x).toBeGreaterThanOrEqual(tile.x - 0.01);
    expect(shot.y).toBeGreaterThanOrEqual(tile.y - 0.01);
  });

  it("gives nothing to punch at when the cursor is off the board", () => {
    expect(punchRect(doc, { x: -5000, y: 0, down: false }, MONITORS)).toBeNull();
  });
});

describe("click ripples", () => {
  const at = { x: 10, y: 10 };

  it("starts one on the press, not on the release", () => {
    const r = new ClickRipples();
    expect(r.sample(at, true, 0)).toBe(true);
    expect(r.sample(at, false, 10)).toBe(false);
  });

  it("does not machine-gun while a button is held", () => {
    const r = new ClickRipples();
    r.sample(at, true, 0);
    let extra = 0;
    for (let t = 10; t < 400; t += 10) if (r.sample(at, true, t)) extra += 1;
    expect(extra).toBe(0);
  });

  it("starts a second one on the next press", () => {
    const r = new ClickRipples();
    r.sample(at, true, 0);
    r.sample(at, false, 50);
    expect(r.sample(at, true, 100)).toBe(true);
    expect(r.live(120)).toHaveLength(2);
  });

  it("forgets them once they have faded", () => {
    const r = new ClickRipples();
    r.sample(at, true, 0);
    expect(r.live(RIPPLE_MS - 1)).toHaveLength(1);
    expect(r.live(RIPPLE_MS + 1)).toHaveLength(0);
  });

  it("never lets them pile up", () => {
    const r = new ClickRipples();
    for (let i = 0; i < 40; i++) {
      r.sample(at, true, i * 2);
      r.sample(at, false, i * 2 + 1);
    }
    expect(r.live(0).length).toBeLessThanOrEqual(6);
  });

  it("ignores a click with nowhere to draw it", () => {
    const r = new ClickRipples();
    expect(r.sample(null, true, 0)).toBe(false);
    expect(r.live(1)).toHaveLength(0);
  });

  it("reports how far through its life a ripple is", () => {
    expect(rippleProgress({ x: 0, y: 0, at: 0 }, 0)).toBe(0);
    expect(rippleProgress({ x: 0, y: 0, at: 0 }, RIPPLE_MS / 2)).toBeCloseTo(0.5);
    expect(rippleProgress({ x: 0, y: 0, at: 0 }, RIPPLE_MS * 5)).toBe(1);
  });
});
