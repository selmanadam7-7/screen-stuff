/**
 * Demo mode.
 *
 * `?demo` on the cockpit swaps the capture engine for drawn desktops and lays
 * out a board worth looking at. Everything else — the store, the stage, the
 * renderer, every keyboard shortcut — is the shipped app. A visitor who drags
 * the stage in the demo has used the product, not a mock of it.
 *
 * The one thing it cannot do is capture your actual screens, which is the
 * reason the app exists and the reason there is a download button on the page.
 */

import { useStore } from "../cockpit/store";
import { DEMO_SOURCES } from "./screens";

export function isDemo(): boolean {
  return new URLSearchParams(window.location.search).has("demo");
}

/**
 * Put a board together that shows what the app is for.
 *
 * Four screens, a note that only the operator can see parked off the stage, a
 * name on the shot, and the stage tightened onto the two that matter — which is
 * the whole pitch, arranged rather than explained.
 */
let started = false;

export function startDemo(): void {
  // React runs effects twice in development, and a demo board laid out twice
  // has eight screens on it. Guarded rather than made re-entrant: there is no
  // sensible meaning for "set the demo up again".
  if (started) return;
  started = true;

  const store = useStore.getState();

  useStore.setState({ sources: DEMO_SOURCES, monitors: DEMO_SOURCES });
  store.setBoardProp({ name: "Discovery call" });
  store.addSources(DEMO_SOURCES.map((s) => s.id));
  store.applyLayout("focus");

  // Off the stage on purpose: the private half of the board is the idea most
  // people have not met before, so the demo should have one in it.
  store.addNote("Only I can see this.\nPricing floor: 2.4k.\nAsk about the December launch.");
  const note = useStore.getState().doc.tiles.find((t) => t.kind === "note");
  if (note) {
    const stage = useStore.getState().doc.frame;
    store.patchTile(note.id, { x: stage.x + stage.w + 140, y: stage.y + 80, w: 520, h: 300 });
  }

  store.setLowerThird({ name: "Adam Selman", role: "BrandBased" });
  store.select([]);
  store.showStage();
  store.toast("this is the real app — drag the stage, press 0, press T");
}
