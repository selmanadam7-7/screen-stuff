// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FrameClient } from "../src/core/frames";
import { writeFrameHeader } from "../src/core/wire";

/**
 * A WebSocket we can drive by hand, so the client's reconnect and frame-dropping
 * behaviour can be tested without a server.
 */
class FakeSocket {
  static instances: FakeSocket[] = [];
  static OPEN = 1;

  readyState = 0;
  binaryType = "";
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }

  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  deliver(data: unknown) {
    this.onmessage?.({ data });
  }

  /** Every subscribe/unsubscribe this socket was asked to send. */
  messages() {
    return this.sent.map((s) => JSON.parse(s));
  }
}

const jpegFrame = (streamId: number, seq: number, width = 64, height = 36) =>
  writeFrameHeader(
    { streamId, seq, width, height, format: 0, geometryChanged: false },
    16,
  );

let bitmapCalls = 0;
/** Call one of these to let the matching decode finish. */
let resolveBitmap: (() => void)[] = [];

beforeEach(() => {
  FakeSocket.instances = [];
  bitmapCalls = 0;
  resolveBitmap = [];
  vi.stubGlobal("WebSocket", FakeSocket as unknown as typeof WebSocket);
  vi.stubGlobal("Blob", class {} as unknown as typeof Blob);
  // Hand back a promise we control, so "still decoding" can be held open.
  vi.stubGlobal("createImageBitmap", () => {
    bitmapCalls += 1;
    return new Promise((resolve) => {
      resolveBitmap.push(() => resolve({ width: 64, height: 36, close: () => undefined }));
    });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("subscribing", () => {
  it("queues a subscription made before the socket opens, then sends it", async () => {
    const client = new FrameClient("ws://test/stream");
    const socket = FakeSocket.instances[0];

    const handle = client.subscribe("monitor:1", { width: 800, height: 450 });
    expect(socket.sent).toHaveLength(0); // not open yet

    socket.open();
    const subscribe = socket.messages().find((m) => m.t === "subscribe");
    expect(subscribe).toMatchObject({
      t: "subscribe",
      stream_id: handle.id,
      source: "monitor:1",
      width: 800,
      height: 450,
      fps: 30,
      quality: 85,
    });
    client.destroy();
  });

  it("re-tunes in place rather than resubscribing for a tiny change", () => {
    const client = new FrameClient("ws://test/stream");
    const socket = FakeSocket.instances[0];
    socket.open();
    const handle = client.subscribe("monitor:1", { width: 800, height: 450 });
    const before = socket.sent.length;

    handle.retune({ width: 803, height: 452 }); // within tolerance
    expect(socket.sent.length).toBe(before);

    handle.retune({ width: 1600, height: 900 }); // a real change
    expect(socket.sent.length).toBe(before + 1);
    client.destroy();
  });

  it("stops the stream on the server when a tile goes away", () => {
    const client = new FrameClient("ws://test/stream");
    const socket = FakeSocket.instances[0];
    socket.open();
    const handle = client.subscribe("monitor:1", { width: 100, height: 100 });
    handle.close();

    expect(socket.messages().some((m) => m.t === "unsubscribe" && m.stream_id === handle.id)).toBe(
      true,
    );
    expect(client.streamCount).toBe(0);
    client.destroy();
  });
});

describe("frames", () => {
  it("decodes a frame and reports it live", async () => {
    const client = new FrameClient("ws://test/stream");
    const socket = FakeSocket.instances[0];
    socket.open();
    const handle = client.subscribe("monitor:1", { width: 100, height: 100 });

    socket.deliver(jpegFrame(handle.id, 1));
    resolveBitmap[0]();
    await settle();

    expect(handle.bitmap).not.toBeNull();
    expect(handle.framesShown).toBe(1);
    expect(handle.status).toBe("live");
    client.destroy();
  });

  it("throws away frames that arrive while the last one is still decoding", async () => {
    const client = new FrameClient("ws://test/stream");
    const socket = FakeSocket.instances[0];
    socket.open();
    const handle = client.subscribe("monitor:1", { width: 100, height: 100 });

    socket.deliver(jpegFrame(handle.id, 1));
    socket.deliver(jpegFrame(handle.id, 2));
    socket.deliver(jpegFrame(handle.id, 3));

    // Only the first started decoding; a backlog would add latency for nothing.
    expect(bitmapCalls).toBe(1);

    resolveBitmap[0]();
    await settle();
    expect(handle.framesShown).toBe(1);

    socket.deliver(jpegFrame(handle.id, 4));
    expect(bitmapCalls).toBe(2);
    client.destroy();
  });

  it("ignores frames for a stream that has already closed", async () => {
    const client = new FrameClient("ws://test/stream");
    const socket = FakeSocket.instances[0];
    socket.open();
    const handle = client.subscribe("monitor:1", { width: 100, height: 100 });
    const id = handle.id;
    handle.close();

    socket.deliver(jpegFrame(id, 1));
    expect(bitmapCalls).toBe(0);
    client.destroy();
  });

  it("ignores rubbish on the wire", () => {
    const client = new FrameClient("ws://test/stream");
    const socket = FakeSocket.instances[0];
    socket.open();
    client.subscribe("monitor:1", { width: 100, height: 100 });

    expect(() => socket.deliver(new ArrayBuffer(4))).not.toThrow();
    expect(() => socket.deliver("{not json")).not.toThrow();
    expect(bitmapCalls).toBe(0);
    client.destroy();
  });
});

describe("control messages", () => {
  it("records the native size when a stream goes live", () => {
    const client = new FrameClient("ws://test/stream");
    const socket = FakeSocket.instances[0];
    socket.open();
    const handle = client.subscribe("monitor:1", { width: 100, height: 100 });

    socket.deliver(
      JSON.stringify({
        t: "stream_live",
        stream_id: handle.id,
        native_width: 2560,
        native_height: 1440,
      }),
    );
    expect(handle.nativeWidth).toBe(2560);
    expect(handle.nativeHeight).toBe(1440);
    client.destroy();
  });

  it("surfaces the reason a source failed", () => {
    const client = new FrameClient("ws://test/stream");
    const socket = FakeSocket.instances[0];
    socket.open();
    const handle = client.subscribe("window:1", { width: 100, height: 100 });

    socket.deliver(
      JSON.stringify({
        t: "stream_error",
        stream_id: handle.id,
        message: "that window has closed",
      }),
    );
    expect(handle.status).toBe("error");
    expect(handle.error).toBe("that window has closed");
    client.destroy();
  });

  it("marks a stream ended when its source disappears", () => {
    const client = new FrameClient("ws://test/stream");
    const socket = FakeSocket.instances[0];
    socket.open();
    const handle = client.subscribe("window:1", { width: 100, height: 100 });
    socket.deliver(JSON.stringify({ t: "stream_ended", stream_id: handle.id }));
    expect(handle.status).toBe("ended");
    client.destroy();
  });

  it("keeps the latest stats from a pong", () => {
    const client = new FrameClient("ws://test/stream");
    const socket = FakeSocket.instances[0];
    socket.open();
    socket.deliver(
      JSON.stringify({ t: "pong", nonce: 1, stats: { sessions: 2, streams: 5 } }),
    );
    expect(client.stats).toMatchObject({ sessions: 2, streams: 5 });
    client.destroy();
  });
});

describe("reconnecting", () => {
  it("re-opens and re-subscribes everything still wanted", async () => {
    vi.useFakeTimers();
    const client = new FrameClient("ws://test/stream");
    const first = FakeSocket.instances[0];
    first.open();
    client.subscribe("monitor:1", { width: 100, height: 100 });
    client.subscribe("monitor:2", { width: 100, height: 100 });

    first.close();
    expect(client.connected).toBe(false);

    await vi.advanceTimersByTimeAsync(300);
    const second = FakeSocket.instances[1];
    expect(second).toBeDefined();

    second.open();
    const resubscribed = second
      .messages()
      .filter((m) => m.t === "subscribe")
      .map((m) => m.source)
      .sort();
    expect(resubscribed).toEqual(["monitor:1", "monitor:2"]);
    expect(client.connected).toBe(true);

    client.destroy();
    vi.useRealTimers();
  });

  it("stops trying once destroyed", async () => {
    vi.useFakeTimers();
    const client = new FrameClient("ws://test/stream");
    const socket = FakeSocket.instances[0];
    socket.open();
    client.destroy();
    socket.close();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(FakeSocket.instances).toHaveLength(1);
    vi.useRealTimers();
  });
});
