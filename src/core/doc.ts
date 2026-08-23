/**
 * Board document operations.
 *
 * Every function here is pure: give it a document, get a new one. The board
 * window holds the live document and the cockpit sends intents, so keeping the
 * transforms side-effect free is what lets both windows agree without a
 * synchronisation dance.
 */

import {
  boundingRect,
  fitAspect,
  frameFor,
  gridLayout,
  rect,
  rectEquals,
  tileRect,
} from "./geometry";
import { redactionsOf, type Redaction } from "./redact";
import { normaliseStage } from "./stage";
import type {
  BoardDoc,
  ImageTile,
  NoteTile,
  Rect,
  Scene,
  SourceTile,
  Stroke,
  Tile,
  TileBase,
  WebTile,
} from "./types";

export const DEFAULT_ASPECT = 16 / 9;
/** Board units are arbitrary; 1920 wide keeps the numbers familiar. */
export const FRAME_WIDTH = 1920;

let counter = 0;
export function newId(prefix = "t"): string {
  counter += 1;
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${random}`;
}

/** Reset between tests so ids are comparable. */
export function __resetIdCounter() {
  counter = 0;
}

export function emptyBoard(name = "Untitled board"): BoardDoc {
  const frame = rect(0, 0, FRAME_WIDTH, FRAME_WIDTH / DEFAULT_ASPECT);
  return {
    version: 1,
    name,
    frame,
    aspect: DEFAULT_ASPECT,
    stageLocked: false,
    tiles: [],
    strokes: [],
    scenes: [],
    background: "#08090D",
    showGrid: true,
    quality: 85,
    fps: 30,
    card: null,
    lowerThird: null,
  };
}

const baseTile = (overrides: Partial<TileBase> = {}): Omit<TileBase, "kind"> => ({
  id: newId(),
  x: 0,
  y: 0,
  w: 640,
  h: 360,
  z: 0,
  rotation: 0,
  opacity: 1,
  radius: 8,
  locked: false,
  hidden: false,
  fit: "contain",
  label: "",
  shadow: true,
  ...overrides,
});

export function nextZ(doc: BoardDoc): number {
  return doc.tiles.reduce((max, t) => Math.max(max, t.z), 0) + 1;
}

// ---------------------------------------------------------------------------
// Tile constructors
// ---------------------------------------------------------------------------

export function makeSourceTile(
  source: string,
  opts: Partial<SourceTile> & { nativeW?: number; nativeH?: number } = {},
): SourceTile {
  const aspect =
    opts.nativeW && opts.nativeH ? opts.nativeW / opts.nativeH : DEFAULT_ASPECT;
  const w = opts.w ?? 800;
  return {
    ...baseTile({ w, h: opts.h ?? w / aspect }),
    kind: "source",
    source,
    ...opts,
  } as SourceTile;
}

export function makeCameraTile(opts: Partial<Tile> = {}): Tile {
  // The id is generated first so the feed name can be derived from it, which
  // keeps the two permanently in step with no extra bookkeeping.
  const id = (opts.id as string | undefined) ?? newId();
  return {
    ...baseTile({ id, w: 480, h: 270, radius: 12 }),
    kind: "camera",
    mirrored: true,
    shape: "rect",
    fit: "cover",
    source: cameraFeedSource(id),
    ...opts,
  } as Tile;
}

/** Mirrors `cockpit/cameraFeeds.ts`; kept here so the document is self-contained. */
export function cameraFeedSource(tileId: string): string {
  return `feed:${`cam-${tileId.replace(/[^a-zA-Z0-9_-]/g, "")}`.slice(0, 64)}`;
}

export function makeImageTile(
  src: string,
  naturalW: number,
  naturalH: number,
  name = "Image",
  opts: Partial<ImageTile> = {},
): ImageTile {
  const w = opts.w ?? Math.min(900, naturalW);
  return {
    ...baseTile({ w, h: opts.h ?? (w * naturalH) / Math.max(1, naturalW) }),
    kind: "image",
    src,
    naturalW,
    naturalH,
    name,
    ...opts,
  } as ImageTile;
}

export function makeWebTile(url: string, opts: Partial<WebTile> = {}): WebTile {
  return {
    ...baseTile({ w: 1000, h: 700, radius: 6 }),
    kind: "web",
    url,
    interacting: false,
    fit: "cover",
    ...opts,
  } as WebTile;
}

export function makeVideoTile(src: string, name = "Video", opts: Partial<Tile> = {}): Tile {
  return {
    ...baseTile({ w: 960, h: 540, radius: 6 }),
    kind: "video",
    src,
    name,
    loop: false,
    muted: false,
    autoplay: false,
    ...opts,
  } as Tile;
}

export function makePdfTile(src: string, name = "Document", opts: Partial<Tile> = {}): Tile {
  return {
    ...baseTile({ w: 700, h: 906, radius: 4, fit: "contain" }),
    kind: "pdf",
    src,
    name,
    page: 1,
    pageCount: 1,
    ...opts,
  } as Tile;
}

export function makeNoteTile(text = "", opts: Partial<NoteTile> = {}): NoteTile {
  return {
    ...baseTile({ w: 420, h: 260, radius: 6, shadow: false }),
    kind: "note",
    text,
    color: "#F5D06B",
    textColor: "#171307",
    fontSize: 34,
    align: "left",
    ...opts,
  } as NoteTile;
}

// ---------------------------------------------------------------------------
// Document transforms
// ---------------------------------------------------------------------------

export function addTile(doc: BoardDoc, tile: Tile): BoardDoc {
  return { ...doc, tiles: [...doc.tiles, { ...tile, z: nextZ(doc) }] };
}

export function removeTiles(doc: BoardDoc, ids: string[]): BoardDoc {
  const gone = new Set(ids);
  return { ...doc, tiles: doc.tiles.filter((t) => !gone.has(t.id)) };
}

export function updateTile(doc: BoardDoc, id: string, patch: Partial<Tile>): BoardDoc {
  return {
    ...doc,
    tiles: doc.tiles.map((t) => (t.id === id ? ({ ...t, ...patch } as Tile) : t)),
  };
}

export function updateTiles(
  doc: BoardDoc,
  ids: string[],
  patch: (tile: Tile) => Partial<Tile>,
): BoardDoc {
  const targets = new Set(ids);
  return {
    ...doc,
    tiles: doc.tiles.map((t) => (targets.has(t.id) ? ({ ...t, ...patch(t) } as Tile) : t)),
  };
}

export function getTile(doc: BoardDoc, id: string): Tile | undefined {
  return doc.tiles.find((t) => t.id === id);
}

export function bringToFront(doc: BoardDoc, ids: string[]): BoardDoc {
  let z = nextZ(doc);
  const targets = new Set(ids);
  return {
    ...doc,
    tiles: doc.tiles.map((t) => (targets.has(t.id) ? { ...t, z: z++ } : t)),
  };
}

export function sendToBack(doc: BoardDoc, ids: string[]): BoardDoc {
  const targets = new Set(ids);
  const min = doc.tiles.reduce((m, t) => Math.min(m, t.z), 0);
  let z = min - ids.length;
  return {
    ...doc,
    tiles: doc.tiles.map((t) => (targets.has(t.id) ? { ...t, z: z++ } : t)),
  };
}

/** Duplicate, offset a little so the copy is visibly a copy. */
export function duplicateTiles(doc: BoardDoc, ids: string[]): { doc: BoardDoc; ids: string[] } {
  const targets = doc.tiles.filter((t) => ids.includes(t.id));
  const offset = 48;
  let z = nextZ(doc);
  const copies = targets.map((t) => ({
    ...t,
    id: newId(),
    x: t.x + offset,
    y: t.y + offset,
    z: z++,
  })) as Tile[];
  return { doc: { ...doc, tiles: [...doc.tiles, ...copies] }, ids: copies.map((c) => c.id) };
}

/** The rectangle enclosing every visible tile, or the stage if the board is bare. */
export function contentBounds(doc: BoardDoc): Rect {
  const visible = doc.tiles.filter((t) => !t.hidden).map(tileRect);
  return boundingRect(visible) ?? { ...doc.frame };
}

/**
 * The stage that would hold everything on the board.
 *
 * This is a *stage* move, not a view move — it changes what the audience sees.
 * It used to be wired to "fit everything", which meant looking around your own
 * board silently re-aimed the broadcast, and on an empty board grew the stage
 * by 8% every press.
 */
export function stageAroundEverything(doc: BoardDoc): Rect {
  // "Everything" on an empty board is nothing, and padding the stage around
  // itself is how it used to grow 8% on every press with no way back.
  if (!doc.tiles.some((tile) => !tile.hidden)) return { ...doc.frame };
  return frameFor(contentBounds(doc), doc.aspect, 0.08);
}

/** The stage that frames one tile — the spotlight move. */
export function frameTile(doc: BoardDoc, id: string): Rect | null {
  const tile = getTile(doc, id);
  if (!tile) return null;
  return frameFor(tileRect(tile), doc.aspect, 0.04);
}

/**
 * Arrange the given tiles into a grid filling the stage.
 * The four-monitor move, and the reason the board is worth having.
 */
export function arrangeInFrame(doc: BoardDoc, ids: string[], gap = 24): BoardDoc {
  const targets = doc.tiles.filter((t) => ids.includes(t.id));
  if (targets.length === 0) return doc;

  const inner = {
    x: doc.frame.x + gap,
    y: doc.frame.y + gap,
    w: doc.frame.w - gap * 2,
    h: doc.frame.h - gap * 2,
  };
  // Use the average aspect so a portrait tile in a landscape set does not
  // force everything into a letterbox.
  const aspect =
    targets.reduce((sum, t) => sum + t.w / Math.max(1, t.h), 0) / targets.length;
  const slots = gridLayout(targets.length, inner, aspect, gap);

  const byId = new Map(targets.map((t, i) => [t.id, slots[i]]));
  return {
    ...doc,
    tiles: doc.tiles.map((t) => {
      const slot = byId.get(t.id);
      return slot ? { ...t, x: slot.x, y: slot.y, w: slot.w, h: slot.h, rotation: 0 } : t;
    }),
  };
}

/** Drop a new tile just outside whatever is already there, so nothing is buried. */
export function placeBeside(doc: BoardDoc, gap = 48): { x: number; y: number } {
  const bounds = doc.tiles.length ? contentBounds(doc) : doc.frame;
  return { x: bounds.x + bounds.w + gap, y: bounds.y };
}

/** Centre a new tile on the stage, so a new tile lands on air. */
export function placeInFrame(doc: BoardDoc, w: number, h: number): { x: number; y: number } {
  return { x: doc.frame.x + (doc.frame.w - w) / 2, y: doc.frame.y + (doc.frame.h - h) / 2 };
}

/** Cover a part of a tile, permanently, in every output. */
export function addRedaction(doc: BoardDoc, tileId: string, redaction: Redaction): BoardDoc {
  return updateTile(doc, tileId, {
    redactions: [...redactionsOf(getTile(doc, tileId) ?? ({} as Tile)), redaction],
  } as Partial<Tile>);
}

export function removeRedaction(doc: BoardDoc, tileId: string, id: string): BoardDoc {
  const tile = getTile(doc, tileId);
  if (!tile) return doc;
  return updateTile(doc, tileId, {
    redactions: redactionsOf(tile).filter((r) => r.id !== id),
  } as Partial<Tile>);
}

export function clearRedactions(doc: BoardDoc, tileId: string): BoardDoc {
  return updateTile(doc, tileId, { redactions: [] } as Partial<Tile>);
}

export function setAspect(doc: BoardDoc, aspect: number): BoardDoc {
  return { ...doc, aspect, frame: fitAspect(doc.frame, aspect) };
}

/**
 * Move or resize the stage.
 *
 * The single writer: the stage lives in the document so it is saved, undoable
 * and shared by everything that reasons about it — arranging tiles, placing new
 * ones, the zoom readout. A locked stage refuses, which is what makes the lock
 * worth having mid-call.
 */
export function setStage(doc: BoardDoc, next: Rect, options: { force?: boolean } = {}): BoardDoc {
  if (doc.stageLocked && !options.force) return doc;
  const stage = normaliseStage(next, doc.aspect);
  if (rectEquals(doc.frame, stage)) return doc;
  return { ...doc, frame: stage };
}

// ---------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------

export function addScene(doc: BoardDoc, name: string, frame: Rect, hotkey = ""): BoardDoc {
  const scene: Scene = { id: newId("s"), name, hotkey, frame: { ...frame }, transition: "fly" };
  return { ...doc, scenes: [...doc.scenes, scene] };
}

export function updateScene(doc: BoardDoc, id: string, patch: Partial<Scene>): BoardDoc {
  // A hotkey can only belong to one scene, so claiming one releases it elsewhere.
  const claiming = patch.hotkey && patch.hotkey.length > 0 ? patch.hotkey : null;
  return {
    ...doc,
    scenes: doc.scenes.map((s) => {
      if (s.id === id) return { ...s, ...patch };
      if (claiming && s.hotkey === claiming) return { ...s, hotkey: "" };
      return s;
    }),
  };
}

export function removeScene(doc: BoardDoc, id: string): BoardDoc {
  return { ...doc, scenes: doc.scenes.filter((s) => s.id !== id) };
}

export function sceneForKey(doc: BoardDoc, key: string): Scene | undefined {
  return doc.scenes.find((s) => s.hotkey && s.hotkey.toLowerCase() === key.toLowerCase());
}

// ---------------------------------------------------------------------------
// Ink
// ---------------------------------------------------------------------------

export function addStroke(doc: BoardDoc, stroke: Stroke): BoardDoc {
  return { ...doc, strokes: [...doc.strokes, stroke] };
}

export function removeStrokes(doc: BoardDoc, ids: string[]): BoardDoc {
  const gone = new Set(ids);
  return { ...doc, strokes: doc.strokes.filter((s) => !gone.has(s.id)) };
}

export function clearInk(doc: BoardDoc): BoardDoc {
  return { ...doc, strokes: [] };
}

/** Drop strokes that were drawn as temporary and have outlived their fade. */
export function expireStrokes(doc: BoardDoc, now: number): BoardDoc {
  const kept = doc.strokes.filter(
    (s) => !s.fadeAfterMs || now - s.createdAt < s.fadeAfterMs + STROKE_FADE_MS,
  );
  return kept.length === doc.strokes.length ? doc : { ...doc, strokes: kept };
}

export const STROKE_FADE_MS = 700;

/** Opacity for a temporary stroke that is on its way out. */
export function strokeOpacity(stroke: Stroke, now: number): number {
  if (!stroke.fadeAfterMs) return 1;
  const age = now - stroke.createdAt;
  if (age <= stroke.fadeAfterMs) return 1;
  return Math.max(0, 1 - (age - stroke.fadeAfterMs) / STROKE_FADE_MS);
}

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

/**
 * Load a document that may have come from an older version, a hand-edited file,
 * or a future version of the app. Never throws: a board that half-loads still
 * beats a blank screen thirty seconds before a call.
 */
export function reviveBoard(raw: unknown, fallbackName = "Recovered board"): BoardDoc {
  const base = emptyBoard(fallbackName);
  if (!raw || typeof raw !== "object") return base;
  const input = raw as Partial<BoardDoc>;

  const frame =
    input.frame && Number.isFinite(input.frame.w) && input.frame.w > 0
      ? input.frame
      : base.frame;
  const aspect =
    typeof input.aspect === "number" && input.aspect > 0.1 && input.aspect < 10
      ? input.aspect
      : base.aspect;

  const tiles = Array.isArray(input.tiles)
    ? input.tiles.filter(isPlausibleTile).map((t, i) => ({
        ...t,
        z: Number.isFinite(t.z) ? t.z : i,
        opacity: Number.isFinite(t.opacity) ? t.opacity : 1,
        rotation: Number.isFinite(t.rotation) ? t.rotation : 0,
        radius: Number.isFinite(t.radius) ? t.radius : 8,
        label: typeof t.label === "string" ? t.label : "",
        // A redaction that failed to load would silently un-hide something, so
        // anything malformed is dropped rather than guessed at.
        ...(Array.isArray((t as { redactions?: unknown }).redactions)
          ? {
              redactions: ((t as { redactions: unknown[] }).redactions as Redaction[]).filter(
                (r) =>
                  r &&
                  typeof r.id === "string" &&
                  [r.x, r.y, r.w, r.h].every((v) => typeof v === "number" && v >= 0 && v <= 1),
              ),
            }
          : {}),
        fit: t.fit === "cover" ? "cover" : "contain",
        // Boards saved before camera feeds existed have no source on their
        // camera tiles; deriving it on load costs nothing and fixes them.
        ...(t.kind === "camera" && !(t as { source?: string }).source
          ? { source: cameraFeedSource(t.id) }
          : {}),
      }))
    : [];

  return {
    ...base,
    name: typeof input.name === "string" && input.name ? input.name : base.name,
    frame,
    aspect,
    stageLocked: input.stageLocked === true,
    tiles: tiles as Tile[],
    strokes: Array.isArray(input.strokes) ? (input.strokes.filter(isPlausibleStroke) as Stroke[]) : [],
    scenes: Array.isArray(input.scenes) ? (input.scenes.filter(isPlausibleScene) as Scene[]) : [],
    background: typeof input.background === "string" ? input.background : base.background,
    showGrid: typeof input.showGrid === "boolean" ? input.showGrid : base.showGrid,
    quality: clampNumber(input.quality, 30, 100, base.quality),
    fps: clampNumber(input.fps, 1, 120, base.fps),
    // A card is a live decision, not a property of the board. Reopening a board
    // that was saved with "back in a minute" up should not put it back on air.
    card: null,
    lowerThird:
      input.lowerThird && typeof input.lowerThird.name === "string"
        ? { name: input.lowerThird.name, role: String(input.lowerThird.role ?? "") }
        : null,
  };
}

function clampNumber(v: unknown, lo: number, hi: number, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}

const TILE_KINDS = new Set(["source", "camera", "image", "web", "video", "pdf", "note"]);

function isPlausibleTile(t: unknown): t is Tile {
  if (!t || typeof t !== "object") return false;
  const tile = t as Partial<Tile>;
  return (
    typeof tile.id === "string" &&
    typeof tile.kind === "string" &&
    TILE_KINDS.has(tile.kind) &&
    Number.isFinite(tile.x) &&
    Number.isFinite(tile.y) &&
    Number.isFinite(tile.w) &&
    Number.isFinite(tile.h) &&
    (tile.w as number) > 0 &&
    (tile.h as number) > 0
  );
}

function isPlausibleStroke(s: unknown): s is Stroke {
  if (!s || typeof s !== "object") return false;
  const stroke = s as Partial<Stroke>;
  return (
    typeof stroke.id === "string" &&
    Array.isArray(stroke.points) &&
    stroke.points.length >= 4 &&
    stroke.points.every((n) => Number.isFinite(n))
  );
}

function isPlausibleScene(s: unknown): s is Scene {
  if (!s || typeof s !== "object") return false;
  const scene = s as Partial<Scene>;
  return (
    typeof scene.id === "string" &&
    typeof scene.name === "string" &&
    !!scene.frame &&
    Number.isFinite(scene.frame.w) &&
    (scene.frame.w as number) > 0
  );
}
