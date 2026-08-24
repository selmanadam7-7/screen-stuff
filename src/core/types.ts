/**
 * The board document.
 *
 * One rule runs through all of this: the board is an infinite plane in "board
 * space", and the audience sees one rectangle of it called the *stage*. Tiles
 * are positioned in board space and know nothing about the stage — which is
 * what makes "zoom into monitor two" the same operation as "show all four", and
 * what makes everything outside the stage private without any extra machinery.
 */

import type { HoldingCard, LowerThird } from "./overlays";
import type { Pin } from "./pin";
import type { Redaction } from "./redact";

export type Rect = { x: number; y: number; w: number; h: number };
export type Vec2 = { x: number; y: number };

export type TileKind = "source" | "camera" | "image" | "web" | "video" | "pdf" | "note";

/** How a tile's content is fitted into its box. */
export type FitMode = "contain" | "cover";

export interface TileBase {
  id: string;
  kind: TileKind;
  /** Board-space geometry. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Paint order, low to high. */
  z: number;
  /** Degrees, clockwise, about the tile centre. */
  rotation: number;
  opacity: number;
  /** Corner radius in board units. */
  radius: number;
  locked: boolean;
  hidden: boolean;
  fit: FitMode;
  /** Optional caption drawn under the tile. Empty means none. */
  label: string;
  /** Drawn behind the tile so a light source on a dark board still reads. */
  shadow: boolean;
  /**
   * Parts of this tile that never reach the audience.
   *
   * Stored as fractions of the tile so they stay put when it is moved, resized
   * or re-tuned to a different capture resolution. See `core/redact.ts`.
   */
  redactions?: Redaction[];
  /**
   * Parked in a corner of the shot, and moves with it.
   *
   * A pinned tile ignores the geometry above: its box is derived from wherever
   * the stage is, every frame. See `core/pin.ts` for why that is derived rather
   * than written back.
   */
  pin?: Pin | null;
}

export interface SourceTile extends TileBase {
  kind: "source";
  /** A `SourceId` string: monitor:1, window:12345, region:monitor:1@x,y,w,h */
  source: string;
  /** JPEG quality for this tile specifically. Undefined means "use the board default". */
  quality?: number;
  fps?: number;
  /** Native pixel size, learned from the first frame. Used for aspect before any frame lands. */
  nativeW?: number;
  nativeH?: number;
}

export interface CameraTile extends TileBase {
  kind: "camera";
  deviceId?: string;
  mirrored: boolean;
  shape: "rect" | "circle";
  /**
   * The feed this camera is published under, as `feed:<name>`. The host reads
   * the camera directly; guests read this. Without it a guest would open their
   * own webcam where the host's face should be.
   */
  source: string;
}

export interface ImageTile extends TileBase {
  kind: "image";
  /** Object URL, data URL, or asset:// path. */
  src: string;
  naturalW: number;
  naturalH: number;
  name: string;
}

export interface WebTile extends TileBase {
  kind: "web";
  url: string;
  /** The app-owned browser window backing this tile, once it exists. */
  source?: string;
  /** True while the window is pulled forward so the operator can click in it. */
  interacting: boolean;
}

export interface VideoTile extends TileBase {
  kind: "video";
  src: string;
  name: string;
  loop: boolean;
  muted: boolean;
  autoplay: boolean;
}

export interface PdfTile extends TileBase {
  kind: "pdf";
  src: string;
  name: string;
  page: number;
  pageCount: number;
}

export interface NoteTile extends TileBase {
  kind: "note";
  text: string;
  color: string;
  textColor: string;
  fontSize: number;
  align: "left" | "center";
}

export type Tile =
  | SourceTile
  | CameraTile
  | ImageTile
  | WebTile
  | VideoTile
  | PdfTile
  | NoteTile;

export type InkTool = "pen" | "highlighter" | "arrow" | "box" | "ellipse";

export interface Stroke {
  id: string;
  tool: InkTool;
  color: string;
  width: number;
  /** Flat [x0,y0,x1,y1,...] in board space. Arrow/box/ellipse use exactly two points. */
  points: number[];
  /** Strokes drawn in "temporary" mode fade out on their own. */
  fadeAfterMs?: number;
  createdAt: number;
}

export interface Scene {
  id: string;
  name: string;
  /** Single character, matched against the digit/letter row. Empty means unbound. */
  hotkey: string;
  frame: Rect;
  transition: "cut" | "fly";
}

export interface BoardDoc {
  version: 1;
  name: string;
  /**
   * The stage: the rectangle the audience sees, in board space.
   *
   * Saved with the board, because a stage you have to rebuild every session is
   * not a stage. Everything outside it is the operator's private workspace.
   */
  frame: Rect;
  /** Output aspect ratio the stage is locked to. */
  aspect: number;
  /** Stops the stage being dragged or resized by accident mid-call. */
  stageLocked: boolean;
  tiles: Tile[];
  strokes: Stroke[];
  scenes: Scene[];
  background: string;
  showGrid: boolean;
  /** Default JPEG quality for source tiles that do not override it. */
  quality: number;
  /** Default frame rate for source tiles. */
  fps: number;
  /** What the audience sees instead of the board, when one is up. */
  card?: HoldingCard | null;
  /** Your name and what you do, in the corner of the shot. */
  lowerThird?: LowerThird | null;
}

export type NavMode = "free" | "spotlight" | "follow";

/** Live state that is not part of the saved document. */
export interface BoardRuntime {
  /** What the operator is looking at. Independent of the stage by default. */
  view: Rect;
  private: boolean;
  selection: string[];
  /** Which tile is currently spotlit, if any. */
  spotlight: string | null;
  navModes: Record<NavMode, boolean>;
  inkTool: InkTool | null;
  inkColor: string;
  inkWidth: number;
  /** Set while the operator is dragging out a new region. */
  live: { camera: boolean; guests: number };
}

export interface SourceInfo {
  id: string;
  kind: "monitor" | "window" | "region";
  title: string;
  subtitle: string;
  width: number;
  height: number;
  x: number;
  y: number;
  isPrimary: boolean;
}

export interface SessionInfo {
  streamUrl: string;
  version: string;
  dataDir: string;
  desktop: { x: number; y: number; width: number; height: number };
}

export interface BoardMeta {
  id: string;
  name: string;
  kind: "board" | "template";
  updated_at: number;
  created_at: number;
  note: string;
}

export interface ServerStats {
  sessions: number;
  streams: number;
  frames_encoded: number;
  bytes_sent: number;
  dropped_frames: number;
  encode_ms_avg: number;
}
