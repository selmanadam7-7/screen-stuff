// Development probe: connect to a running Screen Stuff engine, pull one frame
// from every source given on the command line, and write them out as JPEGs.
// Proves capture -> scale -> encode -> transport without launching any UI.
import { writeFileSync } from "node:fs";

const [url, outDir, ...sources] = process.argv.slice(2);
if (!url || !outDir || sources.length === 0) {
  console.error("usage: probe-frame.mjs <ws-url> <out-dir> <source> [source...]");
  process.exit(2);
}

const socket = new WebSocket(url);
socket.binaryType = "arraybuffer";
const pending = new Map(sources.map((source, i) => [i + 1, source]));
const results = [];

const done = () => {
  console.log(JSON.stringify(results, null, 2));
  socket.close();
  process.exit(results.length === sources.length ? 0 : 1);
};

socket.addEventListener("open", () => {
  sources.forEach((source, i) => {
    socket.send(
      JSON.stringify({
        t: "subscribe",
        stream_id: i + 1,
        source,
        width: 960,
        height: 540,
        fps: 15,
        quality: 88,
      }),
    );
  });
});

socket.addEventListener("message", (event) => {
  if (typeof event.data === "string") {
    const msg = JSON.parse(event.data);
    if (msg.t === "stream_error") {
      results.push({ source: pending.get(msg.stream_id), error: msg.message });
      pending.delete(msg.stream_id);
      if (pending.size === 0) done();
    }
    return;
  }
  const view = new DataView(event.data);
  if (view.getUint32(0, true) !== 0x53445246) return;
  const streamId = view.getUint32(4, true);
  const source = pending.get(streamId);
  if (!source) return;
  pending.delete(streamId);

  const width = view.getUint16(12, true);
  const height = view.getUint16(14, true);
  const payload = Buffer.from(event.data.slice(20));
  const file = `${outDir}/${source.replace(/[^a-z0-9]+/gi, "_")}.jpg`;
  writeFileSync(file, payload);
  results.push({ source, width, height, bytes: payload.length, file });
  if (pending.size === 0) done();
});

socket.addEventListener("error", (err) => {
  console.error("socket error", err.message ?? err);
  process.exit(1);
});

setTimeout(() => {
  console.error("timed out waiting for frames; got", results.length, "of", sources.length);
  console.log(JSON.stringify(results, null, 2));
  process.exit(1);
}, 12000);
