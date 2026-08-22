// Screenshots a local page with the Playwright install already on this machine.
// Used to check the cockpit's layout without needing the app window in front.
import { chromium } from "file:///C:/Users/kong1/adgap/node_modules/playwright/index.mjs";

const [url, out, w = "1520", h = "980", waitMs = "3500"] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: Number(w), height: Number(h) },
  deviceScaleFactor: 1,
  permissions: [],
});
const problems = [];
page.on("console", (m) => m.type() === "error" && problems.push(m.text()));
page.on("pageerror", (e) => problems.push(String(e)));

await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(Number(waitMs));
await page.screenshot({ path: out });
console.log(JSON.stringify({ out, problems }, null, 2));
await browser.close();
