/**
 * The camera that responds to whether you are talking.
 *
 * All of the difficulty is hysteresis. Speech has gaps between words and pauses
 * between sentences, so a gate that follows the level directly pumps several
 * times a second and is unwatchable. These tests are about the gate refusing to
 * react to those gaps.
 */

import { describe, expect, it } from "vitest";
import { makeCameraTile } from "../src/core/doc";
import {
  ATTACK_MS,
  EMPHASIS_SCALE,
  RELEASE_MS,
  SPEAKING_LEVEL,
  SpeechGate,
  approach,
  emphasisedRect,
  levelOf,
} from "../src/core/voice";
import type { Rect, Tile } from "../src/core/types";

const LOUD = SPEAKING_LEVEL * 3;
const QUIET = SPEAKING_LEVEL / 3;

describe("the speech gate", () => {
  it("starts closed", () => {
    expect(new SpeechGate().speaking).toBe(false);
  });

  it("does not open on a single loud sample", () => {
    const gate = new SpeechGate();
    expect(gate.push(LOUD, 0)).toBe(false);
  });

  it("opens once a voice has been there long enough", () => {
    const gate = new SpeechGate();
    gate.push(LOUD, 0);
    expect(gate.push(LOUD, ATTACK_MS + 1)).toBe(true);
  });

  it("opens quickly, because being late to your own sentence looks broken", () => {
    expect(ATTACK_MS).toBeLessThan(300);
  });

  it("stays open through the gap between two words", () => {
    const gate = new SpeechGate();
    gate.push(LOUD, 0);
    gate.push(LOUD, ATTACK_MS + 1);
    // A couple of hundred milliseconds of nothing, as between words.
    let now = ATTACK_MS + 1;
    for (let i = 0; i < 6; i++) {
      now += 33;
      expect(gate.push(QUIET, now), `gap sample ${i}`).toBe(true);
    }
  });

  it("closes only after a real silence", () => {
    const gate = new SpeechGate();
    gate.push(LOUD, 0);
    gate.push(LOUD, ATTACK_MS + 1);

    // The release clock starts at the first quiet sample, not when the gate
    // opened -- otherwise a long sentence would shorten the pause it takes to
    // let go.
    const quietFrom = 5_000;
    expect(gate.push(QUIET, quietFrom)).toBe(true);
    expect(gate.push(QUIET, quietFrom + RELEASE_MS - 100)).toBe(true);
    expect(gate.push(QUIET, quietFrom + RELEASE_MS + 1)).toBe(false);
  });

  it("closes slowly, because a pause is not the end of talking", () => {
    expect(RELEASE_MS).toBeGreaterThan(ATTACK_MS * 4);
  });

  it("does not pump on a level wobbling around the threshold", () => {
    const gate = new SpeechGate();
    let flips = 0;
    let last = gate.speaking;
    for (let i = 0; i < 200; i++) {
      const level = i % 2 === 0 ? SPEAKING_LEVEL * 1.05 : SPEAKING_LEVEL * 0.95;
      const now = i * 16;
      const open = gate.push(level, now);
      if (open !== last) flips += 1;
      last = open;
    }
    // At most it settles open once. Anything more is the shot pumping.
    expect(flips).toBeLessThanOrEqual(1);
  });

  it("forgets everything when reset", () => {
    const gate = new SpeechGate();
    gate.push(LOUD, 0);
    gate.push(LOUD, ATTACK_MS + 1);
    gate.reset();
    expect(gate.speaking).toBe(false);
  });
});

describe("easing the size", () => {
  it("moves toward the target", () => {
    expect(approach(0, 1, 100)).toBeGreaterThan(0);
    expect(approach(0, 1, 100)).toBeLessThan(1);
  });

  it("arrives, rather than approaching forever", () => {
    let v = 0;
    for (let i = 0; i < 400; i++) v = approach(v, 1, 16);
    expect(v).toBe(1);
  });

  it("does not depend on frame rate", () => {
    // One 100ms step and ten 10ms steps should land in the same place, or the
    // animation runs at a different speed on a 60Hz and a 120Hz machine.
    const oneStep = approach(0, 1, 100);
    let many = 0;
    for (let i = 0; i < 10; i++) many = approach(many, 1, 10);
    expect(many).toBeCloseTo(oneStep, 3);
  });
});

describe("the emphasised rectangle", () => {
  const stage: Rect = { x: 0, y: 0, w: 1920, h: 1080 };
  const camera = { ...makeCameraTile(), x: 1400, y: 700, w: 400, h: 225 } as Tile;

  it("is the tile itself at no emphasis", () => {
    const r = emphasisedRect(camera, stage, 0);
    expect(r).toEqual({ x: camera.x, y: camera.y, w: camera.w, h: camera.h });
  });

  it("grows with emphasis", () => {
    const r = emphasisedRect(camera, stage, 1);
    expect(r.w).toBeCloseTo(camera.w * EMPHASIS_SCALE);
    expect(r.h).toBeCloseTo(camera.h * EMPHASIS_SCALE);
  });

  it("grows into the stage rather than out of it", () => {
    const corner = { ...camera, x: stage.w - camera.w, y: stage.h - camera.h } as Tile;
    const r = emphasisedRect(corner, stage, 1);
    expect(r.x + r.w).toBeLessThanOrEqual(stage.x + stage.w + 0.01);
    expect(r.y + r.h).toBeLessThanOrEqual(stage.y + stage.h + 0.01);
  });

  it("centres one too big to fit rather than jamming it in a corner", () => {
    const huge = { ...camera, w: stage.w * 0.9, h: stage.h * 0.9 } as Tile;
    const r = emphasisedRect(huge, stage, 1);
    expect(r.x + r.w / 2).toBeCloseTo(stage.x + stage.w / 2);
  });
});

describe("measuring loudness", () => {
  it("is zero for silence", () => {
    expect(levelOf(new Float32Array(64))).toBe(0);
  });

  it("is the root mean square, not the peak", () => {
    // One loud sample among many quiet ones is not a loud block.
    const spike = new Float32Array(1024);
    spike[0] = 1;
    expect(levelOf(spike)).toBeLessThan(SPEAKING_LEVEL);
  });

  it("rises with a sustained signal", () => {
    const tone = new Float32Array(512).fill(0.3);
    expect(levelOf(tone)).toBeCloseTo(0.3, 2);
  });

  it("copes with nothing at all", () => {
    expect(levelOf(new Float32Array(0))).toBe(0);
  });
});
