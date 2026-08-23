/**
 * The guest page.
 *
 * A guest runs the same compositor the host does. They receive the board
 * document and open the same source streams, which is what lets them roam
 * independently: looking somewhere else is just drawing the same document at a
 * different view.
 *
 * The same page also serves **output mode**, at `/o/<token>` instead of
 * `/g/<token>`: the shot, and nothing else. No toolbar, no name, no roaming, no
 * cursors, no reconnecting notice — a browser source in OBS, vMix, Streamlabs
 * or Ecamm is a camera, and a camera does not have a user interface.
 *
 * That is what makes Screen Stuff usable as a webcam today. Windows' own
 * virtual camera API needs a COM server registered machine-wide and loaded into
 * the Frame Server service, which is exactly the kind of system surgery this
 * project promised not to do. Every broadcast tool already has a virtual camera
 * and a browser source, so this hands the shot to the one they have.
 */

import "../styles/guest.css";
import { FrameClient } from "../core/frames";
import { MediaPool } from "../core/media";
import { REACTIONS, REACTION_GLYPH } from "../core/presence";
import { renderBoard } from "../core/render";
import { emptyBoard, expireStrokes, newId, reviveBoard } from "../core/doc";
import { clamp, fitAspect, screenToBoard, simplifyPoints, zoomAround } from "../core/geometry";
import type { BoardDoc, InkTool, Rect, Stroke, Vec2 } from "../core/types";

interface Powers {
  draw: boolean;
  roam: boolean;
  files: boolean;
}

const INK_COLORS = ["#FF5A41", "#F5C062", "#56D9A3", "#8296FF", "#EAE6DC"];

/**
 * Output mode, decided by the path the page was opened at.
 *
 * The path rather than a query string, because a browser source's URL gets
 * copied, pasted and hand-edited, and a lost `?output=1` would silently put a
 * toolbar on somebody's stream.
 */
const OUTPUT = window.location.pathname.split("/").filter(Boolean)[0] === "o";

const state = {
  doc: emptyBoard("Waiting for the host"),
  frame: { ...emptyBoard().frame } as Rect,
  view: null as Rect | null, // null means "following the host"
  powers: { draw: false, roam: false, files: false } as Powers,
  name: "",
  id: 0,
  connected: false,
  closed: null as string | null,
  dirty: true,
  tool: null as InkTool | null,
  color: INK_COLORS[0],
  drawing: null as number[] | null,
};

const root = document.getElementById("guest-root")!;
root.innerHTML = `
  <canvas id="guest-stage"></canvas>
  <div class="guest-bar">
    <svg class="guest-mark" viewBox="0 0 3987.69 3686.84" fill="currentColor" aria-hidden="true"><path d="M3048.36,2512.37l-247.7,4.14c-15.1.25-37.5,26.13-38.35,42.36-7.51,144.02-15.39,278.05-3.78,425.41,247.87,5.77,479.89,1.91,715.21-9.65,10.24-.5,28.99-24.06,29.67-37.09,6.92-133.18,9.98-277.01-6.76-418.57-151.86-16.88-296.76-9.15-448.29-6.61Z"/><path d="M3985.54,3162.76c-1.16-56.93-26.94-109.89-48.02-160.95l-31.06-75.23,9.62-168.81c6.73-118.15-23.2-72.52-70.67-209.78-22.82-66-46.25-131.59-48.15-201.92-1.32-49.12-7.8-92.79-29.96-134.61l-84.5-159.46c-21.28-40.17-49.93-72.66-93.38-89.72-31.92,26.68-63.11,51.48-88.33,80.85-26.42,30.77-49.2,56.92-91.37,65.28l-100.78,19.98c-20.61,38.19-36.87,74.31-84.21,86.77l39.43-70.78c36.94-66.32,80.07-44.92,163.84-78.59,42.9-42.55,76.04-89.27,107.79-142.91-73.88-120.22-411.14-50.22-464.54-60.78l-114.09-22.56c-87.29-17.26-183.27,19.81-269.55,49.27-65.43,22.34-111.69,76.27-167.34,112.85-80.64,53.01-135.28,123.05-147.04,222.78-6.53,55.36-65.79,75.39-31.29,261.57,18.26,98.54-24.24,101.19-59.37,213-18.92,60.24-12.08,124.97-22.86,185.89-27.59,155.93-4.96,135.25,1.66,294.69,83.51-80.69,102.95-54.09,178.21-138.15,28.72,14.43-59.03,94.12-71.61,106.03-29.69,28.09-68.82,50.24-83.18,91.29l-51.74,147.89c-16.97,48.51-6.62,93.88,16.04,138.4,20.31,39.91,39.08,85.53,79.13,110.11,65.1,39.95,349.4,26.88,427.88,32.19l265.32,17.95c84.61,5.73,166.38-6.72,251.09-3.15,91.3,3.86,176.38-10.6,266.35-19.54,83.83-8.32,338.36-9.78,374.33-82.56,83.27-168.48,76.48-215.07,72.36-417.31ZM3623.55,2986.09c-6.8,69.69-52.02,114.84-119.65,117.66l-282.22,11.77,2.76,61.56,74.03,9.35c19.23,2.43,39.23,26.85,40.32,45.99,1.09,19.19-19.24,46.14-46.28,46.59l-317.61,5.27c-20.12.33-45.26-33.56-42.29-50.28,12.19-68.63,95.37-31.61,110.46-59.58,8.09-15,6.59-56.01-10.98-56.02-100.48-.09-197.9-.11-292.97-5.96-64.85-3.99-109.67-52.28-113.01-116.18-5.78-110.75-1.82-219.18,4.91-331.09l9.89-164.54c2.86-47.59,41.21-90.83,90.04-98.74,111.85-18.12,221.94-14.92,336.36-16.36,148.07-1.85,291.21-6.42,437.96.6,64.09,3.07,110.95,47.79,115.86,111.3,12.65,163.44,18.24,326.48,2.42,488.66Z"/></svg>
    <span class="guest-brand">Screen Stuff</span>
    <span class="guest-pip" id="guest-pip"></span>
    <span class="guest-name" id="guest-name"></span>
    <span class="guest-spacer"></span>
    <div class="guest-tools" id="guest-tools"></div>
    <div class="guest-reactions" id="guest-reactions"></div>
    <button class="guest-btn" id="guest-follow">Follow the host</button>
  </div>
  <div class="guest-toast" id="guest-toast"></div>
  <div class="guest-gate" id="guest-gate">
    <div class="guest-gate__card">
      <h1>Join the board</h1>
      <p>Your name shows in the host's guest list.</p>
      <input id="guest-name-input" maxlength="24" placeholder="Your name" autocomplete="off" />
      <button class="guest-btn guest-btn--go" id="guest-join">Join</button>
    </div>
  </div>
`;

if (OUTPUT) {
    // Before anything can paint: a bar that appears for one frame appears on
    // the stream. The canvas is the page.
    document.body.classList.add("is-output");
}

const canvas = document.getElementById("guest-stage") as HTMLCanvasElement;
const ctx = canvas.getContext("2d", { alpha: false })!;
const gate = document.getElementById("guest-gate")!;
const nameLabel = document.getElementById("guest-name")!;
const pip = document.getElementById("guest-pip")!;
const toast = document.getElementById("guest-toast")!;
const followButton = document.getElementById("guest-follow") as HTMLButtonElement;
const toolbar = document.getElementById("guest-tools")!;
const reactionBar = document.getElementById("guest-reactions")!;

// The token is the last path segment: /g/<token>
const token = window.location.pathname.split("/").filter(Boolean).pop() ?? "";
const socketUrl =
  `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}` +
  `/gw?token=${encodeURIComponent(token)}${OUTPUT ? "&output=1" : ""}`;

const client = new FrameClient(socketUrl);
const pool = new MediaPool(client, {
  fps: 24,
  quality: 80,
  role: "guest",
  onFrame: () => {
    state.dirty = true;
  },
});

client.onConnectionChange = (connected) => {
  state.connected = connected;
  pip.className = `guest-pip${connected ? " is-good" : " is-bad"}`;
  // No notices on a feed. A dropped connection holds the last frame, which is
  // what every other camera in the world does.
  if (!connected && !OUTPUT) flash("reconnecting…");
};

client.onControl = (message) => {
  switch (message.t) {
    case "welcome": {
      state.id = Number(message.id ?? 0);
      state.name = String(message.name ?? "");
      nameLabel.textContent = state.name;
      break;
    }
    case "board": {
      state.doc = reviveBoard(message.doc, "Board");
      state.frame = (message.frame as Rect) ?? state.doc.frame;
      // An output view is a feed, not a participant: whatever the host has
      // granted, it never draws and never roams.
      state.powers = OUTPUT
        ? { draw: false, roam: false, files: false }
        : ((message.powers as Powers) ?? state.powers);
      renderToolbar();
      followButton.style.display = state.powers.roam ? "" : "none";
      if (!state.powers.roam) state.view = null;
      state.dirty = true;
      break;
    }
    case "refused": {
      flash(String(message.message ?? "not allowed"));
      break;
    }
    case "closed": {
      state.closed = String(message.reason ?? "the session ended");
      state.dirty = true;
      break;
    }
  }
};

// ---------------------------------------------------------------------------
// Joining
// ---------------------------------------------------------------------------

const nameInput = document.getElementById("guest-name-input") as HTMLInputElement;
nameInput.value = localStorage.getItem("screen-stuff:guest-name") ?? "";
const join = () => {
  const name = nameInput.value.trim();
  localStorage.setItem("screen-stuff:guest-name", name);
  send({ t: "hello", name });
  gate.classList.add("is-gone");
  canvas.focus();
};
document.getElementById("guest-join")!.addEventListener("click", join);
nameInput.addEventListener("keydown", (e) => e.key === "Enter" && join());

// Nothing to ask an output view. It is already looking.
if (OUTPUT) {
    gate.classList.add("is-gone");
    send({ t: "hello", name: "Output" });
}

/** Reuse the frame client's socket rather than opening a second one. */
function send(message: unknown) {
  client.sendControl(message);
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

function renderToolbar() {
  toolbar.innerHTML = "";
  if (!state.powers.draw) return;

  for (const color of INK_COLORS) {
    const swatch = document.createElement("button");
    swatch.className = `guest-swatch${state.color === color ? " is-active" : ""}`;
    swatch.style.background = color;
    swatch.title = "Draw";
    swatch.addEventListener("click", () => {
      state.color = color;
      state.tool = "pen";
      renderToolbar();
    });
    toolbar.appendChild(swatch);
  }

  const arrow = document.createElement("button");
  arrow.className = `guest-btn${state.tool === "arrow" ? " is-active" : ""}`;
  arrow.textContent = "Arrow";
  arrow.addEventListener("click", () => {
    state.tool = state.tool === "arrow" ? null : "arrow";
    renderToolbar();
  });
  toolbar.appendChild(arrow);

  const off = document.createElement("button");
  off.className = `guest-btn${state.tool === null ? " is-active" : ""}`;
  off.textContent = "Look only";
  off.addEventListener("click", () => {
    state.tool = null;
    renderToolbar();
  });
  toolbar.appendChild(off);
}

followButton.addEventListener("click", () => {
  state.view = null;
  state.dirty = true;
  followButton.classList.remove("is-roaming");
});

// ---------------------------------------------------------------------------
// Interaction
// ---------------------------------------------------------------------------

const currentView = (): Rect => {
  const aspect = canvas.width / Math.max(1, canvas.height);
  const base = state.view ?? state.frame;
  return Math.abs(base.w / base.h - aspect) > 0.001 ? { ...base, h: base.w / aspect } : base;
};

const toBoard = (event: { clientX: number; clientY: number }): Vec2 => {
  const rect = canvas.getBoundingClientRect();
  const dpr = canvas.width / rect.width;
  return screenToBoard(
    { x: (event.clientX - rect.left) * dpr, y: (event.clientY - rect.top) * dpr },
    currentView(),
    canvas.width,
    canvas.height,
  );
};

const startRoaming = () => {
  if (!state.powers.roam) return false;
  if (!state.view) state.view = { ...currentView() };
  followButton.classList.add("is-roaming");
  return true;
};

let panFrom: Vec2 | null = null;

/**
 * Six things a guest can say without drawing on anything.
 *
 * A closed set, matching the list the server will accept — a guest is a
 * stranger holding a link, and anything free-text would end up drawn on the
 * host's board.
 */
for (const kind of REACTIONS) {
  const button = document.createElement("button");
  button.className = "guest-react";
  button.textContent = REACTION_GLYPH[kind];
  button.title = kind;
  button.setAttribute("aria-label", `React: ${kind}`);
  button.addEventListener("click", () => {
    send({ t: "reaction", reaction: kind });
    button.classList.add("is-sent");
    window.setTimeout(() => button.classList.remove("is-sent"), 400);
  });
  reactionBar.appendChild(button);
}

canvas.addEventListener("pointerdown", (event) => {
  canvas.setPointerCapture(event.pointerId);
  if (state.tool && state.powers.draw && event.button === 0 && !event.shiftKey) {
    const point = toBoard(event);
    state.drawing = [point.x, point.y];
    return;
  }
  if (startRoaming()) panFrom = toBoard(event);
});

/**
 * Where this guest is pointing, sent at a sensible rate.
 *
 * Throttled rather than sent per event: a pointermove fires on every pixel, and
 * the host only needs enough to follow a hand.
 */
let lastPointerSent = 0;
function sendPointer(point: { x: number; y: number }) {
  const now = performance.now();
  if (now - lastPointerSent < 60) return;
  lastPointerSent = now;
  send({ t: "pointer", x: point.x, y: point.y });
}

canvas.addEventListener("pointermove", (event) => {
  sendPointer(toBoard(event));
  if (state.drawing) {
    const point = toBoard(event);
    state.drawing =
      state.tool === "arrow"
        ? [state.drawing[0], state.drawing[1], point.x, point.y]
        : [...state.drawing, point.x, point.y];
    state.dirty = true;
    return;
  }
  if (panFrom && state.view) {
    const point = toBoard(event);
    state.view = {
      ...state.view,
      x: state.view.x + (panFrom.x - point.x),
      y: state.view.y + (panFrom.y - point.y),
    };
    state.dirty = true;
  }
});

canvas.addEventListener("pointerup", () => {
  panFrom = null;
  if (state.drawing && state.drawing.length >= 4) {
    const stroke: Stroke = {
      id: newId("guest"),
      tool: state.tool ?? "pen",
      color: state.color,
      width: 7,
      points:
        state.tool === "arrow"
          ? state.drawing
          : simplifyPoints(state.drawing, currentView().w / canvas.width),
      createdAt: Date.now(),
    };
    send({ t: "ink", stroke });
  }
  state.drawing = null;
});

canvas.addEventListener("wheel", (event) => {
  if (!startRoaming() || !state.view) return;
  event.preventDefault();
  state.view = zoomAround(state.view, toBoard(event), Math.pow(1.0016, -event.deltaY));
  state.dirty = true;
}, { passive: false });

// Dropping a file onto the board.
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", async (event) => {
  event.preventDefault();
  if (!state.powers.files) {
    flash("the host has file drops turned off");
    return;
  }
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  if (file.size > 12 * 1024 * 1024) {
    flash("that file is too big (12 MB max)");
    return;
  }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  send({ t: "file", name: file.name, mime: file.type, data_url: dataUrl });
  flash(`sent ${file.name}`);
});

// Tell the host where we are looking, but only occasionally.
window.setInterval(() => {
  if (state.view && state.powers.roam) send({ t: "view", view: state.view });
}, 1200);

// ---------------------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------------------

function tick(now: number) {
  requestAnimationFrame(tick);

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.round(window.innerWidth * dpr);
  const height = Math.round(window.innerHeight * dpr);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    state.dirty = true;
  }

  const hasLiveMedia = state.doc.tiles.some(
    (t) => (t.kind === "camera" || t.kind === "video") && !t.hidden,
  );
  const hasFading = state.doc.strokes.some((s) => s.fadeAfterMs);
  if (!state.dirty && !hasLiveMedia && !hasFading) return;
  state.dirty = false;

  if (hasFading) {
    const trimmed = expireStrokes(state.doc, now);
    if (trimmed !== state.doc) state.doc = trimmed;
  }

  if (OUTPUT) {
    renderOutput(now, dpr);
    return;
  }

  const view = currentView();
  pool.sync(state.doc, (canvas.width / view.w) / dpr);

  const live: BoardDoc = state.drawing
    ? {
        ...state.doc,
        strokes: [
          ...state.doc.strokes,
          {
            id: "live",
            tool: state.tool ?? "pen",
            color: state.color,
            width: 7,
            points: state.drawing,
            createdAt: now,
          },
        ],
      }
    : state.doc;

  renderBoard({ ctx, width: canvas.width, height: canvas.height, view, doc: live, media: pool, now });

  // A guest who has roamed sees where the host is pointing, so they can find
  // their way back to the conversation.
  if (state.view) drawHostFrame(view);
  if (state.closed) drawClosed();
}

/**
 * The shot, letterboxed into whatever size the broadcast tool asked for.
 *
 * A guest window that is the wrong shape shows *more board*, which is right for
 * someone looking around. An output at the wrong shape must show exactly the
 * stage and bars, because the alternative is quietly broadcasting the private
 * part of the board to everyone on the call.
 */
function renderOutput(now: number, dpr: number) {
  const stage = state.frame;
  const aspect = stage.w / Math.max(1, stage.h);
  const box = fitInto(canvas.width, canvas.height, aspect);

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  pool.sync(state.doc, (box.w / stage.w) / dpr);

  ctx.save();
  // renderBoard draws from its own origin outwards, so translating first puts
  // the whole thing inside the box without it needing to know about one.
  ctx.translate(box.x, box.y);
  renderBoard({ ctx, width: box.w, height: box.h, view: stage, doc: state.doc, media: pool, now });
  ctx.restore();
}

/** The largest rectangle of `aspect` that fits, centred. */
function fitInto(width: number, height: number, aspect: number) {
  const w = Math.min(width, Math.round(height * aspect));
  const h = Math.round(w / aspect);
  return { x: Math.round((width - w) / 2), y: Math.round((height - h) / 2), w, h };
}

function drawHostFrame(view: Rect) {
  const scale = canvas.width / view.w;
  const x = (state.frame.x - view.x) * scale;
  const y = (state.frame.y - view.y) * scale;
  ctx.save();
  ctx.strokeStyle = "rgba(130,150,255,0.75)";
  ctx.setLineDash([9, 7]);
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, state.frame.w * scale, state.frame.h * scale);
  ctx.restore();
}

function drawClosed() {
  ctx.save();
  ctx.fillStyle = "rgba(6,7,10,0.86)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#EAE6DC";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `600 ${Math.round(canvas.width / 42)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.fillText(state.closed ?? "", canvas.width / 2, canvas.height / 2);
  ctx.restore();
}

let toastTimer: number | null = null;
function flash(message: string) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2600);
}

// Guests never see a frame wider than the board's own aspect allows.
window.addEventListener("resize", () => {
  if (state.view) state.view = fitAspect(state.view, clamp(state.doc.aspect, 0.2, 5));
  state.dirty = true;
});

requestAnimationFrame(tick);
