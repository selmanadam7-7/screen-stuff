/**
 * The control API's vocabulary.
 *
 * Everything anything else on this machine can ask the app to do — a Stream
 * Deck, a shell script, the hotkey daemon someone already lives in. Rust owns
 * the socket; this owns the meaning.
 *
 * Three rules shape the whole table:
 *
 *   * **Say what happened, not that it was heard.** Every action returns the
 *     thing it produced — the stage it actually landed on, the tile it actually
 *     found. A caller that gets `{ ok: true }` and nothing else has learned
 *     nothing, and cannot tell a working button from a broken one.
 *   * **Refuse in words a person can act on.** A wrong tile name comes back
 *     with the names that do exist. There is no documentation to go and read at
 *     3am with a call waiting.
 *   * **Address things the way a person would.** `{"name": "code"}` finds the
 *     tile labelled Code. Ids exist and work, but nobody writes a Stream Deck
 *     button around a uuid.
 *
 * The reference at `GET /` is generated from this same table, so it cannot
 * describe an action that is not here or miss one that is.
 */

import type { AutoFrameMode } from "./autoframe";
import { fitAspect, rect, tileRect } from "./geometry";
import type { LayoutKind } from "./layouts";
import { LAYOUTS } from "./layouts";
import { CARD_PRESETS, cardFromPreset } from "./overlays";
import type { HoldingCard } from "./overlays";
import { fitView } from "./stage";
import type { BoardDoc, Rect, Scene, Tile } from "./types";

/** A refusal the caller can read. Anything else is a bug and reads like one. */
export class ControlRefusal extends Error {}

const no = (message: string): never => {
  throw new ControlRefusal(message);
};

/**
 * What an action is allowed to touch.
 *
 * Deliberately the shape of the cockpit store rather than the store itself, so
 * the table can be exercised without a window, a canvas or a Rust process.
 */
export interface ControlTarget {
  doc: BoardDoc;
  frame: Rect;
  view: Rect;
  preview: Rect | null;
  isPrivate: boolean;
  followView: boolean;
  spotlight: string | null;
  autoFrame: AutoFrameMode;
  punchedFrom: Rect | null;
  guests: {
    running: boolean;
    link: string | null;
    publicLink?: string | null;
    /** The board with none of the furniture, for a broadcast tool. */
    outputLink?: string | null;
    publicOutputLink?: string | null;
    guests: unknown[];
  };

  setStage(next: Rect, options?: { transition?: "cut" | "fly"; force?: boolean }): void;
  applyLayout(kind: LayoutKind): void;
  stageAroundEverything(): void;
  showStage(): void;
  applyScene(id: string): void;
  saveScene(name?: string): void;
  patchTile(id: string, patch: Partial<Tile>): void;
  addSources(ids: string[]): void;
  addCamera(): void;
  addNote(text?: string): void;
  addWeb(url: string): Promise<void>;
  select(ids: string[], additive?: boolean): void;
  deleteSelection(): void;
  setSpotlight(id: string | null): void;
  openPreview(): void;
  closePreview(): void;
  setPreview(next: Rect): void;
  take(): void;
  setPrivate(on: boolean): void;
  setFollowView(on: boolean): void;
  setAutoFrame(mode: AutoFrameMode): void;
  punchIn(next: Rect): void;
  punchOut(): void;
  showCard(card: HoldingCard | null): void;
  setLowerThird(third: { name: string; role: string } | null): void;
  setBoardProp(patch: Partial<BoardDoc>): void;
  startGuests(): Promise<void>;
  stopGuests(): Promise<void>;
  startTunnel(): Promise<void>;
  stopTunnel(): Promise<void>;
  toast(message: string, tone?: "info" | "warn"): void;
  /** Draws the stage exactly as the audience sees it, as a PNG data URL. */
  shot(): Promise<string>;
}

/**
 * A target that reads through to a live store instead of a snapshot of one.
 *
 * This is not a nicety. Every action here mutates through the store and then
 * reports what changed, so a target built by copying the state once answers
 * every question with the state from *before* its own action: `add` said
 * nothing was added while adding, and a card came back null while up. The
 * actions are copied because they never change identity; the state is read
 * again on every access because it changes constantly.
 */
export function liveTarget(
  getState: () => Omit<ControlTarget, "shot">,
  shot: () => Promise<string>,
): ControlTarget {
  return {
    ...getState(),
    get doc() {
      return getState().doc;
    },
    get frame() {
      return getState().frame;
    },
    get view() {
      return getState().view;
    },
    get preview() {
      return getState().preview;
    },
    get isPrivate() {
      return getState().isPrivate;
    },
    get followView() {
      return getState().followView;
    },
    get spotlight() {
      return getState().spotlight;
    },
    get autoFrame() {
      return getState().autoFrame;
    },
    get punchedFrom() {
      return getState().punchedFrom;
    },
    get guests() {
      return getState().guests;
    },
    shot,
  };
}

type Body = Record<string, unknown>;

export interface Action {
  /** One line, in the imperative, as it appears in the generated reference. */
  summary: string;
  /** The shapes the body may take, most useful first. */
  accepts: string[];
  /** A body that works, copied straight into the reference. */
  example: Body;
  run(target: ControlTarget, body: Body): unknown | Promise<unknown>;
}

// --- reading the body -------------------------------------------------------

const num = (body: Body, key: string): number | null => {
  const value = body[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

const str = (body: Body, key: string): string | null => {
  const value = body[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
};

const flag = (body: Body, key: string): boolean | null => {
  const value = body[key];
  return typeof value === "boolean" ? value : null;
};

/** A rectangle, only if all four numbers are there. Three is a typo, not a rect. */
function rectIn(body: Body): Rect | null {
  const x = num(body, "x");
  const y = num(body, "y");
  const w = num(body, "w");
  const h = num(body, "h");
  if (x === null || y === null || w === null || h === null) return null;
  if (w <= 0 || h <= 0) no("a rectangle needs a positive width and height");
  return rect(x, y, w, h);
}

/** How a tile is described in a reply: enough to address it again, no more. */
export const describeTile = (tile: Tile) => ({
  id: tile.id,
  kind: tile.kind,
  name: tileName(tile),
  x: Math.round(tile.x),
  y: Math.round(tile.y),
  w: Math.round(tile.w),
  h: Math.round(tile.h),
  hidden: tile.hidden,
});

/** The name a person would use for a tile, in the order they would try it. */
export function tileName(tile: Tile): string {
  if (tile.label.trim()) return tile.label.trim();
  if (tile.kind === "source") return tile.source;
  if (tile.kind === "web") return tile.url;
  if (tile.kind === "note") return tile.text.split("\n")[0]?.slice(0, 40) || "Note";
  if ("name" in tile && typeof tile.name === "string" && tile.name) return tile.name;
  return tile.kind;
}

/**
 * Find the tile a body is talking about.
 *
 * An exact id first, then an exact name, then a unique partial name. Ambiguity
 * is refused rather than guessed: picking the first of two matching tiles
 * mid-call is worse than doing nothing, because nothing is visible and wrong
 * is not.
 */
export function findTile(doc: BoardDoc, body: Body, key = "tile"): Tile {
  const wanted = str(body, "id") ?? str(body, key) ?? str(body, "name");
  if (!wanted) no(`say which tile: { "${key}": "the name or id of one" }`);
  const needle = (wanted as string).toLowerCase();

  const byId = doc.tiles.find((t) => t.id === wanted);
  if (byId) return byId;

  // The id the caller got from GET /sources, which is the one they added it
  // with. A screen picks up its monitor's name as a label the moment it lands,
  // so without this the id you just used stops working the second it works.
  const bySource = doc.tiles.filter(
    (t) => "source" in t && typeof t.source === "string" && t.source === wanted,
  );
  if (bySource.length === 1) return bySource[0];

  const named = doc.tiles.filter((t) => tileName(t).toLowerCase() === needle);
  if (named.length === 1) return named[0];

  const partial = doc.tiles.filter((t) => tileName(t).toLowerCase().includes(needle));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    no(
      `"${wanted}" matches ${partial.length} tiles: ${partial.map((t) => tileName(t)).join(", ")}`,
    );
  }

  const available = doc.tiles.map((t) =>
    // Both the name and the source id, because the caller could reasonably be
    // holding either, and a list that omits the one they have is not help.
    "source" in t && typeof t.source === "string" && t.source !== tileName(t)
      ? `${tileName(t)} (${t.source})`
      : tileName(t),
  );
  no(
    available.length
      ? `there is no tile called "${wanted}". On the board: ${available.join(", ")}`
      : `there is no tile called "${wanted}" — the board is empty`,
  );
  throw new Error("unreachable");
}

/** Scenes are recalled by name or by their hotkey, whichever the caller has. */
export function findScene(doc: BoardDoc, body: Body): Scene {
  const wanted = str(body, "scene") ?? str(body, "name") ?? str(body, "key");
  if (!wanted) no('say which scene: { "scene": "its name" }');
  const needle = (wanted as string).toLowerCase();
  const found =
    doc.scenes.find((s) => s.id === wanted) ??
    doc.scenes.find((s) => s.name.toLowerCase() === needle) ??
    doc.scenes.find((s) => s.hotkey && s.hotkey.toLowerCase() === needle) ??
    doc.scenes.find((s) => s.name.toLowerCase().includes(needle));
  if (found) return found;
  const available = doc.scenes.map((s) => s.name);
  no(
    available.length
      ? `there is no scene called "${wanted}". Saved: ${available.join(", ")}`
      : `there is no scene called "${wanted}" — none are saved yet`,
  );
  throw new Error("unreachable");
}

const stageOf = (target: ControlTarget) => ({
  x: Math.round(target.doc.frame.x),
  y: Math.round(target.doc.frame.y),
  w: Math.round(target.doc.frame.w),
  h: Math.round(target.doc.frame.h),
});

// --- the table --------------------------------------------------------------

export const ACTIONS: Record<string, Action> = {
  stage: {
    summary: "Move the rectangle the audience sees.",
    accepts: [
      '{ "x": 0, "y": 0, "w": 1920, "h": 1080 } — exactly there',
      '{ "tile": "code" } — around one tile',
      '{ "preset": "everything" | "home" } — around all of it, or back to the saved stage',
      '{ "transition": "cut" | "fly" } — with any of the above; the default is a fly',
    ],
    example: { tile: "code" },
    run(target, body) {
      const transition = str(body, "transition") === "cut" ? "cut" : "fly";
      const explicit = rectIn(body);
      const preset = str(body, "preset");

      if (explicit) {
        target.setStage(explicit, { transition, force: true });
      } else if (preset === "everything") {
        target.stageAroundEverything();
      } else if (preset === "home") {
        target.setStage(target.doc.frame, { transition, force: true });
      } else if (preset) {
        no(`"${preset}" is not a preset. Try "everything" or "home".`);
      } else {
        const tile = findTile(target.doc, body);
        target.setStage(fitAspect(tileRect(tile), target.doc.aspect), {
          transition,
          force: true,
        });
      }
      return { stage: stageOf(target) };
    },
  },

  layout: {
    summary: "Rearrange the tiles inside the stage.",
    accepts: [`{ "layout": ${LAYOUTS.map((l) => `"${l.kind}"`).join(" | ")} }`],
    example: { layout: "grid" },
    run(target, body) {
      const wanted = str(body, "layout") ?? str(body, "kind");
      const known = LAYOUTS.map((l) => l.kind);
      if (!wanted || !known.includes(wanted as LayoutKind)) {
        no(`say which layout: ${known.join(", ")}`);
      }
      target.applyLayout(wanted as LayoutKind);
      return { layout: wanted, tiles: target.doc.tiles.filter((t) => !t.hidden).length };
    },
  },

  scene: {
    summary: "Recall a saved shot, or save the one you are on.",
    accepts: [
      '{ "scene": "wide" } — cut to it',
      '{ "save": "wide" } — save the stage as it is now under that name',
    ],
    example: { scene: "wide" },
    run(target, body) {
      const saving = str(body, "save");
      if (saving) {
        target.saveScene(saving);
        return { saved: saving, stage: stageOf(target) };
      }
      const scene = findScene(target.doc, body);
      target.applyScene(scene.id);
      return { scene: scene.name, stage: stageOf(target) };
    },
  },

  card: {
    summary: "Put a holding card over the shot, or take it down.",
    accepts: [
      `{ "preset": ${CARD_PRESETS.map((p) => `"${p.key}"`).join(" | ")} }`,
      '{ "title": "Back at 3", "subtitle": "…", "minutes": 5 }',
      '{ "clear": true } — take it down',
    ],
    example: { preset: "brb" },
    run(target, body) {
      if (flag(body, "clear") || str(body, "preset") === "off") {
        target.showCard(null);
        return { card: null };
      }
      const preset = str(body, "preset");
      if (preset) {
        const card = cardFromPreset(preset, Date.now());
        if (!card) {
          no(`"${preset}" is not a card. Try ${CARD_PRESETS.map((p) => p.key).join(", ")}.`);
        }
        target.showCard(card);
        return { card: target.doc.card };
      }
      const title = str(body, "title");
      if (!title) no('a card needs a { "title" }, or a { "preset" }');
      const minutes = num(body, "minutes");
      target.showCard({
        title: title as string,
        subtitle: str(body, "subtitle") ?? "",
        // Absolute, so a card raised now still counts down correctly later.
        until: minutes === null ? null : Date.now() + minutes * 60_000,
        showBoard: flag(body, "showBoard") ?? false,
      });
      return { card: target.doc.card };
    },
  },

  "lower-third": {
    summary: "Put your name in the corner of the shot, or take it off.",
    accepts: ['{ "name": "Adam", "role": "Founder" }', '{ "clear": true }'],
    example: { name: "Adam Selman", role: "Screen Stuff" },
    run(target, body) {
      if (flag(body, "clear")) {
        target.setLowerThird(null);
        return { lowerThird: null };
      }
      const name = str(body, "name") ?? str(body, "title");
      if (!name) no('a lower third needs a { "name" }');
      target.setLowerThird({ name: name as string, role: str(body, "role") ?? "" });
      return { lowerThird: target.doc.lowerThird };
    },
  },

  tile: {
    summary: "Move, resize, hide or relabel one tile.",
    accepts: [
      '{ "tile": "code", "hidden": true }',
      '{ "tile": "camera", "x": 0, "y": 0, "w": 480, "h": 270 }',
      '{ "tile": "code", "label": "The build" }',
    ],
    example: { tile: "camera", hidden: false },
    run(target, body) {
      const tile = findTile(target.doc, body);
      const patch: Partial<Tile> = {};
      for (const key of ["x", "y", "w", "h", "opacity", "rotation"] as const) {
        const value = num(body, key);
        if (value !== null) (patch as Record<string, number>)[key] = value;
      }
      for (const key of ["hidden", "locked", "shadow"] as const) {
        const value = flag(body, key);
        if (value !== null) (patch as Record<string, boolean>)[key] = value;
      }
      const label = str(body, "label");
      if (label !== null) patch.label = label;
      if (Object.keys(patch).length === 0) {
        // A read is a legitimate thing to want, and refusing it would make the
        // caller guess at the geometry it is about to change.
        return { tile: describeTile(tile) };
      }
      target.patchTile(tile.id, patch);
      const after = target.doc.tiles.find((t) => t.id === tile.id) ?? tile;
      return { tile: describeTile(after) };
    },
  },

  add: {
    summary: "Put something new on the board.",
    accepts: [
      '{ "source": "monitor:1" } — a screen or window, from GET /sources',
      '{ "camera": true }',
      '{ "note": "text" }',
      '{ "web": "https://…" }',
    ],
    example: { source: "monitor:1" },
    run: async (target, body) => {
      const before = new Set(target.doc.tiles.map((t) => t.id));
      const source = str(body, "source");
      const web = str(body, "web") ?? str(body, "url");
      const note = str(body, "note");

      if (source) target.addSources([source]);
      else if (flag(body, "camera")) target.addCamera();
      else if (note) target.addNote(note);
      else if (web) await target.addWeb(web);
      else no('say what to add: a "source", "web", "note", or "camera": true');

      const added = target.doc.tiles.filter((t) => !before.has(t.id));
      if (!added.length) no("nothing was added — the source may have gone away");
      return { added: added.map(describeTile) };
    },
  },

  remove: {
    summary: "Take something off the board.",
    accepts: ['{ "tile": "code" }'],
    example: { tile: "note" },
    run(target, body) {
      const tile = findTile(target.doc, body);
      target.select([tile.id]);
      target.deleteSelection();
      return { removed: describeTile(tile) };
    },
  },

  spotlight: {
    summary: "Follow one tile with the stage, or stop following.",
    accepts: ['{ "tile": "code" }', '{ "off": true }'],
    example: { tile: "code" },
    run(target, body) {
      if (flag(body, "off") || body.tile === null) {
        target.setSpotlight(null);
        return { spotlight: null };
      }
      const tile = findTile(target.doc, body);
      target.setSpotlight(tile.id);
      return { spotlight: describeTile(tile) };
    },
  },

  preview: {
    summary: "Set up the next shot where the audience cannot see it.",
    accepts: [
      '{ "tile": "slides" } — line the preview up on a tile',
      '{ "x": 0, "y": 0, "w": 1920, "h": 1080 }',
      '{ "close": true }',
    ],
    example: { tile: "slides" },
    run(target, body) {
      if (flag(body, "close")) {
        target.closePreview();
        return { preview: null };
      }
      target.openPreview();
      const explicit = rectIn(body);
      if (explicit) target.setPreview(explicit);
      else if (str(body, "tile") || str(body, "id") || str(body, "name")) {
        const tile = findTile(target.doc, body);
        target.setPreview(fitAspect(tileRect(tile), target.doc.aspect));
      }
      return { preview: target.preview };
    },
  },

  take: {
    summary: "Cut the preview to air.",
    accepts: ["{} — no body needed"],
    example: {},
    run(target) {
      if (!target.preview) no("there is no preview to take — set one up first");
      target.take();
      return { stage: stageOf(target) };
    },
  },

  private: {
    summary: "Hold the audience on the stage while you work elsewhere.",
    accepts: ['{ "on": true }'],
    example: { on: true },
    run(target, body) {
      const on = flag(body, "on") ?? true;
      target.setPrivate(on);
      return { private: on, stage: stageOf(target) };
    },
  },

  follow: {
    summary: "Make the audience follow wherever you look.",
    accepts: ['{ "on": true }'],
    example: { on: false },
    run(target, body) {
      const on = flag(body, "on") ?? true;
      target.setFollowView(on);
      return { follow: on };
    },
  },

  autoframe: {
    summary: "Let the stage follow your work between monitors or windows.",
    accepts: ['{ "mode": "off" | "monitor" | "window" }'],
    example: { mode: "monitor" },
    run(target, body) {
      const mode = str(body, "mode") ?? "off";
      if (!["off", "monitor", "window"].includes(mode)) {
        no(`"${mode}" is not a mode. Try off, monitor or window.`);
      }
      target.setAutoFrame(mode as AutoFrameMode);
      return { autoframe: mode };
    },
  },

  punch: {
    summary: "Snap in tight on something, then snap back.",
    accepts: ['{ "tile": "code" }', '{ "out": true }'],
    example: { tile: "code" },
    run(target, body) {
      if (flag(body, "out")) {
        if (!target.punchedFrom) no("you are not punched in");
        target.punchOut();
        return { stage: stageOf(target), punched: false };
      }
      const tile = findTile(target.doc, body);
      target.punchIn(fitAspect(tileRect(tile), target.doc.aspect));
      return { stage: stageOf(target), punched: true };
    },
  },

  guests: {
    summary: "Open or close the link people watch from.",
    accepts: [
      '{ "on": true } — on this network',
      '{ "on": true, "public": true } — and off it, through a tunnel',
    ],
    example: { on: true, public: true },
    run: async (target, body) => {
      const on = flag(body, "on") ?? true;
      if (!on) {
        await target.stopTunnel();
        await target.stopGuests();
        return { guests: false, link: null };
      }
      if (!target.guests.running) await target.startGuests();
      if (flag(body, "public")) await target.startTunnel();
      return {
        guests: true,
        link: target.guests.link,
        publicLink: target.guests.publicLink ?? null,
        // The one a broadcast tool wants, which is usually why a script is
        // opening the link in the first place.
        outputLink: target.guests.publicOutputLink ?? target.guests.outputLink ?? null,
        watching: target.guests.guests.length,
      };
    },
  },

  board: {
    summary: "Change how the board itself is set up.",
    accepts: ['{ "fps": 30 }', '{ "quality": 80 }', '{ "background": "#0b0d10" }'],
    example: { fps: 30 },
    run(target, body) {
      const patch: Partial<BoardDoc> = {};
      const fps = num(body, "fps");
      if (fps !== null) {
        if (fps < 1 || fps > 60) no("frame rate has to be between 1 and 60");
        patch.fps = Math.round(fps);
      }
      const quality = num(body, "quality");
      if (quality !== null) {
        if (quality < 20 || quality > 100) no("quality has to be between 20 and 100");
        patch.quality = Math.round(quality);
      }
      const background = str(body, "background");
      if (background) patch.background = background;
      const grid = flag(body, "showGrid");
      if (grid !== null) patch.showGrid = grid;
      if (!Object.keys(patch).length) {
        return { fps: target.doc.fps, quality: target.doc.quality, name: target.doc.name };
      }
      target.setBoardProp(patch);
      return { fps: target.doc.fps, quality: target.doc.quality };
    },
  },

  flash: {
    summary: "Put a line of text on your own screen. Nobody else sees it.",
    accepts: ['{ "message": "two minutes left" }'],
    example: { message: "two minutes left" },
    run(target, body) {
      const message = str(body, "message") ?? str(body, "text");
      if (!message) no('say what to show: { "message": "…" }');
      target.toast(message as string, str(body, "tone") === "warn" ? "warn" : "info");
      return { flashed: message };
    },
  },

  shot: {
    summary: "A PNG of the shot as it is going out right now.",
    accepts: ["{} — no body needed; GET /shot returns the image itself"],
    example: {},
    run: async (target) => ({ png: await target.shot() }),
  },

  help: {
    summary: "This.",
    accepts: ["{} — no body needed"],
    example: {},
    run: () => reference(),
  },
};

/**
 * The reference, built from the table above.
 *
 * Generated rather than written, because a hand-written reference for a moving
 * API is a document that is wrong by the second release.
 */
export function reference() {
  return {
    name: "Screen Stuff control API",
    about:
      "Everything the operator can do, over loopback. POST /<action> with a JSON body; " +
      "GET /state, /sources, /shot; GET /events is a WebSocket that pushes state as it changes. " +
      "Pass the token as ?token= or an X-Control-Token header.",
    actions: Object.entries(ACTIONS)
      .filter(([name]) => name !== "help")
      .map(([name, action]) => ({
        name,
        summary: action.summary,
        accepts: action.accepts,
        example: { post: `/${name}`, body: action.example },
      })),
  };
}

/** What the API publishes as state, and what a watcher on /events receives. */
export function stateOf(target: ControlTarget) {
  return {
    board: target.doc.name,
    stage: stageOf(target),
    aspect: target.doc.aspect,
    private: target.isPrivate,
    follow: target.followView,
    autoframe: target.autoFrame,
    punched: target.punchedFrom !== null,
    card: target.doc.card ?? null,
    lowerThird: target.doc.lowerThird ?? null,
    spotlight: target.spotlight,
    preview: target.preview,
    fps: target.doc.fps,
    quality: target.doc.quality,
    tiles: target.doc.tiles.map(describeTile),
    scenes: target.doc.scenes.map((s) => ({ name: s.name, hotkey: s.hotkey })),
    guests: {
      running: target.guests.running,
      link: target.guests.link,
      publicLink: target.guests.publicLink ?? null,
      outputLink: target.guests.publicOutputLink ?? target.guests.outputLink ?? null,
      watching: target.guests.guests.length,
    },
  };
}

/** The answer to one request: either a result or a reason, never both. */
export type ControlOutcome = { result: unknown } | { error: string };

/**
 * Run one action.
 *
 * Never throws. A refusal is an answer, and the caller on the other end of a
 * socket is owed one either way.
 */
export async function perform(
  target: ControlTarget,
  action: string,
  body: unknown,
): Promise<ControlOutcome> {
  const known = ACTIONS[action];
  if (!known) {
    return {
      error: `there is no action called "${action}". Try: ${Object.keys(ACTIONS).join(", ")}`,
    };
  }
  const payload: Body =
    body && typeof body === "object" && !Array.isArray(body) ? (body as Body) : {};
  try {
    return { result: await known.run(target, payload) };
  } catch (err) {
    if (err instanceof ControlRefusal) return { error: err.message };
    // A real failure, reported as one rather than dressed up as a refusal.
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** The stage a `fit everything` would land on, for callers that want to know. */
export const everythingStage = (doc: BoardDoc): Rect => fitView(stageAroundEverythingBounds(doc), doc.aspect);

function stageAroundEverythingBounds(doc: BoardDoc): Rect {
  const visible = doc.tiles.filter((t) => !t.hidden);
  if (!visible.length) return doc.frame;
  const left = Math.min(...visible.map((t) => t.x));
  const top = Math.min(...visible.map((t) => t.y));
  const right = Math.max(...visible.map((t) => t.x + t.w));
  const bottom = Math.max(...visible.map((t) => t.y + t.h));
  return rect(left, top, right - left, bottom - top);
}
