/**
 * Turning a dropped or chosen file into the right kind of tile.
 *
 * Lives on its own because three different surfaces need it: the toolbar's file
 * picker, the media page's drop zone, and a guest dropping something in.
 */

import type { Actions } from "./store";

export function addByExtension(store: Actions, src: string, name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["mp4", "webm", "mov", "mkv", "m4v"].includes(ext)) {
    store.addVideo(src, name);
    return;
  }
  if (ext === "pdf") {
    store.addPdf(src, name);
    return;
  }
  // Measure it first so the tile lands with the right shape rather than
  // snapping to it a frame later.
  const probe = new Image();
  probe.onload = () => store.addImage(src, probe.naturalWidth, probe.naturalHeight, name);
  probe.onerror = () => store.toast(`${name} is not something I can show`, "warn");
  probe.src = src;
}
