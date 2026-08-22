// Holds a subscription open for a while, so session accounting can be observed
// rising and falling around a client that comes and goes.
const [url, source, holdMs = "4000"] = process.argv.slice(2);
const socket = new WebSocket(url);
socket.binaryType = "arraybuffer";
socket.addEventListener("open", () => {
  socket.send(JSON.stringify({ t: "subscribe", stream_id: 1, source, width: 640, height: 360, fps: 10, quality: 75 }));
  setTimeout(() => { socket.close(); process.exit(0); }, Number(holdMs));
});
socket.addEventListener("message", (e) => {
  if (typeof e.data === "string") {
    const m = JSON.parse(e.data);
    if (m.t === "stream_error") console.error("stream_error:", m.message);
    if (m.t === "stream_live") console.error("live:", m.native_width + "x" + m.native_height);
  }
});
