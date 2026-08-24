// Drives a real guest through sharing, and checks the promises hold.
//
// Three of them, and each has already been wrong once:
//   * a guest's screen lands on the host's board but NOT on the stage, so
//     nothing a guest shares reaches the call until the host puts it there;
//   * on a plain LAN link the buttons are absent and say why, because browsers
//     do not expose a camera outside a secure context and a button that cannot
//     work is worse than no button;
//   * closing the tab takes the tile and the guest away, rather than leaving a
//     frozen picture and a ghost in the guest list.
//
// Needs the app running with the control API on, and a guest link open:
//   node scripts/check-guest-share.mjs <secure-link> <lan-link>
import { chromium } from "file:///C:/Users/kong1/adgap/node_modules/playwright/index.mjs";
const [link, insecure] = process.argv.slice(2);
const api = async (p, b) => (await fetch(`http://127.0.0.1:4488${p}`, {
  method: b ? "POST" : "GET",
  headers: { "X-Control-Token": "temp-share-check", "content-type": "application/json" },
  body: b ? JSON.stringify(b) : undefined })).json();

const browser = await chromium.launch({ args: [
  "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
  "--auto-select-desktop-capture-source=Entire screen"] });

// 1. the insecure LAN link must say why, not offer a broken button
{
  const page = await (await browser.newContext()).newPage();
  await page.goto(insecure, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  await page.fill("#guest-name-input", "Lan"); await page.click("#guest-join");
  await page.waitForTimeout(1500);
  const buttons = await page.$$eval("#guest-share button", (e) => e.map(x => x.textContent));
  const hint = await page.$eval("#guest-share .guest-hint", (e) => e.textContent).catch(() => null);
  console.log("  LAN buttons:", JSON.stringify(buttons), "| hint:", JSON.stringify(hint));
  await page.close();
}

// 2. the secure link shares a screen, named
const page = await (await browser.newContext({ permissions: ["camera"] })).newPage();
await page.goto(link, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
await page.fill("#guest-name-input", "Tester"); await page.click("#guest-join");
await page.waitForTimeout(1500);
const roster = (await api("/state")).guests;
console.log("  roster while joined:", JSON.stringify(roster));

const before = (await api("/state")).tiles.length;
await page.click("#guest-share button:has-text('Share my screen')");
await page.waitForTimeout(4000);
const st = await api("/state");
console.log(`  tiles ${before} -> ${st.tiles.length}`);
console.log("  tile:", JSON.stringify(st.tiles.map(t => t.name)));

// 3. closing the tab removes the tile AND the guest
await page.close();
await new Promise(r => setTimeout(r, 2500));
const after = await api("/state");
console.log(`  after the guest closed the tab: tiles=${after.tiles.length} watching=${after.guests.watching}`);
await browser.close();
