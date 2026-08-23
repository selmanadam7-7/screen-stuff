import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "../core/api";
import { listenFor, onBoardStatus } from "../core/bus";
import { FrameClient } from "../core/frames";
import type { MediaPool } from "../core/media";
import { AutoFramer, targetFor, type AutoFrameMode } from "../core/autoframe";
import { cursorOnBoard, punchRect } from "../core/pointer";
import { SpeechGate, approach } from "../core/voice";
import { MicLevel } from "./mic";
import { isTyping } from "./Editor";
import type { Stroke } from "../core/types";
import { TooltipHost, cx } from "../ui/primitives";
import { CameraFeeds } from "./cameraFeeds";
import { Editor } from "./Editor";
import { addByExtension } from "./Panels";
import { RegionPicker, REGION_PICKED_EVENT } from "./RegionPicker";
import { AddScreens } from "./shell/AddScreens";
import { Minimap, OffStageHint, OnAirPill, SceneRail, ZoomControl } from "./shell/CanvasChrome";
import { Inspector } from "./shell/Inspector";
import { BoardsPage, MediaPage, SettingsPage } from "./shell/Pages";
import { ShareBoard } from "./shell/ShareBoard";
import { Sidebar } from "./shell/Sidebar";
import { InkBar, Toolbar } from "./shell/Toolbar";
import { TitleBar } from "./shell/TitleBar";
import { installGlobalHotkeys, installLocalHotkeys } from "./hotkeys";
import { useActions, useStore, type Look } from "./store";

type GuestEvent =
  | { t: "guest_joined"; guest: { id: number; name: string } }
  | { t: "guest_left"; id: number }
  | { t: "guest_view"; id: number; view: unknown }
  | { t: "guest_ink"; id: number; stroke: Stroke }
  | { t: "guest_file"; id: number; name: string; mime: string; data_url: string };

export function App() {
  const isRegionWindow = new URLSearchParams(window.location.search).get("window") === "region";
  if (isRegionWindow) return <RegionPicker />;
  return (
    <TooltipHost>
      <Cockpit />
    </TooltipHost>
  );
}

function Cockpit() {
  const [client, setClient] = useState<FrameClient | null>(null);
  const [screensOpen, setScreensOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const panel = useStore((s) => s.panel);
  const look = useStore((s) => s.look);
  const notice = useStore((s) => s.notice);
  const doc = useStore((s) => s.doc);
  const guestsRunning = useStore((s) => s.guests.running);
  const boardVisible = useStore((s) => s.boardVisible);
  const autoFrame = useStore((s) => s.autoFrame);
  const spotlightCursor = useStore((s) => s.spotlightCursor);
  const autoCamera = useStore((s) => s.autoCamera);
  const [punchKeyHeld, setPunchKeyHeld] = useState(false);
  const store = useActions();
  const shellRef = useRef<HTMLDivElement>(null);
  const cameraFeeds = useMemo(() => new CameraFeeds(), []);
  const handlePool = useCallback(
    (pool: MediaPool | null) => cameraFeeds.setPool(pool),
    [cameraFeeds],
  );

  /* --- the chosen look, applied to the document root --------------------- */
  useEffect(() => {
    document.documentElement.dataset.look = look;
  }, [look]);

  useEffect(() => {
    void api
      .settingsGet<{
        look?: Look;
        followView?: boolean;
        autoFrame?: AutoFrameMode;
        spotlightCursor?: boolean;
        autoCamera?: boolean;
      }>()
      .then((settings) => {
        if (settings?.look) store.setLook(settings.look);
        if (settings?.followView === true) store.setFollowView(true);
        if (settings?.spotlightCursor === true) store.setSpotlightCursor(true);
        if (settings?.autoCamera === true) store.setAutoCamera(true);
        if (settings?.autoFrame && settings.autoFrame !== "off") {
          store.setAutoFrame(settings.autoFrame);
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* --- the capture engine ------------------------------------------------ */
  useEffect(() => {
    let live: FrameClient | null = null;
    let cancelled = false;
    void api.sessionInfo().then((session) => {
      if (cancelled || !session.streamUrl) return;
      live = new FrameClient(session.streamUrl);
      setClient(live);
      void probeCameras(live);
    });
    return () => {
      cancelled = true;
      live?.destroy();
      live = null;
    };
  }, []);

  /* --- publish the camera while a guest link is open --------------------- */
  useEffect(() => {
    cameraFeeds.setClient(client);
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__screenStuffCameraFeeds = cameraFeeds;
    }
    return () => cameraFeeds.stopAll();
  }, [client, cameraFeeds]);

  useEffect(() => {
    // Publish whenever anything outside this window needs to see the camera:
    // a guest, or the board window. Exactly one process opens the device and
    // everyone else reads what it publishes, so nothing ever competes for the
    // hardware. The publisher is idle when nothing is watching.
    cameraFeeds.sync(doc, guestsRunning || boardVisible);
  }, [doc, guestsRunning, boardVisible, cameraFeeds]);

  /* --- the stage follows the work, when asked to ------------------------- */
  useEffect(() => {
    if (autoFrame === "off") return;
    const framer = new AutoFramer();
    let stopped = false;

    // Polled a few times a second rather than hooked. A focus hook in this
    // process would fire for every window on the machine; this needs one
    // answer, often enough to feel immediate and rarely enough to be free.
    const tick = async () => {
      if (stopped) return;
      const focus = await api.foregroundFocus();
      if (stopped) return;
      const state = useStore.getState();
      const target = targetFor(state.doc, focus, state.autoFrame, state.monitors);
      const move = framer.offer(target, state.doc.frame, performance.now());
      if (move) state.applyAutoFrame(move);
    };

    const timer = window.setInterval(() => void tick(), 300);
    void tick();
    return () => {
      stopped = true;
      window.clearInterval(timer);
      useStore.setState({ autoFrameOn: null });
    };
  }, [autoFrame]);

  /* --- where the pointer is, for the ring and the punch-in --------------- */
  useEffect(() => {
    if (!spotlightCursor && !punchKeyHeld) {
      useStore.getState().setPointerAt(null);
      return;
    }
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      const cursor = await api.cursorState();
      if (stopped) return;
      const state = useStore.getState();
      const at = cursorOnBoard(state.doc, cursor, state.monitors);
      state.setPointerAt(at && cursor ? { x: at.x, y: at.y, down: cursor.down } : null);
      if (punchKeyHeld && cursor) {
        const shot = punchRect(state.doc, cursor, state.monitors);
        if (shot && !state.punchedFrom) state.punchIn(shot);
        else if (shot && state.punchedFrom) state.setStage(shot, { force: true, history: false });
      }
    };
    // Fast enough that the ring keeps up with the hand, slow enough to be free.
    const timer = window.setInterval(() => void tick(), punchKeyHeld ? 60 : 120);
    void tick();
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [spotlightCursor, punchKeyHeld]);

  /* --- hold Z to punch in on the cursor ---------------------------------- */
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "z" || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTyping(e.target)) return;
      e.preventDefault();
      setPunchKeyHeld(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "z") return;
      setPunchKeyHeld(false);
      useStore.getState().punchOut();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  /* --- the camera grows while you are talking ---------------------------- */
  useEffect(() => {
    if (!autoCamera) return;
    const mic = new MicLevel();
    const gate = new SpeechGate();
    let emphasis = 0;
    let last = performance.now();
    let raf = 0;

    // The gate decides speaking or not; this eases the size toward it, so the
    // camera never snaps between two sizes on a syllable.
    const ease = () => {
      raf = requestAnimationFrame(ease);
      const now = performance.now();
      const dt = now - last;
      last = now;
      emphasis = approach(emphasis, gate.speaking ? 1 : 0, dt);
      useStore.getState().setCameraEmphasis(emphasis);
    };

    void mic.start((level) => gate.push(level, performance.now())).then(() => {
      if (mic.error) useStore.getState().setMicError(mic.error);
      else raf = requestAnimationFrame(ease);
    });

    return () => {
      cancelAnimationFrame(raf);
      mic.stop();
      useStore.getState().setCameraEmphasis(0);
    };
  }, [autoCamera]);

  /* --- keyboard, sources, boards, and what the other windows report ------ */
  useEffect(() => {
    const removeLocal = installLocalHotkeys();
    let removeGlobal: (() => void) | undefined;
    void installGlobalHotkeys().then((fn) => (removeGlobal = fn));

    void store.refreshSources();
    void store.refreshBoards();
    void store.refreshGuests();
    store.pushSnapshot();

    const unlisteners: Array<() => void> = [];
    void onBoardStatus((status) => store.setStatus(status)).then((un) => unlisteners.push(un));

    void listenFor<GuestEvent>("sd:guest-event", (event) => {
      switch (event.t) {
        case "guest_joined":
        case "guest_left":
        case "guest_view":
          void store.refreshGuests();
          break;
        case "guest_ink":
          store.applyGuestInk(event.stroke);
          break;
        case "guest_file":
          store.applyGuestFile(event.name, event.mime, event.data_url);
          break;
      }
    }).then((un) => unlisteners.push(un));

    void listenFor<{ source: string; title: string }>(REGION_PICKED_EVENT, ({ source, title }) => {
      // The picker only knows the rectangle; the cockpit turns it into a tile.
      useStore.setState((s) => ({
        sources: [
          ...s.sources,
          {
            id: source,
            kind: "region" as const,
            title,
            subtitle: "screen region",
            width: 0,
            height: 0,
            x: 0,
            y: 0,
            isPrimary: false,
          },
        ],
      }));
      store.addSources([source]);
      void api.cockpitFocus();
    }).then((un) => unlisteners.push(un));

    const openScreens = () => setScreensOpen(true);
    window.addEventListener("screen-stuff:add-screens", openScreens);

    return () => {
      removeLocal();
      removeGlobal?.();
      unlisteners.forEach((un) => un());
      window.removeEventListener("screen-stuff:add-screens", openScreens);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* --- paste a screenshot, a link or some text --------------------------- */
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (!file) continue;
          event.preventDefault();
          // Kept as a real file, so the board window and any guest can load it
          // too -- a blob URL only exists inside the window that made it.
          void api.mediaKeep(file).then((url) => {
            const probe = new Image();
            probe.onload = () =>
              store.addImage(url, probe.naturalWidth, probe.naturalHeight, "Pasted image");
            probe.src = url;
          });
          return;
        }
        if (item.type === "text/plain") {
          item.getAsString((text) => {
            const trimmed = text.trim();
            if (/^https?:\/\/\S+$/i.test(trimmed)) void store.addWeb(trimmed);
            else if (trimmed) store.addNote(trimmed);
          });
          return;
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addWeb = () => {
    const url = window.prompt("Address of the page to put on the board");
    if (url?.trim()) void store.addWeb(url.trim());
  };

  const addMedia = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ multiple: true });
      if (!selected) return;
      for (const path of Array.isArray(selected) ? selected : [selected]) {
        // Taken into the app's own directory, so the board window, a guest and
        // this board reopened next week all still find the file.
        const url = await api.mediaAdopt(path);
        addByExtension(store, url, path.split(/[\\/]/).pop() ?? "File");
      }
    } catch {
      store.toast("could not open the file picker", "warn");
    }
  };

  return (
    <div
      className={cx("app", dragOver && "is-drag-over")}
      ref={shellRef}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const source = e.dataTransfer.getData("application/x-screen-stuff-source");
        if (source) {
          store.addSources([source]);
          return;
        }
        for (const file of Array.from(e.dataTransfer.files)) {
          void api.mediaKeep(file).then((url) => addByExtension(store, url, file.name));
        }
      }}
    >
      <TitleBar
        onOpenShare={() => setShareOpen(true)}
        onOpenSearch={() => store.setPanel("media")}
      />

      <div className="app__body">
        <Sidebar onAddScreens={() => setScreensOpen(true)} />

        <main className="app__center">
          {panel === "board" ? (
            <>
              <Editor client={client} onPool={handlePool} />
              <div className="canvas-dock canvas-dock--top">
                <div className="canvas-dock__mid">
                  <Toolbar
                    onAddScreens={() => setScreensOpen(true)}
                    onInvite={() => setShareOpen(true)}
                    onAddMedia={() => void addMedia()}
                    onAddWeb={addWeb}
                  />
                  <InkBar />
                  <div className="canvas-hint">
                    <OffStageHint />
                  </div>
                </div>
                <div className="canvas-dock__side canvas-dock__side--end">
                  <OnAirPill onOpenScreens={() => setScreensOpen(true)} />
                </div>
              </div>
              <div className="canvas-dock canvas-dock--bottom">
                <div className="canvas-dock__side">
                  <Minimap />
                </div>
                <div className="canvas-dock__mid">
                  <SceneRail />
                </div>
                <div className="canvas-dock__side canvas-dock__side--end">
                  <ZoomControl onHelp={() => store.setPanel("settings")} />
                </div>
              </div>
            </>
          ) : panel === "boards" ? (
            <BoardsPage />
          ) : panel === "media" ? (
            <MediaPage />
          ) : (
            <SettingsPage />
          )}
        </main>

        <Inspector />
      </div>

      <AddScreens open={screensOpen} onClose={() => setScreensOpen(false)} client={client} />
      <ShareBoard open={shareOpen} onClose={() => setShareOpen(false)} />

      {notice && <div className={cx("toast", `is-${notice.tone}`)}>{notice.message}</div>}
      {dragOver && <div className="drop-hint">Drop it on the board</div>}
    </div>
  );
}

/**
 * Reports what cameras this webview can actually reach, into the app's log.
 *
 * WebView2 decides media permission per webview and a refusal is invisible from
 * outside — the tile just stays dark. One line at boot turns "the camera does
 * not work" into something diagnosable.
 */
async function probeCameras(client: FrameClient) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320 } });
    const label = stream.getVideoTracks()[0]?.label ?? "unnamed";
    stream.getTracks().forEach((track) => track.stop());
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
      (d) => d.kind === "videoinput",
    );
    client.log(
      `camera access granted — ${devices.length} camera(s): ${devices
        .map((d) => d.label || "unnamed")
        .join(", ")} (opened "${label}")`,
    );
  } catch (err) {
    const name = err instanceof Error ? err.name : "unknown";
    client.log(
      name === "NotReadableError"
        ? "camera access granted, but the camera is busy in another app"
        : `camera unavailable: ${name} — ${String(err).slice(0, 120)}`,
      name === "NotAllowedError" ? "error" : "warn",
    );
  }
}
