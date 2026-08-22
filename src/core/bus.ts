/**
 * Cross-window messaging.
 *
 * The cockpit owns the document and pushes snapshots to the board; the board
 * reports back what it is actually doing (output size, camera state, guests).
 *
 * Outside Tauri — plain `vite dev` in a browser — this falls back to a
 * BroadcastChannel so the UI can be worked on without building the shell.
 */

import type { BoardDoc, Rect } from "./types";

export const SNAPSHOT_EVENT = "sd:snapshot";
export const BOARD_STATUS_EVENT = "sd:board-status";
export const COMMAND_EVENT = "sd:command";

/** What the board needs in order to paint. */
export interface Snapshot {
  doc: BoardDoc;
  /** The rectangle the audience sees. Animated by the cockpit. */
  frame: Rect;
  /** Bumped whenever the cockpit wants the board to hard-refresh its media. */
  revision: number;
  clean: boolean;
}

/** What the board tells the cockpit about itself. */
export interface BoardStatus {
  outputWidth: number;
  outputHeight: number;
  fps: number;
  connected: boolean;
  streams: number;
  cameraLive: boolean;
  guests: number;
  lastError: string | null;
}

/** One-shot instructions that are not part of document state. */
export type BoardCommand =
  | { t: "flash"; message: string }
  | { t: "refreshMedia" }
  | { t: "requestStatus" };

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type Handler<T> = (payload: T) => void;

let channel: BroadcastChannel | null = null;
function browserChannel(): BroadcastChannel {
  if (!channel) channel = new BroadcastChannel("screen-stuff");
  return channel;
}

export async function emitTo<T>(target: string, event: string, payload: T): Promise<void> {
  if (isTauri) {
    const { emitTo: tauriEmitTo } = await import("@tauri-apps/api/event");
    await tauriEmitTo(target, event, payload);
    return;
  }
  browserChannel().postMessage({ target, event, payload });
}

export async function listenFor<T>(event: string, handler: Handler<T>): Promise<() => void> {
  if (isTauri) {
    const { listen } = await import("@tauri-apps/api/event");
    const unlisten = await listen<T>(event, (e) => handler(e.payload));
    return unlisten;
  }
  const ch = browserChannel();
  const onMessage = (e: MessageEvent) => {
    if (e.data?.event === event) handler(e.data.payload as T);
  };
  ch.addEventListener("message", onMessage);
  return () => ch.removeEventListener("message", onMessage);
}

export const sendSnapshot = (snapshot: Snapshot) => emitTo("board", SNAPSHOT_EVENT, snapshot);
export const sendCommand = (command: BoardCommand) => emitTo("board", COMMAND_EVENT, command);
export const sendBoardStatus = (status: BoardStatus) => emitTo("main", BOARD_STATUS_EVENT, status);

export const onSnapshot = (handler: Handler<Snapshot>) => listenFor(SNAPSHOT_EVENT, handler);
export const onCommand = (handler: Handler<BoardCommand>) => listenFor(COMMAND_EVENT, handler);
export const onBoardStatus = (handler: Handler<BoardStatus>) =>
  listenFor(BOARD_STATUS_EVENT, handler);

export const runningInTauri = () => isTauri;
