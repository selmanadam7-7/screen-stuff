// Proves the output view is safe to put on a stream.
//
// Two things could go wrong here, and both are silent. The furniture could
// render for a frame before JavaScript hides it, putting a toolbar on somebody
// else's recording. And the letterboxing could be wrong, which would not look
// broken -- it would look fine, while quietly broadcasting the part of the
// board the operator thought was private.
//
// So this loads the real page at four sizes, samples actual pixels, and checks
// the geometry rather than trusting that it looks right.
//
//   node scripts/check-output.mjs http://192.168.1.4:7788/o/<token>
import { chromium } from "file:///C:/Users/kong1/adgap/node_modules/playwright/index.mjs";

const url = process.argv[2];
if (!url) {
  console.error("usage: node scripts/check-output.mjs <output-url>");
  process.exit(2);
}
if (!/\/o\/[^/]+$/.test(url)) {
  console.error("that is not an output url -- it should end with /o/<token>");
  process.exit(2);
}

// The shapes a broadcast tool actually asks for: matching, too wide, too tall,
// and the square nobody plans for but somebody always types.
const SIZES = [
  { name: "1920x1080 (matching)", width: 1280, height: 720, bars: "none" },
  { name: "1280x1024 (too tall)", width: 1280, height: 1024, bars: "horizontal" },
  { name: "2560x800 (too wide)", width: 1280, height: 400, bars: "vertical" },
  { name: "800x800 (square)", width: 800, height: 800, bars: "horizontal" },
];

const browser = await chromium.launch();
let failures = 0;
const fail = (message) => {
  console.log(`  FAIL  ${message}`);
  failures += 1;
};
const pass = (message) => console.log(`  ok    ${message}`);

for (const size of SIZES) {
  console.log(`\n${size.name}`);
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });

  // No interface, ever. Checked as computed style rather than by looking,
  // because "display: none" and "painted white on white" look identical.
  const furniture = await page.evaluate(() =>
    [".guest-bar", ".guest-gate", ".guest-toast"].map((selector) => {
      const node = document.querySelector(selector);
      if (!node) return { selector, visible: false };
      const style = getComputedStyle(node);
      const box = node.getBoundingClientRect();
      return {
        selector,
        visible: style.display !== "none" && style.visibility !== "hidden" && box.height > 0,
      };
    }),
  );
  for (const item of furniture) {
    if (item.visible) fail(`${item.selector} is on screen`);
  }
  if (!furniture.some((f) => f.visible)) pass("no toolbar, no gate, no notices");

  // Give the socket a moment to deliver a board and a frame or two.
  await page.waitForTimeout(2500);

  const shot = await page.evaluate(() => {
    const canvas = document.getElementById("guest-stage");
    if (!canvas) return null;
    const ctx = canvas.getContext("2d");
    const { width, height } = canvas;
    const at = (x, y) => {
      const [r, g, b] = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
      return { r, g, b };
    };
    return {
      width,
      height,
      cssWidth: canvas.clientWidth,
      cssHeight: canvas.clientHeight,
      topLeft: at(2, 2),
      topMiddle: at(width / 2, 2),
      leftMiddle: at(2, height / 2),
      middle: at(width / 2, height / 2),
      bottomMiddle: at(width / 2, height - 3),
      rightMiddle: at(width - 3, height / 2),
    };
  });
  if (!shot) {
    fail("there is no canvas");
    await context.close();
    continue;
  }

  // The canvas fills the window: any gap is a strip of page background on the
  // stream.
  if (shot.cssWidth !== size.width || shot.cssHeight !== size.height) {
    fail(`the canvas is ${shot.cssWidth}x${shot.cssHeight}, not ${size.width}x${size.height}`);
  } else {
    pass("the canvas fills the frame");
  }

  const black = (p) => p.r < 12 && p.g < 12 && p.b < 12;
  if (size.bars === "horizontal") {
    if (black(shot.topMiddle) && black(shot.bottomMiddle) && !black(shot.leftMiddle)) {
      pass("bars top and bottom, board edge to edge");
    } else {
      fail(
        "expected bars top and bottom — " +
          `top ${JSON.stringify(shot.topMiddle)}, left ${JSON.stringify(shot.leftMiddle)}`,
      );
    }
  } else if (size.bars === "vertical") {
    if (black(shot.leftMiddle) && black(shot.rightMiddle) && !black(shot.topMiddle)) {
      pass("bars left and right, board top to bottom");
    } else {
      fail(
        "expected bars left and right — " +
          `left ${JSON.stringify(shot.leftMiddle)}, top ${JSON.stringify(shot.topMiddle)}`,
      );
    }
  } else if (black(shot.topMiddle) || black(shot.leftMiddle)) {
    fail("a matching frame should have no bars at all");
  } else {
    pass("no bars, as it should be");
  }

  await context.close();
}

await browser.close();
console.log(failures ? `\n${failures} problem(s)` : "\nthe output view is safe to point a camera at");
process.exit(failures ? 1 : 0);
