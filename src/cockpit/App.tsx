import { useEffect, useMemo, useRef, useState } from "react";
import * as api from "../core/api";
import { listenFor, onBoardStatus } from "../core/bus";
import { FrameClient } from "../core/frames";
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
  const store = useActions();
  const shellRef = useRef<HTMLDivElement>(null);
  const cameraFeeds = useMemo(() => new CameraFeeds(), []);

  /* --- the chosen look, applied to the document root --------------------- */
  useEffect(() => {
    document.documentElement.dataset.look = look;
  }, [look]);

  useEffect(() => {
    void api.settingsGet<{ look?: Look; followView?: boolean }>().then((settings) => {
      if (settings?.look) store.setLook(settings.look);
      if (settings?.followView === true) store.setFollowView(true);
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
    cameraFeeds.sync(doc, guestsRunning);
  }, [doc, guestsRunning, cameraFeeds]);

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
          const url = URL.createObjectURL(file);
          const probe = new Image();
          probe.onload = () =>
            store.addImage(url, probe.naturalWidth, probe.naturalHeight, "Pasted image");
          probe.src = url;
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
      const { convertFileSrc } = await import("@tauri-apps/api/core");
      for (const path of Array.isArray(selected) ? selected : [selected]) {
        addByExtension(store, convertFileSrc(path), path.split(/[\\/]/).pop() ?? "File");
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
          addByExtension(store, URL.createObjectURL(file), file.name);
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
              <Editor client={client} />
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
