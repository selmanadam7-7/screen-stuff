/**
 * The stage.
 *
 * Two properties matter more than anything else here, and both were broken:
 * the stage does not move when you look around, and no view is a dead end.
 */

import { describe, expect, it } from "vitest";
import { emptyBoard, reviveBoard, setStage } from "../src/core/doc";
import { rectEquals } from "../src/core/geometry";
import {
  HOME_PADDING,
  MIN_STAGE,
  STAGE_TAB_HEIGHT,
  ViewHistory,
  fitView,
  homeView,
  normaliseStage,
  resizeStage,
  stageHandleAt,
  stageHandles,
  stageHit,
  stageLabel,
  stageTabFor,
  viewIsAwayFromStage,
  visibleBounds,
} from "../src/core/stage";
import type { Rect } from "../src/core/types";

const ASPECT = 16 / 9;
const STAGE: Rect = { x: 0, y: 0, w: 1920, h: 1080 };

describe("coming home", () => {
  it("shows the stage with board visible around it", () => {
    const view = homeView(STAGE, ASPECT);
    expect(view.w).toBeGreaterThan(STAGE.w);
    expect(view.h).toBeGreaterThan(STAGE.h);
    expect(view.w / view.h).toBeCloseTo(ASPECT);
    // Centred on the stage, so the stage does not drift to a corner.
    expect(view.x + view.w / 2).toBeCloseTo(STAGE.x + STAGE.w / 2);
    expect(view.y + view.h / 2).toBeCloseTo(STAGE.y + STAGE.h / 2);
  });

  it("lands in the same place from anywhere", () => {
    // The point of a home key: it is not relative to where you are.
    expect(homeView(STAGE, ASPECT)).toEqual(homeView(STAGE, ASPECT));
  });

  it("leaves visible margin, which is what says the board is bigger than the shot", () => {
    const view = homeView(STAGE, ASPECT);
    expect((view.w - STAGE.w) / STAGE.w).toBeCloseTo(HOME_PADDING * 2, 1);
  });
});

describe("normalising a stage", () => {
  it("forces the output aspect", () => {
    const odd = normaliseStage({ x: 0, y: 0, w: 500, h: 500 }, ASPECT);
    expect(odd.w / odd.h).toBeCloseTo(ASPECT);
  });

  it("refuses to go below the minimum, growing about the centre", () => {
    const tiny = normaliseStage({ x: 100, y: 100, w: 10, h: 6 }, ASPECT);
    expect(Math.min(tiny.w, tiny.h)).toBeGreaterThanOrEqual(MIN_STAGE - 0.01);
    expect(tiny.x + tiny.w / 2).toBeCloseTo(105);
    // A stage clamped about its origin would jump away from the cursor at the
    // exact moment it hit the limit.
    expect(tiny.y + tiny.h / 2).toBeCloseTo(103);
  });

  it("keeps a stage that is already right exactly as it is", () => {
    expect(normaliseStage(STAGE, ASPECT)).toEqual(STAGE);
  });
});

describe("resizing a stage", () => {
  it("holds the aspect from every handle", () => {
    for (const handle of ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const) {
      const next = resizeStage(STAGE, handle, { x: 220, y: -90 }, ASPECT);
      expect(next.w / next.h, handle).toBeCloseTo(ASPECT);
    }
  });

  it("pins the opposite corner when dragging a corner", () => {
    const next = resizeStage(STAGE, "se", { x: 320, y: 180 }, ASPECT);
    expect(next.x).toBeCloseTo(STAGE.x);
    expect(next.y).toBeCloseTo(STAGE.y);
    expect(next.w).toBeGreaterThan(STAGE.w);
  });

  it("cannot be dragged below the minimum", () => {
    const next = resizeStage(STAGE, "se", { x: -5000, y: -5000 }, ASPECT);
    expect(Math.min(next.w, next.h)).toBeGreaterThanOrEqual(MIN_STAGE - 0.01);
  });

  it("grows from the centre when asked", () => {
    const next = resizeStage(STAGE, "se", { x: 200, y: 0 }, ASPECT, { fromCenter: true });
    expect(next.x + next.w / 2).toBeCloseTo(STAGE.x + STAGE.w / 2);
    expect(next.y + next.h / 2).toBeCloseTo(STAGE.y + STAGE.h / 2);
  });
});

describe("grabbing a stage", () => {
  const SLOP = 12;
  const tab = stageTabFor(STAGE, "Stage · 1920 × 1080", 1);

  it("is grabbed by its edge", () => {
    expect(stageHit(STAGE, { x: 0, y: 540 }, SLOP, tab)).toBe("edge");
    expect(stageHit(STAGE, { x: 960, y: 1080 }, SLOP, tab)).toBe("edge");
  });

  it("is not grabbed by its middle, or the board underneath would be unusable", () => {
    expect(stageHit(STAGE, { x: 960, y: 540 }, SLOP, tab)).toBeNull();
  });

  it("is grabbed by its name tab", () => {
    expect(stageHit(STAGE, { x: tab.x + 4, y: tab.y + tab.h / 2 }, SLOP, tab)).toBe("tab");
  });

  it("ignores points nowhere near it", () => {
    expect(stageHit(STAGE, { x: -900, y: -900 }, SLOP, tab)).toBeNull();
  });

  it("puts the tab above the stage, clear of the outline", () => {
    expect(tab.y + tab.h).toBeLessThan(STAGE.y);
    expect(tab.x).toBeCloseTo(STAGE.x);
  });

  it("sizes the tab in screen pixels, so it survives zooming out", () => {
    const zoomedOut = stageTabFor(STAGE, "Stage", 0.1);
    // Ten times smaller on screen means ten times bigger in board units.
    expect(zoomedOut.h).toBeCloseTo(STAGE_TAB_HEIGHT / 0.1);
  });

  it("offers eight handles, at the corners and edge midpoints", () => {
    const handles = stageHandles(STAGE);
    expect(Object.keys(handles)).toHaveLength(8);
    expect(handles.nw).toEqual({ x: 0, y: 0 });
    expect(handles.se).toEqual({ x: 1920, y: 1080 });
    expect(handles.n).toEqual({ x: 960, y: 0 });
    expect(stageHandleAt(STAGE, { x: 4, y: 4 }, 10)).toBe("nw");
    expect(stageHandleAt(STAGE, { x: 900, y: 500 }, 10)).toBeNull();
  });

  it("labels itself with its size", () => {
    expect(stageLabel(STAGE)).toBe("1920 × 1080");
  });
});

describe("view history", () => {
  const A: Rect = { x: 0, y: 0, w: 100, h: 100 };
  const B: Rect = { x: 500, y: 0, w: 100, h: 100 };
  const C: Rect = { x: 900, y: 0, w: 100, h: 100 };

  it("has nowhere to go before you have gone anywhere", () => {
    const nav = new ViewHistory();
    expect(nav.canGoBack).toBe(false);
    expect(nav.back(A)).toBeNull();
  });

  it("returns you to where you were", () => {
    const nav = new ViewHistory();
    nav.push(A);
    expect(nav.canGoBack).toBe(true);
    expect(nav.back(B)).toEqual(A);
  });

  it("walks back through several jumps in order", () => {
    const nav = new ViewHistory();
    nav.push(A);
    nav.push(B);
    expect(nav.back(C)).toEqual(B);
    expect(nav.back(B)).toEqual(A);
    expect(nav.back(A)).toBeNull();
  });

  it("goes forward again after going back", () => {
    const nav = new ViewHistory();
    nav.push(A);
    expect(nav.back(B)).toEqual(A);
    expect(nav.canGoForward).toBe(true);
    expect(nav.forward(A)).toEqual(B);
  });

  it("drops the forward trail once you jump somewhere new", () => {
    const nav = new ViewHistory();
    nav.push(A);
    nav.back(B);
    nav.push(A);
    expect(nav.canGoForward).toBe(false);
  });

  it("ignores a jump that does not actually move", () => {
    const nav = new ViewHistory();
    nav.push(A);
    nav.push({ ...A });
    expect(nav.back(B)).toEqual(A);
    expect(nav.canGoBack).toBe(false);
  });

  it("forgets the oldest entries rather than growing without bound", () => {
    const nav = new ViewHistory(3);
    for (let i = 0; i < 10; i++) nav.push({ x: i * 10, y: 0, w: 100, h: 100 });
    let steps = 0;
    let current: Rect = A;
    while (nav.canGoBack) {
      current = nav.back(current)!;
      steps++;
    }
    expect(steps).toBe(3);
  });

  it("clears completely when a different board is opened", () => {
    const nav = new ViewHistory();
    nav.push(A);
    nav.back(B);
    nav.clear();
    expect(nav.canGoBack).toBe(false);
    expect(nav.canGoForward).toBe(false);
  });
});

describe("fitting everything", () => {
  it("keeps the stage in shot", () => {
    const doc = emptyBoard();
    const faraway: Rect = { x: 9000, y: 9000, w: 400, h: 400 };
    const bounds = visibleBounds(doc, faraway);
    // A view of "everything" that has scrolled the broadcast off screen is not
    // a view of everything.
    expect(bounds.x).toBeLessThanOrEqual(doc.frame.x);
    expect(bounds.x + bounds.w).toBeGreaterThanOrEqual(faraway.x + faraway.w);
  });

  it("falls back to the stage on an empty board", () => {
    const doc = emptyBoard();
    expect(visibleBounds(doc, null)).toEqual(doc.frame);
  });

  it("fits at the output aspect", () => {
    const view = fitView({ x: 0, y: 0, w: 400, h: 2000 }, ASPECT);
    expect(view.w / view.h).toBeCloseTo(ASPECT);
  });
});

describe("knowing you have wandered off", () => {
  it("says nothing while you are looking at the stage", () => {
    expect(viewIsAwayFromStage(homeView(STAGE, ASPECT), STAGE)).toBe(false);
  });

  it("notices a pan away", () => {
    const away = { ...homeView(STAGE, ASPECT), x: 6000 };
    expect(viewIsAwayFromStage(away, STAGE)).toBe(true);
  });

  it("notices a zoom in", () => {
    const close = { x: 400, y: 300, w: 320, h: 180 };
    expect(viewIsAwayFromStage(close, STAGE)).toBe(true);
  });
});

describe("the stage in the document", () => {
  it("is saved and restored with the board", () => {
    const moved = setStage(emptyBoard(), { x: 700, y: -240, w: 1200, h: 675 });
    const reloaded = reviveBoard(JSON.parse(JSON.stringify(moved)));
    expect(rectEquals(reloaded.frame, moved.frame)).toBe(true);
  });

  it("refuses to move while locked", () => {
    const locked = { ...emptyBoard(), stageLocked: true };
    const after = setStage(locked, { x: 999, y: 999, w: 1920, h: 1080 });
    expect(after).toBe(locked);
  });

  it("moves anyway when the operator says so explicitly", () => {
    const locked = { ...emptyBoard(), stageLocked: true };
    const after = setStage(locked, { x: 999, y: 0, w: 1920, h: 1080 }, { force: true });
    expect(after.frame.x).toBeCloseTo(999);
  });

  it("keeps the lock across a save and load", () => {
    const locked = { ...emptyBoard(), stageLocked: true };
    expect(reviveBoard(JSON.parse(JSON.stringify(locked))).stageLocked).toBe(true);
  });

  it("defaults to unlocked for a board saved before the lock existed", () => {
    const old = emptyBoard() as Partial<ReturnType<typeof emptyBoard>>;
    delete old.stageLocked;
    expect(reviveBoard(old).stageLocked).toBe(false);
  });

  it("normalises whatever it is given", () => {
    const squished = setStage(emptyBoard(), { x: 0, y: 0, w: 900, h: 900 });
    expect(squished.frame.w / squished.frame.h).toBeCloseTo(ASPECT);
  });

  it("returns the same document when nothing would change", () => {
    const doc = emptyBoard();
    expect(setStage(doc, { ...doc.frame })).toBe(doc);
  });
});
