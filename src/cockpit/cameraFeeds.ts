/**
 * Publishing the host's camera to guests.
 *
 * A camera lives in this webview, not in Windows Graphics Capture, so a guest
 * cannot capture it the way they capture a monitor. Left alone, a guest
 * rendering a camera tile would open *their own* webcam — which is worse than
 * showing nothing at all.
 *
 * So while anyone outside this window needs to see it, the host encodes each
 * camera tile to JPEG and pushes it into a named feed. Guests and the board
 * window subscribe to that feed like any other source, and everything
 * downstream — the security gate, the renderer, the resolution ladder — works
 * without knowing the difference.
 *
 * The frames are read from the camera element the cockpit's `MediaPool` already
 * has open. This file used to call `getUserMedia` itself, which meant one
 * webcam with two readers in this window alone — three once the board window
 * opened its own — and the exclusive-access devices people actually own
 * (capture cards, DSLR utilities, virtual cameras) answered that by handing
 * everyone frames that came and went.
 */

import type { MediaPool } from "../core/media";
import type { FrameClient } from "../core/frames";
import type { BoardDoc, Tile } from "../core/types";

/** Enough for a face on a board; more would spend bandwidth on nothing. */
const FEED_WIDTH = 640;
const FEED_FPS = 15;
const FEED_QUALITY = 0.72;

/** The feed a camera tile publishes under. Derived, so it needs no extra state. */
export function cameraFeedName(tileId: string): string {
  return `cam-${tileId.replace(/[^a-zA-Z0-9_-]/g, "")}`.slice(0, 64);
}

export function cameraFeedSource(tileId: string): string {
  return `feed:${cameraFeedName(tileId)}`;
}

interface Publisher {
  tileId: string;
  deviceId?: string;
  slot: number;
  /** The tile being published, so the pool can be asked for its camera. */
  tile: Tile;
  canvas: HTMLCanvasElement;
  timer: number | null;
  stopped: boolean;
  seq: number;
}

export class CameraFeeds {
  private publishers = new Map<string, Publisher>();
  private nextSlot = 9000; // well clear of the stream ids the pools hand out
  private client: FrameClient | null = null;
  private pool: MediaPool | null = null;
  private active = false;

  /** The pool whose camera this publishes. Nothing is published without one. */
  setPool(pool: MediaPool | null) {
    this.pool = pool;
  }

  setClient(client: FrameClient | null) {
    if (this.client === client) return;
    this.stopAll();
    this.client = client;
  }

  /**
   * Reconcile against the board. `active` is normally "a guest link is open" —
   * there is no reason to encode a camera nobody is receiving.
   */
  sync(doc: BoardDoc, active: boolean) {
    this.active = active;
    if (!this.client || !this.pool || !active) {
      this.stopAll();
      return;
    }

    const wanted = new Map<string, Tile>();
    for (const tile of doc.tiles) {
      if (tile.kind === "camera" && !tile.hidden) wanted.set(tile.id, tile);
    }

    for (const [tileId, publisher] of [...this.publishers]) {
      const tile = wanted.get(tileId);
      // A tile that changed camera needs a new stream, not a re-tune.
      if (!tile || (tile as any).deviceId !== publisher.deviceId) {
        this.stop(tileId);
      }
    }

    for (const [tileId, tile] of wanted) {
      const publisher = this.publishers.get(tileId);
      // Keep the tile fresh: the pump asks the pool for this tile's camera, and
      // a tile that moved to another device has to ask for the new one.
      if (publisher) publisher.tile = tile;
      else this.start(tile);
    }
  }

  private start(tile: Tile) {
    const client = this.client;
    if (!client) return;

    const slot = this.nextSlot++;
    const publisher: Publisher = {
      tileId: tile.id,
      deviceId: (tile as { deviceId?: string }).deviceId,
      slot,
      tile,
      canvas: document.createElement("canvas"),
      timer: null,
      stopped: false,
      seq: 0,
    };
    this.publishers.set(tile.id, publisher);
    client.openFeed(slot, cameraFeedName(tile.id));

    // No getUserMedia here. The pump reads whatever the pool has open, and
    // simply does nothing until the camera is running -- which is also the
    // right behaviour when the operator has not granted access yet.
    publisher.timer = window.setInterval(() => this.pump(publisher), 1000 / FEED_FPS);
  }

  private pump(publisher: Publisher) {
    const client = this.client;
    if (!client || publisher.stopped) return;
    const video = this.pool?.cameraElement(publisher.tile) ?? null;
    if (!video?.videoWidth) return;
    const { canvas } = publisher;

    const height = Math.round((FEED_WIDTH * video.videoHeight) / video.videoWidth) & ~1;
    if (canvas.width !== FEED_WIDTH || canvas.height !== height) {
      canvas.width = FEED_WIDTH;
      canvas.height = height;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Mirroring is a tile property, applied by the renderer on every viewer's
    // side. Publish the camera as it really is.
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        if (!blob || publisher.stopped) return;
        void blob.arrayBuffer().then((bytes) => {
          if (publisher.stopped) return;
          publisher.seq = (publisher.seq + 1) >>> 0;
          client.publishFrame(publisher.slot, publisher.seq, canvas.width, canvas.height, bytes);
        });
      },
      "image/jpeg",
      FEED_QUALITY,
    );
  }

  private stop(tileId: string) {
    const publisher = this.publishers.get(tileId);
    if (!publisher) return;
    publisher.stopped = true;
    if (publisher.timer !== null) window.clearInterval(publisher.timer);
    // The camera itself belongs to the pool; stopping a publisher must not
    // take the picture away from the cockpit that is still showing it.
    this.client?.closeFeed(publisher.slot);
    this.publishers.delete(tileId);
  }

  stopAll() {
    for (const tileId of [...this.publishers.keys()]) this.stop(tileId);
  }

  get publishing(): number {
    return this.publishers.size;
  }

  get isActive(): boolean {
    return this.active;
  }
}
