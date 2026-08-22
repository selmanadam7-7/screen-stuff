/**
 * The guest page.
 *
 * A guest runs the same compositor the host does. They receive the board
 * document and open the same source streams, which is what lets them roam
 * independently: looking somewhere else is just drawing the same document at a
 * different view.
 */

import "../styles/guest.css";
import { FrameClient } from "../core/frames";
import { MediaPool } from "../core/media";
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
    <span class="guest-brand">Screen Stuff</span>
    <span class="guest-pip" id="guest-pip"></span>
    <span class="guest-name" id="guest-name"></span>
    <span class="guest-spacer"></span>
    <div class="guest-tools" id="guest-tools"></div>
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

const canvas = document.getElementById("guest-stage") as HTMLCanvasElement;
const ctx = canvas.getContext("2d", { alpha: false })!;
const gate = document.getElementById("guest-gate")!;
const nameLabel = document.getElementById("guest-name")!;
const pip = document.getElementById("guest-pip")!;
const toast = document.getElementById("guest-toast")!;
const followButton = document.getElementById("guest-follow") as HTMLButtonElement;
const toolbar = document.getElementById("guest-tools")!;

// The token is the last path segment: /g/<token>
const token = window.location.pathname.split("/").filter(Boolean).pop() ?? "";
const socketUrl = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/gw?token=${encodeURIComponent(token)}`;

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
  if (!connected) flash("reconnecting…");
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
      state.powers = (message.powers as Powers) ?? state.powers;
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

canvas.addEventListener("pointerdown", (event) => {
  canvas.setPointerCapture(event.pointerId);
  if (state.tool && state.powers.draw && event.button === 0 && !event.shiftKey) {
    const point = toBoard(event);
    state.drawing = [point.x, point.y];
    return;
  }
  if (startRoaming()) panFrom = toBoard(event);
});

canvas.addEventListener("pointermove", (event) => {
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
