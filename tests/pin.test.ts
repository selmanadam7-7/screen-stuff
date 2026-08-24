/**
 * Tiles pinned to a corner of the shot.
 *
 * The property that matters: a pinned tile is *inside* the stage, in the corner
 * asked for, whatever the stage does. Everything else here is a consequence of
 * that — including the reason it is derived rather than stored, which is that
 * the stage moves while an animation is running and the camera has to move with
 * it rather than wait at the destination.
 */

import { describe, expect, it } from "vitest";
import {
  CORNERS,
  DEFAULT_PIN,
  MAX_SIZE,
  MIN_SIZE,
  applyPins,
  cornerAt,
  hasPins,
  normalisePin,
  pinTile,
  pinnedRect,
  type Pin,
} from "../src/core/pin";
import { addTile, emptyBoard, makeCameraTile, makeNoteTile } from "../src/core/doc";
import type { BoardDoc, Rect } from "../src/core/types";

const STAGE: Rect = { x: 0, y: 0, w: 1920, h: 1080 };
const inside = (r: Rect, stage: Rect) =>
  r.x >= stage.x && r.y >= stage.y && r.x + r.w <= stage.x + stage.w && r.y + r.h <= stage.y + stage.h;

describe("where a pinned tile sits", () => {
  it("is inside the shot, in every corner, at every size", () => {
    for (const { value } of CORNERS) {
      for (const size of [MIN_SIZE, 0.22, MAX_SIZE]) {
        const rect = pinnedRect(STAGE, { corner: value, size, margin: 0.03 }, 16 / 9);
        expect(inside(rect, STAGE), `${value} at ${size}`).toBe(true);
      }
    }
  });

  it("puts each corner where its name says", () => {
    const mid = { x: STAGE.x + STAGE.w / 2, y: STAGE.y + STAGE.h / 2 };
    const at = (corner: Pin["corner"]) =>
      pinnedRect(STAGE, { ...DEFAULT_PIN, corner }, 16 / 9);
    expect(at("tl").x).toBeLessThan(mid.x);
    expect(at("tl").y).toBeLessThan(mid.y);
    expect(at("tr").x).toBeGreaterThan(mid.x);
    expect(at("tr").y).toBeLessThan(mid.y);
    expect(at("bl").x).toBeLessThan(mid.x);
    expect(at("bl").y).toBeGreaterThan(mid.y);
    expect(at("br").x).toBeGreaterThan(mid.x);
    expect(at("br").y).toBeGreaterThan(mid.y);
  });

  it("keeps the tile's own shape", () => {
    // A circular camera has to stay circular; a phone capture has to stay tall.
    for (const aspect of [1, 16 / 9, 9 / 16]) {
      const rect = pinnedRect(STAGE, DEFAULT_PIN, aspect);
      expect(rect.w / rect.h).toBeCloseTo(aspect, 3);
    }
  });

  it("stays the same apparent size whatever shape the stage is", () => {
    // Measured against the stage width in both cases, so moving from a 16:9
    // shot to a square one does not silently resize somebody's face.
    const wide = pinnedRect(STAGE, DEFAULT_PIN, 1);
    const square = pinnedRect({ x: 0, y: 0, w: 1920, h: 1920 }, DEFAULT_PIN, 1);
    expect(square.w).toBeCloseTo(wide.w, 3);
  });

  it("follows a stage that has moved somewhere else entirely", () => {
    // The auto-framing case: the stage jumps to another monitor.
    const far: Rect = { x: -4000, y: 2000, w: 2560, h: 1440 };
    expect(inside(pinnedRect(far, DEFAULT_PIN, 16 / 9), far)).toBe(true);
  });

  it("refuses to be given a nonsense size or corner", () => {
    const mad = normalisePin({ corner: "middle" as Pin["corner"], size: 40, margin: -3 });
    expect(mad.corner).toBe(DEFAULT_PIN.corner);
    expect(mad.size).toBe(MAX_SIZE);
    expect(mad.margin).toBe(0);
    expect(normalisePin({ ...DEFAULT_PIN, size: 0.0001 }).size).toBe(MIN_SIZE);
  });

  it("survives a tile with no height rather than dividing by zero", () => {
    const rect = pinnedRect(STAGE, DEFAULT_PIN, Number.NaN);
    expect(Number.isFinite(rect.w) && Number.isFinite(rect.h)).toBe(true);
  });
});

describe("applying pins to a document", () => {
  const withCamera = (pin: Pin | null = DEFAULT_PIN): BoardDoc => {
    let d = emptyBoard();
    d = addTile(d, makeCameraTile({ x: 9000, y: 9000, w: 320, h: 320 }));
    d = addTile(d, makeNoteTile("not pinned", { x: 100, y: 100 }));
    return pin ? pinTile(d, d.tiles[0].id, pin) : d;
  };

  it("moves the pinned tile and leaves everything else alone", () => {
    const doc = applyPins(withCamera(), STAGE);
    const camera = doc.tiles[0];
    const note = doc.tiles[1];
    expect(inside(camera, STAGE)).toBe(true);
    expect({ x: note.x, y: note.y }).toEqual({ x: 100, y: 100 });
  });

  it("hands back the same document when nothing is pinned", () => {
    // Reference equality, not just deep equality: this runs every frame in
    // three renderers, and the common case has to allocate nothing.
    const doc = withCamera(null);
    expect(applyPins(doc, STAGE)).toBe(doc);
    expect(hasPins(doc)).toBe(false);
  });

  it("is idempotent, because the renderer and its caller may both do it", () => {
    const once = applyPins(withCamera(), STAGE);
    const twice = applyPins(once, STAGE);
    expect(twice.tiles[0]).toEqual(once.tiles[0]);
  });

  it("ignores where the tile was stored, however far away that is", () => {
    // The stored box of a pinned tile is not where it appears, and the
    // difference is the entire point.
    const doc = applyPins(withCamera(), STAGE);
    expect(doc.tiles[0].x).not.toBe(9000);
  });

  it("tracks the stage frame by frame through a fly", () => {
    // What the animation actually does: the frame is interpolated, and the
    // camera is recomputed against each intermediate rectangle. If this were
    // stored geometry the camera would sit at the destination the whole way.
    const doc = withCamera();
    const from: Rect = { x: 0, y: 0, w: 1920, h: 1080 };
    const to: Rect = { x: 4000, y: 0, w: 1920, h: 1080 };
    let previous = -Infinity;
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const frame = { ...from, x: from.x + (to.x - from.x) * t };
      const camera = applyPins(doc, frame).tiles[0];
      expect(inside(camera, frame)).toBe(true);
      expect(camera.x).toBeGreaterThan(previous);
      previous = camera.x;
    }
  });
});

describe("pinning and unpinning", () => {
  it("brings the tile to the front, because a hidden picture-in-picture is not one", () => {
    // addTile stacks each new tile above the last, so the note starts on top.
    let doc = emptyBoard();
    doc = addTile(doc, makeCameraTile());
    doc = addTile(doc, makeNoteTile("on top"));
    expect(doc.tiles[1].z).toBeGreaterThan(doc.tiles[0].z);

    const pinned = pinTile(doc, doc.tiles[0].id, DEFAULT_PIN);
    expect(pinned.tiles[0].z).toBeGreaterThan(pinned.tiles[1].z);
  });

  it("unpinning leaves the tile where it was stored", () => {
    let doc = emptyBoard();
    doc = addTile(doc, makeCameraTile({ x: 700, y: 400, w: 320, h: 320 }));
    const id = doc.tiles[0].id;
    const freed = pinTile(pinTile(doc, id, DEFAULT_PIN), id, null);
    expect(freed.tiles[0].pin).toBeNull();
    expect({ x: freed.tiles[0].x, y: freed.tiles[0].y }).toEqual({ x: 700, y: 400 });
  });

  it("normalises whatever it is handed", () => {
    const doc = addTile(emptyBoard(), makeCameraTile());
    const pinned = pinTile(doc, doc.tiles[0].id, { corner: "br", size: 99, margin: 99 });
    expect(pinned.tiles[0].pin?.size).toBe(MAX_SIZE);
  });
});

describe("dropping a tile into a corner", () => {
  it("names the corner a point falls in", () => {
    expect(cornerAt(STAGE, { x: 10, y: 10 })).toBe("tl");
    expect(cornerAt(STAGE, { x: 1900, y: 10 })).toBe("tr");
    expect(cornerAt(STAGE, { x: 10, y: 1070 })).toBe("bl");
    expect(cornerAt(STAGE, { x: 1900, y: 1070 })).toBe("br");
  });

  it("works on a stage that is not at the origin", () => {
    const off: Rect = { x: -1000, y: -500, w: 800, h: 450 };
    expect(cornerAt(off, { x: -990, y: -490 })).toBe("tl");
    expect(cornerAt(off, { x: -210, y: -60 })).toBe("br");
  });
});
