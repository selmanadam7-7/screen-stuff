/**
 * Everyone else in the room.
 *
 * All of it is ephemeral by construction, and the tests are about that: nothing
 * accumulates, a guest who leaves takes their cursor with them, and a reaction
 * from a stranger cannot be arbitrary text.
 */

import { describe, expect, it } from "vitest";
import {
  CURSOR_TIMEOUT_MS,
  PRESENCE_COLOURS,
  REACTIONS,
  REACTION_GLYPH,
  REACTION_MS,
  Presence,
  colourFor,
  isReaction,
  reactionProgress,
} from "../src/core/presence";

describe("cursors", () => {
  it("remembers where somebody is pointing", () => {
    const p = new Presence();
    p.pointer(1, "Aaron", 100, 200, 0);
    expect(p.liveCursors(0)).toEqual([{ id: 1, name: "Aaron", x: 100, y: 200, at: 0 }]);
  });

  it("keeps one per guest rather than a trail", () => {
    const p = new Presence();
    for (let i = 0; i < 500; i++) p.pointer(1, "Aaron", i, i, i);
    expect(p.liveCursors(499)).toHaveLength(1);
  });

  it("forgets a cursor that has stopped reporting", () => {
    const p = new Presence();
    p.pointer(1, "Aaron", 0, 0, 0);
    expect(p.liveCursors(CURSOR_TIMEOUT_MS - 1)).toHaveLength(1);
    expect(p.liveCursors(CURSOR_TIMEOUT_MS + 1)).toHaveLength(0);
  });

  it("drops it when the guest leaves, without waiting for the timeout", () => {
    const p = new Presence();
    p.pointer(7, "Sam", 0, 0, 0);
    p.remove(7);
    expect(p.liveCursors(0)).toHaveLength(0);
  });

  it("keeps several people apart", () => {
    const p = new Presence();
    p.pointer(1, "Aaron", 0, 0, 0);
    p.pointer(2, "Sam", 10, 10, 0);
    expect(p.liveCursors(0)).toHaveLength(2);
  });
});

describe("reactions", () => {
  it("accepts the ones on the list", () => {
    const p = new Presence();
    for (const kind of REACTIONS) p.react(1, "Aaron", kind, 0);
    expect(p.liveReactions(0)).toHaveLength(REACTIONS.length);
  });

  it("refuses anything else", () => {
    // A guest is a stranger holding a link, and whatever they send is drawn on
    // the host's board.
    const p = new Presence();
    p.react(1, "Aaron", "<script>", 0);
    p.react(1, "Aaron", "", 0);
    p.react(1, "Aaron", "yes ", 0);
    expect(p.liveReactions(0)).toHaveLength(0);
  });

  it("fades them out", () => {
    const p = new Presence();
    p.react(1, "Aaron", "clap", 0);
    expect(p.liveReactions(REACTION_MS - 1)).toHaveLength(1);
    expect(p.liveReactions(REACTION_MS + 1)).toHaveLength(0);
  });

  it("never lets them pile up", () => {
    const p = new Presence();
    for (let i = 0; i < 200; i++) p.react(1, "Aaron", "clap", 0);
    expect(p.liveReactions(0).length).toBeLessThanOrEqual(10);
  });

  it("reports how far through its life one is", () => {
    expect(reactionProgress({ id: 1, name: "a", kind: "yes", at: 0 }, 0)).toBe(0);
    expect(reactionProgress({ id: 1, name: "a", kind: "yes", at: 0 }, REACTION_MS)).toBe(1);
  });

  it("has a glyph for every one it accepts", () => {
    for (const kind of REACTIONS) expect(REACTION_GLYPH[kind], kind).toBeTruthy();
  });

  it("agrees with itself about what is valid", () => {
    for (const kind of REACTIONS) expect(isReaction(kind)).toBe(true);
    expect(isReaction("nope")).toBe(false);
  });
});

describe("colours", () => {
  it("gives the same person the same colour every time", () => {
    expect(colourFor("Aaron")).toBe(colourFor("Aaron"));
  });

  it("uses the palette and nothing else", () => {
    for (const name of ["Aaron", "Sam", "Jo", "Kit", "", "Zzz"]) {
      expect(PRESENCE_COLOURS).toContain(colourFor(name));
    }
  });

  it("spreads different names around", () => {
    const seen = new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map(colourFor));
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("clearing out", () => {
  it("forgets everything at once", () => {
    const p = new Presence();
    p.pointer(1, "Aaron", 0, 0, 0);
    p.react(1, "Aaron", "yes", 0);
    expect(p.anyone).toBe(true);
    p.clear();
    expect(p.anyone).toBe(false);
  });
});
