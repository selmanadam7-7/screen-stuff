/**
 * Holding cards and lower thirds.
 *
 * Mostly about the clock: a countdown that goes negative, or that is computed
 * from a duration rather than a deadline, is wrong in exactly the moment
 * somebody is looking at it.
 */

import { describe, expect, it } from "vitest";
import { emptyBoard, reviveBoard } from "../src/core/doc";
import {
  CARD_PRESETS,
  cardFromPreset,
  countdownText,
  hasOverlays,
  lowerThirdRect,
  type HoldingCard,
} from "../src/core/overlays";

const card = (over: Partial<HoldingCard> = {}): HoldingCard => ({
  title: "Back in a minute",
  subtitle: "",
  until: null,
  showBoard: false,
  ...over,
});

describe("holding cards", () => {
  it("builds one from a preset", () => {
    const made = cardFromPreset("brb", 1_000_000)!;
    expect(made.title).toBe("Back in a minute");
    expect(made.until).toBe(1_000_000 + 60_000);
  });

  it("leaves the clock off for a preset that has none", () => {
    expect(cardFromPreset("soon", 0)!.until).toBeNull();
  });

  it("says nothing for a preset that does not exist", () => {
    expect(cardFromPreset("nope", 0)).toBeNull();
  });

  it("every preset has something to say", () => {
    for (const preset of CARD_PRESETS) {
      expect(preset.title.length, preset.key).toBeGreaterThan(0);
      expect(preset.subtitle.length, preset.key).toBeGreaterThan(0);
    }
  });
});

describe("the countdown", () => {
  it("counts down in minutes and seconds", () => {
    expect(countdownText(card({ until: 90_000 }), 0)).toBe("1:30");
    expect(countdownText(card({ until: 9_000 }), 0)).toBe("0:09");
  });

  it("stops at zero rather than counting how late you are", () => {
    expect(countdownText(card({ until: 0 }), 60_000)).toBe("0:00");
  });

  it("is silent when there is no clock", () => {
    expect(countdownText(card(), 0)).toBeNull();
  });

  it("is a wall-clock deadline, so every window agrees on it", () => {
    // The bug this guards: the card stores Date.now() + n, and the renderer
    // used to hand it performance.now(). Those differ by about fifty years, and
    // the countdown rendered as a twelve-digit number on air.
    const made = cardFromPreset("brb", Date.now())!;
    expect(countdownText(made, Date.now())).toMatch(/^\d:\d\d$/);
    // A render-clock value is a small number of milliseconds since page load.
    expect(countdownText(made, 30_000)).not.toMatch(/^\d:\d\d$/);
  });

  it("is right no matter when it is asked, because it stores a deadline", () => {
    const made = cardFromPreset("break", 0)!;
    expect(countdownText(made, 0)).toBe("5:00");
    expect(countdownText(made, 120_000)).toBe("3:00");
  });
});

describe("the lower third", () => {
  const stage = { x: 100, y: 200, w: 1920, h: 1080 };

  it("sits in the bottom left of the shot, inside it", () => {
    const box = lowerThirdRect(stage);
    expect(box.x).toBeGreaterThan(stage.x);
    expect(box.y).toBeGreaterThan(stage.y + stage.h / 2);
    expect(box.y + box.h).toBeLessThan(stage.y + stage.h);
    expect(box.x + box.w).toBeLessThan(stage.x + stage.w);
  });

  it("scales with the shot, so a punched-in shot looks the same", () => {
    const small = lowerThirdRect({ x: 0, y: 0, w: 960, h: 540 });
    const big = lowerThirdRect({ x: 0, y: 0, w: 1920, h: 1080 });
    expect(big.w / big.h).toBeCloseTo(small.w / small.h);
    expect(big.w).toBeCloseTo(small.w * 2);
  });
});

describe("knowing whether to draw anything", () => {
  it("is nothing when both are empty", () => {
    expect(hasOverlays(null, null)).toBe(false);
    expect(hasOverlays(null, { name: "  ", role: "" })).toBe(false);
  });

  it("is something when either has content", () => {
    expect(hasOverlays(card(), null)).toBe(true);
    expect(hasOverlays(null, { name: "Adam", role: "" })).toBe(true);
  });
});

describe("what survives a save", () => {
  it("keeps the banner", () => {
    const doc = { ...emptyBoard(), lowerThird: { name: "Adam", role: "BrandBased" } };
    const back = reviveBoard(JSON.parse(JSON.stringify(doc)));
    expect(back.lowerThird).toEqual({ name: "Adam", role: "BrandBased" });
  });

  it("does not put a card back on air", () => {
    // A card is a live decision. Reopening a board saved with "back in a
    // minute" up must not start the call behind a card.
    const doc = { ...emptyBoard(), card: card({ until: 1 }) };
    expect(reviveBoard(JSON.parse(JSON.stringify(doc))).card).toBeNull();
  });
});
