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
 * How often state may be published, at most.
 *
 * Four times a second. Nothing watching this is reading faster than that, and
 * the alternative -- once per store write -- is sixty full serialisations of
 * the board every second while the camera meter is running.
 */
const PUBLISH_EVERY_MS = 250;

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

  // State, when it changes -- but not on every store write, and not at all when
  // nothing is listening.
  //
  // This was the first version's mistake and it cost real frames. Zustand fires
  // a subscriber on *any* write, and the store is written to constantly by
  // things that are not board state: the speaking meter eases the camera's size
  // on every animation frame, the pointer poll runs several times a second, the
  // stage animation writes a new frame sixty times a second. Serialising the
  // whole board on each of those -- for an API that is switched off by default,
  // and that no Stream Deck needs at sixty hertz -- made the app stutter while
  // it was being screen-shared, which is the one moment it must not.
  //
  // So: skip entirely unless the server is up, and coalesce the rest onto a
  // trailing timer. A watcher gets a fresh snapshot a few times a second, which
  // is faster than anyone can read a button.
  let lastSent = "";
  let pending = 0;

  const sendNow = () => {
    pending = 0;
    if (!alive || !api.controlIsLive()) return;
    const next = stateOf(target());
    const encoded = JSON.stringify(next);
    if (encoded === lastSent) return;
    lastSent = encoded;
    void api.controlPublish(next);
  };

  const publish = () => {
    // The cheapest possible check first: one boolean, on the hot path.
    if (!alive || !api.controlIsLive() || pending) return;
    pending = window.setTimeout(sendNow, PUBLISH_EVERY_MS);
  };

  stopping.push(useStore.subscribe(publish));
  stopping.push(() => {
    if (pending) window.clearTimeout(pending);
    pending = 0;
  });
  publish();

  return () => {
    alive = false;
    for (const stop of stopping) stop();
  };
}
