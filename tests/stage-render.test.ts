/**
 * What the stage actually looks like on the canvas.
 *
 * Drawing is verified through a recording context rather than pixels: the
 * questions worth asking are "is there a scrim over everything outside it",
 * "does it say what it is" and "does it show handles when it is selected", and
 * all three are answerable from the call log.
 */

import { describe, expect, it } from "vitest";
import { emptyBoard, makeNoteTile, makeSourceTile } from "../src/core/doc";
import { renderBoard, HANDLE_SIZE } from "../src/core/render";
import { stageTabFor } from "../src/core/stage";
import type { BoardDoc } from "../src/core/types";

type Call = { name: string; args: unknown[] };

/**
 * A canvas context that records every call and draws nothing.
 *
 * A Proxy rather than a hand-written stub so the renderer can start using a new
 * context method without this file quietly returning undefined and failing
 * somewhere unrelated.
 */
function recorder(): { ctx: CanvasRenderingContext2D; calls: Call[]; text: string[] } {
  const calls: Call[] = [];
  const text: string[] = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(state, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      if (prop === "canvas") return { width: 1200, height: 675 };
      if (prop === "measureText") {
        return (t: string) => ({ width: t.length * 6 });
      }
      return (...args: unknown[]) => {
        calls.push({ name: prop, args });
        if (prop === "fillText") text.push(String(args[0]));
        return undefined;
      };
    },
    set(target, prop: string, value) {
      target[prop] = value;
      calls.push({ name: `set:${prop}`, args: [value] });
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls, text };
}

const VIEW = { x: -400, y: -300, w: 2800, h: 1575 };

function draw(doc: BoardDoc, stage: { selected: boolean; locked: boolean; label: string } | undefined) {
  const { ctx, calls, text } = recorder();
  renderBoard({
    ctx,
    width: 1200,
    height: 675,
    view: VIEW,
    doc,
    media: { resolve: () => null },
    now: 0,
    chrome: {
      selection: [],
      frame: doc.frame,
      stage,
      showGrid: false,
      isPrivate: false,
    },
  });
  return { calls, text };
}

/** Circles drawn at handle size — the handles, and nothing else in this scene. */
const arcs = (calls: Call[]) => calls.filter((c) => c.name === "arc");

describe("drawing the stage", () => {
  const doc = emptyBoard();

  it("dims everything outside it with an even-odd fill", () => {
    const { calls } = draw(doc, { selected: false, locked: false, label: "Stage" });
    const evenOdd = calls.find((c) => c.name === "fill" && c.args[0] === "evenodd");
    expect(evenOdd, "the scrim is what makes on-air unmistakable").toBeTruthy();
  });

  it("names itself, so nobody has to guess what the box is", () => {
    const { text } = draw(doc, { selected: false, locked: false, label: "Stage · 1920 × 1080" });
    expect(text).toContain("Stage · 1920 × 1080");
  });

  it("shows eight handles once it is selected, and none before", () => {
    const idle = draw(doc, { selected: false, locked: false, label: "Stage" });
    const selected = draw(doc, { selected: true, locked: false, label: "Stage" });
    expect(arcs(idle.calls)).toHaveLength(0);
    expect(arcs(selected.calls)).toHaveLength(8);
  });

  it("shows no handles on a locked stage, because there is nothing to drag", () => {
    const locked = draw(doc, { selected: true, locked: true, label: "Stage" });
    expect(arcs(locked.calls)).toHaveLength(0);
  });

  it("dashes the outline when locked", () => {
    const locked = draw(doc, { selected: false, locked: true, label: "Stage" });
    const dashes = locked.calls.filter((c) => c.name === "setLineDash" && (c.args[0] as number[]).length);
    expect(dashes.length).toBeGreaterThan(0);
  });

  it("still outlines the stage with no stage options, as the board window does", () => {
    const { calls, text } = draw(doc, undefined);
    expect(calls.some((c) => c.name === "strokeRect")).toBe(true);
    // No tab on the output: the audience must never see the operator's chrome.
    expect(text).toHaveLength(0);
    expect(arcs(calls)).toHaveLength(0);
  });

  it("puts the tab where the hit-test looks for it", () => {
    // Same helper on both sides, so a tab you can see is a tab you can click.
    const scale = 1200 / VIEW.w;
    const tab = stageTabFor(doc.frame, "Stage", scale);
    expect(tab.y + tab.h).toBeLessThan(doc.frame.y);
    expect(tab.h * scale).toBeCloseTo(21);
  });

  it("draws tiles as well as the stage, so the cockpit shows the whole board", () => {
    const withTile: BoardDoc = {
      ...doc,
      tiles: [{ ...makeNoteTile("hello"), x: 4000, y: 0 }],
    };
    const { text } = draw(withTile, { selected: false, locked: false, label: "Stage" });
    // The note is far outside the stage and still drawn: off-stage is visible
    // to the operator, which is the entire point of the private area.
    expect(text).toContain("hello");
  });

  it("uses the same handle size as tile selection", () => {
    const selected = draw(doc, { selected: true, locked: false, label: "Stage" });
    const radius = arcs(selected.calls)[0].args[2] as number;
    const px = VIEW.w / 1200;
    expect(radius).toBeCloseTo((HANDLE_SIZE * px) / 2);
  });
});

describe("never-shared regions", () => {
  const doc = emptyBoard();

  function withRedactions(style: "solid" | "blur") {
    const tile = {
      ...makeSourceTile("monitor:1", { x: 0, y: 0, w: 1200, h: 675 }),
      redactions: [{ id: "r1", x: 0.6, y: 0, w: 0.4, h: 0.2, style, label: "the top right" }],
    } as unknown as BoardDoc["tiles"][number];
    return { ...doc, tiles: [tile] };
  }

  it("paints over the region on the board, where there is no chrome at all", () => {
    const { ctx, calls } = recorder();
    renderBoard({
      ctx,
      width: 1200,
      height: 675,
      view: doc.frame,
      doc: withRedactions("solid"),
      media: { resolve: () => null },
      now: 0,
      // No chrome: this is the audience's copy.
    });
    // A filled rectangle over the top-right fifth of the tile. Coordinates are
    // board units, and the region sits inside the tile's body, below its bar.
    const covers = calls.filter(
      (c) =>
        c.name === "fillRect" &&
        Math.abs((c.args[0] as number) - 720) < 2 &&
        Math.abs((c.args[2] as number) - 480) < 2,
    );
    expect(covers.length, "the audience's copy must be covered too").toBeGreaterThan(0);
  });

  it("re-draws through a blur for the tidying style", () => {
    const { calls } = draw(withRedactions("blur"), undefined);
    const blurred = calls.filter((c) => c.name === "set:filter" && String(c.args[0]).startsWith("blur"));
    expect(blurred.length).toBeGreaterThan(0);
  });

  it("draws nothing extra when the same tile has no regions", () => {
    const plain = {
      ...doc,
      tiles: [makeSourceTile("monitor:1", { x: 0, y: 0, w: 1200, h: 675 })],
    } as BoardDoc;
    const without = draw(plain, undefined).calls.filter((c) => c.name === "fillRect").length;
    const with_ = draw(withRedactions("solid"), undefined).calls.filter(
      (c) => c.name === "fillRect",
    ).length;
    expect(with_).toBeGreaterThan(without);
  });
});
