/**
 * Keyboard.
 *
 * Two layers, and the split matters:
 *
 *   * **local** — plain keys, live only while the cockpit has focus. Fast, and
 *     free to use single letters because nothing else can hear them.
 *   * **global** — `Ctrl+Alt+…`, registered with the OS so they fire while you
 *     are typing in Discord. Every one of these is modified, because a global
 *     bare digit would steal that key from every other program on the machine.
 */

import { isTyping } from "./Editor";
import { useStore } from "./store";
import type { InkTool } from "../core/types";
import { runningInTauri } from "../core/bus";

const INK_KEYS: Record<string, InkTool> = {
  p: "pen",
  h: "highlighter",
  a: "arrow",
  b: "box",
  o: "ellipse",
};

export function installLocalHotkeys(): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (isTyping(event.target)) return;
    const store = useStore.getState();
    const meta = event.ctrlKey || event.metaKey;

    if (meta) {
      switch (event.key.toLowerCase()) {
        case "z":
          event.preventDefault();
          event.shiftKey ? store.redo() : store.undo();
          return;
        case "y":
          event.preventDefault();
          store.redo();
          return;
        case "d":
          event.preventDefault();
          store.duplicateSelection();
          return;
        case "l":
          event.preventDefault();
          store.toggleLock();
          return;
        case "a":
          event.preventDefault();
          store.select(store.doc.tiles.filter((t) => !t.locked).map((t) => t.id));
          return;
        case "s":
          event.preventDefault();
          if (event.shiftKey) void store.saveBoard();
          else store.saveScene();
          return;
      }
      // Back and forward through the views you have jumped to. Bare arrows
      // nudge the selection, so these have to be modified.
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        store.viewBack();
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        store.viewForward();
        return;
      }
      return;
    }

    if (event.altKey) return;

    // Scenes on the number row, plus 0 for the stage.
    if (/^[1-9]$/.test(event.key)) {
      const scene = store.sceneForKey(event.key);
      if (scene) {
        event.preventDefault();
        store.applyScene(scene.id);
      }
      return;
    }
    if (event.key === "0") {
      event.preventDefault();
      store.showStage();
      return;
    }
    // Shift+0 on every layout worth supporting. Fits the board in your view —
    // a view move, so the audience stays on the stage.
    if (event.key === ")" || (event.shiftKey && event.code === "Digit0")) {
      event.preventDefault();
      store.fitEverything();
      return;
    }

    switch (event.key) {
      case "Escape":
        event.preventDefault();
        if (store.ink.tool) store.setInk({ tool: null });
        else if (store.spotlight) store.setSpotlight(null);
        else if (store.stageSelected) store.selectStage(false);
        else store.select([]);
        return;
      case "Delete":
      case "Backspace":
        event.preventDefault();
        store.deleteSelection();
        return;
      case "Enter":
        event.preventDefault();
        store.bringThem();
        return;
      case "g":
      case "G":
        event.preventDefault();
        store.setPrivate(!store.isPrivate);
        return;
      case "f":
      case "F":
        event.preventDefault();
        void store.grabForeground();
        return;
      case "[":
        event.preventDefault();
        store.order("back");
        return;
      case "]":
        event.preventDefault();
        store.order("front");
        return;
      case "ArrowLeft":
      case "ArrowRight":
      case "ArrowUp":
      case "ArrowDown": {
        const step = event.shiftKey ? 40 : 8;
        const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
        const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
        // Arrows nudge whatever is selected — including the stage, so a shot
        // can be lined up precisely without touching the mouse.
        if (store.stageSelected) {
          event.preventDefault();
          const stage = store.doc.frame;
          store.setStage({ ...stage, x: stage.x + dx, y: stage.y + dy });
          return;
        }
        if (store.selection.length === 0) return;
        event.preventDefault();
        store.patchSelection((tile) => ({ x: tile.x + dx, y: tile.y + dy }));
        return;
      }
    }

    const tool = INK_KEYS[event.key.toLowerCase()];
    if (tool) {
      event.preventDefault();
      store.setInk({ tool: store.ink.tool === tool ? null : tool });
    }
  };

  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}

/** Global bindings, in the order they appear in the shortcuts list. */
export const GLOBAL_BINDINGS: { accelerator: string; describe: string; run: () => void }[] = [
  {
    accelerator: "CommandOrControl+Alt+B",
    describe: "show or hide the board",
    run: () => {
      const store = useStore.getState();
      void (store.boardVisible ? store.hideBoardWindow() : store.showBoardWindow());
    },
  },
  {
    accelerator: "CommandOrControl+Alt+G",
    describe: "go private / come back",
    run: () => {
      const store = useStore.getState();
      store.setPrivate(!store.isPrivate);
    },
  },
  {
    accelerator: "CommandOrControl+Alt+Enter",
    describe: "bring them to your view",
    run: () => useStore.getState().bringThem(),
  },
  {
    accelerator: "CommandOrControl+Alt+F",
    describe: "grab the window in front",
    run: () => void useStore.getState().grabForeground(),
  },
  {
    accelerator: "CommandOrControl+Alt+0",
    describe: "come home to the stage",
    run: () => useStore.getState().showStage(),
  },
  ...Array.from({ length: 9 }, (_, i) => {
    const digit = String(i + 1);
    return {
      accelerator: `CommandOrControl+Alt+${digit}`,
      describe: `scene ${digit}`,
      run: () => {
        const store = useStore.getState();
        const scene = store.sceneForKey(digit);
        if (scene) store.applyScene(scene.id);
      },
    };
  }),
];

export async function installGlobalHotkeys(): Promise<() => void> {
  if (!runningInTauri()) return () => undefined;
  try {
    const { register, unregisterAll } = await import("@tauri-apps/plugin-global-shortcut");
    for (const binding of GLOBAL_BINDINGS) {
      // A shortcut another app already owns is not an error worth shouting
      // about — the local key still works when the cockpit has focus.
      try {
        await register(binding.accelerator, (event) => {
          if (event.state === "Pressed") binding.run();
        });
      } catch {
        /* taken by something else */
      }
    }
    return () => void unregisterAll();
  } catch {
    return () => undefined;
  }
}
