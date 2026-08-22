// Isolates the feed path from the browser: one socket claims a slot and pushes
// synthetic frames, a second subscribes to the feed and counts what arrives.
const [url] = process.argv.slice(2);

const HEADER = 20;
const MAGIC = 0x53445246;
// A one-pixel JPEG is enough; the relay never decodes it.
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64",
);

function envelope(slot, seq, w, h, payload) {
  const buf = Buffer.alloc(HEADER + payload.length);
  buf.writeUInt32LE(MAGIC, 0);
  buf.writeUInt32LE(slot, 4);
  buf.writeUInt32LE(seq, 8);
  buf.writeUInt16LE(w, 12);
  buf.writeUInt16LE(h, 14);
  buf.writeUInt16LE(0, 16);
  buf.writeUInt16LE(0, 18);
  payload.copy(buf, HEADER);
  return buf;
}

const publisher = new WebSocket(url);
publisher.binaryType = "arraybuffer";
let pushed = 0;

publisher.addEventListener("open", () => {
  publisher.send(JSON.stringify({ t: "open_feed", slot: 42, name: "probe" }));
  const timer = setInterval(() => {
    publisher.send(envelope(42, ++pushed, 320, 180, JPEG));
    if (pushed >= 40) clearInterval(timer);
  }, 100);
});

// Give the publisher a head start, then watch from a separate connection.
setTimeout(() => {
  const viewer = new WebSocket(url);
  viewer.binaryType = "arraybuffer";
  const got = [];
  const notes = [];
  viewer.addEventListener("open", () => {
    viewer.send(
      JSON.stringify({
        t: "subscribe",
        stream_id: 5,
        source: "feed:probe",
        width: 320,
        height: 180,
      }),
    );
  });
  viewer.addEventListener("message", (e) => {
    if (typeof e.data === "string") {
      const m = JSON.parse(e.data);
      if (m.t !== "pong") notes.push(m.t + (m.message ? `: ${m.message}` : ""));
      return;
    }
    const view = new DataView(e.data);
    if (view.getUint32(0, true) === MAGIC && view.getUint32(4, true) === 5) {
      got.push({ w: view.getUint16(12, true), h: view.getUint16(14, true), bytes: e.data.byteLength - 20 });
    }
  });
  setTimeout(() => {
    console.log(JSON.stringify({ pushed, framesRelayed: got.length, first: got[0] ?? null, notes }, null, 2));
    process.exit(got.length > 0 ? 0 : 1);
  }, 2500);
}, 1200);
