/**
 * The editor canvas.
 *
 * Same renderer as the board window, but with chrome on and pointers wired up.
 * What you see here is the truth about what is on air: the stage is outlined,
 * named, and everything outside it — the whole rest of the infinite board — is
 * dimmed, because that part is yours alone.
 *
 * The stage is grabbed by its edge or its name tab, never its middle. Its
 * middle is where the tiles are, and a frame that swallowed clicks there would
 * make the board unusable.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { FrameClient } from "../core/frames";
import { MediaPool } from "../core/media";
import { handlePositions, renderBoard, HANDLE_SIZE } from "../core/render";
import { newId } from "../core/doc";
import {
  rectsOverlap,
  screenToBoard,
  simplifyPoints,
  snapToNeighbours,
  tileAt,
  tileRect,
  zoomAround,
} from "../core/geometry";
import type { BoardDoc, Rect, Stroke, Tile, Vec2 } from "../core/types";
import { CURSOR_FOR_HANDLE, resizeRect, type HandleName } from "../core/resize";
import { resizeStage, stageHandleAt, stageHit, stageLabel, stageTabFor } from "../core/stage";
import { useStore } from "./store";
import { Menu, type MenuEntry } from "../ui/primitives";

type Drag =
  | { kind: "none" }
  | { kind: "pan"; from: Vec2; view: Rect }
  | { kind: "marquee"; from: Vec2; to: Vec2; additive: boolean }
  | {
      kind: "move";
      from: Vec2;
      originals: Map<string, Rect>;
      moved: boolean;
    }
  | {
      kind: "resize";
      handle: HandleName;
      tileId: string;
      original: Rect;
      from: Vec2;
    }
  | { kind: "ink"; points: number[] }
  | { kind: "redact"; tileId: string; from: Vec2; to: Vec2 }
  | { kind: "stage-move"; from: Vec2; original: Rect; moved: boolean }
  | { kind: "stage-resize"; handle: HandleName; original: Rect; from: Vec2 };

export function Editor({
  client,
  onPool,
}: {
  client: FrameClient | null;
  /**
   * Hands the media pool up to the shell.
   *
   * The camera lives in exactly one place -- this pool -- and the feed
   * publisher reads it from here rather than opening the device again.
   */
  onPool?: (pool: MediaPool | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag>({ kind: "none" });
  const spaceRef = useRef(false);
  /** The document as it was when the current drag started — the undo target. */
  const beforeDragRef = useRef<BoardDoc | null>(null);
  const dirtyRef = useRef(true);
  const guidesRef = useRef<{ vertical: number[]; horizontal: number[] }>({
    vertical: [],
    horizontal: [],
  });
  const [cursor, setCursor] = useState("default");
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuEntry[] } | null>(null);

  const pool = useMemo(
    () =>
      client
        ? new MediaPool(client, {
            fps: 20, // the cockpit does not need 60 — the board does
            quality: 78,
            onFrame: () => {
              dirtyRef.current = true;
            },
          })
        : null,
    [client],
  );

  useEffect(() => () => pool?.destroy(), [pool]);

  useEffect(() => {
    onPool?.(pool);
    return () => onPool?.(null);
  }, [pool, onPool]);

  // ---------------------------------------------------------------------
  // Render loop
  // ---------------------------------------------------------------------
  useEffect(() => {
    let raf = 0;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      const wrap = wrapRef.current;
      if (!canvas || !wrap) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      // Measure the wrapper, never the canvas: the canvas is absolutely
      // positioned inside it precisely so it cannot influence this number.
      const bounds = wrap.getBoundingClientRect();
      const cssW = Math.max(1, Math.round(bounds.width));
      const cssH = Math.max(1, Math.round(bounds.height));
      const width = Math.round(cssW * dpr);
      const height = Math.round(cssH * dpr);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        dirtyRef.current = true;
      }

      const state = useStore.getState();
      state.tickFrameAnimation(now);

      // Keep the view's aspect matched to the canvas, or tiles would skew.
      const view = state.view;
      const canvasAspect = width / Math.max(1, height);
      const corrected: Rect =
        Math.abs(view.w / view.h - canvasAspect) > 0.001
          ? { ...view, h: view.w / canvasAspect }
          : view;

      const scale = width / corrected.w;
      pool?.sync(state.doc, scale / dpr);

      const drag = dragRef.current;
      const redacting =
        drag.kind === "redact"
          ? {
              x: Math.min(drag.from.x, drag.to.x),
              y: Math.min(drag.from.y, drag.to.y),
              w: Math.abs(drag.to.x - drag.from.x),
              h: Math.abs(drag.to.y - drag.from.y),
            }
          : null;
      const marquee =
        drag.kind === "marquee"
          ? {
              x: Math.min(drag.from.x, drag.to.x),
              y: Math.min(drag.from.y, drag.to.y),
              w: Math.abs(drag.to.x - drag.from.x),
              h: Math.abs(drag.to.y - drag.from.y),
            }
          : null;

      const liveInk: Stroke | null =
        drag.kind === "ink" && state.ink.tool
          ? {
              id: "live",
              tool: state.ink.tool,
              color: state.ink.color,
              width: state.ink.width,
              points: drag.points,
              createdAt: now,
            }
          : null;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      renderBoard({
        ctx,
        width,
        height,
        view: corrected,
        doc: liveInk ? { ...state.doc, strokes: [...state.doc.strokes, liveInk] } : state.doc,
        media: pool ?? { resolve: () => null },
        now,
        chrome: {
          selection: state.selection,
          // Always the live audience rectangle, so the outline is the truth
          // about what is on air. Stage drags cut rather than animate, so this
          // still tracks the cursor exactly.
          frame: state.frame,
          // A spotlight is a temporary override of the stage, not the stage. It
          // gets the outline but no name and no handles: dragging "the stage"
          // while looking at a spotlight would move a rectangle that is not the
          // one on screen.
          stage: state.spotlight
            ? undefined
            : {
                selected: state.stageSelected,
                locked: state.doc.stageLocked,
                label: `${state.isPrivate ? "Stage · private" : "Stage"} · ${stageLabel(state.doc.frame)}`,
              },
          guides: guidesRef.current,
          showGrid: state.doc.showGrid,
          marquee,
          redacting,
          isPrivate: state.isPrivate,
          hoverTileId: state.hover,
        },
      });
      dirtyRef.current = false;
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [pool]);

  // ---------------------------------------------------------------------
  // Pointer helpers
  // ---------------------------------------------------------------------

  const viewForCanvas = (): { view: Rect; width: number; height: number } => {
    const canvas = canvasRef.current!;
    const state = useStore.getState();
    const aspect = canvas.width / Math.max(1, canvas.height);
    const view =
      Math.abs(state.view.w / state.view.h - aspect) > 0.001
        ? { ...state.view, h: state.view.w / aspect }
        : state.view;
    return { view, width: canvas.width, height: canvas.height };
  };

  const toBoard = (event: { clientX: number; clientY: number }): Vec2 => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const dpr = canvas.width / rect.width;
    const { view, width, height } = viewForCanvas();
    return screenToBoard(
      { x: (event.clientX - rect.left) * dpr, y: (event.clientY - rect.top) * dpr },
      view,
      width,
      height,
    );
  };

  /** Board units per canvas pixel — used to size hit slop by zoom. */
  const boardPerPixel = (): number => {
    const { view, width } = viewForCanvas();
    return view.w / Math.max(1, width);
  };

  /**
   * The stage's tab in board units, at the current zoom.
   *
   * The renderer computes the same rectangle from the same helper, so what is
   * drawn and what is clickable can never drift apart.
   */
  const stageTab = (): Rect => {
    const state = useStore.getState();
    const { view, width } = viewForCanvas();
    const label = `${state.isPrivate ? "Stage · private" : "Stage"} · ${stageLabel(state.doc.frame)}`;
    return stageTabFor(state.doc.frame, label, width / view.w);
  };

  /** Where, if anywhere, the pointer is on the stage. Null during a spotlight. */
  const stageUnderPoint = (point: Vec2) => {
    const state = useStore.getState();
    if (state.spotlight) return null;
    return stageHit(state.doc.frame, point, HANDLE_SIZE * boardPerPixel(), stageTab());
  };

  /** A stage handle under the pointer, if the stage is selected and unlocked. */
  const stageHandleUnderPoint = (point: Vec2): HandleName | null => {
    const state = useStore.getState();
    if (!state.stageSelected || state.doc.stageLocked || state.spotlight) return null;
    return stageHandleAt(state.doc.frame, point, HANDLE_SIZE * boardPerPixel() * 1.6);
  };

  const handleUnderPoint = (point: Vec2): { tile: Tile; handle: HandleName } | null => {
    const state = useStore.getState();
    const slop = HANDLE_SIZE * boardPerPixel() * 1.6;
    for (const id of state.selection) {
      const tile = state.doc.tiles.find((t) => t.id === id);
      if (!tile || tile.locked) continue;
      for (const [name, position] of Object.entries(handlePositions(tile))) {
        if (Math.abs(point.x - position.x) <= slop && Math.abs(point.y - position.y) <= slop) {
          return { tile, handle: name as HandleName };
        }
      }
    }
    return null;
  };

  // ---------------------------------------------------------------------
  // Pointer events
  // ---------------------------------------------------------------------

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    setMenu(null);
    const canvas = canvasRef.current!;
    canvas.setPointerCapture(event.pointerId);
    const state = useStore.getState();
    const point = toBoard(event);
    // Captured before anything moves: a drag makes many small mutations with
    // history off, and this is the one state undo should return to.
    beforeDragRef.current = state.doc;

    // Middle mouse or space: pan, whatever else is going on.
    if (event.button === 1 || spaceRef.current) {
      dragRef.current = { kind: "pan", from: point, view: { ...state.view } };
      setCursor("grabbing");
      return;
    }

    if (event.button === 2) {
      openMenu(event, point);
      return;
    }

    // Drawing a never-shared rectangle beats every other pointer job while it
    // is armed: it is a deliberate mode the operator turned on.
    if (state.redacting) {
      const target = tileAt(state.doc.tiles, point, true);
      if (target) {
        dragRef.current = { kind: "redact", tileId: target.id, from: point, to: point };
        state.select([target.id]);
      } else {
        state.toast("drag over a tile", "warn");
      }
      return;
    }

    if (state.ink.tool) {
      dragRef.current = { kind: "ink", points: [point.x, point.y] };
      return;
    }

    // The stage's own handles come first: they sit on top of everything, and a
    // tile underneath one must not steal the grab.
    const stageHandle = stageHandleUnderPoint(point);
    if (stageHandle) {
      dragRef.current = {
        kind: "stage-resize",
        handle: stageHandle,
        original: { ...state.doc.frame },
        from: point,
      };
      return;
    }

    const handle = handleUnderPoint(point);
    if (handle) {
      dragRef.current = {
        kind: "resize",
        handle: handle.handle,
        tileId: handle.tile.id,
        original: tileRect(handle.tile),
        from: point,
      };
      return;
    }

    // The stage's edge and name tab, before tiles: they are a thin target, and
    // a tile lying under the edge would otherwise make the stage ungrabbable.
    const onStage = stageUnderPoint(point);
    if (onStage) {
      state.selectStage(true);
      if (!state.doc.stageLocked) {
        dragRef.current = {
          kind: "stage-move",
          from: point,
          original: { ...state.doc.frame },
          moved: false,
        };
        setCursor("move");
      }
      return;
    }

    const hit = tileAt(state.doc.tiles, point);
    if (hit) {
      const additive = event.shiftKey;
      const alreadySelected = state.selection.includes(hit.id);
      if (!alreadySelected) state.select([hit.id], additive);
      else if (additive) state.select(state.selection.filter((id) => id !== hit.id));

      const ids = useStore.getState().selection;
      const originals = new Map<string, Rect>();
      for (const id of ids) {
        const tile = state.doc.tiles.find((t) => t.id === id);
        if (tile && !tile.locked) originals.set(id, tileRect(tile));
      }
      dragRef.current = { kind: "move", from: point, originals, moved: false };
      return;
    }

    if (!event.shiftKey) {
      state.select([]);
      state.selectStage(false);
    }
    dragRef.current = { kind: "marquee", from: point, to: point, additive: event.shiftKey };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const state = useStore.getState();
    const point = toBoard(event);
    const drag = dragRef.current;

    if (drag.kind === "none") {
      const stageHandle = stageHandleUnderPoint(point);
      const handle = stageHandle ? null : handleUnderPoint(point);
      if (stageHandle || handle) {
        setCursor(CURSOR_FOR_HANDLE[stageHandle ?? handle!.handle]);
      } else if (!state.ink.tool && !spaceRef.current && stageUnderPoint(point)) {
        state.setHover(null);
        setCursor(state.doc.stageLocked ? "not-allowed" : "move");
      } else {
        const hit = tileAt(state.doc.tiles, point);
        state.setHover(hit?.id ?? null);
        setCursor(
          state.redacting
            ? "crosshair"
            : spaceRef.current
              ? "grab"
              : state.ink.tool
                ? "crosshair"
                : hit
                  ? "move"
                  : "default",
        );
      }
      return;
    }

    switch (drag.kind) {
      case "pan": {
        state.setView({
          ...state.view,
          x: drag.view.x + (drag.from.x - point.x),
          y: drag.view.y + (drag.from.y - point.y),
        });
        // Panning changes the mapping, so re-derive `from` against the new view.
        dragRef.current = { kind: "pan", from: toBoard(event), view: useStore.getState().view };
        break;
      }
      case "marquee": {
        dragRef.current = { ...drag, to: point };
        dirtyRef.current = true;
        break;
      }
      case "move": {
        const dx = point.x - drag.from.x;
        const dy = point.y - drag.from.y;
        if (!drag.moved && Math.hypot(dx, dy) < boardPerPixel() * 3) return;

        const ids = [...drag.originals.keys()];
        const tolerance = boardPerPixel() * 7;
        const others = state.doc.tiles
          .filter((t) => !ids.includes(t.id) && !t.hidden)
          .map(tileRect);
        others.push(state.doc.frame);

        // Snap using the first tile, then move the rest by the same delta so a
        // multi-selection keeps its internal spacing.
        const anchorId = ids[0];
        const anchor = drag.originals.get(anchorId)!;
        const moved = { ...anchor, x: anchor.x + dx, y: anchor.y + dy };
        const snapped = event.altKey
          ? { x: moved.x, y: moved.y, guides: { vertical: [], horizontal: [] } }
          : snapToNeighbours(moved, others, tolerance);
        guidesRef.current = snapped.guides;

        const finalDx = snapped.x - anchor.x;
        const finalDy = snapped.y - anchor.y;
        state.mutate(
          (d) => ({
            ...d,
            tiles: d.tiles.map((t) => {
              const original = drag.originals.get(t.id);
              return original ? { ...t, x: original.x + finalDx, y: original.y + finalDy } : t;
            }),
          }),
          { history: false },
        );
        dragRef.current = { ...drag, moved: true };
        break;
      }
      case "resize": {
        const next = resizeRect(
          drag.original,
          drag.handle,
          { x: point.x - drag.from.x, y: point.y - drag.from.y },
          { keepAspect: event.shiftKey, fromCenter: event.altKey },
        );
        state.mutate((d) => ({
          ...d,
          tiles: d.tiles.map((t) => (t.id === drag.tileId ? { ...t, ...next } : t)),
        }), { history: false });
        break;
      }
      case "redact": {
        dragRef.current = { ...drag, to: point };
        dirtyRef.current = true;
        break;
      }
      case "stage-move": {
        const dx = point.x - drag.from.x;
        const dy = point.y - drag.from.y;
        if (!drag.moved && Math.hypot(dx, dy) < boardPerPixel() * 3) return;
        const moved = { ...drag.original, x: drag.original.x + dx, y: drag.original.y + dy };
        // Snap the stage to the tiles, which is how you line a shot up on a
        // monitor edge without squinting.
        const tolerance = boardPerPixel() * 7;
        const others = state.doc.tiles.filter((tile) => !tile.hidden).map(tileRect);
        const snapped = event.altKey
          ? { x: moved.x, y: moved.y, guides: { vertical: [], horizontal: [] } }
          : snapToNeighbours(moved, others, tolerance);
        guidesRef.current = snapped.guides;
        state.setStage({ ...moved, x: snapped.x, y: snapped.y }, {
          transition: "cut",
          history: false,
        });
        dragRef.current = { ...drag, moved: true };
        break;
      }
      case "stage-resize": {
        const next = resizeStage(
          drag.original,
          drag.handle,
          { x: point.x - drag.from.x, y: point.y - drag.from.y },
          state.doc.aspect,
          { fromCenter: event.altKey },
        );
        state.setStage(next, { transition: "cut", history: false });
        break;
      }
      case "ink": {
        const points = [...drag.points, point.x, point.y];
        // Straight tools only ever need their two endpoints.
        const tool = state.ink.tool;
        dragRef.current = {
          kind: "ink",
          points:
            tool === "arrow" || tool === "box" || tool === "ellipse"
              ? [drag.points[0], drag.points[1], point.x, point.y]
              : points,
        };
        dirtyRef.current = true;
        break;
      }
    }
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    const state = useStore.getState();
    const drag = dragRef.current;
    dragRef.current = { kind: "none" };
    guidesRef.current = { vertical: [], horizontal: [] };
    setCursor("default");

    if (drag.kind === "marquee") {
      const area: Rect = {
        x: Math.min(drag.from.x, drag.to.x),
        y: Math.min(drag.from.y, drag.to.y),
        w: Math.abs(drag.to.x - drag.from.x),
        h: Math.abs(drag.to.y - drag.from.y),
      };
      if (area.w > 4 && area.h > 4) {
        const hits = state.doc.tiles
          .filter((t) => !t.hidden && !t.locked && rectsOverlap(area, tileRect(t)))
          .map((t) => t.id);
        state.select(hits, drag.additive);
      }
    }

    // One history entry for the whole drag, not one per mouse move.
    const mutated =
      (drag.kind === "move" && drag.moved) ||
      drag.kind === "resize" ||
      (drag.kind === "stage-move" && drag.moved) ||
      drag.kind === "stage-resize";
    if (mutated) commitHistory(beforeDragRef.current);
    beforeDragRef.current = null;

    if (drag.kind === "redact") {
      const rect: Rect = {
        x: Math.min(drag.from.x, drag.to.x),
        y: Math.min(drag.from.y, drag.to.y),
        w: Math.abs(drag.to.x - drag.from.x),
        h: Math.abs(drag.to.y - drag.from.y),
      };
      if (rect.w > 2 && rect.h > 2) state.addRedaction(drag.tileId, rect);
    }

    if (drag.kind === "ink" && state.ink.tool && drag.points.length >= 4) {
      const stroke: Stroke = {
        id: newId("ink"),
        tool: state.ink.tool,
        color: state.ink.color,
        width: state.ink.width,
        points:
          state.ink.tool === "pen" || state.ink.tool === "highlighter"
            ? simplifyPoints(drag.points, boardPerPixel() * 1.2)
            : drag.points,
        createdAt: performance.now(),
        fadeAfterMs: state.ink.temporary ? 2600 : undefined,
      };
      state.commitStroke(stroke);
    }
  };

  const onDoubleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const state = useStore.getState();
    const point = toBoard(event);
    const hit = tileAt(state.doc.tiles, point, true);
    if (hit) {
      state.toggleSpotlight(hit.id);
      return;
    }
    // Empty canvas: come home to the stage. This used to fit everything, which
    // on a fresh board zoomed straight onto the stage and left no way back to
    // the view you opened on.
    state.showStage();
  };

  const onWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    const state = useStore.getState();
    if (event.shiftKey) {
      state.panBy(event.deltaY * boardPerPixel(), 0);
      return;
    }
    const factor = Math.pow(1.0016, -event.deltaY);
    state.setView(zoomAround(state.view, toBoard(event), factor));
  };

  const openMenu = (event: { clientX: number; clientY: number }, point: Vec2) => {
    const state = useStore.getState();
    const hit = tileAt(state.doc.tiles, point, true);
    if (hit && !state.selection.includes(hit.id)) state.select([hit.id]);

    const onStage = !hit && stageUnderPoint(point) !== null;
    if (onStage) state.selectStage(true);

    const items: MenuEntry[] = onStage
      ? [
          {
            label: "Fit the stage around everything",
            onSelect: () => state.stageAroundEverything(),
          },
          { label: "Move the stage to my view", shortcut: "Enter", onSelect: () => state.bringThem() },
          { separator: true },
          { label: "Save this stage as a scene", shortcut: "Ctrl+S", onSelect: () => state.saveScene() },
          {
            label: state.doc.stageLocked ? "Unlock the stage" : "Lock the stage",
            onSelect: () => state.setStageLocked(!state.doc.stageLocked),
          },
        ]
      : hit
      ? [
          { label: "Spotlight", shortcut: "double-click", onSelect: () => state.toggleSpotlight(hit.id) },
          { label: "Bring to front", shortcut: "]", onSelect: () => state.order("front") },
          { label: "Send to back", shortcut: "[", onSelect: () => state.order("back") },
          { separator: true },
          { label: "Duplicate", shortcut: "Ctrl+D", onSelect: () => state.duplicateSelection() },
          {
            label: hit.locked ? "Unlock" : "Lock",
            shortcut: "Ctrl+L",
            onSelect: () => state.toggleLock(),
          },
          { separator: true },
          { label: "Remove", shortcut: "Del", danger: true, onSelect: () => state.deleteSelection() },
        ]
      : [
          { label: "Arrange everything onto the stage", onSelect: () => state.arrange("all") },
          { label: "Show the stage", shortcut: "0", onSelect: () => state.showStage() },
          { label: "Fit everything in view", shortcut: ")", onSelect: () => state.fitEverything() },
          { separator: true },
          { label: "Save this view as a scene", shortcut: "Ctrl+S", onSelect: () => state.saveScene() },
          { label: "Add a note", onSelect: () => state.addNote() },
          { separator: true },
          { label: "Clear all ink", onSelect: () => state.clearInk() },
        ];
    setMenu({ x: event.clientX, y: event.clientY, items });
  };

  // Space-to-pan.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isTyping(e.target)) {
        spaceRef.current = true;
        setCursor("grab");
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spaceRef.current = false;
        setCursor("default");
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  return (
    <div className="editor" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
      />
      {menu && <Menu x={menu.x} y={menu.y} entries={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}

/**
 * Close a drag off with one undo entry.
 *
 * It has to be the document from *before* the drag. Pushing the current one
 * put the state you are already looking at on top of the stack, so the first
 * Ctrl+Z appeared to do nothing at all.
 */
function commitHistory(before: BoardDoc | null) {
  if (!before) return;
  const state = useStore.getState();
  if (before === state.doc) return;
  useStore.setState((s) => ({
    past: [...s.past, before].slice(-80),
    future: [],
  }));
}

export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable;
}
