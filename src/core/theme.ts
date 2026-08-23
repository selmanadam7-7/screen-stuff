/**
 * The canvas is drawn in a canvas element, not in CSS, so it has to read the
 * design tokens rather than inherit them.
 *
 * Values are cached per look — reading a dozen custom properties every frame at
 * 60fps would be a real cost, and they only change when the look does.
 */

export interface Theme {
  canvas: string;
  dot: string;
  panel: string;
  panelAlt: string;
  line: string;
  lineSoft: string;
  ink: string;
  ink2: string;
  ink3: string;
  accent: string;
  accentTint: string;
  accentInk: string;
  onAccent: string;
  note: string;
  noteInk: string;
  danger: string;
  warning: string;
  /** True when the surface is dark, so shadows and scrims can flip. */
  dark: boolean;
}

const FALLBACK: Theme = {
  canvas: "#FCFCFD",
  dot: "rgba(30,35,41,0.09)",
  panel: "#FFFFFF",
  panelAlt: "#F8F9FB",
  line: "#DDDDE1",
  lineSoft: "#E9EBEF",
  ink: "#1E2329",
  ink2: "#6C7480",
  ink3: "#9AA0AB",
  accent: "#0562FE",
  accentTint: "#EFF4FE",
  accentInk: "#0345BA",
  onAccent: "#FFFFFF",
  note: "#FEF4D7",
  noteInk: "#6B5518",
  danger: "#FA3928",
  warning: "#FD9F0A",
  dark: false,
};

let cachedLook: string | null = null;
let cached: Theme = FALLBACK;

export function readTheme(force = false): Theme {
  if (typeof document === "undefined") return FALLBACK;
  const look = document.documentElement.dataset.look ?? "pure-white";
  if (!force && look === cachedLook) return cached;

  const styles = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) =>
    styles.getPropertyValue(name).trim() || fallback;

  cached = {
    canvas: read("--canvas", FALLBACK.canvas),
    dot: read("--canvas-dot", FALLBACK.dot),
    panel: read("--panel", FALLBACK.panel),
    panelAlt: read("--panel-2", FALLBACK.panelAlt),
    line: read("--line", FALLBACK.line),
    lineSoft: read("--line-soft", FALLBACK.lineSoft),
    ink: read("--ink", FALLBACK.ink),
    ink2: read("--ink-2", FALLBACK.ink2),
    ink3: read("--ink-3", FALLBACK.ink3),
    accent: read("--accent", FALLBACK.accent),
    accentTint: read("--accent-tint", FALLBACK.accentTint),
    accentInk: read("--accent-ink", FALLBACK.accentInk),
    onAccent: "#FFFFFF",
    note: read("--note", FALLBACK.note),
    noteInk: read("--note-ink", FALLBACK.noteInk),
    danger: read("--danger", FALLBACK.danger),
    warning: read("--warning", FALLBACK.warning),
    dark: look === "graphite-dark",
  };
  cachedLook = look;
  return cached;
}

/** Called when the look changes, so the next frame re-reads. */
export function invalidateTheme() {
  cachedLook = null;
}
