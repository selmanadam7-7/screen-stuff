/**
 * The cockpit end of the control API.
 *
 * Rust holds the socket and waits; this does the work and answers. Three jobs:
 *
 *   * run requests as they arrive, and reply to every one of them — a caller
 *     is holding a socket open, and an unanswered request is a hung button;
 *   * publish state whenever it changes, so `GET /state` costs nothing and a
 *     watcher on `/events` sees the show as it happens;
 *   * draw the shot on demand, through the same renderer that is drawing it
 *     for the audience, so the PNG is the picture rather than an impression
 *     of it.
 *
 * Installed only when the API is switched on, and torn down completely when it
 * is switched off: no listener, no subscription, nothing left running.
 */

import * as api from "../core/api";
import { listenFor } from "../core/bus";
import { liveTarget, perform, stateOf } from "../core/control";
import { MediaPool } from "../core/media";
import { renderBoard } from "../core/render";
import { useStore } from "./store";

export const CONTROL_EVENT = "sd:control";

interface Request {
  id: number;
  action: string;
  body: unknown;
}

/** The width the shot is rendered at. 1080p is what the stage is scaled to. */
const SHOT_WIDTH = 1920;

/**
 * Draw the stage into an offscreen canvas and hand back a PNG.
 *
 * Renders the *stage*, not the view: someone asking the API for the shot wants
 * the thing the audience is looking at, not wherever the operator happens to
 * have scrolled the board. No chrome for the same reason — handles and outlines
 * are the operator's furniture and were never on air.
 */
async function drawShot(pool: () => MediaPool | null): Promise<string> {
  const state = useStore.getState();
  const stage = state.frame;
  const height = Math.max(1, Math.round(SHOT_WIDTH / (state.doc.aspect || 16 / 9)));
  const canvas = document.createElement("canvas");
  canvas.width = SHOT_WIDTH;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("this machine could not give us a canvas");

  renderBoard({
    ctx,
    width: SHOT_WIDTH,
    height,
    view: stage,
    doc: state.doc,
    media: pool() ?? { resolve: () => null },
    now: performance.now(),
    // Left unset on purpose: the renderer reads the look from the document
    // root, which is the same place the board window reads it from.
    cameraEmphasis: state.cameraEmphasis,
  });
  return canvas.toDataURL("image/png");
}

/**
 * Wire the cockpit to the API. Returns the teardown.
 *
 * `pool` is a getter rather than the pool itself because the media pool is
 * rebuilt whenever the frame client reconnects, and a captured reference would
 * quietly start drawing black some time after the first reconnect.
 */
export function installControlBridge(pool: () => MediaPool | null): () => void {
  let alive = true;
  const stopping: Array<() => void> = [];

  // No cast: the store is checked against the target's shape at build time, so
  // renaming a store action breaks the build rather than one Stream Deck button
  // in the middle of somebody's call. `shot` is the only thing the store does
  // not have, because drawing needs a canvas and the store has none.
  const target = () => liveTarget(useStore.getState, () => drawShot(pool));

  void listenFor<Request>(CONTROL_EVENT, (request) => {
    if (!alive) return;
    void (async () => {
      const outcome = await perform(target(), request.action, request.body);
      // Answered either way. A refusal is an answer; silence is a bug.
      await api.controlReply(
        request.id,
        "result" in outcome ? outcome.result : undefined,
        "error" in outcome ? outcome.error : undefined,
      );
    })();
  }).then((off) => {
    if (alive) stopping.push(off);
    else off();
  });

  // State, on every change. Zustand fires this for any store write, so it is
  // compared against the last publish rather than sent blindly: the store also
  // changes when the operator moves their mouse over a tile, and a WebSocket
  // watcher does not need to hear about hover.
  let lastSent = "";
  const publish = () => {
    if (!alive) return;
    const next = stateOf(target());
    const encoded = JSON.stringify(next);
    if (encoded === lastSent) return;
    lastSent = encoded;
    void api.controlPublish(next);
  };
  stopping.push(useStore.subscribe(publish));
  publish();

  return () => {
    alive = false;
    for (const stop of stopping) stop();
  };
}
