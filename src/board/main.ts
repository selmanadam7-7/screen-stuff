/**
 * The board window.
 *
 * This canvas *is* the output. Nothing is drawn on it that the audience should
 * not see — no handles, no selection, no grid, no cursor. Share this window in
 * Discord, or hand its `captureStream()` to the camera and to guests, and they
 * all get the same pixels.
 *
 * It holds no authority over the document: the cockpit owns that and pushes
 * snapshots. This window's only jobs are to paint and to report how it is doing.
 */

import "../styles/board.css";
import { FrameClient } from "../core/frames";
import { MediaPool } from "../core/media";
import { renderBoard } from "../core/render";
import { emptyBoard, expireStrokes } from "../core/doc";
import { onCommand, onSnapshot, runningInTauri, sendBoardStatus } from "../core/bus";
import type { Snapshot } from "../core/bus";
import { sessionInfo } from "../core/api";
import type { BoardDoc, Rect } from "../core/types";

const DEFAULT_OUTPUT = { width: 1920, height: 1080 };

interface BoardState {
  doc: BoardDoc;
  frame: Rect;
  revision: number;
  dirty: boolean;
  connected: boolean;
  lastError: string | null;
  framesDrawn: number;
  fps: number;
}

const state: BoardState = {
  doc: emptyBoard(),
  frame: { ...emptyBoard().frame },
  revision: 0,
  dirty: true,
  connected: false,
  lastError: null,
  framesDrawn: 0,
  fps: 0,
};

const root = document.getElementById("board-root")!;
const canvas = document.createElement("canvas");
canvas.id = "stage";
canvas.width = DEFAULT_OUTPUT.width;
canvas.height = DEFAULT_OUTPUT.height;
root.appendChild(canvas);

const banner = document.createElement("div");
banner.className = "board-banner";
root.appendChild(banner);

const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
if (!ctx) throw new Error("this machine cannot open a 2D canvas");

let client: FrameClient | null = null;
let pool: MediaPool | null = null;

function markDirty() {
  state.dirty = true;
}

async function boot() {
  const info = await sessionInfo();
  if (!info.streamUrl) {
    flash("no frame server — open Screen Stuff from the app, not a browser tab");
  } else {
    client = new FrameClient(info.streamUrl);
    client.onConnectionChange = (connected) => {
      state.connected = connected;
      if (!connected) flash("reconnecting to the capture engine");
      else clearFlash();
      markDirty();
    };
    pool = new MediaPool(client, {
      fps: state.doc.fps,
      quality: state.doc.quality,
      onFrame: markDirty,
    });
  }

  await onSnapshot(applySnapshot);
  await onCommand((command) => {
    if (command.t === "flash") flash(command.message);
    if (command.t === "refreshMedia") {
      pool?.sync(state.doc, currentScale());
      markDirty();
    }
    if (command.t === "requestStatus") reportStatus();
  });

  setupWindowDragging();
  requestAnimationFrame(tick);
  window.setInterval(reportStatus, 1000);
}

function applySnapshot(snapshot: Snapshot) {
  state.doc = snapshot.doc;
  state.frame = snapshot.frame;
  if (snapshot.revision !== state.revision) {
    state.revision = snapshot.revision;
  }
  resizeOutput(snapshot);
  pool?.setOptions({ fps: snapshot.doc.fps, quality: snapshot.doc.quality });
  pool?.sync(snapshot.doc, currentScale());
  markDirty();
}

/**
 * The backing store is the *output* resolution, not the window size, so the
 * pixels a guest receives do not change when the window is nudged. CSS scales
 * it to fit whatever the window happens to be.
 */
function resizeOutput(snapshot: Snapshot) {
  const aspect = snapshot.doc.aspect || 16 / 9;
  const width = DEFAULT_OUTPUT.width;
  const height = Math.round(width / aspect);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

const currentScale = () => canvas.width / Math.max(1, state.frame.w);

let lastFpsSample = performance.now();
let framesSinceSample = 0;

function tick(now: number) {
  requestAnimationFrame(tick);

  // Live video keeps changing without telling us, so those tiles always redraw.
  const hasLiveElementMedia = state.doc.tiles.some(
    (t) => (t.kind === "camera" || t.kind === "video") && !t.hidden,
  );
  const hasTemporaryInk = state.doc.strokes.some((s) => s.fadeAfterMs);
  if (!state.dirty && !hasLiveElementMedia && !hasTemporaryInk) return;
  state.dirty = false;

  if (hasTemporaryInk) {
    const trimmed = expireStrokes(state.doc, now);
    if (trimmed !== state.doc) state.doc = trimmed;
  }

  renderBoard({
    ctx: ctx!,
    width: canvas.width,
    height: canvas.height,
    view: state.frame,
    doc: state.doc,
    media: pool ?? { resolve: () => null },
    now,
  });

  state.framesDrawn += 1;
  framesSinceSample += 1;
  if (now - lastFpsSample >= 1000) {
    state.fps = Math.round((framesSinceSample * 1000) / (now - lastFpsSample));
    framesSinceSample = 0;
    lastFpsSample = now;
  }
}

function reportStatus() {
  void sendBoardStatus({
    outputWidth: canvas.width,
    outputHeight: canvas.height,
    fps: state.fps,
    connected: state.connected,
    streams: client?.streamCount ?? 0,
    cameraLive: false,
    guests: 0,
    lastError: state.lastError,
  });
}

let flashTimer: number | null = null;
function flash(message: string) {
  banner.textContent = message;
  banner.classList.add("is-visible");
  if (flashTimer !== null) window.clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => banner.classList.remove("is-visible"), 3200);
}

function clearFlash() {
  banner.classList.remove("is-visible");
}

/**
 * The board has no title bar, because a title bar would be on air. Alt-drag
 * moves it; the cockpit does everything else.
 */
function setupWindowDragging() {
  if (!runningInTauri()) return;
  window.addEventListener("mousedown", async (event) => {
    if (!event.altKey || event.button !== 0) return;
    event.preventDefault();
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().startDragging();
  });
  // Alt is held: show the operator that dragging is available.
  window.addEventListener("keydown", (e) => {
    if (e.key === "Alt") document.body.classList.add("is-draggable");
  });
  window.addEventListener("keyup", (e) => {
    if (e.key === "Alt") document.body.classList.remove("is-draggable");
  });
  window.addEventListener("blur", () => document.body.classList.remove("is-draggable"));
}

/** Exposed so the cockpit's capture path can grab the same pixels. */
(window as any).__screenStuffCanvas = canvas;

void boot();
