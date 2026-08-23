/**
 * Going back to what was on the shot a moment ago.
 *
 * The design claim is that this is not a recording, and the tests are mostly
 * about that claim holding: a fixed ceiling on memory, the oldest frame falling
 * off continuously, and nothing that grows.
 */

import { describe, expect, it } from "vitest";
import {
  REPLAY_CAPACITY,
  REPLAY_FPS,
  REPLAY_SECONDS,
  ReplayBuffer,
  agoLabel,
  positionOf,
} from "../src/core/replay";

const frame = (n: number) => `data:image/jpeg;base64,${"A".repeat(n)}`;

describe("the ring", () => {
  it("keeps what it is given", () => {
    const b = new ReplayBuffer(10);
    b.push(frame(4), 1000);
    expect(b.length).toBe(1);
    expect(b.at(0)?.at).toBe(1000);
  });

  it("drops the oldest rather than growing", () => {
    const b = new ReplayBuffer(5);
    for (let i = 0; i < 50; i++) b.push(frame(4), i);
    expect(b.length).toBe(5);
    // The five most recent, in order.
    expect(b.at(0)?.at).toBe(45);
    expect(b.at(4)?.at).toBe(49);
  });

  it("has a ceiling that does not depend on how fast it is fed", () => {
    const slow = new ReplayBuffer(20);
    const fast = new ReplayBuffer(20);
    for (let i = 0; i < 20; i++) slow.push(frame(100), i * 250);
    for (let i = 0; i < 2000; i++) fast.push(frame(100), i * 2);
    expect(fast.length).toBe(slow.length);
    expect(fast.bytes()).toBe(slow.bytes());
  });

  it("reports roughly how much memory it is holding", () => {
    const b = new ReplayBuffer(4);
    b.push(frame(400), 0);
    // base64 is four characters per three bytes, plus the data URL prefix.
    expect(b.bytes()).toBeGreaterThan(250);
    expect(b.bytes()).toBeLessThan(500);
  });

  it("says how far back it goes", () => {
    const b = new ReplayBuffer();
    b.push(frame(4), 10_000);
    b.push(frame(4), 40_000);
    expect(b.seconds(40_000)).toBeCloseTo(30);
  });

  it("has no history when it is empty", () => {
    expect(new ReplayBuffer().seconds(1000)).toBe(0);
    expect(new ReplayBuffer().at(0)).toBeNull();
  });

  it("forgets everything on request", () => {
    const b = new ReplayBuffer();
    for (let i = 0; i < 10; i++) b.push(frame(4), i);
    b.clear();
    expect(b.length).toBe(0);
    expect(b.bytes()).toBe(0);
  });

  it("refuses an index that is not there", () => {
    const b = new ReplayBuffer();
    b.push(frame(4), 0);
    expect(b.at(-1)).toBeNull();
    expect(b.at(1)).toBeNull();
  });
});

describe("scrubbing", () => {
  const buffer = () => {
    const b = new ReplayBuffer();
    for (let i = 0; i < 20; i++) b.push(frame(4), i * 250);
    return b;
  };

  it("finds the frame nearest a moment", () => {
    const b = buffer();
    expect(b.nearest(0)).toBe(0);
    expect(b.nearest(2_600)).toBe(10);
    expect(b.nearest(99_999)).toBe(19);
  });

  it("has nothing to find in an empty buffer", () => {
    expect(new ReplayBuffer().nearest(0)).toBe(-1);
  });

  it("reports position as a fraction", () => {
    expect(positionOf(0, 10)).toBe(0);
    expect(positionOf(9, 10)).toBe(1);
    expect(positionOf(0, 1)).toBe(1);
  });

  it("says how long ago a frame was", () => {
    expect(agoLabel({ image: "", at: 5_000 }, 5_000)).toBe("now");
    expect(agoLabel({ image: "", at: 0 }, 12_000)).toBe("12s ago");
  });
});

describe("the shape of it", () => {
  it("holds about a minute at a watchable rate", () => {
    expect(REPLAY_SECONDS).toBeGreaterThanOrEqual(30);
    expect(REPLAY_FPS).toBeGreaterThanOrEqual(2);
    expect(REPLAY_CAPACITY).toBe(REPLAY_SECONDS * REPLAY_FPS);
  });
});
