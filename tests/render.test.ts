import { describe, expect, it } from "vitest";
import { ellipsise, handlePositions, wrapText, HANDLE_SIZE } from "../src/core/render";
import { makeNoteTile, makeSourceTile } from "../src/core/doc";

/** wrapText only ever asks the context to measure, so that is all we provide. */
const fakeCtx = (charWidth = 10) =>
  ({
    measureText: (text: string) => ({ width: text.length * charWidth }),
  }) as unknown as CanvasRenderingContext2D;

describe("note text wrapping", () => {
  it("breaks a long line at the width given", () => {
    const lines = wrapText(fakeCtx(), "one two three four five", 100);
    for (const line of lines) expect(line.length * 10).toBeLessThanOrEqual(100);
    expect(lines.join(" ")).toBe("one two three four five");
  });

  it("honours explicit newlines, including blank ones", () => {
    const lines = wrapText(fakeCtx(), "first\n\nsecond", 1000);
    expect(lines).toEqual(["first", "", "second"]);
  });

  it("never drops a word that is wider than the box", () => {
    const lines = wrapText(fakeCtx(), "supercalifragilistic", 50);
    expect(lines).toEqual(["supercalifragilistic"]);
  });

  it("returns nothing for empty text", () => {
    expect(wrapText(fakeCtx(), "", 100)).toEqual([""]);
  });

  it("collapses runs of whitespace", () => {
    expect(wrapText(fakeCtx(), "a    b", 1000)).toEqual(["a b"]);
  });
});

describe("selection handles", () => {
  const tile = makeSourceTile("monitor:1", { x: 100, y: 200, w: 400, h: 300 });

  it("puts eight handles on the tile's corners and edge midpoints", () => {
    const handles = handlePositions(tile);
    expect(Object.keys(handles).sort()).toEqual(
      ["e", "n", "ne", "nw", "s", "se", "sw", "w"].sort(),
    );
    expect(handles.nw).toEqual({ x: 100, y: 200 });
    expect(handles.se).toEqual({ x: 500, y: 500 });
    expect(handles.n).toEqual({ x: 300, y: 200 });
    expect(handles.w).toEqual({ x: 100, y: 350 });
  });

  it("keeps handles big enough to grab", () => {
    expect(HANDLE_SIZE).toBeGreaterThanOrEqual(8);
  });

  it("tracks a tile that has moved", () => {
    const moved = { ...makeNoteTile("x"), x: 0, y: 0, w: 10, h: 10 };
    expect(handlePositions(moved).se).toEqual({ x: 10, y: 10 });
  });
});

describe("caption trimming", () => {
  it("leaves a caption that fits alone", () => {
    expect(ellipsise(fakeCtx(), "Display 1", 1000)).toBe("Display 1");
  });

  it("trims with an ellipsis rather than cutting hard", () => {
    // 10px per character, so 65px fits six characters plus the ellipsis.
    const trimmed = ellipsise(fakeCtx(), "A very long window title", 65);
    expect(trimmed.endsWith("…")).toBe(true);
    expect(trimmed.length * 10).toBeLessThanOrEqual(65);
    expect("A very long window title".startsWith(trimmed.slice(0, -1))).toBe(true);
  });

  it("gives up gracefully when there is no room at all", () => {
    expect(ellipsise(fakeCtx(), "anything", 0)).toBe("");
    expect(ellipsise(fakeCtx(), "anything", 5)).toBe("");
  });
});
