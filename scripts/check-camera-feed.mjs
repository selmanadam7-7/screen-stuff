// Proves the host->guest camera path: a cockpit publishes its camera into a
// feed, and a separate client subscribes to that feed and receives frames.
// Without this, a guest rendering a camera tile opens their own webcam.
import { chromium } from "file:///C:/Users/kong1/adgap/node_modules/playwright/index.mjs";

const [stream] = process.argv.slice(2);
const browser = await chromium.launch({
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});
const context = await browser.newContext({ permissions: ["camera"] });
const page = await context.newPage();
const problems = [];
page.on("pageerror", (e) => problems.push(String(e)));

await page.goto(`http://localhost:4483/?stream=${encodeURIComponent(stream)}`, {
  waitUntil: "networkidle",
});
await page.waitForFunction(() => "__screenDropStore" in window, null, { timeout: 15000 });

// Add a camera tile, then open the guest link — publishing is driven by the
// app's own effect, so flipping the real flag is what actually exercises it.
const { feedSource, publishing } = await page.evaluate(async () => {
  const useStore = window.__screenDropStore;
  useStore.getState().addCamera();
  const tile = useStore.getState().doc.tiles.find((t) => t.kind === "camera");
  useStore.setState({ guests: { running: true, link: "http://probe/g/x", guests: [] } });
  await new Promise((r) => setTimeout(r, 3000));
  return { feedSource: tile.source, publishing: window.__screenDropCameraFeeds.publishing };
});

// Now watch it from outside, exactly as a guest's renderer would.
const received = await new Promise((resolve) => {
  const socket = new WebSocket(stream);
  socket.binaryType = "arraybuffer";
  const frames = [];
  socket.addEventListener("open", () => {
    socket.send(
      JSON.stringify({ t: "subscribe", stream_id: 77, source: feedSource, width: 640, height: 360 }),
    );
  });
  socket.addEventListener("message", (e) => {
    if (typeof e.data === "string") return;
    const view = new DataView(e.data);
    if (view.getUint32(0, true) !== 0x53445246) return;
    if (view.getUint32(4, true) !== 77) return;
    frames.push({
      width: view.getUint16(12, true),
      height: view.getUint16(14, true),
      bytes: e.data.byteLength - 20,
    });
  });
  setTimeout(() => {
    socket.close();
    resolve(frames);
  }, 3000);
});

await browser.close();
const ok = received.length >= 5 && received[0].width === 640 && problems.length === 0;
console.log(
  JSON.stringify(
    {
      feedSource,
      publishing,
      framesReceived: received.length,
      first: received[0] ?? null,
      problems,
      ok,
    },
    null,
    2,
  ),
);
process.exit(ok ? 0 : 1);
