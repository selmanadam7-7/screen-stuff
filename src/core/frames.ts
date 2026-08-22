/**
 * Client for the Rust frame server.
 *
 * Hands out live `ImageBitmap`s for any source. Both windows use this: the board
 * for tiles, the cockpit for its thumbnails. Several subscriptions to the same
 * source cost one capture in Rust and one encode each.
 *
 * Decoding is deliberately lossy in the same way the Rust side is: if a frame
 * arrives while the previous one is still decoding, the older one is thrown away.
 * Latency beats completeness for a screen share.
 */

import { FRAME_HEADER_LEN, FRAME_MAGIC, readFrameHeader } from "./wire";
import type { ServerStats } from "./types";

export interface StreamOptions {
  width: number;
  height: number;
  fps?: number;
  quality?: number;
}

export type StreamStatus = "connecting" | "live" | "ended" | "error";

export interface StreamHandle {
  readonly id: number;
  readonly source: string;
  /** Newest decoded frame, or null until the first one lands. */
  readonly bitmap: ImageBitmap | null;
  readonly status: StreamStatus;
  readonly error: string | null;
  /** Native size of the source, once known. */
  readonly nativeWidth: number;
  readonly nativeHeight: number;
  /** Frames actually decoded, for the cockpit's health readout. */
  readonly framesShown: number;
  retune(options: StreamOptions): void;
  close(): void;
}

interface StreamRecord extends StreamHandle {
  id: number;
  source: string;
  bitmap: ImageBitmap | null;
  status: StreamStatus;
  error: string | null;
  nativeWidth: number;
  nativeHeight: number;
  framesShown: number;
  options: StreamOptions;
  decoding: boolean;
  onUpdate?: () => void;
}

const RECONNECT_DELAYS = [250, 500, 1000, 2000, 4000];

export class FrameClient {
  private socket: WebSocket | null = null;
  private url: string;
  private nextId = 1;
  private streams = new Map<number, StreamRecord>();
  /** Feeds this client publishes, so a reconnect can re-announce them. */
  private feeds = new Map<number, string>();
  private reconnectAttempt = 0;
  private reconnectTimer: number | null = null;
  private closed = false;
  private pingTimer: number | null = null;

  /** Last stats reported by the server, refreshed on every ping. */
  stats: ServerStats | null = null;
  connected = false;
  onConnectionChange?: (connected: boolean) => void;
  onStats?: (stats: ServerStats) => void;
  /**
   * Control messages this client does not handle itself. The guest socket
   * speaks the same subscribe/frame protocol plus a few messages of its own,
   * which is why the same client serves both.
   */
  onControl?: (message: Record<string, unknown>) => void;

  constructor(url: string) {
    this.url = url;
    this.connect();
  }

  private connect() {
    if (this.closed) return;
    try {
      this.socket = new WebSocket(this.url);
    } catch (err) {
      this.scheduleReconnect();
      return;
    }
    this.socket.binaryType = "arraybuffer";

    this.socket.onopen = () => {
      this.reconnectAttempt = 0;
      this.connected = true;
      this.onConnectionChange?.(true);
      // Re-open everything the app still believes in. Without the feeds the
      // server would no longer know which slot is which, and published frames
      // would land nowhere.
      for (const stream of this.streams.values()) {
        this.sendSubscribe(stream);
      }
      for (const [slot, name] of this.feeds) {
        this.send({ t: "open_feed", slot, name });
      }
      this.pingTimer = window.setInterval(() => this.ping(), 2000);
    };

    this.socket.onmessage = (event) => {
      if (typeof event.data === "string") {
        this.handleControl(event.data);
      } else {
        this.handleFrame(event.data as ArrayBuffer);
      }
    };

    this.socket.onclose = () => {
      this.connected = false;
      this.onConnectionChange?.(false);
      if (this.pingTimer !== null) {
        window.clearInterval(this.pingTimer);
        this.pingTimer = null;
      }
      for (const stream of this.streams.values()) {
        if (stream.status === "live") stream.status = "connecting";
      }
      this.scheduleReconnect();
    };

    this.socket.onerror = () => {
      this.socket?.close();
    };
  }

  private scheduleReconnect() {
    if (this.closed || this.reconnectTimer !== null) return;
    const delay = RECONNECT_DELAYS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS.length - 1)];
    this.reconnectAttempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private send(message: unknown) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  private ping() {
    this.send({ t: "ping", nonce: Date.now() % 1_000_000 });
  }

  private sendSubscribe(stream: StreamRecord) {
    this.send({
      t: "subscribe",
      stream_id: stream.id,
      source: stream.source,
      width: Math.max(16, Math.round(stream.options.width)),
      height: Math.max(16, Math.round(stream.options.height)),
      fps: stream.options.fps ?? 30,
      quality: stream.options.quality ?? 85,
    });
  }

  private handleControl(text: string) {
    let message: any;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    switch (message.t) {
      case "stream_live": {
        const stream = this.streams.get(message.stream_id);
        if (!stream) return;
        stream.status = "live";
        stream.error = null;
        stream.nativeWidth = message.native_width ?? 0;
        stream.nativeHeight = message.native_height ?? 0;
        stream.onUpdate?.();
        break;
      }
      case "stream_ended": {
        const stream = this.streams.get(message.stream_id);
        if (!stream) return;
        stream.status = "ended";
        stream.onUpdate?.();
        break;
      }
      case "stream_error": {
        const stream = this.streams.get(message.stream_id);
        if (!stream) return;
        stream.status = "error";
        stream.error = message.message ?? "capture failed";
        stream.onUpdate?.();
        break;
      }
      case "pong": {
        this.stats = message.stats;
        if (message.stats) this.onStats?.(message.stats);
        break;
      }
      default:
        this.onControl?.(message);
    }
  }

  private handleFrame(buffer: ArrayBuffer) {
    const header = readFrameHeader(buffer);
    if (!header) return;
    const stream = this.streams.get(header.streamId);
    if (!stream) return;

    // Still decoding the last one? Then this one is already stale by the time we
    // would show it. Drop it and wait for the next.
    if (stream.decoding) return;
    stream.decoding = true;

    const payload = new Uint8Array(buffer, FRAME_HEADER_LEN);
    const blob = new Blob([payload], { type: "image/jpeg" });
    createImageBitmap(blob)
      .then((bitmap) => {
        if (!this.streams.has(header.streamId)) {
          bitmap.close();
          return;
        }
        stream.bitmap?.close();
        stream.bitmap = bitmap;
        stream.status = "live";
        stream.framesShown += 1;
        stream.onUpdate?.();
      })
      .catch(() => {
        /* a corrupt frame is not worth a console full of noise */
      })
      .finally(() => {
        stream.decoding = false;
      });
  }

  /**
   * Send a control message the client itself has no opinion about — the guest
   * page uses this for joining, ink and file drops.
   */
  sendControl(message: unknown) {
    this.send(message);
  }

  /**
   * Claim a slot to publish frames into. Frames sent afterwards under this slot
   * land in the named feed, which guests can subscribe to like any source.
   */
  openFeed(slot: number, name: string) {
    this.feeds.set(slot, name);
    this.send({ t: "open_feed", slot, name });
  }

  closeFeed(slot: number) {
    this.feeds.delete(slot);
    this.send({ t: "close_feed", slot });
  }

  /** Feeds currently claimed by this client. */
  get feedCount(): number {
    return this.feeds.size;
  }

  /** Push one already-encoded JPEG frame into a feed. */
  publishFrame(slot: number, seq: number, width: number, height: number, jpeg: ArrayBuffer) {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    const envelope = new Uint8Array(FRAME_HEADER_LEN + jpeg.byteLength);
    const view = new DataView(envelope.buffer);
    view.setUint32(0, FRAME_MAGIC, true);
    view.setUint32(4, slot, true);
    view.setUint32(8, seq, true);
    view.setUint16(12, width, true);
    view.setUint16(14, height, true);
    view.setUint16(16, 0, true);
    view.setUint16(18, 0, true);
    envelope.set(new Uint8Array(jpeg), FRAME_HEADER_LEN);
    this.socket.send(envelope);
  }

  /**
   * Write a line into the app's own log. A packaged desktop window has no
   * console attached, so this is the only way to see what happened in here.
   */
  log(message: string, level: "info" | "warn" | "error" = "info") {
    this.send({ t: "log", level, message });
  }

  /** Open a stream. Call `close()` on the handle when the tile goes away. */
  subscribe(source: string, options: StreamOptions, onUpdate?: () => void): StreamHandle {
    const id = this.nextId++;
    const client = this;
    const record: StreamRecord = {
      id,
      source,
      bitmap: null,
      status: "connecting",
      error: null,
      nativeWidth: 0,
      nativeHeight: 0,
      framesShown: 0,
      options: { ...options },
      decoding: false,
      onUpdate,
      retune(next: StreamOptions) {
        const changed =
          Math.abs(next.width - record.options.width) > 8 ||
          Math.abs(next.height - record.options.height) > 8 ||
          next.fps !== record.options.fps ||
          next.quality !== record.options.quality;
        record.options = { ...next };
        if (changed) client.sendSubscribe(record);
      },
      close() {
        client.streams.delete(id);
        record.bitmap?.close();
        record.bitmap = null;
        client.send({ t: "unsubscribe", stream_id: id });
      },
    };
    this.streams.set(id, record);
    this.sendSubscribe(record);
    return record;
  }

  get streamCount(): number {
    return this.streams.size;
  }

  destroy() {
    this.closed = true;
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
    for (const stream of this.streams.values()) stream.bitmap?.close();
    this.streams.clear();
    this.feeds.clear();
    this.socket?.close();
    this.socket = null;
  }
}

export { FRAME_MAGIC };
