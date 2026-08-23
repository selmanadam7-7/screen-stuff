/**
 * Keeping the last minute of the shot, off to one side.
 *
 * Renders the stage — and only the stage, at a small size — into an offscreen
 * canvas a few times a second, and keeps the JPEGs in a ring. It is a second
 * render pass, which sounds expensive until you notice it is 960 pixels wide,
 * four times a second, against a board that is already being composited sixty.
 *
 * It runs in the cockpit rather than the board window because the cockpit is
 * always open. The board can be hidden, and "wait, go back" is asked most often
 * about something you were showing a moment before you hid it.
 */

import { renderBoard } from "../core/render";
import type { MediaResolver } from "../core/render";
import { REPLAY_FPS, REPLAY_WIDTH, ReplayBuffer } from "../core/replay";
import type { BoardDoc } from "../core/types";

export class ReplayCapture {
  readonly buffer = new ReplayBuffer();
  private canvas: HTMLCanvasElement | null = null;
  private timer: number | null = null;
  private busy = false;

  start(read: () => { doc: BoardDoc; media: MediaResolver } | null): void {
    this.stop();
    this.timer = window.setInterval(() => this.grab(read), 1000 / REPLAY_FPS);
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  /** Stop and forget everything. Used when the feature is switched off. */
  discard(): void {
    this.stop();
    this.buffer.clear();
    this.canvas = null;
  }

  private grab(read: () => { doc: BoardDoc; media: MediaResolver } | null): void {
    // Skipped rather than queued: falling behind should cost a frame of
    // history, never a growing backlog of encodes.
    if (this.busy) return;
    const state = read();
    if (!state) return;

    const stage = state.doc.frame;
    if (stage.w <= 0 || stage.h <= 0) return;
    const width = REPLAY_WIDTH;
    const height = Math.max(1, Math.round((width * stage.h) / stage.w));

    if (!this.canvas) this.canvas = document.createElement("canvas");
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;

    this.busy = true;
    try {
      // The stage exactly, and no chrome: this is what the audience saw.
      renderBoard({
        ctx,
        width,
        height,
        view: stage,
        doc: state.doc,
        media: state.media,
        now: performance.now(),
      });
      this.buffer.push(this.canvas.toDataURL("image/jpeg", 0.62), Date.now());
    } catch {
      // A tainted canvas or a source mid-teardown costs one frame, not the app.
    } finally {
      this.busy = false;
    }
  }
}
