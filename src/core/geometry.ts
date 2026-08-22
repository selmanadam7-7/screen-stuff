/**
 * Board-space maths.
 *
 * Everything the board draws lives in board space; the stage and the
 * operator's view are both rectangles of it. These helpers are pure so the
 * fiddly parts — fitting, framing, hit-testing rotated tiles — are testable
 * without a canvas.
 */

import type { Rect, Tile, Vec2 } from "./types";

export const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

export const rectCenter = (r: Rect): Vec2 => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

export const rectRight = (r: Rect) => r.x + r.w;
export const rectBottom = (r: Rect) => r.y + r.h;

export function rectEquals(a: Rect, b: Rect, epsilon = 0.01): boolean {
  return (
    Math.abs(a.x - b.x) < epsilon &&
    Math.abs(a.y - b.y) < epsilon &&
    Math.abs(a.w - b.w) < epsilon &&
    Math.abs(a.h - b.h) < epsilon
  );
}

export function containsPoint(r: Rect, p: Vec2): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Smallest rectangle containing all of them. Returns null for an empty list. */
export function boundingRect(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Grow (or shrink, with a negative amount) a rectangle on every side. */
export function inflate(r: Rect, amount: number): Rect {
  return { x: r.x - amount, y: r.y - amount, w: r.w + amount * 2, h: r.h + amount * 2 };
}

/** Grow a rectangle by a fraction of its own size. */
export function padByFraction(r: Rect, fraction: number): Rect {
  const dx = r.w * fraction;
  const dy = r.h * fraction;
  return { x: r.x - dx, y: r.y - dy, w: r.w + dx * 2, h: r.h + dy * 2 };
}

/**
 * Force a rectangle to an aspect ratio by growing the short side, keeping the
 * centre put. Growing rather than cropping means framing a tile never cuts part
 * of it off — you get letterboxing instead, which is the honest failure.
 */
export function fitAspect(r: Rect, aspect: number): Rect {
  const center = rectCenter(r);
  let w = r.w;
  let h = r.h;
  if (w / h > aspect) {
    h = w / aspect;
  } else {
    w = h * aspect;
  }
  return { x: center.x - w / 2, y: center.y - h / 2, w, h };
}

/** The frame that shows `target` with breathing room, locked to the output aspect. */
export function frameFor(target: Rect, aspect: number, padding = 0.06): Rect {
  return fitAspect(padByFraction(target, padding), aspect);
}

/**
 * Fit `content` (by aspect) inside `box`, centred. `contain` letterboxes,
 * `cover` fills and overflows — the caller clips.
 */
export function fitInto(
  box: Rect,
  contentW: number,
  contentH: number,
  mode: "contain" | "cover",
): Rect {
  if (contentW <= 0 || contentH <= 0) return { ...box };
  const scale =
    mode === "contain"
      ? Math.min(box.w / contentW, box.h / contentH)
      : Math.max(box.w / contentW, box.h / contentH);
  const w = contentW * scale;
  const h = contentH * scale;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

/** Map a point from board space into the pixel space of a viewport. */
export function boardToScreen(p: Vec2, view: Rect, canvasW: number, canvasH: number): Vec2 {
  return { x: ((p.x - view.x) / view.w) * canvasW, y: ((p.y - view.y) / view.h) * canvasH };
}

/** Map a pixel in the viewport back onto the board. */
export function screenToBoard(p: Vec2, view: Rect, canvasW: number, canvasH: number): Vec2 {
  return { x: view.x + (p.x / canvasW) * view.w, y: view.y + (p.y / canvasH) * view.h };
}

/** Zoom about a fixed board point — the point under the cursor stays put. */
export function zoomAround(view: Rect, anchor: Vec2, factor: number, limits = ZOOM_LIMITS): Rect {
  const nextW = clamp(view.w / factor, limits.minWidth, limits.maxWidth);
  const applied = view.w / nextW;
  const nextH = view.h / applied;
  return {
    x: anchor.x - (anchor.x - view.x) / applied,
    y: anchor.y - (anchor.y - view.y) / applied,
    w: nextW,
    h: nextH,
  };
}

export const ZOOM_LIMITS = { minWidth: 40, maxWidth: 400_000 };

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Ease used for every animated frame move. Slow in, slow out, no overshoot. */
export const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export function lerpRect(a: Rect, b: Rect, t: number): Rect {
  const k = easeInOutCubic(clamp(t, 0, 1));
  return {
    x: a.x + (b.x - a.x) * k,
    y: a.y + (b.y - a.y) * k,
    w: a.w + (b.w - a.w) * k,
    h: a.h + (b.h - a.h) * k,
  };
}

export const tileRect = (t: { x: number; y: number; w: number; h: number }): Rect => ({
  x: t.x,
  y: t.y,
  w: t.w,
  h: t.h,
});

/** Rotate a point about a centre, degrees clockwise. */
export function rotatePoint(p: Vec2, center: Vec2, degrees: number): Vec2 {
  if (degrees === 0) return { ...p };
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
}

/** Hit test that respects a tile's rotation. */
export function tileContains(tile: Tile, point: Vec2): boolean {
  const box = tileRect(tile);
  const local = rotatePoint(point, rectCenter(box), -tile.rotation);
  return containsPoint(box, local);
}

/**
 * Topmost tile under a point. Hidden and locked tiles are skipped — locked means
 * "I am done arranging this, stop grabbing it".
 */
export function tileAt(tiles: Tile[], point: Vec2, includeLocked = false): Tile | null {
  const ordered = [...tiles].sort((a, b) => b.z - a.z);
  for (const tile of ordered) {
    if (tile.hidden) continue;
    if (tile.locked && !includeLocked) continue;
    if (tileContains(tile, point)) return tile;
  }
  return null;
}

/** Snap a value to a grid, but only when it is already close. */
export function snap(value: number, step: number, threshold: number): number {
  const snapped = Math.round(value / step) * step;
  return Math.abs(snapped - value) <= threshold ? snapped : value;
}

/**
 * Snap a moving rectangle to the edges and centres of its neighbours.
 * Returns the adjusted position plus the guide lines worth drawing.
 */
export function snapToNeighbours(
  moving: Rect,
  others: Rect[],
  tolerance: number,
): { x: number; y: number; guides: { vertical: number[]; horizontal: number[] } } {
  const guides: { vertical: number[]; horizontal: number[] } = { vertical: [], horizontal: [] };
  let bestDx = tolerance + 1;
  let bestDy = tolerance + 1;
  let x = moving.x;
  let y = moving.y;

  const movingXs = [moving.x, moving.x + moving.w / 2, moving.x + moving.w];
  const movingYs = [moving.y, moving.y + moving.h / 2, moving.y + moving.h];

  for (const other of others) {
    const otherXs = [other.x, other.x + other.w / 2, other.x + other.w];
    const otherYs = [other.y, other.y + other.h / 2, other.y + other.h];

    for (let i = 0; i < movingXs.length; i++) {
      for (const target of otherXs) {
        const delta = target - movingXs[i];
        if (Math.abs(delta) < Math.abs(bestDx)) {
          bestDx = delta;
          x = moving.x + delta;
        }
      }
    }
    for (let i = 0; i < movingYs.length; i++) {
      for (const target of otherYs) {
        const delta = target - movingYs[i];
        if (Math.abs(delta) < Math.abs(bestDy)) {
          bestDy = delta;
          y = moving.y + delta;
        }
      }
    }
  }

  if (Math.abs(bestDx) > tolerance) x = moving.x;
  else guides.vertical.push(x, x + moving.w / 2, x + moving.w);
  if (Math.abs(bestDy) > tolerance) y = moving.y;
  else guides.horizontal.push(y, y + moving.h / 2, y + moving.h);

  return { x, y, guides };
}

/**
 * Lay tiles out in the tightest grid that fills a rectangle, keeping a common
 * aspect ratio. This is what "arrange all four monitors" calls.
 */
export function gridLayout(
  count: number,
  into: Rect,
  itemAspect: number,
  gap: number,
): Rect[] {
  if (count <= 0) return [];
  let best: { cols: number; rows: number; size: number } | null = null;

  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const cellW = (into.w - gap * (cols - 1)) / cols;
    const cellH = (into.h - gap * (rows - 1)) / rows;
    if (cellW <= 0 || cellH <= 0) continue;
    const w = Math.min(cellW, cellH * itemAspect);
    if (!best || w > best.size) best = { cols, rows, size: w };
  }
  if (!best) return [];

  const { cols, rows } = best;
  const w = best.size;
  const h = w / itemAspect;
  const totalW = cols * w + gap * (cols - 1);
  const totalH = rows * h + gap * (rows - 1);
  const startX = into.x + (into.w - totalW) / 2;
  const startY = into.y + (into.h - totalH) / 2;

  const out: Rect[] = [];
  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    // Centre the last, possibly short, row.
    const inRow = Math.min(cols, count - row * cols);
    const rowOffset = ((cols - inRow) * (w + gap)) / 2;
    out.push({
      x: startX + rowOffset + col * (w + gap),
      y: startY + row * (h + gap),
      w,
      h,
    });
  }
  return out;
}

/** Distance from a point to a line segment — used to hit-test ink strokes. */
export function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq;
  t = clamp(t, 0, 1);
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Douglas-Peucker, so a fast scribble does not save 4000 points. */
export function simplifyPoints(points: number[], tolerance: number): number[] {
  if (points.length <= 4) return [...points];
  const pts: Vec2[] = [];
  for (let i = 0; i < points.length; i += 2) pts.push({ x: points[i], y: points[i + 1] });

  const keep = new Array(pts.length).fill(false);
  keep[0] = true;
  keep[pts.length - 1] = true;

  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    let maxDistance = 0;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const d = distanceToSegment(pts[i], pts[first], pts[last]);
      if (d > maxDistance) {
        maxDistance = d;
        index = i;
      }
    }
    if (maxDistance > tolerance && index > 0) {
      keep[index] = true;
      stack.push([first, index], [index, last]);
    }
  }

  const out: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    if (keep[i]) out.push(pts[i].x, pts[i].y);
  }
  return out;
}
