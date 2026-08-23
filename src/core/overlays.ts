/**
 * The two things drawn over the shot rather than on the board.
 *
 * A **holding card** is what the audience sees instead of your screens: back in
 * two minutes, starting soon, a countdown. Every call needs one and nobody has
 * one to hand, so people improvise with a Notes window at 400% and their
 * desktop visible around the edges.
 *
 * A **lower third** is your name and what you do, in the corner. It costs
 * nothing and it is the difference between a screen share and something that
 * looks made on purpose.
 *
 * Both are anchored to the *stage*, not the board. That way the operator sees
 * them exactly where the audience will, however far they have wandered off, and
 * they stay put when the shot moves.
 */

import type { Rect } from "./types";

export interface HoldingCard {
  title: string;
  subtitle: string;
  /**
   * Epoch milliseconds to count down to, or null for no clock.
   *
   * Absolute rather than a duration, so the countdown is right even if the card
   * was raised a while ago and nothing has re-rendered since.
   */
  until: number | null;
  /** Whether the board underneath shows through, dimmed. */
  showBoard: boolean;
}

export interface LowerThird {
  name: string;
  role: string;
}

/** The presets, because a card you have to write is a card you do not use. */
export const CARD_PRESETS: Array<{ key: string; title: string; subtitle: string; minutes: number | null }> = [
  { key: "soon", title: "Starting soon", subtitle: "Hang tight — we'll begin in a moment.", minutes: null },
  { key: "brb", title: "Back in a minute", subtitle: "Grabbing something. Don't go anywhere.", minutes: 1 },
  { key: "break", title: "Taking a short break", subtitle: "Back shortly.", minutes: 5 },
  { key: "thanks", title: "Thanks for watching", subtitle: "That's everything.", minutes: null },
];

/** A card from a preset, with the countdown resolved against the clock now. */
export function cardFromPreset(key: string, now: number): HoldingCard | null {
  const preset = CARD_PRESETS.find((p) => p.key === key);
  if (!preset) return null;
  return {
    title: preset.title,
    subtitle: preset.subtitle,
    until: preset.minutes === null ? null : now + preset.minutes * 60_000,
    showBoard: false,
  };
}

/**
 * The countdown, as `m:ss`, or null when there is nothing to count.
 *
 * Never negative: a card left up past its own deadline should read "0:00" and
 * stop, not start counting how late you are.
 */
export function countdownText(card: HoldingCard, now: number): string | null {
  if (card.until === null) return null;
  const left = Math.max(0, card.until - now);
  const total = Math.round(left / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Where the lower third sits inside the shot. */
export function lowerThirdRect(stage: Rect): Rect {
  // Proportional to the shot rather than fixed, so it looks the same on a
  // punched-in shot as on the whole board.
  const width = stage.w * 0.34;
  const height = stage.h * 0.13;
  const margin = stage.h * 0.07;
  return {
    x: stage.x + margin,
    y: stage.y + stage.h - margin - height,
    w: width,
    h: height,
  };
}

/** True when there is anything at all to draw. */
export function hasOverlays(card: HoldingCard | null, third: LowerThird | null): boolean {
  return card !== null || (third !== null && (third.name.trim() !== "" || third.role.trim() !== ""));
}
