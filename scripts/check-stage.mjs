// Proves the stage behaves the way the product claims, against the real running
// cockpit rather than a unit-test stub.
//
// The three things being checked are the three that were wrong:
//
//   1. the opening view shows the stage with board around it,
//   2. moving your view does not move the stage, and
//   3. nothing you can click leaves you somewhere you cannot get back from.
//
//   node scripts/check-stage.mjs [http://localhost:4483]
import { chromium } from "file:///C:/Users/kong1/adgap/node_modules/playwright/index.mjs";

const base = process.argv[2] ?? "http://localhost:4483";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1520, height: 980 } });

const problems = [];
page.on("console", (m) => m.type() === "error" && problems.push(m.text()));
page.on("pageerror", (e) => problems.push(String(e)));

await page.goto(base, { waitUntil: "networkidle" });
await page.waitForFunction(() => "__screenDropStore" in window, null, { timeout: 15000 });

/** Board space -> page pixels, using the same aspect correction the editor uses. */
async function toScreen(point) {
  return page.evaluate(({ x, y }) => {
    const canvas = document.querySelector(".editor canvas");
    const box = canvas.getBoundingClientRect();
    const state = window.__screenDropStore.getState();
    const aspect = canvas.width / canvas.height;
    const v =
      Math.abs(state.view.w / state.view.h - aspect) > 0.001
        ? { ...state.view, h: state.view.w / aspect }
        : state.view;
    return {
      x: box.left + ((x - v.x) / v.w) * box.width,
      y: box.top + ((y - v.y) / v.h) * box.height,
    };
  }, point);
}

const read = () =>
  page.evaluate(() => {
    const s = window.__screenDropStore.getState();
    return {
      view: s.view,
      stage: s.doc.frame,
      live: s.frame,
      locked: s.doc.stageLocked,
      selected: s.stageSelected,
      canGoBack: s.canGoBack,
      away: s.viewAway,
      followView: s.followView,
      tiles: s.doc.tiles.length,
    };
  });

const act = (fn, arg) =>
  page.evaluate(
    ({ body, arg }) => {
      const store = window.__screenDropStore.getState();
      return new Function("store", "arg", body)(store, arg);
    },
    { body: fn, arg: arg ?? null },
  );

const round = (r) => ({
  x: Math.round(r.x),
  y: Math.round(r.y),
  w: Math.round(r.w),
  h: Math.round(r.h),
});
const same = (a, b, tol = 1.5) =>
  Math.abs(a.x - b.x) < tol &&
  Math.abs(a.y - b.y) < tol &&
  Math.abs(a.w - b.w) < tol &&
  Math.abs(a.h - b.h) < tol;

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? "  — " + detail : ""}`);
}

// --------------------------------------------------------------------------
// 1. The opening view
// --------------------------------------------------------------------------
const opening = await read();
check(
  "opens on the stage, with board visible around it",
  opening.view.w > opening.stage.w * 1.3 && opening.view.h > opening.stage.h * 1.1,
  `view ${Math.round(opening.view.w)} wide vs stage ${Math.round(opening.stage.w)}`,
);
check(
  "the stage is centred in the opening view",
  Math.abs(opening.view.x + opening.view.w / 2 - (opening.stage.x + opening.stage.w / 2)) < 2,
);
check("roaming is private by default", opening.followView === false);

// --------------------------------------------------------------------------
// 2. Looking around does not move the stage
// --------------------------------------------------------------------------
const before = await read();
await act("store.panBy(4000, 2500)");
await act("store.zoom(2.4)");
const afterPan = await read();
check(
  "panning and zooming leaves the stage exactly where it was",
  same(afterPan.stage, before.stage, 0.01),
  `${JSON.stringify(round(afterPan.stage))}`,
);
check("the app notices you have wandered off", afterPan.away === true);
check(
  "the audience frame did not follow either",
  same(afterPan.live, before.stage, 1.5),
);

// --------------------------------------------------------------------------
// 3. Coming home, and getting back
// --------------------------------------------------------------------------
await act("store.showStage()");
const home = await read();
check("Home returns to exactly the opening view", same(home.view, opening.view, 0.5));

await act("store.viewBack()");
const back = await read();
check(
  "Back returns to where you were before Home",
  same(back.view, afterPan.view, 0.5),
  `${JSON.stringify(round(back.view))}`,
);

await act("store.viewForward()");
check("Forward goes home again", same((await read()).view, home.view, 0.5));

// The exact trap: double-clicking empty canvas used to zoom onto the stage
// with no way out.
const middleOfNowhere = await toScreen({
  x: opening.stage.x + opening.stage.w / 2,
  y: opening.stage.y + opening.stage.h / 2,
});
await act("store.panBy(3000, 0)");
const wandered = await read();
await page.mouse.dblclick(middleOfNowhere.x, middleOfNowhere.y);
const afterDouble = await read();
check(
  "double-clicking empty canvas comes home rather than trapping you",
  same(afterDouble.view, opening.view, 1) && afterDouble.canGoBack,
);
await act("store.viewBack()");
check("...and Back undoes it", same((await read()).view, wandered.view, 1));

// --------------------------------------------------------------------------
// 4. Fitting everything is a view move, not a stage move
// --------------------------------------------------------------------------
await act("store.showStage()");
const beforeFit = await read();
for (let i = 0; i < 8; i++) await act("store.fitEverything()");
const afterFit = await read();
check(
  "fitting an empty board eight times never moves the stage",
  same(afterFit.stage, beforeFit.stage, 0.01),
  `${JSON.stringify(round(afterFit.stage))}`,
);

// --------------------------------------------------------------------------
// 5. Dragging the stage on the canvas
// --------------------------------------------------------------------------
await act("store.showStage()");
const beforeDrag = await read();
const edge = await toScreen({
  x: beforeDrag.stage.x + beforeDrag.stage.w / 2,
  y: beforeDrag.stage.y,
});
await page.mouse.move(edge.x, edge.y);
await page.mouse.down();
await page.mouse.move(edge.x + 120, edge.y + 60, { steps: 8 });
await page.mouse.up();
const dragged = await read();
check("the stage's edge is grabbable, and selects it", dragged.selected === true);
check(
  "dragging the edge moves the stage",
  !same(dragged.stage, beforeDrag.stage, 4),
  `${JSON.stringify(round(dragged.stage))}`,
);
check("dragging the stage does not move your view", same(dragged.view, beforeDrag.view, 0.5));
check(
  "the audience frame follows the stage",
  same(dragged.live, dragged.stage, 2),
);

// Undo has to take one press, not two.
await act("store.undo()");
check(
  "one undo puts the stage back",
  same((await read()).stage, beforeDrag.stage, 0.5),
);

// The middle of the stage is still the board, not a giant grab handle.
await act("store.showStage(); store.selectStage(false)");
const middle = await toScreen({
  x: beforeDrag.stage.x + beforeDrag.stage.w / 2,
  y: beforeDrag.stage.y + beforeDrag.stage.h / 2,
});
const beforeMiddle = await read();
await page.mouse.move(middle.x, middle.y);
await page.mouse.down();
await page.mouse.move(middle.x + 140, middle.y + 80, { steps: 6 });
await page.mouse.up();
const afterMiddle = await read();
check(
  "clicking the middle of the stage does not drag it",
  same(afterMiddle.stage, beforeMiddle.stage, 0.01) && afterMiddle.selected === false,
);

// --------------------------------------------------------------------------
// 6. Resizing keeps the output shape
// --------------------------------------------------------------------------
await act("store.selectStage(true)");
const beforeResize = await read();
const corner = await toScreen({
  x: beforeResize.stage.x + beforeResize.stage.w,
  y: beforeResize.stage.y + beforeResize.stage.h,
});
await page.mouse.move(corner.x, corner.y);
await page.mouse.down();
await page.mouse.move(corner.x + 160, corner.y + 40, { steps: 8 });
await page.mouse.up();
const resized = await read();
check(
  "the corner handle resizes the stage",
  resized.stage.w > beforeResize.stage.w + 20,
  `${Math.round(beforeResize.stage.w)} -> ${Math.round(resized.stage.w)}`,
);
check(
  "resizing holds the output shape",
  Math.abs(resized.stage.w / resized.stage.h - 16 / 9) < 0.01,
);

// --------------------------------------------------------------------------
// 7. The lock
// --------------------------------------------------------------------------
await act("store.setStageLocked(true)");
const locked = await read();
const lockedEdge = await toScreen({
  x: locked.stage.x + locked.stage.w / 2,
  y: locked.stage.y,
});
await page.mouse.move(lockedEdge.x, lockedEdge.y);
await page.mouse.down();
await page.mouse.move(lockedEdge.x + 200, lockedEdge.y + 120, { steps: 8 });
await page.mouse.up();
check(
  "a locked stage refuses to be dragged",
  same((await read()).stage, locked.stage, 0.01),
);
await act("store.bringThem()");
check(
  "...but an explicit command still moves it",
  !same((await read()).stage, locked.stage, 4),
);
await act("store.setStageLocked(false)");

// --------------------------------------------------------------------------
// 8. It survives a save and reload
// --------------------------------------------------------------------------
const persisted = await page.evaluate(() => {
  const useStore = window.__screenDropStore;
  const store = useStore.getState();
  store.setStage({ x: 640, y: -320, w: 1280, h: 720 }, { force: true });
  const saved = JSON.parse(JSON.stringify(useStore.getState().doc));
  store.newBoard("scratch");
  const wiped = { ...useStore.getState().doc.frame };
  useStore.setState({ doc: saved });
  return { saved: saved.frame, wiped, reloaded: useStore.getState().doc.frame };
});
check(
  "the stage is part of the saved document",
  Math.round(persisted.saved.x) === 640 &&
    Math.round(persisted.reloaded.x) === 640 &&
    Math.round(persisted.wiped.x) === 0,
);

// --------------------------------------------------------------------------
// 9. A spotlight is a loan, not a move
// --------------------------------------------------------------------------
await page.evaluate(() => {
  const useStore = window.__screenDropStore;
  const store = useStore.getState();
  store.newBoard("spotlight");
  const monitors = [
    {
      id: "monitor:1",
      kind: "monitor",
      title: "Display 1",
      subtitle: "2560 x 1440",
      width: 2560,
      height: 1440,
      x: 0,
      y: 0,
      isPrimary: true,
    },
  ];
  useStore.setState({ sources: monitors, monitors });
  store.addSources(["monitor:1"]);
  store.setStage({ x: 300, y: 120, w: 1600, h: 900 }, { force: true });
});
const beforeSpot = await read();
await act("store.toggleSpotlight(store.doc.tiles[0].id)");
await page.waitForTimeout(700);
const spotlit = await read();
check(
  "a spotlight aims the audience somewhere else",
  !same(spotlit.live, beforeSpot.stage, 6),
);
check("...without overwriting the stage", same(spotlit.stage, beforeSpot.stage, 0.01));
await act("store.setSpotlight(null)");
await page.waitForTimeout(700);
check(
  "...and leaving it puts them back exactly where they were",
  same((await read()).live, beforeSpot.stage, 1.5),
);

// --------------------------------------------------------------------------
// 10. Scenes remember the stage, and getting to one is reversible
// --------------------------------------------------------------------------
await act("store.showStage(); store.saveScene('Wide')");
const sceneStage = (await read()).stage;
// Somewhere genuinely else, view and all, so applying the scene is a real jump.
await act("store.setStage({ x: 9000, y: 4000, w: 900, h: 506 }, { force: true }); store.showStage()");
const wandered2 = await read();
await act("store.applyScene(store.doc.scenes[0].id)");
await page.waitForTimeout(700);
check("a scene restores the stage it was saved with", same((await read()).stage, sceneStage, 1.5));
check("...and takes your view with it", !same((await read()).view, wandered2.view, 50));
await act("store.viewBack()");
check("...and Back returns your view", same((await read()).view, wandered2.view, 1));

// --------------------------------------------------------------------------
// 11. Opt in to the old behaviour and it comes back
// --------------------------------------------------------------------------
await page.evaluate(() => {
  const store = window.__screenDropStore.getState();
  store.newBoard("follow");
  store.setFollowView(true);
});
const beforeFollow = await read();
await act("store.panBy(900, 400)");
const afterFollow = await read();
check(
  "with follow on, the audience does ride your view",
  !same(afterFollow.stage, beforeFollow.stage, 4),
);
await act("store.setFollowView(false)");

// --------------------------------------------------------------------------
await browser.close();

if (problems.length) {
  console.log("\nconsole errors:");
  for (const p of problems.slice(0, 8)) console.log("  " + p);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length || problems.length ? 1 : 0);
