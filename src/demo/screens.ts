/**
 * Synthetic desktops, for the demo that runs in a browser.
 *
 * The demo is the real cockpit — the same store, the same renderer, the same
 * canvas — with one thing swapped: instead of Windows Graphics Capture handing
 * it pixels, this file draws them. Everything the visitor touches is the actual
 * product, which is the only way a demo is worth having.
 *
 * These are deliberately not screenshots. A screenshot is a still, and the
 * whole point of the app is that the tiles are *live*: a cursor moving, a log
 * scrolling, a chart redrawing. Drawn means they move, they cost nothing to
 * ship, and they contain nobody's actual data.
 */

import type { Drawable, MediaResolver } from "../core/render";
import type { Tile } from "../core/types";

const WIDTH = 1280;
const HEIGHT = 720;

type Painter = (ctx: CanvasRenderingContext2D, t: number) => void;

/** A plausible desktop, keyed by the source id the board asks for. */
interface Screen {
  canvas: HTMLCanvasElement;
  paint: Painter;
}

const MONO = '"JetBrains Mono", "Cascadia Mono", Consolas, monospace';
const SANS = '"Inter Variable", Inter, "Segoe UI", system-ui, sans-serif';

/* -------------------------------------------------------------------------- */
/* Pieces                                                                      */
/* -------------------------------------------------------------------------- */

function windowChrome(
  ctx: CanvasRenderingContext2D,
  title: string,
  ground: string,
  bar: string,
  ink: string,
) {
  ctx.fillStyle = ground;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = bar;
  ctx.fillRect(0, 0, WIDTH, 44);
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(24 + i * 20, 22, 6, 0, Math.PI * 2);
    ctx.fillStyle = ["#FF5F57", "#FEBC2E", "#28C840"][i];
    ctx.fill();
  }
  ctx.fillStyle = ink;
  ctx.font = `500 15px ${SANS}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(title, WIDTH / 2, 22);
  ctx.textAlign = "left";
}

/** An editor with code that types itself out and a cursor that blinks. */
const CODE = [
  ["const", " stage", " = ", "board", ".frame;"],
  [],
  ["// Only what is inside this rectangle is shared."],
  ["export function", " onAir", "(", "tile", ": Tile) {"],
  ["  return", " overlaps", "(stage, ", "tileRect", "(tile));"],
  ["}"],
  [],
  ["const", " shot", " = ", "punchRect", "(doc, cursor, monitors);"],
  ["if", " (shot) ", "setStage", "(shot, { force: ", "true", " });"],
];

const CODE_COLOURS = ["#C678DD", "#E5C07B", "#ABB2BF", "#61AFEF", "#98C379", "#7F848E"];

const editor: Painter = (ctx, t) => {
  windowChrome(ctx, "stage.ts — screen-stuff", "#21252B", "#1B1F23", "#8B949E");

  ctx.fillStyle = "#1B1F23";
  ctx.fillRect(0, 44, 210, HEIGHT - 44);
  ctx.font = `13px ${SANS}`;
  const files = ["src", "  core", "    stage.ts", "    render.ts", "    redact.ts", "  cockpit", "  demo"];
  files.forEach((file, i) => {
    ctx.fillStyle = file.includes("stage.ts") ? "#61AFEF" : "#6B7280";
    ctx.fillText(file, 18, 84 + i * 26);
  });

  // Reveals a character at a time, then holds, then starts again.
  const total = CODE.reduce((n, line) => n + line.join("").length + 1, 0);
  const shown = Math.floor(((t / 26) % (total + 90)) * 1);
  let seen = 0;

  ctx.font = `15px ${MONO}`;
  CODE.forEach((line, row) => {
    let x = 240;
    const y = 92 + row * 30;
    ctx.fillStyle = "#4B5263";
    ctx.fillText(String(row + 1).padStart(2, " "), 210, y);
    line.forEach((part, i) => {
      const room = Math.max(0, Math.min(part.length, shown - seen));
      const text = part.slice(0, room);
      seen += part.length;
      ctx.fillStyle = line.length === 1 && part.startsWith("//") ? "#5C6370" : CODE_COLOURS[i % CODE_COLOURS.length];
      ctx.fillText(text, x, y);
      x += ctx.measureText(part).width;
      if (room < part.length) x = -1;
    });
    seen += 1;
  });

  if (Math.floor(t / 500) % 2 === 0) {
    ctx.fillStyle = "#61AFEF";
    ctx.fillRect(240, 300, 2, 20);
  }
};

/** A dashboard with a chart that keeps drawing. */
const dashboard: Painter = (ctx, t) => {
  windowChrome(ctx, "Analytics — this week", "#FFFFFF", "#F3F5F9", "#5B6474");

  ctx.fillStyle = "#101828";
  ctx.font = `650 26px ${SANS}`;
  ctx.fillText("Sessions", 48, 100);

  const cards = [
    ["Live now", "1,284", "#0562FE"],
    ["Today", "18.4k", "#14B18D"],
    ["Median", "3m 12s", "#FD9F0A"],
  ];
  cards.forEach(([label, value, colour], i) => {
    const x = 48 + i * 240;
    ctx.fillStyle = "#F7F9FC";
    ctx.beginPath();
    ctx.roundRect(x, 126, 216, 96, 12);
    ctx.fill();
    ctx.fillStyle = "#6B7280";
    ctx.font = `12px ${SANS}`;
    ctx.fillText(String(label).toUpperCase(), x + 18, 154);
    ctx.fillStyle = colour as string;
    ctx.font = `650 30px ${SANS}`;
    ctx.fillText(String(value), x + 18, 194);
  });

  // The chart: a line that redraws with the clock, so it is never still.
  const left = 48;
  const right = WIDTH - 48;
  const top = 262;
  const bottom = HEIGHT - 70;
  ctx.strokeStyle = "#EDF0F5";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = top + ((bottom - top) / 4) * i;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
  }

  ctx.beginPath();
  const points = 56;
  for (let i = 0; i <= points; i++) {
    const p = i / points;
    const x = left + (right - left) * p;
    const wave =
      Math.sin(p * 6 + t / 900) * 0.22 + Math.sin(p * 13 + t / 420) * 0.1 + Math.sin(p * 2.2) * 0.3;
    const y = bottom - (bottom - top) * (0.45 + wave);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = "#0562FE";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.lineTo(right, bottom);
  ctx.lineTo(left, bottom);
  ctx.closePath();
  ctx.fillStyle = "rgba(5,98,254,0.10)";
  ctx.fill();
};

/** A terminal with a build that keeps running. */
const LOG = [
  ["$ ", "#98C379", "pnpm test"],
  ["", "#ABB2BF", " ✓ tests/stage.test.ts (39)"],
  ["", "#ABB2BF", " ✓ tests/redact.test.ts (11)"],
  ["", "#ABB2BF", " ✓ tests/autoframe.test.ts (27)"],
  ["", "#ABB2BF", " ✓ tests/pointer.test.ts (17)"],
  ["", "#ABB2BF", " ✓ tests/layouts.test.ts (27)"],
  ["", "#ABB2BF", " ✓ tests/voice.test.ts (20)"],
  ["", "#ABB2BF", " ✓ tests/replay.test.ts (13)"],
  ["", "#98C379", " Tests  326 passed (326)"],
  ["$ ", "#98C379", "cargo clippy -- -D warnings"],
  ["", "#5C6370", "    Finished `dev` profile in 0.52s"],
];

const terminal: Painter = (ctx, t) => {
  windowChrome(ctx, "screen-stuff — pwsh", "#0C0E12", "#15181E", "#7D8590");
  ctx.font = `15px ${MONO}`;
  const rows = Math.floor((t / 380) % (LOG.length + 6));
  LOG.slice(0, rows).forEach((line, i) => {
    const y = 86 + i * 28;
    ctx.fillStyle = "#61AFEF";
    ctx.fillText(line[0], 32, y);
    ctx.fillStyle = line[1];
    ctx.fillText(line[2], 32 + ctx.measureText(line[0]).width, y);
  });
  if (Math.floor(t / 500) % 2 === 0 && rows <= LOG.length) {
    ctx.fillStyle = "#98C379";
    ctx.fillRect(32, 74 + rows * 28, 9, 18);
  }
};

/** A chat, because everybody has one open and nobody wants it on the call. */
const chat: Painter = (ctx, t) => {
  windowChrome(ctx, "Messages", "#FFFFFF", "#F3F5F9", "#5B6474");
  ctx.fillStyle = "#F7F9FC";
  ctx.fillRect(0, 44, 280, HEIGHT - 44);
  const rooms = ["# general", "# launch", "# clients — acme", "# clients — northvane", "# invoices"];
  rooms.forEach((room, i) => {
    ctx.fillStyle = i === 2 ? "#0562FE" : "#6B7280";
    ctx.font = `${i === 2 ? "600 " : ""}14px ${SANS}`;
    ctx.fillText(room, 24, 92 + i * 34);
  });

  const messages = [
    ["Priya", "can you show the board again?", "#14B18D"],
    ["You", "one sec — punching in", "#0562FE"],
    ["Priya", "perfect, that's the bit", "#14B18D"],
  ];
  const shown = Math.min(messages.length, 1 + Math.floor((t / 1600) % (messages.length + 1)));
  messages.slice(0, shown).forEach(([who, text, colour], i) => {
    const y = 120 + i * 92;
    ctx.fillStyle = colour as string;
    ctx.beginPath();
    ctx.arc(324, y, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#101828";
    ctx.font = `600 14px ${SANS}`;
    ctx.fillText(String(who), 352, y - 4);
    ctx.fillStyle = "#4B5563";
    ctx.font = `15px ${SANS}`;
    ctx.fillText(String(text), 352, y + 20);
  });
};

const PAINTERS: Record<string, Painter> = {
  "monitor:1": editor,
  "monitor:2": dashboard,
  "monitor:3": terminal,
  "monitor:4": chat,
};

/** The sources the demo pretends to have. */
export const DEMO_SOURCES = [
  { id: "monitor:1", title: "Display 1", subtitle: "Editor · 2560 × 1440" },
  { id: "monitor:2", title: "Display 2", subtitle: "Dashboard · 2560 × 1440" },
  { id: "monitor:3", title: "Display 3", subtitle: "Terminal · 1920 × 1080" },
  { id: "monitor:4", title: "Display 4", subtitle: "Messages · 1920 × 1080" },
].map((s) => ({
  ...s,
  kind: "monitor" as const,
  width: 2560,
  height: 1440,
  x: 0,
  y: 0,
  isPrimary: s.id === "monitor:1",
}));

/**
 * Stands in for the capture engine.
 *
 * One canvas per source, repainted on demand and at most once per animation
 * frame — the board asks for the same tile several times a frame and there is
 * no reason to redraw a fake desktop for each of them.
 */
export class DemoMedia implements MediaResolver {
  private screens = new Map<string, Screen>();
  private paintedAt = new Map<string, number>();
  private started = performance.now();

  resolve(tile: Tile): Drawable | null {
    const source = tile.kind === "source" ? tile.source : null;
    if (!source) return null;
    const paint = PAINTERS[source];
    if (!paint) return null;

    let screen = this.screens.get(source);
    if (!screen) {
      const canvas = document.createElement("canvas");
      canvas.width = WIDTH;
      canvas.height = HEIGHT;
      screen = { canvas, paint };
      this.screens.set(source, screen);
    }

    const now = performance.now();
    if ((this.paintedAt.get(source) ?? -1) < now - 24) {
      const ctx = screen.canvas.getContext("2d");
      if (ctx) {
        ctx.save();
        screen.paint(ctx, now - this.started);
        ctx.restore();
      }
      this.paintedAt.set(source, now);
    }

    return { image: screen.canvas, width: WIDTH, height: HEIGHT };
  }

  statusFor(): string | null {
    return null;
  }
}
