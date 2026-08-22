// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { initials, whoColor } from "../src/ui/primitives";
import { tileIcon, ScreenIcon, CameraIcon, NoteIcon } from "../src/ui/icons";
import { invalidateTheme, readTheme } from "../src/core/theme";
import { cameraFeedName, cameraFeedSource } from "../src/cockpit/cameraFeeds";
import { cameraFeedSource as docCameraFeedSource, makeCameraTile } from "../src/core/doc";

const TOKENS = readFileSync("src/styles/tokens.css", "utf8");

/**
 * The palette was measured out of the reference screenshots. If someone
 * "tidies" a value, the design stops matching the thing it was built from —
 * so the anchors are asserted rather than trusted.
 */
describe("the measured palette", () => {
  const ANCHORS: Array<[string, string]> = [
    ["--b-500", "#0562fe"], // primary, measured
    ["--b-50", "#eff4fe"], // tint behind selected rows
    ["--n-200", "#dddde1"], // borders
    ["--n-900", "#1e2329"], // ink
    ["--success", "#14b18d"],
    ["--warning", "#fd9f0a"],
    ["--danger", "#fa3928"],
    ["--violet", "#846afc"],
    ["--note", "#fef4d7"],
  ];

  it.each(ANCHORS)("%s is still %s", (token, value) => {
    expect(TOKENS).toContain(`${token}: ${value}`);
  });

  it("keeps the arctic canvas at the measured blue", () => {
    expect(TOKENS).toContain("--canvas: #ecf4fc");
  });

  it("ships all five looks", () => {
    for (const look of [
      "pure-white",
      "liquid-glass",
      "arctic-blue",
      "graphite-dark",
      "spectrum-pro",
    ]) {
      expect(TOKENS).toContain(`[data-look="${look}"]`);
    }
  });

  it("gives every look a canvas and a panel to sit on", () => {
    // A look that forgets one of these renders half-themed, which is worse
    // than not shipping it.
    const blocks = TOKENS.split(/\[data-look="/).slice(1);
    expect(blocks).toHaveLength(5);
    for (const block of blocks) {
      const body = block.slice(0, block.indexOf("}"));
      expect(body).toMatch(/--canvas:/);
      expect(body).toMatch(/--panel:/);
    }
  });
});

describe("presence colours", () => {
  it("gives one person the same colour every time", () => {
    expect(whoColor("Aaron")).toBe(whoColor("Aaron"));
    expect(whoColor("Aaron")).toMatch(/^var\(--who-[1-8]\)$/);
  });

  it("spreads names across the whole set", () => {
    const names = ["Aaron", "Jamie", "Taylor", "Jordan", "Sam", "Morgan", "Riley", "Alex", "Lena"];
    const used = new Set(names.map(whoColor));
    expect(used.size).toBeGreaterThan(3);
  });

  it("builds initials from a name", () => {
    expect(initials("Aaron Rodriguez")).toBe("AR");
    expect(initials("Adam")).toBe("AD");
    expect(initials("  Jamie   Lee  Scott ")).toBe("JS");
    expect(initials("")).toBe("?");
    expect(initials("   ")).toBe("?");
  });
});

describe("icon mapping", () => {
  it("draws one concept one way", () => {
    expect(tileIcon("source")).toBe(ScreenIcon);
    expect(tileIcon("camera")).toBe(CameraIcon);
    expect(tileIcon("note")).toBe(NoteIcon);
  });

  it("falls back rather than rendering nothing for an unknown kind", () => {
    // Reicon icons are forwardRef components, so they are objects rather than
    // plain functions — the guarantee is that something renderable comes back.
    const fallback = tileIcon("something-new");
    expect(fallback).toBeDefined();
    expect(["function", "object"]).toContain(typeof fallback);
  });

  it("maps every tile kind the document can hold", () => {
    for (const kind of ["source", "camera", "image", "video", "pdf", "note", "web"]) {
      expect(tileIcon(kind)).toBeDefined();
    }
  });
});

describe("theme reading", () => {
  beforeEach(() => {
    invalidateTheme();
    document.documentElement.removeAttribute("data-look");
  });

  it("always returns a usable theme, even with no tokens loaded", () => {
    const theme = readTheme(true);
    expect(theme.canvas).toMatch(/^#|rgb/);
    expect(theme.accent).toMatch(/^#|rgb/);
    expect(theme.dark).toBe(false);
  });

  it("knows the dark look is dark", () => {
    document.documentElement.dataset.look = "graphite-dark";
    expect(readTheme(true).dark).toBe(true);
  });

  it("caches until the look changes", () => {
    const first = readTheme(true);
    expect(readTheme()).toBe(first);
    document.documentElement.dataset.look = "arctic-blue";
    expect(readTheme()).not.toBe(first);
  });
});

describe("camera feed naming", () => {
  it("agrees between the document and the publisher", () => {
    // These live in two modules on purpose — the document must be readable
    // without pulling in the cockpit — so they are checked against each other.
    const tile = makeCameraTile();
    expect(cameraFeedSource(tile.id)).toBe(docCameraFeedSource(tile.id));
    expect((tile as { source: string }).source).toBe(cameraFeedSource(tile.id));
  });

  it("produces a name the Rust side will accept", () => {
    // `feed:<name>`, name limited to 64 alphanumerics, dashes and underscores.
    for (const id of ["t_abc123", "weird id!@#", "x".repeat(200)]) {
      const name = cameraFeedName(id);
      expect(name.length).toBeGreaterThan(0);
      expect(name.length).toBeLessThanOrEqual(64);
      expect(name).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("prefixes the source so it parses as a feed", () => {
    expect(cameraFeedSource("t_1")).toBe("feed:cam-t_1");
  });
});
