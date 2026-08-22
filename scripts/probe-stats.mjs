// Watches the engine's own counters. Used to confirm captures are released
// when the last watcher goes away.
const [url, samples = "6", gapMs = "1000"] = process.argv.slice(2);
const socket = new WebSocket(url);
let n = 0;
socket.addEventListener("open", () => tick());
function tick() {
  socket.send(JSON.stringify({ t: "ping", nonce: n }));
}
socket.addEventListener("message", (e) => {
  if (typeof e.data !== "string") return;
  const msg = JSON.parse(e.data);
  if (msg.t !== "pong") return;
  console.log(new Date().toISOString().slice(11, 19), JSON.stringify(msg.stats));
  if (++n >= Number(samples)) {
    socket.close();
    process.exit(0);
  }
  setTimeout(tick, Number(gapMs));
});
socket.addEventListener("error", (e) => {
  console.error("error", e.message ?? e);
  process.exit(1);
});
