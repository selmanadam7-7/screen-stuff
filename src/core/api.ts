/**
 * Thin typed wrappers over the Rust commands.
 *
 * Every call degrades to something sensible when the app is opened in a plain
 * browser, so the UI can be developed and tested without the shell.
 */

import type { BoardMeta, SessionInfo, SourceInfo } from "./types";
import { runningInTauri } from "./bus";

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(command, args);
}

const OFFLINE_SESSION: SessionInfo = {
  streamUrl: "",
  version: "dev",
  dataDir: "(browser)",
  desktop: { x: 0, y: 0, width: 1920, height: 1080 },
};

/**
 * Development escape hatch: opening the cockpit in a browser with
 * `?stream=ws://…` points it at a running capture engine, so the UI can be
 * worked on with real pixels flowing. Never used inside the app itself.
 */
function devStreamUrl(): string {
  if (typeof window === "undefined") return "";
  const fromQuery = new URLSearchParams(window.location.search).get("stream");
  if (fromQuery) {
    try {
      localStorage.setItem("screen-drop:devStream", fromQuery);
    } catch {
      /* private mode, not important */
    }
    return fromQuery;
  }
  try {
    return localStorage.getItem("screen-drop:devStream") ?? "";
  } catch {
    return "";
  }
}

export async function sessionInfo(): Promise<SessionInfo> {
  if (!runningInTauri()) return { ...OFFLINE_SESSION, streamUrl: devStreamUrl() };
  return invoke<SessionInfo>("session_info");
}

/**
 * Outside Tauri there is no capture engine to ask, so the browser fallback
 * serves whatever a harness has put on `__screenDropSources`. That is what lets
 * the UI be developed and screenshotted against a real engine's frames without
 * the desktop shell.
 */
function offlineSources(): SourceInfo[] {
  const injected = (window as unknown as { __screenDropSources?: SourceInfo[] })
    .__screenDropSources;
  return Array.isArray(injected) ? injected : [];
}

export async function listSources(): Promise<SourceInfo[]> {
  if (!runningInTauri()) return offlineSources();
  return invoke<SourceInfo[]>("list_sources");
}

export async function listMonitors(): Promise<SourceInfo[]> {
  if (!runningInTauri()) return offlineSources().filter((s) => s.kind === "monitor");
  return invoke<SourceInfo[]>("list_monitors");
}

export async function foregroundWindow(): Promise<string | null> {
  if (!runningInTauri()) return null;
  return invoke<string | null>("foreground_window");
}

export async function sourceIsAlive(id: string): Promise<boolean> {
  if (!runningInTauri()) return true;
  return invoke<boolean>("source_is_alive", { id });
}

// --- boards ---------------------------------------------------------------

export interface BoardRecord {
  id: string;
  name: string;
  kind: "board" | "template";
  updated_at: number;
  created_at: number;
  note: string;
  doc: unknown;
}

const LOCAL_KEY = "screen-drop:boards";

function localBoards(): Record<string, BoardRecord> {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export async function boardList(): Promise<BoardMeta[]> {
  if (!runningInTauri()) {
    return Object.values(localBoards())
      .map(({ doc: _doc, ...meta }) => meta)
      .sort((a, b) => b.updated_at - a.updated_at);
  }
  return invoke<BoardMeta[]>("board_list");
}

export async function boardSave(record: BoardRecord): Promise<BoardMeta> {
  if (!runningInTauri()) {
    const all = localBoards();
    const now = Math.floor(Date.now() / 1000);
    all[record.id] = { ...record, created_at: record.created_at || now, updated_at: now };
    localStorage.setItem(LOCAL_KEY, JSON.stringify(all));
    const { doc: _doc, ...meta } = all[record.id];
    return meta;
  }
  return invoke<BoardMeta>("board_save", { record });
}

export async function boardLoad(id: string): Promise<BoardRecord> {
  if (!runningInTauri()) {
    const record = localBoards()[id];
    if (!record) throw new Error(`no board saved as ${id}`);
    return record;
  }
  return invoke<BoardRecord>("board_load", { id });
}

export async function boardDelete(id: string): Promise<void> {
  if (!runningInTauri()) {
    const all = localBoards();
    delete all[id];
    localStorage.setItem(LOCAL_KEY, JSON.stringify(all));
    return;
  }
  return invoke<void>("board_delete", { id });
}

// --- settings -------------------------------------------------------------

export async function settingsGet<T = Record<string, unknown>>(): Promise<T> {
  if (!runningInTauri()) {
    try {
      return JSON.parse(localStorage.getItem("screen-drop:settings") ?? "{}");
    } catch {
      return {} as T;
    }
  }
  return invoke<T>("settings_get");
}

export async function settingsSet(value: unknown): Promise<void> {
  if (!runningInTauri()) {
    localStorage.setItem("screen-drop:settings", JSON.stringify(value));
    return;
  }
  return invoke<void>("settings_set", { value });
}

// --- the board window -----------------------------------------------------

export const boardShow = () => (runningInTauri() ? invoke<void>("board_show") : Promise.resolve());
export const boardHide = () => (runningInTauri() ? invoke<void>("board_hide") : Promise.resolve());

export async function boardSetGeometry(geometry: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}): Promise<void> {
  if (!runningInTauri()) return;
  return invoke<void>("board_set_geometry", { geometry });
}

export async function boardFillMonitor(monitorId: string): Promise<void> {
  if (!runningInTauri()) return;
  return invoke<void>("board_fill_monitor", { monitorId });
}

export const boardRestoreGeometry = () =>
  runningInTauri() ? invoke<void>("board_restore_geometry") : Promise.resolve();

export async function boardSetAlwaysOnTop(onTop: boolean): Promise<void> {
  if (!runningInTauri()) return;
  return invoke<void>("board_set_always_on_top", { onTop });
}

// --- web sources ----------------------------------------------------------

export interface WebSourceHandle {
  /** The Tauri window label backing this page. */
  label: string;
  /** The capture source id, e.g. `window:12345`. */
  source: string;
}

export async function webSourceOpen(
  url: string,
  width: number,
  height: number,
): Promise<WebSourceHandle> {
  if (!runningInTauri()) throw new Error("web tiles need the desktop app");
  return invoke<WebSourceHandle>("web_source_open", { url, width, height });
}

export async function webSourceNavigate(label: string, url: string): Promise<void> {
  if (!runningInTauri()) return;
  return invoke<void>("web_source_navigate", { label, url });
}

export async function webSourceClose(label: string): Promise<void> {
  if (!runningInTauri()) return;
  return invoke<void>("web_source_close", { label });
}

export async function webSourceInteract(label: string, interacting: boolean): Promise<void> {
  if (!runningInTauri()) return;
  return invoke<void>("web_source_interact", { label, interacting });
}

export async function webSourceReload(label: string): Promise<void> {
  if (!runningInTauri()) return;
  return invoke<void>("web_source_reload", { label });
}

// --- guests ---------------------------------------------------------------

export interface GuestPowers {
  draw: boolean;
  roam: boolean;
  files: boolean;
}

export interface GuestInfo {
  id: number;
  name: string;
  view: { x: number; y: number; w: number; h: number } | null;
}

/** How far the guest link reaches. */
export interface TunnelStatus {
  state: "off" | "preparing" | "starting" | "running" | "failed";
  url: string | null;
  message: string;
}

export interface GuestStatus {
  running: boolean;
  /** For someone on this network. */
  link: string | null;
  /** For someone anywhere, once the tunnel is open. */
  publicLink: string | null;
  tunnel: TunnelStatus;
  guests: GuestInfo[];
}

const NO_TUNNEL: TunnelStatus = { state: "off", url: null, message: "" };
const NO_GUESTS: GuestStatus = {
  running: false,
  link: null,
  publicLink: null,
  tunnel: NO_TUNNEL,
  guests: [],
};

export async function guestStart(): Promise<GuestStatus> {
  if (!runningInTauri()) return NO_GUESTS;
  return invoke<GuestStatus>("guest_start");
}

export async function guestStop(): Promise<GuestStatus> {
  if (!runningInTauri()) return NO_GUESTS;
  return invoke<GuestStatus>("guest_stop");
}

export async function guestStatus(): Promise<GuestStatus> {
  if (!runningInTauri()) return NO_GUESTS;
  return invoke<GuestStatus>("guest_status");
}

/**
 * Open a public address for the guest link.
 *
 * Slow the first time -- it downloads the tunnel helper -- so the caller has to
 * show that something is happening.
 */
export async function tunnelStart(): Promise<GuestStatus> {
  if (!runningInTauri()) return NO_GUESTS;
  return invoke<GuestStatus>("tunnel_start");
}

export async function tunnelStop(): Promise<GuestStatus> {
  if (!runningInTauri()) return NO_GUESTS;
  return invoke<GuestStatus>("tunnel_stop");
}

export async function guestPublish(
  doc: unknown,
  frame: unknown,
  powers: GuestPowers,
): Promise<void> {
  if (!runningInTauri()) return;
  return invoke<void>("guest_publish", { doc, frame, powers });
}

// --- region picker --------------------------------------------------------

export const openRegionPicker = () =>
  runningInTauri() ? invoke<void>("open_region_picker") : Promise.resolve();
export const closeRegionPicker = () =>
  runningInTauri() ? invoke<void>("close_region_picker") : Promise.resolve();
export const cockpitFocus = () =>
  runningInTauri() ? invoke<void>("cockpit_focus") : Promise.resolve();
