/**
 * Where a tile's picture actually is.
 *
 * Two shipped bugs came from the same wrong assumption — that a tile's box and
 * its picture are the same rectangle. They are not: a source tile has a title
 * bar above the picture, and once that is taken off the top the box no longer
 * has the source's proportions, so the picture is letterboxed inside what is
 * left.
 *
 * The pointer ring was placed against the box, so it sat a title bar too low.
 * Redactions were *stored* against the box and *drawn* against the body, so the
 * rectangle you drew over an API key covered something above it — a privacy
 * promise that quietly did not hold. Both are one function now, and these tests
 * are what stop them drifting apart again.
 */

import { describe, expect, it } from "vitest";
import {
  TILE_BAR,
  contentPointToBoard,
  contentRect,
  hasTitleBar,
  naturalSize,
  pointInContent,
  tileBody,
  titleBarHeight,
} from "../src/core/tilebox";
import { makeCameraTile, makeNoteTile, makeSourceTile } from "../src/core/doc";
import type { SourceTile, Tile } from "../src/core/types";

/** A monitor tile as the app makes one: box shaped to the source. */
const monitorTile = (over: Partial<SourceTile> = {}) =>
  makeSourceTile("monitor:1", {
    x: 100,
    y: 50,
    w: 1600,
    h: 900,
    nativeW: 1920,
    nativeH: 1080,
    ...over,
  }) as Tile;

describe("the three rectangles", () => {
  it("gives a windowed tile a title bar and other tiles none", () => {
    expect(hasTitleBar(monitorTile())).toBe(true);
    expect(hasTitleBar(makeNoteTile("hi") as Tile)).toBe(false);
    expect(hasTitleBar(makeCameraTile() as Tile)).toBe(false);
    expect(titleBarHeight(makeNoteTile("hi") as Tile)).toBe(0);
  });

  it("never lets the bar eat a short tile", () => {
    // On a tile 100 units tall a fixed 34-unit bar would be a third of it.
    const short = monitorTile({ h: 100 });
    expect(titleBarHeight(short)).toBeLessThan(TILE_BAR);
    expect(titleBarHeight(short)).toBeCloseTo(16);
  });

  it("takes the bar off the top for the body, and nothing off the sides", () => {
    const tile = monitorTile();
    const body = tileBody(tile);
    expect(body.x).toBe(tile.x);
    expect(body.w).toBe(tile.w);
    expect(body.y).toBeCloseTo(tile.y + titleBarHeight(tile));
    expect(body.h).toBeCloseTo(tile.h - titleBarHeight(tile));
  });

  it("puts the picture inside the body, keeping the source's shape", () => {
    const tile = monitorTile();
    const body = tileBody(tile);
    const content = contentRect(tile);
    expect(content.w / content.h).toBeCloseTo(1920 / 1080, 3);
    // Inside the body, not the box.
    expect(content.y).toBeGreaterThanOrEqual(body.y - 0.001);
    expect(content.y + content.h).toBeLessThanOrEqual(body.y + body.h + 0.001);
  });

  it("is not the tile's box, which is the whole point", () => {
    const tile = monitorTile();
    const content = contentRect(tile);
    expect(content.y).toBeGreaterThan(tile.y);
    // A rectangle drawn against the box would be this far out.
    expect(content.y - tile.y).toBeGreaterThan(10);
  });

  it("falls back to the body when the source's size is not known yet", () => {
    // A source tile learns its native size from the first frame; until then the
    // body is the best answer there is, and it must not be a NaN.
    const unknown = makeSourceTile("monitor:9", { x: 0, y: 0, w: 800, h: 450 }) as Tile;
    expect(naturalSize(unknown)).toBeNull();
    expect(contentRect(unknown)).toEqual(tileBody(unknown));
  });

  it("takes a live frame's size over the tile's own", () => {
    // A source that changed resolution mid-call reports the new shape before
    // the tile has caught up.
    const tile = monitorTile();
    const tall = contentRect(tile, { width: 1080, height: 1920 });
    expect(tall.w / tall.h).toBeCloseTo(1080 / 1920, 3);
  });

  it("uses the whole box for a tile with no bar and no known shape", () => {
    const note = makeNoteTile("hi", { x: 10, y: 20, w: 300, h: 200 }) as Tile;
    expect(contentRect(note)).toEqual({ x: 10, y: 20, w: 300, h: 200 });
  });
});

describe("mapping a point onto the picture", () => {
  it("round-trips", () => {
    const tile = monitorTile();
    for (const point of [
      { x: 0, y: 0 },
      { x: 0.5, y: 0.5 },
      { x: 1, y: 1 },
      { x: 0.23, y: 0.81 },
    ]) {
      const board = contentPointToBoard(tile, point);
      const back = pointInContent(tile, board);
      expect(back!.x).toBeCloseTo(point.x, 6);
      expect(back!.y).toBeCloseTo(point.y, 6);
    }
  });

  it("puts the middle of the screen in the middle of the picture", () => {
    // The pointer bug, stated directly: the centre of the monitor has to land
    // on the centre of what is drawn, not the centre of the tile's box.
    const tile = monitorTile();
    const content = contentRect(tile);
    const middle = contentPointToBoard(tile, { x: 0.5, y: 0.5 });
    expect(middle.x).toBeCloseTo(content.x + content.w / 2);
    expect(middle.y).toBeCloseTo(content.y + content.h / 2);
    // And that is *not* the centre of the tile, which is where it used to go.
    expect(middle.y).not.toBeCloseTo(tile.y + tile.h / 2, 1);
  });

  it("says nothing rather than something wrong outside the picture", () => {
    const tile = monitorTile();
    // In the title bar: on the tile, but not on the screen it shows.
    expect(pointInContent(tile, { x: tile.x + 10, y: tile.y + 2 })).toBeNull();
    // Well outside.
    expect(pointInContent(tile, { x: tile.x - 50, y: tile.y + 100 })).toBeNull();
  });

  it("survives a tile with no size", () => {
    const flat = monitorTile({ w: 0, h: 0 });
    expect(pointInContent(flat, { x: 0, y: 0 })).toBeNull();
  });
});
