/**
 * The stage — the rectangle the audience actually sees.
 *
 * This is the one idea the whole app rests on, so it gets its own file. The
 * board is infinite and private; the stage is a finite window onto it, and
 * *only* what falls inside the stage is ever handed to Discord, Meet or a
 * guest. Everything else on the canvas is the operator's own workspace: notes
 * queued for later, a monitor parked off to one side, the mess before the tidy.
 *
 * Two rules follow from that, and both used to be broken:
 *
 *   1. **Moving your view is not moving the stage.** Panning and zooming is how
 *      you get around your workspace. If it dragged the stage along, the
 *      audience would ride your cursor and there would be no private area at
 *      all. Stage changes are deliberate: drag the stage itself, press Enter,
 *      or pick a scene.
 *   2. **No view is a dead end.** Anything that jumps the view somewhere records
 *      where it came from, so there is always a way back. A control that takes
 *      you somewhere you cannot leave is a trap, not a feature.
 */

import { fitAspect, frameFor, padByFraction, rectEquals } from "./geometry";
import { resizeRect, type HandleName } from "./resize";
import type { BoardDoc, Rect, Vec2 } from "./types";

/**
 * How much room the stage gets when you come home to it. Generous on purpose:
 * this is the opening view, and it needs to say "the board is bigger than the
 * stage" at a glance, which it can only do by showing board around the edges.
 */
export const HOME_PADDING = 0.35;

/** Padding used when fitting the view around every tile. */
export const FIT_PADDING = 0.22;

/** A stage smaller than this is not a shot, it is an accident. */
export const MIN_STAGE = 120;

/**
 * The opening view: the stage, centred, with board visible around it.
 *
 * Home always lands here regardless of where you were, which is what makes it
 * safe to wander.
 */
export function homeView(stage: Rect, aspect: number): Rect {
  return frameFor(stage, aspect, HOME_PADDING);
}

/** The view that fits every tile on the board. A *view* move — never a stage move. */
export function fitView(bounds: Rect, aspect: number): Rect {
  return frameFor(bounds, aspect, FIT_PADDING);
}

/**
 * Force a proposed stage onto the output aspect and a sane minimum.
 *
 * Everything that writes the stage goes through here, so the stage can never
 * hold a rectangle the output cannot actually be.
 */
export function normaliseStage(proposed: Rect, aspect: number): Rect {
  const fitted = fitAspect(proposed, aspect);
  if (fitted.w >= MIN_STAGE && fitted.h >= MIN_STAGE) return fitted;
  // Grow about the centre rather than the origin, or a stage dragged small
  // would jump away from the cursor at the moment it hit the limit.
  const scale = Math.max(MIN_STAGE / fitted.w, MIN_STAGE / fitted.h);
  const w = fitted.w * scale;
  const h = fitted.h * scale;
  return { x: fitted.x + (fitted.w - w) / 2, y: fitted.y + (fitted.h - h) / 2, w, h };
}

/** Resize the stage from one of its handles. The aspect is never negotiable. */
export function resizeStage(
  original: Rect,
  handle: HandleName,
  delta: Vec2,
  aspect: number,
  options: { fromCenter?: boolean } = {},
): Rect {
  const resized = resizeRect(original, handle, delta, {
    keepAspect: true,
    fromCenter: options.fromCenter ?? false,
  });
  return normaliseStage(resized, aspect);
}

/** The eight stage handles, in board space. */
export function stageHandles(stage: Rect): Record<HandleName, Vec2> {
  const { x, y, w, h } = stage;
  return {
    nw: { x, y },
    n: { x: x + w / 2, y },
    ne: { x: x + w, y },
    e: { x: x + w, y: y + h / 2 },
    se: { x: x + w, y: y + h },
    s: { x: x + w / 2, y: y + h },
    sw: { x, y: y + h },
    w: { x, y: y + h / 2 },
  };
}

export function stageHandleAt(stage: Rect, point: Vec2, slop: number): HandleName | null {
  for (const [name, position] of Object.entries(stageHandles(stage))) {
    if (Math.abs(point.x - position.x) <= slop && Math.abs(point.y - position.y) <= slop) {
      return name as HandleName;
    }
  }
  return null;
}

/**
 * The label tab above the stage's top-left corner.
 *
 * It exists because a rectangle drawn on a canvas explains nothing: without a
 * name the first question anyone asks is "what is that box?". Height in screen
 * pixels; the caller converts.
 */
export const STAGE_TAB_HEIGHT = 21;

/**
 * The tab's width, in screen pixels, for a given label.
 *
 * Derived rather than measured so the renderer and the hit-test agree exactly.
 * A tab you can see but cannot click is worse than no tab.
 */
export function stageTabWidth(label: string): number {
  return 22 + label.length * 6.15;
}

export function stageTabRect(stage: Rect, height: number, width: number): Rect {
  return { x: stage.x, y: stage.y - height * 1.28, w: width, h: height };
}

/**
 * The tab for a stage at a given zoom, in board units.
 *
 * Sized in *screen* pixels and converted back, like the dot grid — a tab
 * measured in board units becomes unreadable the moment you zoom out.
 */
export function stageTabFor(stage: Rect, label: string, scale: number): Rect {
  return stageTabRect(stage, STAGE_TAB_HEIGHT / scale, stageTabWidth(label) / scale);
}

export type StageHit = "edge" | "tab" | null;

/**
 * What, if anything, the pointer is on.
 *
 * Deliberately *not* "anywhere inside the stage": the stage covers the middle
 * of the board, and swallowing every click there would make it impossible to
 * marquee-select or to click through to the canvas. Figma's frames work the
 * same way — you grab a frame by its edge or its name, never its middle.
 */
export function stageHit(
  stage: Rect,
  point: Vec2,
  slop: number,
  tab: Rect | null,
): StageHit {
  if (
    tab &&
    point.x >= tab.x &&
    point.x <= tab.x + tab.w &&
    point.y >= tab.y &&
    point.y <= tab.y + tab.h
  ) {
    return "tab";
  }
  const insideOuter =
    point.x >= stage.x - slop &&
    point.x <= stage.x + stage.w + slop &&
    point.y >= stage.y - slop &&
    point.y <= stage.y + stage.h + slop;
  if (!insideOuter) return null;
  const insideInner =
    stage.w > slop * 2 &&
    stage.h > slop * 2 &&
    point.x >= stage.x + slop &&
    point.x <= stage.x + stage.w - slop &&
    point.y >= stage.y + slop &&
    point.y <= stage.y + stage.h - slop;
  return insideInner ? null : "edge";
}

/** How the stage reads in the corner tab and the inspector. */
export function stageLabel(stage: Rect): string {
  return `${Math.round(stage.w)} × ${Math.round(stage.h)}`;
}

/**
 * Where the view has been.
 *
 * Only *jumps* are recorded — fitting, spotlighting, applying a scene, coming
 * home. A pan or a pinch is a continuous gesture, and filling the history with
 * one entry per mouse move would make Back useless.
 */
export class ViewHistory {
  private past: Rect[] = [];
  private future: Rect[] = [];

  constructor(private readonly limit = 60) {}

  /** Record `from` before jumping away from it. */
  push(from: Rect): void {
    const last = this.past[this.past.length - 1];
    if (last && rectEquals(last, from)) return;
    this.past.push({ ...from });
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  /** Step back, given where you are now. Returns null when there is nowhere to go. */
  back(current: Rect): Rect | null {
    const previous = this.past.pop();
    if (!previous) return null;
    this.future.unshift({ ...current });
    if (this.future.length > this.limit) this.future.pop();
    return previous;
  }

  forward(current: Rect): Rect | null {
    const next = this.future.shift();
    if (!next) return null;
    this.past.push({ ...current });
    return next;
  }

  get canGoBack(): boolean {
    return this.past.length > 0;
  }

  get canGoForward(): boolean {
    return this.future.length > 0;
  }

  clear(): void {
    this.past = [];
    this.future = [];
  }
}

/**
 * Everything worth looking at, as one rectangle.
 *
 * The stage is always included: an "everything" that scrolls the thing being
 * broadcast off screen is not everything. On an empty board this is just the
 * stage, which is why fitting on a fresh board no longer dives at a rectangle
 * of nothing.
 */
export function visibleBounds(doc: BoardDoc, tileBounds: Rect | null): Rect {
  if (!tileBounds) return { ...doc.frame };
  const x = Math.min(tileBounds.x, doc.frame.x);
  const y = Math.min(tileBounds.y, doc.frame.y);
  const right = Math.max(tileBounds.x + tileBounds.w, doc.frame.x + doc.frame.w);
  const bottom = Math.max(tileBounds.y + tileBounds.h, doc.frame.y + doc.frame.h);
  return { x, y, w: right - x, h: bottom - y };
}

/**
 * True when the operator has wandered off the stage.
 *
 * Drives the "you are looking away from the stage" hint — the cheapest possible
 * answer to "why does the board window not show what I see?".
 */
export function viewIsAwayFromStage(view: Rect, stage: Rect): boolean {
  const home = padByFraction(stage, HOME_PADDING);
  return !rectEquals(home, view, Math.max(1, stage.w * 0.03));
}
