/**
 * The control API's vocabulary.
 *
 * This is the surface other people write software against, so the things worth
 * pinning down are the promises rather than the plumbing: that an action says
 * what it actually did, that a refusal is a sentence you can act on, that a
 * name finds the tile a person meant, and that no request goes unanswered.
 */

import { describe, expect, it, vi } from "vitest";
import {
  ACTIONS,
  ControlRefusal,
  findScene,
  findTile,
  liveTarget,
  perform,
  reference,
  stateOf,
  tileName,
  type ControlTarget,
} from "../src/core/control";
import { addScene, addTile, emptyBoard, makeNoteTile, makeSourceTile } from "../src/core/doc";
import type { BoardDoc, Rect, Tile } from "../src/core/types";

/**
 * A stand-in cockpit.
 *
 * Applies the mutations for real so an action's return value can be checked
 * against what actually changed, rather than against what it claimed.
 */
function fakeTarget(doc: BoardDoc = emptyBoard("Test board")) {
  const calls: string[] = [];
  const target: ControlTarget = {
    doc,
    frame: { ...doc.frame },
    view: { ...doc.frame },
    preview: null,
    isPrivate: false,
    followView: false,
    spotlight: null,
    autoFrame: "off",
    punchedFrom: null,
    guests: { running: false, link: null, publicLink: null, guests: [] },

    setStage(next, options) {
      calls.push(`setStage:${options?.transition ?? "fly"}`);
      target.doc = { ...target.doc, frame: next };
      target.frame = next;
    },
    applyLayout(kind) {
      calls.push(`layout:${kind}`);
    },
    stageAroundEverything() {
      calls.push("stageAroundEverything");
    },
    showStage() {
      calls.push("showStage");
    },
    applyScene(id) {
      calls.push(`scene:${id}`);
    },
    saveScene(name) {
      calls.push(`saveScene:${name}`);
    },
    patchTile(id, patch) {
      calls.push(`patch:${id}`);
      target.doc = {
        ...target.doc,
        tiles: target.doc.tiles.map((t) => (t.id === id ? ({ ...t, ...patch } as Tile) : t)),
      };
    },
    addSources(ids) {
      calls.push(`addSources:${ids.join(",")}`);
      for (const id of ids) {
        target.doc = addTile(target.doc, makeSourceTile(id, { nativeW: 1920, nativeH: 1080 }));
      }
    },
    addCamera() {
      calls.push("addCamera");
    },
    addNote(text) {
      calls.push("addNote");
      target.doc = addTile(target.doc, makeNoteTile(text ?? ""));
    },
    async addWeb(url) {
      calls.push(`addWeb:${url}`);
    },
    select(ids) {
      calls.push(`select:${ids.join(",")}`);
      target.doc = { ...target.doc, tiles: target.doc.tiles };
      selection = ids;
    },
    deleteSelection() {
      calls.push("delete");
      target.doc = {
        ...target.doc,
        tiles: target.doc.tiles.filter((t) => !selection.includes(t.id)),
      };
    },
    setSpotlight(id) {
      target.spotlight = id;
    },
    openPreview() {
      target.preview = target.preview ?? { ...target.frame };
    },
    closePreview() {
      target.preview = null;
    },
    setPreview(next) {
      target.preview = next;
    },
    take() {
      calls.push("take");
      if (target.preview) target.frame = target.preview;
      target.doc = { ...target.doc, frame: target.frame };
      target.preview = null;
    },
    setPrivate(on) {
      target.isPrivate = on;
    },
    setFollowView(on) {
      target.followView = on;
    },
    setAutoFrame(mode) {
      target.autoFrame = mode;
    },
    punchIn(next) {
      target.punchedFrom = { ...target.frame };
      target.frame = next;
      target.doc = { ...target.doc, frame: next };
    },
    punchOut() {
      if (target.punchedFrom) {
        target.frame = target.punchedFrom;
        target.doc = { ...target.doc, frame: target.punchedFrom };
        target.punchedFrom = null;
      }
    },
    showCard(card) {
      target.doc = { ...target.doc, card };
    },
    setLowerThird(third) {
      target.doc = { ...target.doc, lowerThird: third };
    },
    setBoardProp(patch) {
      target.doc = { ...target.doc, ...patch };
    },
    async startGuests() {
      target.guests = { ...target.guests, running: true, link: "http://192.168.1.4:7788/g/abc" };
    },
    async stopGuests() {
      target.guests = { running: false, link: null, publicLink: null, guests: [] };
    },
    async startTunnel() {
      target.guests = { ...target.guests, publicLink: "https://x.trycloudflare.com/g/abc" };
    },
    async stopTunnel() {
      target.guests = { ...target.guests, publicLink: null };
    },
    toast(message) {
      calls.push(`toast:${message}`);
    },
    async shot() {
      return "data:image/png;base64,AAAA";
    },
  };
  let selection: string[] = [];
  return { target, calls };
}

const withTiles = () => {
  let doc = emptyBoard("Test board");
  doc = addTile(doc, makeSourceTile("monitor:1", { label: "Code", x: 0, y: 0 }));
  doc = addTile(doc, makeSourceTile("monitor:2", { label: "Slides", x: 900, y: 0 }));
  doc = addTile(doc, makeNoteTile("Remember the demo"));
  return doc;
};

/** A tile named "camera", because two documented examples address one. */
const cameraLike = (): Tile =>
  ({ ...makeNoteTile("camera"), label: "camera" }) as Tile;

const ok = (outcome: Awaited<ReturnType<typeof perform>>) => {
  if ("error" in outcome) throw new Error(`expected a result, got: ${outcome.error}`);
  return outcome.result as Record<string, unknown>;
};

const refusal = (outcome: Awaited<ReturnType<typeof perform>>) => {
  if (!("error" in outcome)) throw new Error("expected a refusal");
  return outcome.error;
};

describe("finding what the caller meant", () => {
  it("takes an id", () => {
    const doc = withTiles();
    expect(findTile(doc, { tile: doc.tiles[0].id }).id).toBe(doc.tiles[0].id);
  });

  it("takes the name a person would use", () => {
    expect(tileName(findTile(withTiles(), { tile: "Slides" }))).toBe("Slides");
  });

  it("does not care about case, and takes part of a name", () => {
    expect(tileName(findTile(withTiles(), { tile: "cod" }))).toBe("Code");
  });

  it("refuses an ambiguous name rather than picking one", () => {
    let doc = emptyBoard();
    doc = addTile(doc, makeSourceTile("monitor:1", { label: "Screen left" }));
    doc = addTile(doc, makeSourceTile("monitor:2", { label: "Screen right" }));
    // Guessing here would move the shot to the wrong thing mid-call, which is
    // strictly worse than doing nothing, because nothing is visible.
    expect(() => findTile(doc, { tile: "screen" })).toThrow(/matches 2 tiles/);
  });

  it("takes the source id the caller added it with", () => {
    // A screen picks up its monitor's name as a label the instant it lands, so
    // the id from GET /sources would otherwise stop working the moment it did.
    const doc = withTiles();
    expect(findTile(doc, { tile: "monitor:2" }).id).toBe(doc.tiles[1].id);
  });

  it("offers the source id too when it cannot find something", () => {
    // The caller may well be holding the id rather than the label.
    expect(() => findTile(withTiles(), { tile: "nope" })).toThrow(/Code \(monitor:1\)/);
  });

  it("says what is on the board when it cannot find it", () => {
    expect(() => findTile(withTiles(), { tile: "nope" })).toThrow(/Code.*Slides/);
  });

  it("says the board is empty rather than listing nothing", () => {
    expect(() => findTile(emptyBoard(), { tile: "nope" })).toThrow(/the board is empty/);
  });

  it("finds a scene by name or by its hotkey", () => {
    const doc = addScene(emptyBoard(), "Wide", { x: 0, y: 0, w: 1920, h: 1080 }, "3");
    expect(findScene(doc, { scene: "wide" }).name).toBe("Wide");
    expect(findScene(doc, { scene: "3" }).name).toBe("Wide");
  });
});

describe("the stage", () => {
  it("goes exactly where it is told", async () => {
    const { target } = fakeTarget();
    const result = ok(await perform(target, "stage", { x: 10, y: 20, w: 1920, h: 1080 }));
    expect(result.stage).toEqual({ x: 10, y: 20, w: 1920, h: 1080 });
  });

  it("frames a tile by name", async () => {
    const { target } = fakeTarget(withTiles());
    const slides = target.doc.tiles[1];
    const result = ok(await perform(target, "stage", { tile: "Slides" }));
    const stage = result.stage as Rect;
    // Around it, and at the output's aspect rather than the tile's.
    expect(stage.w / stage.h).toBeCloseTo(target.doc.aspect, 2);
    expect(stage.x).toBeLessThanOrEqual(slides.x);
  });

  it("cuts when asked to cut", async () => {
    const { target, calls } = fakeTarget();
    await perform(target, "stage", { x: 0, y: 0, w: 640, h: 360, transition: "cut" });
    expect(calls).toContain("setStage:cut");
  });

  it("refuses three quarters of a rectangle", async () => {
    const { target } = fakeTarget(withTiles());
    // Three numbers is a typo, not a rectangle — and falling through to the
    // tile lookup would silently frame something instead.
    expect(refusal(await perform(target, "stage", { x: 0, y: 0, w: 640 }))).toMatch(/which tile/);
  });

  it("names the presets it does know", async () => {
    const { target } = fakeTarget();
    expect(refusal(await perform(target, "stage", { preset: "wide" }))).toMatch(/everything/);
  });
});

describe("answers describe what happened", () => {
  it("a layout reports how many tiles it arranged", async () => {
    const { target } = fakeTarget(withTiles());
    expect(ok(await perform(target, "layout", { layout: "grid" }))).toEqual({
      layout: "grid",
      tiles: 3,
    });
  });

  it("a card comes back resolved, not as the preset name", async () => {
    const { target } = fakeTarget();
    const result = ok(await perform(target, "card", { preset: "brb" }));
    const card = result.card as { title: string; until: number };
    expect(card.title).toBe("Back in a minute");
    // Absolute epoch milliseconds, so the countdown survives a re-render.
    expect(card.until).toBeGreaterThan(Date.now());
  });

  it("a custom card turns minutes into a deadline", async () => {
    const { target } = fakeTarget();
    vi.setSystemTime(new Date("2026-01-01T10:00:00Z"));
    const result = ok(await perform(target, "card", { title: "Back at ten past", minutes: 10 }));
    expect((result.card as { until: number }).until).toBe(Date.parse("2026-01-01T10:10:00Z"));
    vi.useRealTimers();
  });

  it("clearing a card says the card is gone", async () => {
    const { target } = fakeTarget();
    await perform(target, "card", { preset: "brb" });
    expect(ok(await perform(target, "card", { clear: true })).card).toBeNull();
  });

  it("adding reports the tile that appeared, addressable by name", async () => {
    const { target } = fakeTarget();
    const result = ok(await perform(target, "add", { source: "monitor:1" }));
    const added = result.added as Array<{ id: string; kind: string }>;
    expect(added).toHaveLength(1);
    expect(added[0].kind).toBe("source");
    expect(findTile(target.doc, { tile: added[0].id })).toBeTruthy();
  });

  it("removing reports what it removed, and it is gone", async () => {
    const { target } = fakeTarget(withTiles());
    ok(await perform(target, "remove", { tile: "Slides" }));
    expect(target.doc.tiles.map(tileName)).not.toContain("Slides");
  });

  it("a tile with nothing to change reads back instead of refusing", async () => {
    const { target } = fakeTarget(withTiles());
    const result = ok(await perform(target, "tile", { tile: "Code" }));
    expect((result.tile as { name: string }).name).toBe("Code");
  });

  it("a tile patch reports the geometry after the change", async () => {
    const { target } = fakeTarget(withTiles());
    const result = ok(await perform(target, "tile", { tile: "Code", x: 42, hidden: true }));
    expect(result.tile).toMatchObject({ x: 42, hidden: true });
  });
});

describe("the rest of the table", () => {
  it("recalls a scene by name, and saves the shot you are on", async () => {
    const { target, calls } = fakeTarget(addScene(withTiles(), "Wide", { x: 0, y: 0, w: 1920, h: 1080 }, "3"));
    expect(ok(await perform(target, "scene", { scene: "wide" })).scene).toBe("Wide");
    expect(calls.some((c) => c.startsWith("scene:"))).toBe(true);
    expect(ok(await perform(target, "scene", { save: "Tight" })).saved).toBe("Tight");
    expect(calls).toContain("saveScene:Tight");
  });

  it("finds a scene by its hotkey, which is what a numbered button sends", async () => {
    const { target } = fakeTarget(addScene(withTiles(), "Wide", { x: 0, y: 0, w: 1920, h: 1080 }, "3"));
    expect(ok(await perform(target, "scene", { scene: "3" })).scene).toBe("Wide");
  });

  it("says which scenes exist when the one asked for does not", async () => {
    const { target } = fakeTarget(addScene(emptyBoard(), "Wide", { x: 0, y: 0, w: 16, h: 9 }, ""));
    expect(refusal(await perform(target, "scene", { scene: "narrow" }))).toMatch(/Saved: Wide/);
  });

  it("puts a name in the corner and takes it off again", async () => {
    const { target } = fakeTarget();
    const up = ok(await perform(target, "lower-third", { name: "Adam", role: "Founder" }));
    expect(up.lowerThird).toEqual({ name: "Adam", role: "Founder" });
    expect(ok(await perform(target, "lower-third", { clear: true })).lowerThird).toBeNull();
  });

  it("refuses a lower third with no name rather than showing an empty bar", async () => {
    const { target } = fakeTarget();
    expect(refusal(await perform(target, "lower-third", { role: "Founder" }))).toMatch(/needs a/);
  });

  it("spotlights a tile and lets go of it", async () => {
    const { target } = fakeTarget(withTiles());
    const on = ok(await perform(target, "spotlight", { tile: "Slides" }));
    expect((on.spotlight as { name: string }).name).toBe("Slides");
    expect(target.spotlight).toBe((on.spotlight as { id: string }).id);
    expect(ok(await perform(target, "spotlight", { off: true })).spotlight).toBeNull();
    expect(target.spotlight).toBeNull();
  });

  it("goes private and comes back", async () => {
    const { target } = fakeTarget(withTiles());
    expect(ok(await perform(target, "private", { on: true })).private).toBe(true);
    expect(target.isPrivate).toBe(true);
    expect(ok(await perform(target, "private", { on: false })).private).toBe(false);
  });

  it("treats a bare private with no body as turning it on", async () => {
    // What a Stream Deck sends when the button was set up in a hurry.
    const { target } = fakeTarget();
    expect(ok(await perform(target, "private", {})).private).toBe(true);
  });

  it("switches following on and off", async () => {
    const { target } = fakeTarget();
    expect(ok(await perform(target, "follow", { on: true })).follow).toBe(true);
    expect(target.followView).toBe(true);
    expect(ok(await perform(target, "follow", { on: false })).follow).toBe(false);
  });

  it("takes the three auto-framing modes and nothing else", async () => {
    const { target } = fakeTarget();
    for (const mode of ["monitor", "window", "off"]) {
      expect(ok(await perform(target, "autoframe", { mode })).autoframe).toBe(mode);
      expect(target.autoFrame).toBe(mode);
    }
    expect(refusal(await perform(target, "autoframe", { mode: "cursor" }))).toMatch(
      /off, monitor or window/,
    );
  });

  it("flashes a line at the operator and nobody else", async () => {
    const { target, calls } = fakeTarget();
    expect(ok(await perform(target, "flash", { message: "two minutes" })).flashed).toBe(
      "two minutes",
    );
    expect(calls).toContain("toast:two minutes");
  });

  it("refuses an empty flash rather than blinking nothing", async () => {
    const { target } = fakeTarget();
    expect(refusal(await perform(target, "flash", { message: "   " }))).toMatch(/say what to show/);
  });

  it("hands back the shot as a data url", async () => {
    const { target } = fakeTarget();
    expect(ok(await perform(target, "shot", {}))).toEqual({ png: "data:image/png;base64,AAAA" });
  });

  it("adds a camera, a note and a web tile", async () => {
    const { target, calls } = fakeTarget();
    // The camera and web paths do not create tiles in this double, so they come
    // back as refusals -- what matters is that each reached the right action.
    await perform(target, "add", { camera: true });
    expect(calls).toContain("addCamera");
    await perform(target, "add", { web: "https://example.com" });
    expect(calls).toContain("addWeb:https://example.com");
    expect((ok(await perform(target, "add", { note: "hello" })).added as unknown[]).length).toBe(1);
  });

  it("says what to add when told nothing", async () => {
    const { target } = fakeTarget();
    expect(refusal(await perform(target, "add", {}))).toMatch(/say what to add/);
  });
});

describe("preview and take", () => {
  it("refuses to take a preview that is not there", async () => {
    const { target } = fakeTarget();
    expect(refusal(await perform(target, "take", {}))).toMatch(/no preview/);
  });

  it("lines the preview up on a tile, then cuts to it", async () => {
    const { target } = fakeTarget(withTiles());
    ok(await perform(target, "preview", { tile: "Slides" }));
    const lined = target.preview as Rect;
    const result = ok(await perform(target, "take", {}));
    expect(result.stage).toEqual({
      x: Math.round(lined.x),
      y: Math.round(lined.y),
      w: Math.round(lined.w),
      h: Math.round(lined.h),
    });
    expect(target.preview).toBeNull();
  });
});

describe("punching in", () => {
  it("goes tight, then comes back to where it was", async () => {
    const { target } = fakeTarget(withTiles());
    const before = { ...target.frame };
    ok(await perform(target, "punch", { tile: "Code" }));
    expect(target.frame).not.toEqual(before);
    ok(await perform(target, "punch", { out: true }));
    expect(target.frame).toEqual(before);
  });

  it("says so when there is nothing to come back from", async () => {
    const { target } = fakeTarget();
    expect(refusal(await perform(target, "punch", { out: true }))).toMatch(/not punched in/);
  });
});

describe("guests", () => {
  it("opens the link and reports it", async () => {
    const { target } = fakeTarget();
    const result = ok(await perform(target, "guests", { on: true }));
    expect(result.link).toMatch(/^http:/);
    expect(result.publicLink).toBeNull();
  });

  it("adds the public door when asked, and closes both", async () => {
    const { target } = fakeTarget();
    expect(ok(await perform(target, "guests", { on: true, public: true })).publicLink).toMatch(
      /trycloudflare/,
    );
    expect(ok(await perform(target, "guests", { on: false })).link).toBeNull();
    expect(target.guests.publicLink).toBeNull();
  });
});

describe("refusing well", () => {
  it("an unknown action lists the ones that exist", async () => {
    const { target } = fakeTarget();
    const why = refusal(await perform(target, "explode", {}));
    expect(why).toMatch(/no action called "explode"/);
    expect(why).toMatch(/stage/);
  });

  it("nonsense in the body does not throw out of perform", async () => {
    const { target } = fakeTarget();
    // A caller can send anything at all; the answer is always an answer.
    for (const body of [null, undefined, 4, "text", [1, 2, 3]]) {
      const outcome = await perform(target, "layout", body);
      expect("error" in outcome).toBe(true);
    }
  });

  it("a thrown error is reported rather than swallowed", async () => {
    const { target } = fakeTarget();
    target.shot = async () => {
      throw new Error("no canvas on this machine");
    };
    expect(refusal(await perform(target, "shot", {}))).toBe("no canvas on this machine");
  });

  it("a refusal is a sentence, not a code", async () => {
    const { target } = fakeTarget(withTiles());
    const why = refusal(await perform(target, "board", { fps: 240 }));
    expect(why).toBe("frame rate has to be between 1 and 60");
    expect(() => {
      throw new ControlRefusal("still an Error");
    }).toThrow(Error);
  });

  it("guards the numbers that would break capture", async () => {
    const { target } = fakeTarget();
    expect(refusal(await perform(target, "board", { quality: 5 }))).toMatch(/20 and 100/);
    expect(ok(await perform(target, "board", { fps: 30 })).fps).toBe(30);
  });
});

describe("reading through to a live store", () => {
  /**
   * The bug this exists for: the first bridge handed the actions a *copy* of
   * the store, so every action answered with the state from before its own
   * change. `add` reported that nothing was added while adding, and a card
   * came back null while it was up on screen. Nothing in the table was wrong;
   * the seam was. It is checked here because the seam has no other home.
   */
  function movingStore() {
    const inner = fakeTarget(withTiles());
    // `getState` returns a fresh object each time, exactly as zustand does.
    const getState = () => ({ ...inner.target });
    return { target: liveTarget(getState, async () => "data:image/png;base64,AA"), inner };
  }

  it("sees a change an action just made", async () => {
    const { target } = movingStore();
    const result = ok(await perform(target, "card", { preset: "brb" }));
    expect(result.card).not.toBeNull();
  });

  it("reports the tile that was added rather than claiming none was", async () => {
    const { target } = movingStore();
    const result = ok(await perform(target, "add", { source: "monitor:9" }));
    expect((result.added as unknown[]).length).toBe(1);
  });

  it("reports the stage an action moved it to", async () => {
    const { target } = movingStore();
    const before = stateOf(target).stage;
    const result = ok(await perform(target, "stage", { x: 500, y: 500, w: 1920, h: 1080 }));
    expect(result.stage).not.toEqual(before);
    expect(stateOf(target).stage).toEqual(result.stage);
  });

  it("still carries every action across", async () => {
    const { target, inner } = movingStore();
    await perform(target, "layout", { layout: "focus" });
    expect(inner.calls).toContain("layout:focus");
  });
});

describe("the reference", () => {
  it("describes every action there is, and nothing there is not", () => {
    const listed = reference().actions.map((a) => a.name);
    // `help` is the reference itself, and listing it would be a loop.
    expect(listed.sort()).toEqual(
      Object.keys(ACTIONS)
        .filter((n) => n !== "help")
        .sort(),
    );
  });

  it("gives every action a summary, a body shape and a working example", () => {
    for (const action of reference().actions) {
      expect(action.summary.length).toBeGreaterThan(10);
      expect(action.accepts.length).toBeGreaterThan(0);
      expect(action.example.post).toBe(`/${action.name}`);
    }
  });

  it("documents examples that are actually valid requests", async () => {
    // The reference is generated, so it can never list an action that does not
    // exist. It can still list an example that stopped being valid when the
    // action's body changed, and nothing else would catch that -- a reference
    // full of examples that get refused is worse than no reference.
    let doc = withTiles();
    doc = addTile(doc, makeNoteTile("Slides"));
    doc = addScene(doc, "Wide", { x: 0, y: 0, w: 1920, h: 1080 }, "1");

    // The family of refusals that mean "your request was malformed", as opposed
    // to "the board is not in a state where that makes sense".
    const malformed = /say (which|what)|needs a|is not a|not a preset|has to be/;

    for (const action of reference().actions) {
      const { target } = fakeTarget(doc);
      // A camera tile so { "tile": "camera", ... } resolves like it would live.
      target.doc = { ...target.doc, tiles: [...target.doc.tiles, cameraLike()] };
      const outcome = await perform(target, action.name, action.example.body);
      if ("error" in outcome && malformed.test(outcome.error)) {
        throw new Error(`the documented example for "${action.name}" is not valid: ${outcome.error}`);
      }
    }
  });

  it("is what GET / and POST /help both return", async () => {
    const { target } = fakeTarget();
    expect(ok(await perform(target, "help", {}))).toEqual(reference());
  });
});

describe("published state", () => {
  it("says what is on air, in the terms a caller thinks in", () => {
    const { target } = fakeTarget(withTiles());
    const state = stateOf(target);
    expect(state.board).toBe("Test board");
    expect(state.tiles.map((t) => t.name)).toContain("Code");
    expect(state.stage).toEqual({
      x: Math.round(target.doc.frame.x),
      y: Math.round(target.doc.frame.y),
      w: Math.round(target.doc.frame.w),
      h: Math.round(target.doc.frame.h),
    });
    expect(state.guests.running).toBe(false);
  });

  it("changes when the show changes, so a watcher can trust it", async () => {
    const { target } = fakeTarget(withTiles());
    const before = JSON.stringify(stateOf(target));
    await perform(target, "card", { preset: "brb" });
    expect(JSON.stringify(stateOf(target))).not.toBe(before);
  });

  it("holds still when nothing has happened", () => {
    const { target } = fakeTarget(withTiles());
    // The bridge sends on any store write and compares against the last
    // publish; if this were unstable it would flood every watcher.
    expect(JSON.stringify(stateOf(target))).toBe(JSON.stringify(stateOf(target)));
  });
});
