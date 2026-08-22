import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetIdCounter,
  addScene,
  addStroke,
  addTile,
  arrangeInFrame,
  bringToFront,
  clearInk,
  contentBounds,
  duplicateTiles,
  emptyBoard,
  expireStrokes,
  frameTile,
  getTile,
  makeCameraTile,
  makeNoteTile,
  makeSourceTile,
  newId,
  nextZ,
  placeInFrame,
  removeScene,
  removeTiles,
  reviveBoard,
  sceneForKey,
  sendToBack,
  setAspect,
  setStage,
  stageAroundEverything,
  strokeOpacity,
  updateScene,
  updateTile,
  updateTiles,
} from "../src/core/doc";
import type { BoardDoc, Stroke, Tile } from "../src/core/types";

const withTiles = (...tiles: Tile[]): BoardDoc => {
  let doc = emptyBoard("Test board");
  for (const tile of tiles) doc = addTile(doc, tile);
  return doc;
};

beforeEach(() => __resetIdCounter());

describe("ids", () => {
  it("never repeats", () => {
    const ids = new Set(Array.from({ length: 500 }, () => newId()));
    expect(ids.size).toBe(500);
  });

  it("carries the prefix it was given", () => {
    expect(newId("ink")).toMatch(/^ink_/);
  });
});

describe("tiles", () => {
  it("starts a board with nothing on it and a 16:9 frame", () => {
    const doc = emptyBoard();
    expect(doc.tiles).toHaveLength(0);
    expect(doc.frame.w / doc.frame.h).toBeCloseTo(16 / 9);
  });

  it("stacks each new tile on top", () => {
    const doc = withTiles(makeNoteTile("a"), makeNoteTile("b"), makeNoteTile("c"));
    const zs = doc.tiles.map((t) => t.z);
    expect(zs).toEqual([...zs].sort((a, b) => a - b));
    expect(nextZ(doc)).toBeGreaterThan(Math.max(...zs));
  });

  it("shapes a source tile to its native aspect", () => {
    const tile = makeSourceTile("monitor:1", { nativeW: 2560, nativeH: 1440, w: 800 });
    expect(tile.w / tile.h).toBeCloseTo(2560 / 1440);
  });

  it("falls back to 16:9 when the native size is unknown", () => {
    const tile = makeSourceTile("window:5", { w: 800 });
    expect(tile.w / tile.h).toBeCloseTo(16 / 9);
  });

  it("updates one tile without touching the others", () => {
    const a = makeNoteTile("a");
    const b = makeNoteTile("b");
    const doc = updateTile(withTiles(a, b), a.id, { x: 500 });
    expect(getTile(doc, a.id)!.x).toBe(500);
    expect(getTile(doc, b.id)!.x).toBe(b.x);
  });

  it("updates many tiles with a function of each", () => {
    const a = makeNoteTile("a");
    const b = makeNoteTile("b");
    const doc = updateTiles(withTiles(a, b), [a.id, b.id], (t) => ({ x: t.x + 10 }));
    expect(doc.tiles.map((t) => t.x)).toEqual([a.x + 10, b.x + 10]);
  });

  it("removes tiles by id", () => {
    const a = makeNoteTile("a");
    const b = makeNoteTile("b");
    const doc = removeTiles(withTiles(a, b), [a.id]);
    expect(doc.tiles.map((t) => t.id)).toEqual([b.id]);
  });

  it("brings to front and sends to back", () => {
    const a = makeNoteTile("a");
    const b = makeNoteTile("b");
    const c = makeNoteTile("c");
    let doc = withTiles(a, b, c);

    doc = bringToFront(doc, [a.id]);
    expect(getTile(doc, a.id)!.z).toBeGreaterThan(getTile(doc, c.id)!.z);

    doc = sendToBack(doc, [a.id]);
    expect(getTile(doc, a.id)!.z).toBeLessThan(getTile(doc, b.id)!.z);
  });

  it("duplicates with fresh ids and a visible offset", () => {
    const a = makeNoteTile("a");
    const { doc, ids } = duplicateTiles(withTiles(a), [a.id]);
    expect(ids).toHaveLength(1);
    expect(ids[0]).not.toBe(a.id);
    const copy = getTile(doc, ids[0])!;
    expect(copy.x).toBeGreaterThan(a.x);
    expect(copy.y).toBeGreaterThan(a.y);
    expect(doc.tiles).toHaveLength(2);
  });
});

describe("framing", () => {
  it("falls back to the frame when the board is empty", () => {
    const doc = emptyBoard();
    expect(contentBounds(doc)).toEqual(doc.frame);
  });

  it("ignores hidden tiles when measuring content", () => {
    const visible = { ...makeNoteTile("v"), x: 0, y: 0, w: 100, h: 100 } as Tile;
    const hidden = { ...makeNoteTile("h"), x: 5000, y: 5000, w: 100, h: 100, hidden: true } as Tile;
    const bounds = contentBounds(withTiles(visible, hidden));
    expect(bounds.x + bounds.w).toBeLessThan(1000);
  });

  it("fits a stage around everything at the output aspect", () => {
    const doc = withTiles({ ...makeNoteTile("a"), x: 0, y: 0, w: 400, h: 900 } as Tile);
    const framed = stageAroundEverything(doc);
    expect(framed.w / framed.h).toBeCloseTo(doc.aspect);
    expect(framed.w).toBeGreaterThan(400);
  });

  it("does not creep outward when asked to fit an empty board again and again", () => {
    // The bug: with no tiles, "everything" is the stage itself, so each pass
    // padded the stage by another 8% and it grew without bound — and nothing
    // ever put it back.
    let doc = emptyBoard();
    const original = { ...doc.frame };
    for (let i = 0; i < 20; i++) doc = setStage(doc, stageAroundEverything(doc));
    expect(doc.frame).toEqual(original);
  });

  it("frames a single tile, and nothing for a tile that is gone", () => {
    const a = makeNoteTile("a");
    const doc = withTiles(a);
    const framed = frameTile(doc, a.id)!;
    expect(framed.w / framed.h).toBeCloseTo(doc.aspect);
    expect(frameTile(doc, "nope")).toBeNull();
  });

  it("reshapes the frame when the output aspect changes", () => {
    const doc = setAspect(emptyBoard(), 1);
    expect(doc.aspect).toBe(1);
    expect(doc.frame.w / doc.frame.h).toBeCloseTo(1);
  });

  it("places a new tile in the middle of the frame", () => {
    const doc = emptyBoard();
    const spot = placeInFrame(doc, 400, 200);
    expect(spot.x + 200).toBeCloseTo(doc.frame.x + doc.frame.w / 2);
    expect(spot.y + 100).toBeCloseTo(doc.frame.y + doc.frame.h / 2);
  });
});

describe("arranging", () => {
  it("lays four tiles inside the frame without overlapping", () => {
    const tiles = [0, 1, 2, 3].map((i) =>
      makeSourceTile(`monitor:${i + 1}`, { nativeW: 1920, nativeH: 1080, w: 800 }),
    );
    const doc = arrangeInFrame(withTiles(...tiles), tiles.map((t) => t.id));

    for (const tile of doc.tiles) {
      expect(tile.x).toBeGreaterThanOrEqual(doc.frame.x - 0.01);
      expect(tile.y).toBeGreaterThanOrEqual(doc.frame.y - 0.01);
      expect(tile.x + tile.w).toBeLessThanOrEqual(doc.frame.x + doc.frame.w + 0.01);
      expect(tile.y + tile.h).toBeLessThanOrEqual(doc.frame.y + doc.frame.h + 0.01);
    }

    // No two tiles may occupy the same pixels.
    for (let i = 0; i < doc.tiles.length; i++) {
      for (let j = i + 1; j < doc.tiles.length; j++) {
        const a = doc.tiles[i];
        const b = doc.tiles[j];
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap).toBe(false);
      }
    }
  });

  it("clears rotation so an arranged grid is square to the frame", () => {
    const tile = { ...makeNoteTile("a"), rotation: 12 } as Tile;
    const doc = arrangeInFrame(withTiles(tile), [tile.id]);
    expect(doc.tiles[0].rotation).toBe(0);
  });

  it("leaves the board alone when asked to arrange nothing", () => {
    const doc = withTiles(makeNoteTile("a"));
    expect(arrangeInFrame(doc, [])).toBe(doc);
  });
});

describe("scenes", () => {
  it("saves a scene with its frame and hotkey", () => {
    const doc = addScene(emptyBoard(), "Four up", { x: 0, y: 0, w: 100, h: 56 }, "1");
    expect(doc.scenes).toHaveLength(1);
    expect(sceneForKey(doc, "1")!.name).toBe("Four up");
  });

  it("matches hotkeys regardless of case", () => {
    const doc = addScene(emptyBoard(), "Demo", { x: 0, y: 0, w: 10, h: 6 }, "d");
    expect(sceneForKey(doc, "D")).toBeDefined();
  });

  it("moves a hotkey rather than duplicating it", () => {
    let doc = addScene(emptyBoard(), "A", { x: 0, y: 0, w: 10, h: 6 }, "1");
    doc = addScene(doc, "B", { x: 0, y: 0, w: 10, h: 6 }, "2");
    doc = updateScene(doc, doc.scenes[1].id, { hotkey: "1" });

    expect(doc.scenes.filter((s) => s.hotkey === "1")).toHaveLength(1);
    expect(sceneForKey(doc, "1")!.name).toBe("B");
    expect(doc.scenes[0].hotkey).toBe("");
  });

  it("removes a scene", () => {
    let doc = addScene(emptyBoard(), "A", { x: 0, y: 0, w: 10, h: 6 }, "1");
    doc = removeScene(doc, doc.scenes[0].id);
    expect(doc.scenes).toHaveLength(0);
  });
});

describe("ink", () => {
  const stroke = (over: Partial<Stroke> = {}): Stroke => ({
    id: newId("ink"),
    tool: "pen",
    color: "#fff",
    width: 4,
    points: [0, 0, 10, 10],
    createdAt: 1000,
    ...over,
  });

  it("adds and clears strokes", () => {
    let doc = addStroke(emptyBoard(), stroke());
    expect(doc.strokes).toHaveLength(1);
    doc = clearInk(doc);
    expect(doc.strokes).toHaveLength(0);
  });

  it("keeps permanent ink forever", () => {
    const doc = addStroke(emptyBoard(), stroke());
    expect(expireStrokes(doc, 10_000_000).strokes).toHaveLength(1);
  });

  it("drops temporary ink once it has faded out", () => {
    const doc = addStroke(emptyBoard(), stroke({ fadeAfterMs: 2000 }));
    expect(expireStrokes(doc, 2500).strokes).toHaveLength(1); // still fading
    expect(expireStrokes(doc, 5000).strokes).toHaveLength(0); // gone
  });

  it("returns the same document when nothing expired", () => {
    const doc = addStroke(emptyBoard(), stroke());
    expect(expireStrokes(doc, 2000)).toBe(doc);
  });

  it("fades opacity from full to nothing", () => {
    const s = stroke({ fadeAfterMs: 1000 });
    expect(strokeOpacity(s, 1500)).toBe(1); // inside its lifetime
    expect(strokeOpacity(s, 2350)).toBeGreaterThan(0);
    expect(strokeOpacity(s, 2350)).toBeLessThan(1);
    expect(strokeOpacity(s, 9999)).toBe(0);
    expect(strokeOpacity(stroke(), 9_999_999)).toBe(1); // permanent
  });
});

describe("loading a saved board", () => {
  it("round-trips a real document", () => {
    const original = withTiles(makeNoteTile("hello"), makeCameraTile());
    const revived = reviveBoard(JSON.parse(JSON.stringify(original)));
    expect(revived.tiles).toHaveLength(2);
    expect(revived.name).toBe(original.name);
  });

  it("gives an empty board for junk rather than throwing", () => {
    for (const junk of [null, undefined, 42, "board", [], {}]) {
      const doc = reviveBoard(junk);
      expect(doc.tiles).toEqual([]);
      expect(doc.frame.w).toBeGreaterThan(0);
    }
  });

  it("drops tiles that could not be drawn", () => {
    const doc = reviveBoard({
      tiles: [
        { id: "ok", kind: "note", x: 0, y: 0, w: 10, h: 10 },
        { id: "no-kind", x: 0, y: 0, w: 10, h: 10 },
        { id: "zero", kind: "note", x: 0, y: 0, w: 0, h: 10 },
        { id: "nan", kind: "note", x: NaN, y: 0, w: 10, h: 10 },
        "not even an object",
      ],
    });
    expect(doc.tiles.map((t) => t.id)).toEqual(["ok"]);
  });

  it("fills in fields an older file did not have", () => {
    const doc = reviveBoard({ tiles: [{ id: "t", kind: "image", x: 0, y: 0, w: 10, h: 10 }] });
    const tile = doc.tiles[0];
    expect(tile.opacity).toBe(1);
    expect(tile.rotation).toBe(0);
    expect(tile.label).toBe("");
    expect(tile.fit).toBe("contain");
    expect(Number.isFinite(tile.z)).toBe(true);
  });

  it("clamps settings that are out of range", () => {
    const doc = reviveBoard({ quality: 5000, fps: -3, aspect: 0 });
    expect(doc.quality).toBe(100);
    expect(doc.fps).toBe(1);
    expect(doc.aspect).toBeCloseTo(16 / 9);
  });

  it("keeps only strokes and scenes that make sense", () => {
    const doc = reviveBoard({
      strokes: [
        { id: "good", points: [0, 0, 1, 1] },
        { id: "short", points: [0, 0] },
        { id: "nan", points: [0, 0, NaN, 1] },
      ],
      scenes: [
        { id: "good", name: "A", frame: { x: 0, y: 0, w: 10, h: 6 } },
        { id: "bad", name: "B", frame: { x: 0, y: 0, w: 0, h: 6 } },
        { id: "none", name: "C" },
      ],
    });
    expect(doc.strokes.map((s) => s.id)).toEqual(["good"]);
    expect(doc.scenes.map((s) => s.id)).toEqual(["good"]);
  });
});
