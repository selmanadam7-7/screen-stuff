/**
 * Cockpit state.
 *
 * The cockpit owns the board document; the board window is a renderer that
 * receives snapshots. That split means the thing you edit and the thing on air
 * can be deliberately different — which is the whole point of going private.
 */

import { create } from "zustand";
import * as api from "../core/api";
import { sendCommand, sendSnapshot } from "../core/bus";
import type { BoardStatus } from "../core/bus";
import * as doc from "../core/doc";
import {
  boundingRect,
  clamp,
  fitAspect,
  lerpRect,
  rectEquals,
  tileRect,
  zoomAround,
} from "../core/geometry";
import {
  ViewHistory,
  fitView,
  homeView,
  normaliseStage,
  viewIsAwayFromStage,
  visibleBounds,
} from "../core/stage";
/** The five design directions from the references. */
export type Look =
  | "pure-white"
  | "liquid-glass"
  | "arctic-blue"
  | "graphite-dark"
  | "spectrum-pro";

export const LOOKS: Array<{ value: Look; label: string; hint: string }> = [
  { value: "pure-white", label: "Pure white studio", hint: "The default. Content first, chrome silent." },
  { value: "liquid-glass", label: "Liquid glass", hint: "Frosted panels floating over the canvas." },
  { value: "arctic-blue", label: "Arctic blue", hint: "A cool blue canvas under white chrome." },
  { value: "graphite-dark", label: "Graphite dark", hint: "For a dark room and a long call." },
  { value: "spectrum-pro", label: "Spectrum pro", hint: "White ground, sections washed in their own hue." },
];

export type Panel = "board" | "boards" | "media" | "guests" | "settings";

import type {
  BoardDoc,
  BoardMeta,
  InkTool,
  Rect,
  Scene,
  SourceInfo,
  Stroke,
  Tile,
  Vec2,
} from "../core/types";

const HISTORY_LIMIT = 80;
const AUTOSAVE_MS = 4000;

export interface InkSettings {
  tool: InkTool | null;
  color: string;
  width: number;
  /** Temporary ink fades on its own — for pointing at something mid-sentence. */
  temporary: boolean;
}

export interface CockpitState {
  doc: BoardDoc;
  boardId: string | null;
  dirty: boolean;
  savedAt: number | null;

  /**
   * What the operator is looking at.
   *
   * Independent of the stage: roaming the board is private, which is the whole
   * point of having a board bigger than the shot.
   */
  view: Rect;
  /** True when the view has wandered off the stage — drives the "back to the stage" hint. */
  viewAway: boolean;
  /** Whether Back and Forward have anywhere to go. Mirrored for the buttons. */
  canGoBack: boolean;
  canGoForward: boolean;
  /** Where the audience rectangle is heading — the stage, or a spotlight. */
  targetFrame: Rect;
  /** The audience rectangle right now, animated toward `targetFrame`. */
  frame: Rect;
  /** True when the stage itself is the current selection. */
  stageSelected: boolean;
  transition: "cut" | "fly";
  frameAnimStart: number | null;
  frameAnimFrom: Rect | null;

  isPrivate: boolean;
  /**
   * Opt-in: drag the audience along with every pan and zoom.
   *
   * Off by default. On, there is no private area — whatever you look at is what
   * they see — so it is a mode you choose, not the way the app behaves.
   */
  followView: boolean;
  spotlight: string | null;
  selection: string[];
  hover: string | null;
  ink: InkSettings;

  sources: SourceInfo[];
  monitors: SourceInfo[];
  boards: BoardMeta[];
  status: BoardStatus | null;
  boardVisible: boolean;
  compact: boolean;
  panel: Panel;
  /** Which of the five looks is on. Persisted with the app settings. */
  look: Look;
  /** Space-to-pan latched on from the toolbar rather than held down. */
  panMode: boolean;
  /** The transient line at the bottom of the cockpit. */
  notice: { message: string; tone: "info" | "warn" } | null;

  past: BoardDoc[];
  future: BoardDoc[];
  revision: number;

  /** Guest link state, mirrored from the engine. */
  guests: api.GuestStatus;
  guestPowers: api.GuestPowers;
}

export interface Actions {
  mutate(fn: (d: BoardDoc) => BoardDoc, options?: { history?: boolean }): void;
  undo(): void;
  redo(): void;

  refreshSources(): Promise<void>;
  addSources(ids: string[]): void;
  addTile(tile: Tile): void;
  addCamera(): void;
  addNote(text?: string): void;
  addWeb(url: string): Promise<void>;
  addImage(src: string, w: number, h: number, name: string): void;
  addVideo(src: string, name: string): void;
  addPdf(src: string, name: string): void;
  grabForeground(): Promise<void>;

  select(ids: string[], additive?: boolean): void;
  setHover(id: string | null): void;
  patchTile(id: string, patch: Partial<Tile>): void;
  patchSelection(patch: (tile: Tile) => Partial<Tile>): void;
  deleteSelection(): void;
  duplicateSelection(): void;
  toggleLock(): void;
  order(direction: "front" | "back"): void;
  arrange(scope: "selection" | "all"): void;

  setView(view: Rect): void;
  jumpView(view: Rect): void;
  viewBack(): void;
  viewForward(): void;
  zoom(factor: number, anchor?: Vec2): void;
  panBy(dx: number, dy: number): void;
  /** Come home to the stage. The opening view, from anywhere. */
  showStage(): void;
  /** Fit every tile in your own view. Never touches the stage. */
  fitEverything(): void;
  setSpotlight(id: string | null): void;
  toggleSpotlight(id: string): void;

  selectStage(on: boolean): void;
  setStage(next: Rect, options?: { transition?: "cut" | "fly"; history?: boolean; force?: boolean }): void;
  setStageLocked(locked: boolean): void;
  /** Grow the stage until it holds everything on the board. */
  stageAroundEverything(): void;

  setPrivate(on: boolean): void;
  bringThem(): void;
  setFollowView(on: boolean): void;
  applyFrame(frame: Rect, transition?: "cut" | "fly"): void;
  tickFrameAnimation(now: number): void;

  saveScene(name?: string): void;
  applyScene(id: string): void;
  updateScene(id: string, patch: Partial<Scene>): void;
  removeScene(id: string): void;
  sceneForKey(key: string): Scene | undefined;

  setInk(patch: Partial<InkSettings>): void;
  commitStroke(stroke: Stroke): void;
  clearInk(): void;

  setBoardProp(patch: Partial<BoardDoc>): void;
  newBoard(name?: string): void;
  saveBoard(options?: { name?: string; kind?: "board" | "template"; as?: boolean }): Promise<void>;
  loadBoard(id: string): Promise<void>;
  deleteBoard(id: string): Promise<void>;
  refreshBoards(): Promise<void>;

  showBoardWindow(): Promise<void>;
  hideBoardWindow(): Promise<void>;
  setStatus(status: BoardStatus): void;
  setPanel(panel: Panel): void;
  setLook(look: Look): void;
  setPanMode(on: boolean): void;

  startGuests(): Promise<void>;
  stopGuests(): Promise<void>;
  startTunnel(): Promise<void>;
  stopTunnel(): Promise<void>;
  refreshGuests(): Promise<void>;
  setGuestPowers(patch: Partial<api.GuestPowers>): void;
  applyGuestInk(stroke: Stroke): void;
  applyGuestFile(name: string, mime: string, dataUrl: string): void;
  publishToGuests(): void;
  setCompact(compact: boolean): void;
  toast(message: string, tone?: "info" | "warn"): void;
  pushSnapshot(): void;
}

export type Store = CockpitState & Actions;

const initialDoc = doc.emptyBoard();

/**
 * Where the view has been.
 *
 * Kept outside the store because it is a stack, not state to render: only the
 * two booleans that light up the Back and Forward buttons are mirrored in.
 */
const viewNav = new ViewHistory();

function syncNav(set: (partial: Partial<CockpitState>) => void): void {
  set({ canGoBack: viewNav.canGoBack, canGoForward: viewNav.canGoForward });
}

export const useStore = create<Store>((set, get) => ({
  doc: initialDoc,
  boardId: null,
  dirty: false,
  savedAt: null,

  view: homeView(initialDoc.frame, initialDoc.aspect),
  viewAway: false,
  canGoBack: false,
  canGoForward: false,
  targetFrame: { ...initialDoc.frame },
  frame: { ...initialDoc.frame },
  stageSelected: false,
  transition: "fly",
  frameAnimStart: null,
  frameAnimFrom: null,

  isPrivate: false,
  followView: false,
  spotlight: null,
  selection: [],
  hover: null,
  ink: { tool: null, color: "#FF5A41", width: 6, temporary: false },

  sources: [],
  monitors: [],
  boards: [],
  status: null,
  boardVisible: false,
  compact: false,
  panel: "board",
  look: "pure-white",
  panMode: false,
  notice: null,

  past: [],
  future: [],
  revision: 0,

  guests: {
    running: false,
    link: null,
    publicLink: null,
    tunnel: { state: "off", url: null, message: "" },
    guests: [],
  },
  guestPowers: { draw: true, roam: true, files: true },

  // -------------------------------------------------------------------------

  mutate(fn, options) {
    const state = get();
    const next = fn(state.doc);
    if (next === state.doc) return;
    const history = options?.history !== false;
    set({
      doc: next,
      dirty: true,
      past: history ? [...state.past, state.doc].slice(-HISTORY_LIMIT) : state.past,
      future: history ? [] : state.future,
    });
    get().pushSnapshot();
    scheduleAutosave(get);
  },

  undo() {
    const { past, doc: current, future } = get();
    if (past.length === 0) return;
    const previous = past[past.length - 1];
    set({
      doc: previous,
      past: past.slice(0, -1),
      future: [current, ...future].slice(0, HISTORY_LIMIT),
      dirty: true,
      selection: get().selection.filter((id) => previous.tiles.some((t) => t.id === id)),
    });
    get().pushSnapshot();
  },

  redo() {
    const { future, doc: current, past } = get();
    if (future.length === 0) return;
    const next = future[0];
    set({
      doc: next,
      future: future.slice(1),
      past: [...past, current].slice(-HISTORY_LIMIT),
      dirty: true,
    });
    get().pushSnapshot();
  },

  // --- adding things -------------------------------------------------------

  async refreshSources() {
    const [sources, monitors] = await Promise.all([api.listSources(), api.listMonitors()]);
    set({ sources, monitors });
  },

  addSources(ids) {
    const state = get();
    const known = new Map(state.sources.map((s) => [s.id, s]));
    let next = state.doc;
    const created: string[] = [];

    ids.forEach((id, index) => {
      const info = known.get(id);
      const aspect = info && info.height > 0 ? info.width / info.height : 16 / 9;
      const width = 820;
      const spot = doc.placeInFrame(next, width, width / aspect);
      const tile = doc.makeSourceTile(id, {
        w: width,
        h: width / aspect,
        x: spot.x + index * 56,
        y: spot.y + index * 56,
        label: info?.title ?? "",
        nativeW: info?.width,
        nativeH: info?.height,
      });
      created.push(tile.id);
      next = doc.addTile(next, tile);
    });

    get().mutate(() => next);
    set({ selection: created });
    if (created.length > 1) get().arrange("selection");
  },

  addTile(tile) {
    get().mutate((d) => doc.addTile(d, tile));
    set({ selection: [tile.id] });
  },

  addCamera() {
    const state = get();
    if (state.doc.tiles.some((t) => t.kind === "camera")) {
      get().toast("there is already a camera tile on this board", "warn");
      return;
    }
    const w = 480;
    const h = 270;
    // Bottom-right of the frame, where a face belongs by default.
    const tile = doc.makeCameraTile({
      w,
      h,
      x: state.doc.frame.x + state.doc.frame.w - w - 48,
      y: state.doc.frame.y + state.doc.frame.h - h - 48,
    });
    get().addTile(tile);
  },

  addNote(text = "") {
    const state = get();
    const spot = doc.placeInFrame(state.doc, 420, 260);
    get().addTile(doc.makeNoteTile(text, { x: spot.x, y: spot.y }));
  },

  async addWeb(url) {
    const normalised = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const state = get();
    const spot = doc.placeInFrame(state.doc, 1000, 700);
    const tile = doc.makeWebTile(normalised, { x: spot.x, y: spot.y });
    get().addTile(tile);
    try {
      const created = await api.webSourceOpen(normalised, 1440, 1000);
      get().mutate(
        (d) => doc.updateTile(d, tile.id, { source: created.source, label: hostOf(normalised) } as Partial<Tile>),
        { history: false },
      );
      // Remember the window label so it can be navigated and closed later.
      webLabels.set(tile.id, created.label);
    } catch (err) {
      get().toast(String(err), "warn");
    }
  },

  addImage(src, w, h, name) {
    const state = get();
    const width = Math.min(900, w || 900);
    const height = (width * (h || 600)) / Math.max(1, w || 900);
    const spot = doc.placeInFrame(state.doc, width, height);
    get().addTile(doc.makeImageTile(src, w, h, name, { x: spot.x, y: spot.y }));
  },

  addVideo(src, name) {
    const state = get();
    const spot = doc.placeInFrame(state.doc, 960, 540);
    get().addTile(doc.makeVideoTile(src, name, { x: spot.x, y: spot.y }));
  },

  addPdf(src, name) {
    const state = get();
    const spot = doc.placeInFrame(state.doc, 700, 906);
    get().addTile(doc.makePdfTile(src, name, { x: spot.x, y: spot.y }));
  },

  async grabForeground() {
    const id = await api.foregroundWindow();
    if (!id) {
      get().toast("nothing to grab — bring a window forward first", "warn");
      return;
    }
    await get().refreshSources();
    get().addSources([id]);
  },

  // --- selection and editing ----------------------------------------------

  select(ids, additive = false) {
    // Selecting a tile hands the inspector over to it, so the stage lets go.
    if (get().stageSelected && ids.length > 0) set({ stageSelected: false });
    const current = get().selection;
    const next = additive ? Array.from(new Set([...current, ...ids])) : ids;
    set({ selection: next });
  },

  setHover(id) {
    if (get().hover !== id) set({ hover: id });
  },

  patchTile(id, patch) {
    get().mutate((d) => doc.updateTile(d, id, patch));
  },

  patchSelection(patch) {
    const ids = get().selection;
    if (ids.length === 0) return;
    get().mutate((d) => doc.updateTiles(d, ids, patch));
  },

  deleteSelection() {
    const ids = get().selection;
    if (ids.length === 0) return;
    // Web tiles own a real browser window; closing the tile must close it too.
    for (const id of ids) {
      const label = webLabels.get(id);
      if (label) {
        void api.webSourceClose(label);
        webLabels.delete(id);
      }
    }
    get().mutate((d) => doc.removeTiles(d, ids));
    set({ selection: [], spotlight: get().spotlight && ids.includes(get().spotlight!) ? null : get().spotlight });
  },

  duplicateSelection() {
    const ids = get().selection;
    if (ids.length === 0) return;
    const state = get();
    const { doc: next, ids: created } = doc.duplicateTiles(state.doc, ids);
    get().mutate(() => next);
    set({ selection: created });
  },

  toggleLock() {
    const ids = get().selection;
    if (ids.length === 0) return;
    const tiles = get().doc.tiles.filter((t) => ids.includes(t.id));
    const locking = tiles.some((t) => !t.locked);
    get().mutate((d) => doc.updateTiles(d, ids, () => ({ locked: locking })));
  },

  order(direction) {
    const ids = get().selection;
    if (ids.length === 0) return;
    get().mutate((d) => (direction === "front" ? doc.bringToFront(d, ids) : doc.sendToBack(d, ids)));
  },

  arrange(scope) {
    const state = get();
    const ids =
      scope === "selection" && state.selection.length > 0
        ? state.selection
        : state.doc.tiles.filter((t) => !t.hidden).map((t) => t.id);
    if (ids.length === 0) return;
    get().mutate((d) => doc.arrangeInFrame(d, ids));
  },

  // --- view and frame ------------------------------------------------------

  /**
   * Move the operator's view. A private act unless "follow my view" is on.
   *
   * Deliberately does not record history: this is where every pan and zoom
   * lands, and one entry per mouse move would leave Back useless.
   */
  setView(view) {
    const state = get();
    set({ view, viewAway: viewIsAwayFromStage(view, state.doc.frame) });
    if (state.followView && !state.isPrivate && !state.spotlight) {
      get().setStage(view, { transition: "cut", history: false });
    }
  },

  /** Move the view somewhere discrete, remembering where you were. */
  jumpView(view) {
    const state = get();
    // Pressing Home while already home should not queue up a Back that does
    // nothing when you press it.
    if (rectEquals(state.view, view, 0.5)) return;
    viewNav.push(state.view);
    get().setView(view);
    syncNav(set);
  },

  viewBack() {
    const state = get();
    const previous = viewNav.back(state.view);
    if (!previous) return;
    get().setView(previous);
    syncNav(set);
  },

  viewForward() {
    const state = get();
    const next = viewNav.forward(state.view);
    if (!next) return;
    get().setView(next);
    syncNav(set);
  },

  zoom(factor, anchor) {
    const state = get();
    const point = anchor ?? {
      x: state.view.x + state.view.w / 2,
      y: state.view.y + state.view.h / 2,
    };
    get().setView(zoomAround(state.view, point, factor));
  },

  panBy(dx, dy) {
    const { view } = get();
    get().setView({ ...view, x: view.x + dx, y: view.y + dy });
  },

  showStage() {
    const state = get();
    get().jumpView(homeView(state.doc.frame, state.doc.aspect));
  },

  /**
   * Fit everything into *your* view.
   *
   * A view move only. It used to also re-aim the broadcast, which meant looking
   * around your own board silently changed the shot — and on an empty board
   * grew the stage 8% every press, with no way back to where you started.
   */
  fitEverything() {
    const state = get();
    const tiles = state.doc.tiles.filter((tile) => !tile.hidden).map(tileRect);
    const bounds = visibleBounds(state.doc, boundingRect(tiles));
    get().jumpView(fitView(bounds, state.doc.aspect));
  },

  setSpotlight(id) {
    const state = get();
    if (!id) {
      // Back to the stage you set, not to some freshly computed rectangle.
      set({ spotlight: null });
      get().applyFrame(get().doc.frame);
      return;
    }
    const framed = doc.frameTile(state.doc, id);
    if (!framed) return;
    // The spotlight is a temporary override. It never overwrites the stage, so
    // leaving it always puts the audience back exactly where they were.
    set({ spotlight: id });
    get().applyFrame(framed);
  },

  toggleSpotlight(id) {
    get().setSpotlight(get().spotlight === id ? null : id);
  },

  // --- the stage -----------------------------------------------------------

  selectStage(on) {
    set({ stageSelected: on, selection: on ? [] : get().selection });
  },

  /**
   * The single writer for the stage.
   *
   * Writes the document — so the stage is saved, undoable, and the same
   * rectangle that arranging tiles and the zoom readout reason about — then
   * animates the live audience frame toward it.
   */
  setStage(next, options) {
    const state = get();
    const stage = normaliseStage(next, state.doc.aspect);
    if (state.doc.stageLocked && !options?.force) {
      get().toast("the stage is locked", "warn");
      return;
    }
    if (!rectEquals(state.doc.frame, stage)) {
      get().mutate((d) => doc.setStage(d, stage, { force: true }), {
        history: options?.history !== false,
      });
    }
    set({ viewAway: viewIsAwayFromStage(get().view, stage) });
    if (!get().spotlight) get().applyFrame(stage, options?.transition);
  },

  setStageLocked(locked) {
    get().mutate((d) => ({ ...d, stageLocked: locked }));
    get().toast(locked ? "stage locked" : "stage unlocked");
  },

  stageAroundEverything() {
    const state = get();
    get().setStage(doc.stageAroundEverything(state.doc), { force: true });
  },

  setPrivate(on) {
    set({ isPrivate: on });
    if (!on) get().bringThem();
    get().pushSnapshot();
  },

  /** Move the stage to whatever the operator is looking at. */
  bringThem() {
    const state = get();
    set({ isPrivate: false, spotlight: null });
    get().setStage(fitAspect(state.view, state.doc.aspect), { force: true });
  },

  setFollowView(on) {
    set({ followView: on });
    if (on) get().bringThem();
    else get().toast("the audience stays on the stage");
    // A preference, not board content: it describes how this operator works,
    // and it should not change when they open a different board.
    void api.settingsGet().then((settings) =>
      api.settingsSet({ ...(settings as object), followView: on }),
    );
  },

  /**
   * Animate the live audience frame toward a rectangle.
   *
   * Presentation only — the stage itself lives in the document. Spotlights use
   * this directly, which is how they override the shot without destroying it.
   */
  applyFrame(frame, transition) {
    const state = get();
    const mode = transition ?? state.transition;
    if (mode === "cut" || rectEquals(state.frame, frame)) {
      set({ frame, targetFrame: frame, frameAnimStart: null, frameAnimFrom: null });
    } else {
      set({
        targetFrame: frame,
        frameAnimFrom: { ...state.frame },
        frameAnimStart: performance.now(),
      });
    }
    get().pushSnapshot();
  },

  tickFrameAnimation(now) {
    const state = get();
    if (state.frameAnimStart === null || !state.frameAnimFrom) return;
    const elapsed = now - state.frameAnimStart;
    const t = clamp(elapsed / FRAME_ANIM_MS, 0, 1);
    const frame = lerpRect(state.frameAnimFrom, state.targetFrame, t);
    if (t >= 1) {
      set({ frame: state.targetFrame, frameAnimStart: null, frameAnimFrom: null });
    } else {
      set({ frame });
    }
    get().pushSnapshot();
  },

  // --- scenes --------------------------------------------------------------

  saveScene(name) {
    const state = get();
    const index = state.doc.scenes.length + 1;
    const taken = new Set(state.doc.scenes.map((s) => s.hotkey).filter(Boolean));
    const hotkey = "123456789".split("").find((k) => !taken.has(k)) ?? "";
    // A scene stores the stage, not the frame mid-animation.
    get().mutate((d) => doc.addScene(d, name ?? `Scene ${index}`, state.doc.frame, hotkey));
    get().toast(hotkey ? `saved as scene ${hotkey}` : "scene saved");
  },

  applyScene(id) {
    const state = get();
    const scene = state.doc.scenes.find((s) => s.id === id);
    if (!scene) return;
    set({ spotlight: null });
    get().jumpView(homeView(scene.frame, state.doc.aspect));
    get().setStage(scene.frame, { transition: scene.transition, force: true });
  },

  updateScene(id, patch) {
    get().mutate((d) => doc.updateScene(d, id, patch));
  },

  removeScene(id) {
    get().mutate((d) => doc.removeScene(d, id));
  },

  sceneForKey(key) {
    return doc.sceneForKey(get().doc, key);
  },

  // --- ink -----------------------------------------------------------------

  setInk(patch) {
    set({ ink: { ...get().ink, ...patch } });
  },

  commitStroke(stroke) {
    get().mutate((d) => doc.addStroke(d, stroke), { history: !stroke.fadeAfterMs });
  },

  clearInk() {
    get().mutate((d) => doc.clearInk(d));
  },

  // --- board files ---------------------------------------------------------

  setBoardProp(patch) {
    get().mutate((d) => {
      const next = { ...d, ...patch };
      // Changing the output aspect has to reshape the frame with it.
      return patch.aspect ? doc.setAspect(next, patch.aspect) : next;
    });
    // setAspect already reshaped the stage in the document; follow it live.
    if (patch.aspect) get().applyFrame(get().doc.frame, "cut");
  },

  newBoard(name) {
    const fresh = doc.emptyBoard(name ?? "Untitled board");
    set({
      doc: fresh,
      boardId: null,
      dirty: false,
      selection: [],
      spotlight: null,
      past: [],
      future: [],
      stageSelected: false,
      view: homeView(fresh.frame, fresh.aspect),
      viewAway: false,
      frame: { ...fresh.frame },
      targetFrame: { ...fresh.frame },
      revision: get().revision + 1,
    });
    viewNav.clear();
    syncNav(set);
    get().pushSnapshot();
  },

  async saveBoard(options) {
    const state = get();
    const id = options?.as || !state.boardId ? slugId(options?.name ?? state.doc.name) : state.boardId;
    const name = options?.name ?? state.doc.name;
    try {
      const meta = await api.boardSave({
        id,
        name,
        kind: options?.kind ?? "board",
        created_at: 0,
        updated_at: 0,
        note: "",
        doc: { ...state.doc, name },
      });
      set({
        boardId: meta.id,
        dirty: false,
        savedAt: Date.now(),
        doc: { ...state.doc, name },
      });
      await get().refreshBoards();
    } catch (err) {
      get().toast(`could not save: ${err}`, "warn");
    }
  },

  async loadBoard(id) {
    try {
      const record = await api.boardLoad(id);
      const loaded = doc.reviveBoard(record.doc, record.name);
      set({
        doc: loaded,
        boardId: record.kind === "template" ? null : record.id,
        dirty: record.kind === "template",
        selection: [],
        spotlight: null,
        past: [],
        future: [],
        stageSelected: false,
        // Open on the stage, the same view every board opens on. Landing on the
        // tiles instead would put you somewhere different every time.
        view: homeView(loaded.frame, loaded.aspect),
        viewAway: false,
        frame: { ...loaded.frame },
        targetFrame: { ...loaded.frame },
        revision: get().revision + 1,
      });
      viewNav.clear();
      syncNav(set);
      get().pushSnapshot();
      void sendCommand({ t: "refreshMedia" });
      get().toast(record.kind === "template" ? `started from ${record.name}` : `opened ${record.name}`);
    } catch (err) {
      get().toast(`could not open that board: ${err}`, "warn");
    }
  },

  async deleteBoard(id) {
    await api.boardDelete(id);
    if (get().boardId === id) set({ boardId: null, dirty: true });
    await get().refreshBoards();
  },

  async refreshBoards() {
    set({ boards: await api.boardList() });
  },

  // --- windows and chrome --------------------------------------------------

  async showBoardWindow() {
    await api.boardShow();
    set({ boardVisible: true });
    get().pushSnapshot();
  },

  async hideBoardWindow() {
    await api.boardHide();
    set({ boardVisible: false });
  },

  setStatus(status) {
    set({ status });
  },

  setPanel(panel) {
    set({ panel });
  },

  setLook(look) {
    set({ look });
    document.documentElement.dataset.look = look;
    // Looks are a preference, not board content, so they live in settings.
    void api.settingsGet().then((settings) =>
      api.settingsSet({ ...(settings as object), look }),
    );
  },

  setPanMode(on) {
    set({ panMode: on });
    if (on) set({ ink: { ...get().ink, tool: null } });
  },

  setCompact(compact) {
    set({ compact });
  },

  toast(message, tone = "info") {
    set({ notice: { message, tone } });
    window.setTimeout(() => {
      if (get().notice?.message === message) set({ notice: null });
    }, 2600);
  },

  pushSnapshot() {
    const state = get();
    void sendSnapshot({
      doc: state.doc,
      frame: state.frame,
      revision: state.revision,
      clean: true,
    });
    if (state.guests.running) get().publishToGuests();
  },

  // --- guests --------------------------------------------------------------

  async startGuests() {
    const status = await api.guestStart();
    set({ guests: status });
    get().publishToGuests();
    get().toast(status.link ? "guest link is open" : "could not open the guest link", status.link ? "info" : "warn");
  },

  async stopGuests() {
    set({ guests: await api.guestStop() });
    get().toast("guest link closed");
  },

  async startTunnel() {
    // Optimistic, because the first run downloads ~40 MB and a button that
    // looks dead for a minute reads as broken.
    set({
      guests: {
        ...get().guests,
        tunnel: { state: "preparing", url: null, message: "setting up" },
      },
    });
    try {
      set({ guests: await api.tunnelStart() });
      const status = get().guests;
      get().toast(
        status.tunnel.state === "running"
          ? "anyone with the link can join now"
          : status.tunnel.message || "could not open the public link",
        status.tunnel.state === "running" ? "info" : "warn",
      );
    } catch (err) {
      set({
        guests: {
          ...get().guests,
          tunnel: { state: "failed", url: null, message: String(err) },
        },
      });
      get().toast(`could not open the public link: ${err}`, "warn");
    }
  },

  async stopTunnel() {
    set({ guests: await api.tunnelStop() });
    get().toast("the link is back to this network only");
  },

  async refreshGuests() {
    set({ guests: await api.guestStatus() });
  },

  setGuestPowers(patch) {
    set({ guestPowers: { ...get().guestPowers, ...patch } });
    get().publishToGuests();
  },

  /** A guest drew something. It becomes ordinary ink on the board. */
  applyGuestInk(stroke) {
    get().mutate((d) => doc.addStroke(d, stroke), { history: false });
  },

  /** A guest dropped a file. It lands in the middle of the frame, unlocked. */
  applyGuestFile(name, mime, dataUrl) {
    if (mime === "application/pdf") {
      get().addPdf(dataUrl, name);
      get().toast(`${name} from a guest`);
      return;
    }
    const probe = new Image();
    probe.onload = () => {
      get().addImage(dataUrl, probe.naturalWidth, probe.naturalHeight, name);
      get().toast(`${name} from a guest`);
    };
    probe.onerror = () => get().toast(`could not read ${name}`, "warn");
    probe.src = dataUrl;
  },

  publishToGuests() {
    schedulePublish(get);
  },
}));

export const FRAME_ANIM_MS = 520;

/** Web tile id -> the Tauri window label backing it. */
export const webLabels = new Map<string, string>();

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function slugId(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const suffix = Math.random().toString(36).slice(2, 7);
  return `${base || "board"}-${suffix}`;
}

/**
 * Guests get board updates at a steady 10 a second rather than on every mouse
 * move. The document is small, but a drag fires sixty times a second and none
 * of those extra frames tell a guest anything the next one will not.
 */
let publishTimer: number | null = null;
function schedulePublish(get: () => Store) {
  if (publishTimer !== null) return;
  publishTimer = window.setTimeout(() => {
    publishTimer = null;
    const state = get();
    if (!state.guests.running) return;
    void api.guestPublish(state.doc, state.frame, state.guestPowers);
  }, 100);
}

let autosaveTimer: number | null = null;
function scheduleAutosave(get: () => Store) {
  if (autosaveTimer !== null) window.clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(() => {
    autosaveTimer = null;
    const state = get();
    // Only boards that already have a file autosave; an unnamed scratch board
    // stays unsaved until you decide it is worth keeping.
    if (state.boardId && state.dirty) void state.saveBoard();
  }, AUTOSAVE_MS);
}

/**
 * Actions are created once and never change identity, so a component that only
 * needs to *call* things does not need to subscribe to state at all. Reading
 * them through `getState` is what keeps the inspector from re-rendering on every
 * mouse move of a drag.
 */
export function useActions(): Actions {
  return useStore.getState();
}

/** Rectangle enclosing the current selection, for the inspector and for framing. */
export function selectionBounds(state: CockpitState): Rect | null {
  const tiles = state.doc.tiles.filter((t) => state.selection.includes(t.id));
  return boundingRect(tiles.map(tileRect));
}

export function selectedTiles(state: CockpitState): Tile[] {
  return state.doc.tiles.filter((t) => state.selection.includes(t.id));
}
