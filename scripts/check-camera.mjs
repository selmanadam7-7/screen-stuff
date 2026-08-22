// Verifies camera tiles against the real cameras on this machine: enumerates
// devices, opens one, and reports the frame size actually delivered.
import { chromium } from "file:///C:/Users/kong1/adgap/node_modules/playwright/index.mjs";

const browser = await chromium.launch();
const context = await browser.newContext({ permissions: ["camera"] });
const page = await context.newPage();
await page.goto("http://localhost:4483/", { waitUntil: "domcontentloaded" });

const report = await page.evaluate(async () => {
  // Device labels stay blank until a camera has actually been opened once, so
  // ask for any camera first and enumerate afterwards.
  let firstOpen = null;
  try {
    const probe = await navigator.mediaDevices.getUserMedia({ video: true });
    firstOpen = probe.getVideoTracks()[0]?.label ?? "opened";
    probe.getTracks().forEach((t) => t.stop());
  } catch (err) {
    firstOpen = `failed: ${String(err).slice(0, 90)}`;
  }

  const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
    (d) => d.kind === "videoinput",
  );
  const results = [];
  for (const device of devices) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: device.deviceId } },
      });
      const video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      await video.play();
      await new Promise((r) => setTimeout(r, 900));
      results.push({
        label: device.label || "(unnamed)",
        ok: video.videoWidth > 0,
        size: `${video.videoWidth}x${video.videoHeight}`,
      });
      stream.getTracks().forEach((t) => t.stop());
    } catch (err) {
      results.push({ label: device.label || "(unnamed)", ok: false, error: String(err).slice(0, 90) });
    }
  }
  return { firstOpen, count: devices.length, results };
});

console.log(JSON.stringify(report, null, 2));
await browser.close();
