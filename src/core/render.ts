/**
 * The compositor.
 *
 * One function draws the board, and it is used twice:
 *
 *   * the **board window** calls it with the stage as the view and no chrome — that
 *     canvas is the output, and anything drawn on it goes on air;
 *   * the **cockpit** calls it with the operator's view and full chrome —
 *     selection, handles, guides, the frame outline.
 *
 * Sharing the draw path is what guarantees the cockpit is telling the truth
 * about what the audience sees.
 */

import { fitInto, rectCenter, tileRect } from "./geometry";
import { strokeOpacity } from "./doc";
import { countdownText, lowerThirdRect } from "./overlays";
import { redactionsOf, toBoardRect } from "./redact";
import { stageHandles, stageTabFor } from "./stage";
import { readTheme, type Theme } from "./theme";
import type { BoardDoc, Rect, Stroke, Tile, Vec2 } from "./types";

/** Height of a tile's title bar, in board units, before zoom is applied. */
export const TILE_BAR = 34;

/** Tiles that read as a window and get a title bar drawn above their content. */
const WINDOWED: ReadonlySet<string> = new Set(["source", "web", "video", "pdf"]);

export function hasTitleBar(tile: Tile): boolean {
  return WINDOWED.has(tile.kind);
}

/** Anything the renderer can paint into a tile. */
export interface Drawable {
  image: CanvasImageSource;
  width: number;
  height: number;
}

export interface MediaResolver {
  /** Return the current pixels for a tile, or null if it has nothing yet. */
  resolve(tile: Tile): Drawable | null;
  /** A short line explaining why a tile is blank ("window closed", "connecting"). */
  statusFor?(tile: Tile): string | null;
}

export interface ChromeOptions {
  selection: string[];
  /** The stage, outlined so the operator can see what is on air. */
  frame: Rect | null;
  /** How the stage is drawn. Absent means "just the outline", as on the board. */
  stage?: {
    selected: boolean;
    locked: boolean;
    /** The tab text, e.g. "Stage · 1920 × 1080". */
    label: string;
  };
  guides?: { vertical: number[]; horizontal: number[] };
  showGrid: boolean;
  /** Drawn while dragging out a new tile or marquee. */
  marquee?: Rect | null;
  /** Drawn while dragging out a part of a tile to hide. */
  redacting?: Rect | null;
  /** True when the audience has been held on the last shot. */
  isPrivate: boolean;
  hoverTileId?: string | null;
}

export interface RenderInput {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  view: Rect;
  doc: BoardDoc;
  media: MediaResolver;
  now: number;
  chrome?: ChromeOptions;
  /**
   * Where the operator is pointing, drawn for the audience.
   *
   * Absent in the cockpit on purpose: the operator can already see their own
   * mouse, and a second one drawn under it is just noise.
   */
  pointer?: {
    at: Vec2 | null;
    ripples: Array<{ x: number; y: number; progress: number }>;
  } | null;
  /** Resolved design tokens. Read from the document when not supplied. */
  theme?: Theme;
}

/** Everything the chrome needs, derived from the tokens for the current look. */
function chromeColors(theme: Theme) {
  return {
    dot: theme.dot,
    frame: theme.accent,
    frameDim: theme.ink3,
    selection: theme.accent,
    handle: theme.panel,
    handleEdge: theme.accent,
    tabText: theme.onAccent,
    guide: theme.danger,
    hover: theme.ink3,
    // Always darkens: on a white canvas a light scrim is no scrim at all.
    scrim: theme.dark ? "rgba(6,8,12,0.55)" : "rgba(20,24,32,0.07)",
    placeholder: theme.panelAlt,
    placeholderText: theme.ink3,
  };
}

export function renderBoard(input: RenderInput): void {
  const { ctx, width, height, view, doc, chrome } = input;
  const scale = width / view.w;
  const theme = input.theme ?? readTheme();

  ctx.save();
  ctx.clearRect(0, 0, width, height);
  // The board window paints the document's own background; the cockpit paints
  // the app canvas, so the two are visibly different surfaces.
  ctx.fillStyle = chrome ? theme.canvas : doc.background;
  ctx.fillRect(0, 0, width, height);

  // Everything below draws in board units.
  ctx.translate(-view.x * scale, -view.y * scale);
  ctx.scale(scale, scale);

  if (chrome?.showGrid) drawDotGrid(ctx, view, scale, theme);

  const ordered = [...doc.tiles].sort((a, b) => a.z - b.z);
  for (const tile of ordered) {
    if (tile.hidden) continue;
    drawTile(input, tile, scale, theme);
  }

  drawStrokes(ctx, doc.strokes, input.now, scale);

  if (input.pointer) drawPointer(ctx, input.pointer, scale, theme);
  // On the stage, over everything, under only the operator's own chrome.
  drawOverlays(ctx, doc, scale, theme);
  if (chrome) drawChrome(ctx, doc, chrome, scale, theme);

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------

function drawTile(input: RenderInput, tile: Tile, scale: number, theme: Theme) {
  const { ctx, media } = input;
  const box = tileRect(tile);
  const center = rectCenter(box);
  const bar = hasTitleBar(tile) ? Math.min(TILE_BAR, box.h * 0.16) : 0;
  const body: Rect = { x: box.x, y: box.y + bar, w: box.w, h: box.h - bar };

  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, tile.opacity));

  if (tile.rotation !== 0) {
    ctx.translate(center.x, center.y);
    ctx.rotate((tile.rotation * Math.PI) / 180);
    ctx.translate(-center.x, -center.y);
  }

  if (tile.shadow) {
    ctx.save();
    ctx.shadowColor = theme.dark ? "rgba(0,0,0,0.6)" : "rgba(20,24,32,0.16)";
    ctx.shadowBlur = 28;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = theme.panel;
    pathTile(ctx, tile, box);
    ctx.fill();
    ctx.restore();
  }

  // The window shell: a panel-coloured card the content sits inside.
  if (bar > 0) {
    ctx.save();
    pathTile(ctx, tile, box);
    ctx.fillStyle = theme.panel;
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  if (bar > 0) {
    // Content is clipped to the body only, so it never rides over the bar.
    ctx.beginPath();
    ctx.rect(body.x, body.y, body.w, body.h);
    ctx.clip();
  } else {
    pathTile(ctx, tile, box);
    ctx.clip();
  }

  if (tile.kind === "note") {
    drawNote(ctx, tile, box, theme);
  } else {
    const drawable = media.resolve(tile);
    if (drawable && drawable.width > 0 && drawable.height > 0) {
      const target = fitInto(body, drawable.width, drawable.height, tile.fit);
      if (tile.kind === "camera" && (tile as any).mirrored) {
        ctx.save();
        ctx.translate(target.x + target.w / 2, 0);
        ctx.scale(-1, 1);
        ctx.translate(-(target.x + target.w / 2), 0);
        ctx.drawImage(drawable.image, target.x, target.y, target.w, target.h);
        ctx.restore();
      } else {
        ctx.drawImage(drawable.image, target.x, target.y, target.w, target.h);
      }
    } else {
      drawPlaceholder(ctx, tile, body, media.statusFor?.(tile) ?? null, scale, theme);
    }
  }

  // Covered before the clip is released, so a redaction can never be drawn
  // outside the tile it belongs to — and before the title bar, which is ours
  // rather than the captured window's.
  drawRedactions(ctx, tile, body, scale, theme);

  ctx.restore();

  if (bar > 0) drawTitleBar(ctx, tile, box, bar, scale, theme);

  // A caption sits inside the tile and inside its clip. Drawn below the tile it
  // collided with whatever sat under it — in an arranged grid, the next row
  // painted straight over the row above's captions.
  if (tile.label && bar === 0) {
    ctx.save();
    pathTile(ctx, tile, box);
    ctx.clip();
    drawLabel(ctx, tile, box, scale, theme);
    ctx.restore();
  }

  // A hairline over the whole card, so a white tile still has an edge on white.
  ctx.save();
  pathTile(ctx, tile, box);
  ctx.strokeStyle = theme.line;
  ctx.lineWidth = 1 / scale;
  ctx.stroke();
  ctx.restore();

  ctx.restore();
}

/**
 * A tile's title bar: its name on the left, a Live pill on the right. Every
 * reference screenshot draws screens this way, and it is genuinely useful —
 * four unlabelled captures of the same desktop are impossible to tell apart.
 */
function drawTitleBar(
  ctx: CanvasRenderingContext2D,
  tile: Tile,
  box: Rect,
  bar: number,
  scale: number,
  theme: Theme,
) {
  const radius = Math.min(tile.radius, box.w / 2, box.h / 2);

  ctx.save();
  ctx.beginPath();
  // Rounded on top, square where it meets the content.
  ctx.moveTo(box.x, box.y + bar);
  ctx.lineTo(box.x, box.y + radius);
  ctx.quadraticCurveTo(box.x, box.y, box.x + radius, box.y);
  ctx.lineTo(box.x + box.w - radius, box.y);
  ctx.quadraticCurveTo(box.x + box.w, box.y, box.x + box.w, box.y + radius);
  ctx.lineTo(box.x + box.w, box.y + bar);
  ctx.closePath();
  ctx.fillStyle = theme.panel;
  ctx.fill();
  ctx.clip();

  const size = Math.min(bar * 0.42, 15);
  const pad = bar * 0.42;
  ctx.font = `500 ${size}px ${UI_FONT}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";

  const name = tile.label || defaultTileName(tile);
  const live = isLiveKind(tile);
  const pillW = live ? size * 2.9 : 0;
  const room = box.w - pad * 2 - (live ? pillW + pad : 0);

  ctx.fillStyle = theme.ink;
  ctx.fillText(ellipsise(ctx, name, room), box.x + pad, box.y + bar / 2);

  if (live) {
    const pillH = size * 1.5;
    const px = box.x + box.w - pad - pillW;
    const py = box.y + (bar - pillH) / 2;
    ctx.beginPath();
    ctx.roundRect(px, py, pillW, pillH, pillH / 2);
    ctx.fillStyle = theme.accent;
    ctx.fill();
    ctx.fillStyle = theme.onAccent;
    ctx.font = `600 ${size * 0.78}px ${UI_FONT}`;
    ctx.textAlign = "center";
    ctx.fillText("Live", px + pillW / 2, py + pillH / 2 + size * 0.03);
  }

  ctx.restore();

  // The rule under the bar.
  ctx.save();
  ctx.strokeStyle = theme.lineSoft;
  ctx.lineWidth = 1 / scale;
  ctx.beginPath();
  ctx.moveTo(box.x, box.y + bar);
  ctx.lineTo(box.x + box.w, box.y + bar);
  ctx.stroke();
  ctx.restore();
}

const UI_FONT = '"Inter Variable", Inter, "Segoe UI", system-ui, sans-serif';

function isLiveKind(tile: Tile): boolean {
  return tile.kind === "source" || tile.kind === "web";
}

function defaultTileName(tile: Tile): string {
  switch (tile.kind) {
    case "source":
      return tile.source;
    case "web":
      return (tile as { url: string }).url;
    case "video":
    case "pdf":
      return (tile as { name?: string }).name ?? tile.kind;
    default:
      return "";
  }
}

/** A tile's silhouette: rounded rectangle, or a circle for a round camera. */
function pathTile(ctx: CanvasRenderingContext2D, tile: Tile, box: Rect) {
  ctx.beginPath();
  if (tile.kind === "camera" && (tile as any).shape === "circle") {
    const radius = Math.min(box.w, box.h) / 2;
    ctx.arc(box.x + box.w / 2, box.y + box.h / 2, radius, 0, Math.PI * 2);
    return;
  }
  const r = Math.min(tile.radius, box.w / 2, box.h / 2);
  ctx.roundRect(box.x, box.y, box.w, box.h, r);
}

function drawPlaceholder(
  ctx: CanvasRenderingContext2D,
  tile: Tile,
  box: Rect,
  status: string | null,
  scale: number,
  theme: Theme,
) {
  ctx.fillStyle = theme.panelAlt;
  ctx.fillRect(box.x, box.y, box.w, box.h);

  const text = status ?? defaultPlaceholder(tile);
  if (!text) return;

  // Keep placeholder type legible whatever the zoom.
  const size = Math.max(11 / scale, Math.min(box.h * 0.09, 22));
  ctx.fillStyle = theme.ink3;
  ctx.font = `500 ${size}px ${UI_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, box.x + box.w / 2, box.y + box.h / 2, box.w * 0.86);
}

function defaultPlaceholder(tile: Tile): string {
  switch (tile.kind) {
    case "source":
      return "waiting for the first frame";
    case "camera":
      return "camera off";
    case "web":
      return "loading page";
    case "video":
      return "video";
    case "pdf":
      return "rendering page";
    default:
      return "";
  }
}

/** A caption in the tile's bottom-left corner, the way a lower third sits. */
function drawLabel(
  ctx: CanvasRenderingContext2D,
  tile: Tile,
  box: Rect,
  scale: number,
  theme: Theme,
) {
  const size = Math.max(11 / scale, Math.min(box.w * 0.03, 26));
  const padX = size * 0.62;
  const padY = size * 0.36;
  const inset = size * 0.5;

  ctx.font = `600 ${size}px ${UI_FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";

  const label = ellipsise(ctx, tile.label, box.w - inset * 2 - padX * 2);
  const w = Math.min(ctx.measureText(label).width + padX * 2, box.w - inset * 2);
  const h = size + padY * 2;
  const x = box.x + inset;
  const y = box.y + box.h - inset - h;

  ctx.fillStyle = theme.dark ? "rgba(8,9,13,0.82)" : "rgba(255,255,255,0.92)";
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
  ctx.fill();
  ctx.strokeStyle = theme.line;
  ctx.lineWidth = 1 / scale;
  ctx.stroke();

  ctx.fillStyle = theme.ink;
  ctx.fillText(label, x + padX, y + padY, w - padX * 2);
}

/** Trim a caption to fit, with a middle-dot ellipsis rather than a hard cut. */
export function ellipsise(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (maxWidth <= 0) return "";
  if (ctx.measureText(text).width <= maxWidth) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxWidth) low = mid;
    else high = mid - 1;
  }
  return low > 0 ? `${text.slice(0, low)}…` : "";
}

function drawNote(ctx: CanvasRenderingContext2D, tile: Tile, box: Rect, theme: Theme) {
  const note = tile as Extract<Tile, { kind: "note" }>;
  ctx.fillStyle = note.color;
  ctx.fillRect(box.x, box.y, box.w, box.h);

  const pad = Math.min(box.w, box.h) * 0.09;
  ctx.fillStyle = note.textColor || theme.noteInk;
  ctx.font = `500 ${note.fontSize}px ${UI_FONT}`;
  ctx.textBaseline = "top";
  ctx.textAlign = note.align === "center" ? "center" : "left";

  const lines = wrapText(ctx, note.text, box.w - pad * 2);
  const lineHeight = note.fontSize * 1.32;
  const startX = note.align === "center" ? box.x + box.w / 2 : box.x + pad;
  let y = box.y + pad;
  for (const line of lines) {
    if (y + lineHeight > box.y + box.h) break;
    ctx.fillText(line, startX, y);
    y += lineHeight;
  }
}

/** Greedy word wrap that also honours explicit newlines. */
export function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (paragraph === "") {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth || !line) {
        line = candidate;
      } else {
        out.push(line);
        line = word;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Ink
// ---------------------------------------------------------------------------

function drawStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  now: number,
  scale: number,
) {
  for (const stroke of strokes) {
    const alpha = strokeOpacity(stroke, now);
    if (alpha <= 0) continue;
    drawStroke(ctx, stroke, alpha, scale);
  }
}

export function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  alpha: number,
  _scale: number,
) {
  const pts = stroke.points;
  if (pts.length < 4) return;

  ctx.save();
  ctx.globalAlpha = alpha * (stroke.tool === "highlighter" ? 0.34 : 1);
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.lineWidth = stroke.width;
  ctx.lineCap = stroke.tool === "highlighter" ? "butt" : "round";
  ctx.lineJoin = "round";
  if (stroke.tool === "highlighter") ctx.lineWidth = stroke.width * 3.2;

  const x0 = pts[0];
  const y0 = pts[1];
  const x1 = pts[pts.length - 2];
  const y1 = pts[pts.length - 1];

  switch (stroke.tool) {
    case "box":
      ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      break;
    case "ellipse":
      ctx.beginPath();
      ctx.ellipse(
        (x0 + x1) / 2,
        (y0 + y1) / 2,
        Math.abs(x1 - x0) / 2,
        Math.abs(y1 - y0) / 2,
        0,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
      break;
    case "arrow":
      drawArrow(ctx, { x: x0, y: y0 }, { x: x1, y: y1 }, stroke.width);
      break;
    default: {
      ctx.beginPath();
      ctx.moveTo(pts[0], pts[1]);
      // Quadratic through midpoints: smooths a jittery hand without lag.
      for (let i = 2; i < pts.length - 2; i += 2) {
        const mx = (pts[i] + pts[i + 2]) / 2;
        const my = (pts[i + 1] + pts[i + 3]) / 2;
        ctx.quadraticCurveTo(pts[i], pts[i + 1], mx, my);
      }
      ctx.lineTo(pts[pts.length - 2], pts[pts.length - 1]);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawArrow(ctx: CanvasRenderingContext2D, from: Vec2, to: Vec2, width: number) {
  const head = Math.max(width * 4, 18);
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const backoff = head * 0.72;

  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x - Math.cos(angle) * backoff, to.y - Math.sin(angle) * backoff);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(
    to.x - head * Math.cos(angle - Math.PI / 7),
    to.y - head * Math.sin(angle - Math.PI / 7),
  );
  ctx.lineTo(
    to.x - head * Math.cos(angle + Math.PI / 7),
    to.y - head * Math.sin(angle + Math.PI / 7),
  );
  ctx.closePath();
  ctx.fill();
}

// ---------------------------------------------------------------------------
// Chrome — cockpit only, never on air
// ---------------------------------------------------------------------------

/**
 * A dot grid, as in the references. Dots read as texture rather than structure,
 * which matters when the thing on top is a screenshot full of its own lines.
 */
function drawDotGrid(ctx: CanvasRenderingContext2D, view: Rect, scale: number, theme: Theme) {
  // Keep the dots roughly 26 screen pixels apart whatever the zoom.
  const target = 26 / scale;
  const step = Math.pow(2, Math.round(Math.log2(target / 20))) * 20;
  // Below a couple of pixels apart a dot grid turns into grey soup.
  if (step * scale < 9) return;

  // Radius in *screen* pixels, converted back to board units. Sizing it in
  // board units makes the dots collapse to sub-pixel as soon as you zoom out,
  // which reads as "the grid is off" rather than "the grid is small".
  const radius = 1.15 / scale;
  const startX = Math.floor(view.x / step) * step;
  const startY = Math.floor(view.y / step) * step;
  const endX = view.x + view.w;
  const endY = view.y + view.h;

  ctx.save();
  ctx.fillStyle = theme.dot;
  for (let x = startX; x <= endX; x += step) {
    for (let y = startY; y <= endY; y += step) {
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawChrome(
  ctx: CanvasRenderingContext2D,
  doc: BoardDoc,
  chrome: ChromeOptions,
  scale: number,
  theme: Theme,
) {
  const px = 1 / scale;
  const CHROME = chromeColors(theme);

  if (chrome.frame) drawStage(ctx, chrome, chrome.frame, scale, px, theme);

  if (chrome.hoverTileId) {
    const tile = doc.tiles.find((t) => t.id === chrome.hoverTileId);
    if (tile && !chrome.selection.includes(tile.id)) {
      ctx.save();
      ctx.strokeStyle = CHROME.hover;
      ctx.lineWidth = 1.5 * px;
      ctx.strokeRect(tile.x, tile.y, tile.w, tile.h);
      ctx.restore();
    }
  }

  for (const id of chrome.selection) {
    const tile = doc.tiles.find((t) => t.id === id);
    if (!tile) continue;
    drawSelection(ctx, tile, px, theme);
  }

  if (chrome.guides) {
    ctx.save();
    ctx.strokeStyle = CHROME.guide;
    ctx.lineWidth = px;
    ctx.setLineDash([6 * px, 6 * px]);
    for (const x of chrome.guides.vertical) {
      ctx.beginPath();
      ctx.moveTo(x, -100000);
      ctx.lineTo(x, 100000);
      ctx.stroke();
    }
    for (const y of chrome.guides.horizontal) {
      ctx.beginPath();
      ctx.moveTo(-100000, y);
      ctx.lineTo(100000, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  if (chrome.redacting) {
    const r = chrome.redacting;
    ctx.save();
    ctx.fillStyle = "rgba(30,35,41,0.55)";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = CHROME.guide;
    ctx.lineWidth = 1.5 * px;
    ctx.setLineDash([7 * px, 5 * px]);
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.restore();
  }

  if (chrome.marquee) {
    ctx.save();
    ctx.fillStyle = theme.accentTint;
    ctx.strokeStyle = CHROME.selection;
    ctx.lineWidth = px;
    ctx.fillRect(chrome.marquee.x, chrome.marquee.y, chrome.marquee.w, chrome.marquee.h);
    ctx.strokeRect(chrome.marquee.x, chrome.marquee.y, chrome.marquee.w, chrome.marquee.h);
    ctx.restore();
  }
}

/**
 * The stage: the rectangle the audience sees.
 *
 * Everything outside it is dimmed, and the tab above the corner says what it
 * is — the difference between "there is a mysterious box on my canvas" and
 * "that is the bit they can see, and I can drag it".
 */
function drawStage(
  ctx: CanvasRenderingContext2D,
  chrome: ChromeOptions,
  stage: Rect,
  scale: number,
  px: number,
  theme: Theme,
) {
  const CHROME = chromeColors(theme);
  const dim = chrome.isPrivate;

  // Dim everything outside the stage so "on air" is unmistakable.
  ctx.save();
  ctx.fillStyle = CHROME.scrim;
  ctx.beginPath();
  ctx.rect(stage.x - 100000, stage.y - 100000, 200000, 200000);
  ctx.rect(stage.x, stage.y, stage.w, stage.h);
  ctx.fill("evenodd");
  ctx.restore();

  const selected = chrome.stage?.selected ?? false;
  ctx.save();
  ctx.strokeStyle = dim ? CHROME.frameDim : CHROME.frame;
  ctx.lineWidth = (selected ? 3 : 2) * px;
  if (dim) ctx.setLineDash([10 * px, 8 * px]);
  else if (chrome.stage?.locked) ctx.setLineDash([14 * px, 5 * px]);
  ctx.strokeRect(stage.x, stage.y, stage.w, stage.h);
  ctx.restore();

  if (!chrome.stage) return;

  // The tab. Sized in screen pixels so it stays readable at any zoom.
  const label = chrome.stage.label;
  const tab = stageTabFor(stage, label, scale);
  ctx.save();
  ctx.fillStyle = dim ? CHROME.frameDim : CHROME.frame;
  ctx.beginPath();
  ctx.roundRect(tab.x, tab.y, tab.w, tab.h, Math.min(tab.h / 2.6, 6 / scale));
  ctx.fill();
  ctx.fillStyle = CHROME.tabText;
  ctx.font = `600 ${11.5 / scale}px ${UI_FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(label, tab.x + 11 / scale, tab.y + tab.h / 2);
  ctx.restore();

  if (!selected || chrome.stage.locked) return;

  const size = HANDLE_SIZE * px;
  ctx.save();
  ctx.fillStyle = CHROME.handle;
  ctx.strokeStyle = CHROME.handleEdge;
  ctx.lineWidth = 1.5 * px;
  for (const point of Object.values(stageHandles(stage))) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, size / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Cover the parts of a tile that are never shared.
 *
 * Drawn on every surface that draws a tile — the cockpit, the board, and a
 * guest — because a redaction that only applied to some of them would be worse
 * than none: it would look like it was working.
 */
function drawRedactions(
  ctx: CanvasRenderingContext2D,
  tile: Tile,
  body: Rect,
  scale: number,
  theme: Theme,
) {
  const redactions = redactionsOf(tile);
  if (redactions.length === 0) return;

  for (const redaction of redactions) {
    const r = toBoardRect(tile, redaction, body);
    ctx.save();
    if (redaction.style === "blur") {
      // Re-draw what is underneath through a blur, clipped to the region. Only
      // honest for tidying, and the interface says so: blur is reversible.
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.clip();
      ctx.filter = `blur(${Math.max(6, Math.min(r.w, r.h) * 0.12)}px)`;
      ctx.drawImage(ctx.canvas, 0, 0);
      ctx.filter = "none";
    } else {
      ctx.fillStyle = theme.dark ? "#0b0d12" : "#1e2329";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      // A faint diagonal, so a blackout reads as deliberate rather than as a
      // tile that failed to load.
      ctx.strokeStyle = "rgba(255,255,255,0.07)";
      ctx.lineWidth = 1.5 / scale;
      ctx.beginPath();
      const step = 14 / scale;
      for (let x = r.x - r.h; x < r.x + r.w; x += step) {
        ctx.moveTo(x, r.y + r.h);
        ctx.lineTo(x + r.h, r.y);
      }
      ctx.save();
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.clip();
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }
}

/**
 * The cursor, for people who are not sitting at this desk.
 *
 * A ring rather than an arrow: an arrow drawn on top of the captured arrow
 * gives you two cursors a few pixels apart, which reads as a rendering bug. A
 * ring around the real one says "here" without claiming to be the pointer.
 */
function drawPointer(
  ctx: CanvasRenderingContext2D,
  pointer: NonNullable<RenderInput["pointer"]>,
  scale: number,
  theme: Theme,
) {
  const px = 1 / scale;

  for (const ripple of pointer.ripples) {
    const radius = (10 + ripple.progress * 46) * px;
    ctx.save();
    ctx.globalAlpha = (1 - ripple.progress) * 0.55;
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 3 * px * (1 - ripple.progress * 0.6);
    ctx.beginPath();
    ctx.arc(ripple.x, ripple.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  if (!pointer.at) return;
  ctx.save();
  // A soft halo first, so the ring reads on a light desktop and a dark one.
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = theme.accent;
  ctx.beginPath();
  ctx.arc(pointer.at.x, pointer.at.y, 17 * px, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 2.5 * px;
  ctx.beginPath();
  ctx.arc(pointer.at.x, pointer.at.y, 13 * px, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/**
 * The holding card and the lower third.
 *
 * Anchored to the stage rather than the view, so the operator sees them exactly
 * where the audience will however far they have wandered, and they stay put
 * when the shot moves.
 */
function drawOverlays(
  ctx: CanvasRenderingContext2D,
  doc: BoardDoc,
  scale: number,
  theme: Theme,
) {
  const stage = doc.frame;
  const card = doc.card ?? null;
  const third = doc.lowerThird ?? null;

  if (card) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(stage.x, stage.y, stage.w, stage.h);
    ctx.clip();

    if (card.showBoard) {
      ctx.fillStyle = theme.dark ? "rgba(8,10,14,0.82)" : "rgba(16,20,28,0.78)";
    } else {
      ctx.fillStyle = theme.dark ? "#0b0d12" : theme.canvas;
    }
    ctx.fillRect(stage.x, stage.y, stage.w, stage.h);

    const onDark = card.showBoard || theme.dark;
    const cx = stage.x + stage.w / 2;
    const titleSize = stage.h * 0.085;
    // Date.now(), not the render clock. The deadline is stored in wall-clock
    // time because it has to mean the same thing in the cockpit, in the board
    // window and in a guest's browser, and performance.now() has a different
    // origin in every one of them.
    const countdown = countdownText(card, Date.now());

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // The whole block is centred as one, so a card with a clock does not sit
    // visibly lower than one without.
    const blockHeight = titleSize * (countdown ? 2.9 : 1.9);
    let y = stage.y + stage.h / 2 - blockHeight / 2 + titleSize * 0.6;

    ctx.fillStyle = onDark ? "#ffffff" : theme.ink;
    ctx.font = `650 ${titleSize}px ${UI_FONT}`;
    ctx.fillText(card.title, cx, y);
    y += titleSize * 1.15;

    if (card.subtitle) {
      ctx.fillStyle = onDark ? "rgba(255,255,255,0.62)" : theme.ink2;
      ctx.font = `400 ${titleSize * 0.42}px ${UI_FONT}`;
      ctx.fillText(card.subtitle, cx, y);
      y += titleSize * 0.9;
    }

    if (countdown) {
      ctx.fillStyle = theme.accent;
      ctx.font = `600 ${titleSize * 1.15}px ${UI_FONT}`;
      ctx.fillText(countdown, cx, y + titleSize * 0.4);
    }
    ctx.restore();
  }

  if (third && (third.name.trim() || third.role.trim())) {
    const box = lowerThirdRect(stage);
    ctx.save();
    ctx.beginPath();
    ctx.rect(stage.x, stage.y, stage.w, stage.h);
    ctx.clip();

    // An accent spine rather than a box outline: it reads at any size and it
    // ties the banner to everything else the app paints in the accent.
    const spine = Math.max(2 / scale, box.h * 0.06);
    ctx.fillStyle = theme.accent;
    ctx.fillRect(box.x, box.y, spine, box.h);

    ctx.fillStyle = theme.dark ? "rgba(12,15,20,0.86)" : "rgba(255,255,255,0.92)";
    ctx.fillRect(box.x + spine, box.y, box.w - spine, box.h);

    const pad = box.h * 0.22;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    const nameSize = box.h * 0.38;
    ctx.fillStyle = theme.ink;
    ctx.font = `620 ${nameSize}px ${UI_FONT}`;
    ctx.fillText(third.name, box.x + spine + pad, box.y + box.h * 0.46);
    if (third.role) {
      ctx.fillStyle = theme.ink2;
      ctx.font = `450 ${nameSize * 0.62}px ${UI_FONT}`;
      ctx.fillText(third.role, box.x + spine + pad, box.y + box.h * 0.78);
    }
    ctx.restore();
  }
}

export const HANDLE_SIZE = 9;

/** Resize handles, in board units, for a tile. */
export function handlePositions(tile: Tile): Record<string, Vec2> {
  const { x, y, w, h } = tile;
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

function drawSelection(ctx: CanvasRenderingContext2D, tile: Tile, px: number, theme: Theme) {
  const CHROME = chromeColors(theme);
  const center = rectCenter(tileRect(tile));
  ctx.save();
  if (tile.rotation !== 0) {
    ctx.translate(center.x, center.y);
    ctx.rotate((tile.rotation * Math.PI) / 180);
    ctx.translate(-center.x, -center.y);
  }

  ctx.strokeStyle = CHROME.selection;
  ctx.lineWidth = 2 * px;
  ctx.strokeRect(tile.x, tile.y, tile.w, tile.h);

  if (!tile.locked) {
    // Round handles on a white chip, as in the references.
    const size = HANDLE_SIZE * px;
    ctx.fillStyle = CHROME.handle;
    ctx.strokeStyle = CHROME.handleEdge;
    ctx.lineWidth = 1.5 * px;
    for (const p of Object.values(handlePositions(tile))) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, size / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  } else {
    // A locked tile shows a dashed outline instead of grab handles.
    ctx.setLineDash([6 * px, 5 * px]);
    ctx.strokeStyle = CHROME.handle;
    ctx.lineWidth = px;
    ctx.strokeRect(tile.x - 4 * px, tile.y - 4 * px, tile.w + 8 * px, tile.h + 8 * px);
  }
  ctx.restore();
}
