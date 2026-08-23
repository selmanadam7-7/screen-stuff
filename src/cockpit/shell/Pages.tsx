/**
 * The full-width pages: boards, media and settings.
 *
 * The references treat these as places you go rather than panels you open, so
 * they take over the middle column entirely and the canvas steps aside.
 */

import { useEffect, useMemo, useState } from "react";
import * as api from "../../core/api";
import {
  AddIcon,
  BoardIcon,
  ClockIcon,
  FileIcon,
  ImageIcon,
  NoteIcon,
  BackIcon,
  ScreenIcon,
  SearchIcon,
  TemplateIcon,
  TrashIcon,
  UploadIcon,
  VideoIcon,
  WebIcon,
  tileIcon,
} from "../../ui/icons";
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Group,
  IconButton,
  NumberField,
  SearchField,
  Select,
  Switch,
  Tabs,
  cx,
} from "../../ui/primitives";
import { ACTIONS } from "../../core/control";
import type { Tile } from "../../core/types";
import { LOOKS, useActions, useStore } from "../store";
import { addByExtension } from "../Panels";
import { tileName } from "./Sidebar";

/* ==========================================================================
   Boards
   ========================================================================== */

/**
 * The way back to the board.
 *
 * Every page gets one, in the same place, before the title. Without it the only
 * exit was a chevron in the sidebar that did not list the board at all, so
 * opening Settings was a one-way door.
 */
function BackToBoard() {
  const store = useActions();
  return (
    <button className="page__back" onClick={() => store.setPanel("board")}>
      <BackIcon size={14} aria-hidden />
      Board
    </button>
  );
}


export function BoardsPage() {
  const boards = useStore((s) => s.boards);
  const boardId = useStore((s) => s.boardId);
  const store = useActions();
  const [query, setQuery] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);

  useEffect(() => {
    void store.refreshBoards();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = boards.filter(
    (b) => !query || b.name.toLowerCase().includes(query.toLowerCase()),
  );
  const templates = filtered.filter((b) => b.kind === "template");
  const saved = filtered.filter((b) => b.kind === "board");

  return (
    <div className="page">
      <header className="page__head">
        <div>
          <BackToBoard />
          <h1 className="page__title">Boards</h1>
          <p className="page__sub">Everything you have saved, and the layouts you start from.</p>
        </div>
        <div className="page__actions">
          <SearchField value={query} onChange={setQuery} placeholder="Search boards" />
          <Button tone="primary" icon={AddIcon} onClick={() => store.newBoard()}>
            New board
          </Button>
        </div>
      </header>

      <div className="page__body">
        {templates.length > 0 && (
          <>
            <h2 className="page__section">
              <TemplateIcon size={14} aria-hidden /> Templates
            </h2>
            <div className="board-grid">
              {templates.map((board) => (
                <button
                  className="board-card board-card--template"
                  key={board.id}
                  onClick={() => void store.loadBoard(board.id)}
                >
                  <span className="board-card__shot board-card__shot--template">
                    <TemplateIcon size={22} aria-hidden />
                  </span>
                  <span className="board-card__name">{board.name}</span>
                  <span className="board-card__meta">Start a new board from this</span>
                </button>
              ))}
            </div>
          </>
        )}

        <h2 className="page__section">
          <BoardIcon size={14} aria-hidden /> Saved
        </h2>
        {saved.length === 0 ? (
          <EmptyState
            icon={BoardIcon}
            title="Nothing saved yet"
            hint="Arrange a board, then save it. It will be here next time, exactly as you left it."
            action={
              <Button tone="primary" onClick={() => void store.saveBoard()}>
                Save this board
              </Button>
            }
          />
        ) : (
          <div className="board-grid">
            {saved.map((board) => (
              <div
                className={cx("board-card", board.id === boardId && "is-current")}
                key={board.id}
              >
                <button className="board-card__open" onClick={() => void store.loadBoard(board.id)}>
                  <span className="board-card__shot">
                    <BoardIcon size={20} aria-hidden />
                  </span>
                  <span className="board-card__name">
                    {board.name}
                    {board.id === boardId && <Badge tone="accent">Open</Badge>}
                  </span>
                  <span className="board-card__meta">
                    <ClockIcon size={12} aria-hidden /> {relativeTime(board.updated_at)}
                  </span>
                </button>
                {confirming === board.id ? (
                  <button
                    className="board-card__delete is-confirm"
                    onClick={() => {
                      void store.deleteBoard(board.id);
                      setConfirming(null);
                    }}
                    onMouseLeave={() => setConfirming(null)}
                  >
                    Sure?
                  </button>
                ) : (
                  <IconButton
                    icon={TrashIcon}
                    label={`Delete ${board.name}`}
                    tone="danger"
                    className="board-card__delete"
                    onClick={() => setConfirming(board.id)}
                  />
                )}
              </div>
            ))}
          </div>
        )}

        <div className="page__foot">
          <Button onClick={() => void store.saveBoard()}>Save this board</Button>
          <Button
            onClick={() =>
              void store.saveBoard({
                name: `${useStore.getState().doc.name} template`,
                kind: "template",
                as: true,
              })
            }
          >
            Save as a template
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ==========================================================================
   Media
   ========================================================================== */

const MEDIA_TABS = [
  { value: "all", label: "All" },
  { value: "screens", label: "Screens" },
  { value: "images", label: "Images" },
  { value: "videos", label: "Videos" },
  { value: "files", label: "Files" },
  { value: "notes", label: "Notes" },
] as const;
type MediaTab = (typeof MEDIA_TABS)[number]["value"];

const TAB_KINDS: Record<MediaTab, Tile["kind"][]> = {
  all: ["source", "camera", "image", "video", "pdf", "note", "web"],
  screens: ["source", "camera", "web"],
  images: ["image"],
  videos: ["video"],
  files: ["pdf"],
  notes: ["note"],
};

export function MediaPage() {
  const doc = useStore((s) => s.doc);
  const selection = useStore((s) => s.selection);
  const store = useActions();
  const [tab, setTab] = useState<MediaTab>("all");
  const [query, setQuery] = useState("");
  const [dragOver, setDragOver] = useState(false);

  const items = useMemo(() => {
    const kinds = TAB_KINDS[tab];
    const needle = query.trim().toLowerCase();
    return doc.tiles
      .filter((t) => kinds.includes(t.kind))
      .filter((t) => !needle || tileName(t).toLowerCase().includes(needle))
      .sort((a, b) => b.z - a.z);
  }, [doc.tiles, tab, query]);

  return (
    <div className="page">
      <header className="page__head">
        <div>
          <BackToBoard />
          <h1 className="page__title">Media</h1>
          <p className="page__sub">Everything on this board, and anything you want to add.</p>
        </div>
        <div className="page__actions">
          <SearchField value={query} onChange={setQuery} placeholder="Search this board" />
          <Button tone="primary" icon={UploadIcon} onClick={() => void pickFiles(store)}>
            Import
          </Button>
        </div>
      </header>

      <div className="page__body">
        <Tabs value={tab} onChange={setTab} tabs={MEDIA_TABS.map((t) => ({ ...t }))} />

        <div
          className={cx("dropzone", dragOver && "is-over")}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            for (const file of Array.from(e.dataTransfer.files)) {
              void api.mediaKeep(file).then((url) => addByExtension(store, url, file.name));
            }
          }}
        >
          <UploadIcon size={22} aria-hidden />
          <p className="dropzone__title">Drag and drop files here</p>
          <p className="dropzone__hint">Images, videos and PDFs. Or paste a screenshot anywhere.</p>
          <Button onClick={() => void pickFiles(store)}>Choose files</Button>
        </div>

        {items.length === 0 ? (
          <EmptyState
            icon={ImageIcon}
            title={query ? "Nothing matches that" : "Nothing here yet"}
            hint={query ? undefined : "Add a screen, drop a file, or paste a screenshot."}
          />
        ) : (
          <div className="media-grid">
            {items.map((tile) => {
              const TileIcon = tileIcon(tile.kind);
              return (
                <button
                  key={tile.id}
                  className={cx("media-card", selection.includes(tile.id) && "is-picked")}
                  onClick={() => {
                    store.select([tile.id]);
                    store.setPanel("board");
                  }}
                  onDoubleClick={() => {
                    store.setPanel("board");
                    store.toggleSpotlight(tile.id);
                  }}
                >
                  <span className="media-card__shot">
                    <TileIcon size={20} aria-hidden />
                  </span>
                  <span className="media-card__name">{tileName(tile)}</span>
                  <span className="media-card__meta">
                    <Badge tone="neutral">{kindWord(tile.kind)}</Badge>
                    <span className="numeric">
                      {Math.round(tile.w)}×{Math.round(tile.h)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <p className="page__count numeric">
          {items.length} {items.length === 1 ? "item" : "items"}
        </p>
      </div>
    </div>
  );
}

async function pickFiles(store: ReturnType<typeof useActions>) {
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      multiple: true,
      filters: [
        {
          name: "Anything Screen Stuff can show",
          extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "mp4", "webm", "mov", "mkv", "pdf"],
        },
      ],
    });
    if (!selected) return;
    for (const path of Array.isArray(selected) ? selected : [selected]) {
      const url = await api.mediaAdopt(path);
      addByExtension(store, url, path.split(/[\\/]/).pop() ?? "File");
    }
  } catch (err) {
    store.toast(`could not open that file: ${err}`, "warn");
  }
}

/* ==========================================================================
   Settings
   ========================================================================== */

/**
 * Turning the control API on, and the one line that proves it works.
 *
 * The example is a real request against this machine's own port and token, so
 * the first thing anyone does with the API is watch it work rather than read
 * about it. It moves the stage to a preset, which is visible from across a room
 * and undoes itself with one click of Show me the stage.
 */
function ControlSettings() {
  const [status, setStatus] = useState<api.ControlStatus | null>(null);
  const [port, setPort] = useState(4488);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void (async () => {
      const [live, saved] = await Promise.all([
        api.controlStatus(),
        api.settingsGet<{ controlPort?: number }>(),
      ]);
      setStatus(live);
      setPort(live.running ? live.port : (saved.controlPort ?? 4488));
    })();
  }, []);

  /** Both halves of the switch, so the button can never lie about the state. */
  const set = async (on: boolean) => {
    setBusy(true);
    setProblem(null);
    try {
      const saved = await api.settingsGet<Record<string, unknown>>();
      if (!on) {
        setStatus(await api.controlStop());
        // Remembered, so it does not come back by itself after a restart.
        await api.settingsSet({ ...saved, controlOn: false });
      } else {
        // The token is kept rather than regenerated: a script written once
        // should still work next week, and it cannot if this changes nightly.
        const token = (saved.controlToken as string) || (await api.controlNewToken());
        const next = await api.controlStart(port, token);
        await api.settingsSet({
          ...saved,
          controlOn: true,
          controlToken: token,
          controlPort: next.port,
        });
        setStatus(next);
      }
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const roll = async () => {
    const token = await api.controlNewToken();
    const saved = await api.settingsGet<Record<string, unknown>>();
    await api.settingsSet({ ...saved, controlToken: token });
    if (status?.running) setStatus(await api.controlStart(port, token));
    else setStatus({ running: false, port, token, url: "" });
  };

  const example = status?.running
    ? `curl -X POST "${status.url}/stage?token=${status.token}" -H "content-type: application/json" -d "{\"preset\":\"everything\"}"`
    : "";

  return (
    <Group title="Other software on this machine">
      <p className="settings__note">
        Lets a Stream Deck, a script or anything else on this computer do what
        you can do — cut to a scene, raise a card, grab the shot. It listens on
        this machine only: the guest link and the tunnel have no route into it,
        so turning this on does not put a control surface on the internet.
      </p>
      <Switch
        label="Let other software drive Screen Stuff"
        hint={`${Object.keys(ACTIONS).length - 1} actions, over plain HTTP on this machine.`}
        checked={status?.running ?? false}
        disabled={busy}
        onChange={(on) => void set(on)}
      />

      {status?.running ? (
        <>
          <Field label="Address" inline>
            <span className="readout numeric">{status.url}</span>
          </Field>
          <Field label="Token">
            <span className="readout numeric">{status.token}</span>
          </Field>
          <p className="settings__note">
            Try it — this moves the stage around everything on the board:
          </p>
          <pre className="settings__code">{example}</pre>
          <div className="btn-row">
            <Button
              block
              onClick={async () => {
                await navigator.clipboard.writeText(example);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1600);
              }}
            >
              {copied ? "Copied" : "Copy that line"}
            </Button>
            <Button block onClick={() => void roll()}>
              New token
            </Button>
          </div>
          <p className="settings__note">
            <code>GET {status.url}/</code> lists every action and what it takes.
            Anything the token reaches can move what your audience sees, so treat
            it the way you would a password.
          </p>
        </>
      ) : (
        <Field label="Port" inline>
          <NumberField value={port} min={1024} max={65535} onCommit={setPort} disabled={busy} />
        </Field>
      )}
      {problem ? <p className="settings__problem">{problem}</p> : null}
    </Group>
  );
}

export function SettingsPage() {
  const doc = useStore((s) => s.doc);
  const look = useStore((s) => s.look);
  const followView = useStore((s) => s.followView);
  const replayOn = useStore((s) => s.replayOn);
  const store = useActions();
  const [info, setInfo] = useState<{ version: string; dataDir: string } | null>(null);

  useEffect(() => {
    void api.sessionInfo().then((s) => setInfo({ version: s.version, dataDir: s.dataDir }));
  }, []);

  return (
    <div className="page">
      <header className="page__head">
        <div>
          <BackToBoard />
          <h1 className="page__title">Settings</h1>
          <p className="page__sub">How Screen Stuff looks and how it captures.</p>
        </div>
      </header>

      <div className="page__body page__body--narrow">
        <Group title="Look">
          <div className="look-grid">
            {LOOKS.map((entry) => (
              <button
                key={entry.value}
                className={cx("look-card", look === entry.value && "is-active")}
                onClick={() => store.setLook(entry.value)}
              >
                <span className={cx("look-card__swatch", `look-swatch--${entry.value}`)} aria-hidden>
                  <i />
                  <i />
                  <i />
                </span>
                <span className="look-card__name">{entry.label}</span>
                <span className="look-card__hint">{entry.hint}</span>
              </button>
            ))}
          </div>
        </Group>

        <Group title="The stage">
          <p className="settings__note">
            The stage is the rectangle everyone else sees. The rest of the board
            is yours: pan and zoom around it during a call and nobody follows.
          </p>
          <Switch
            label="Drag the audience with my view"
            hint="On, whatever you look at is what they see, and there is no private area."
            checked={followView}
            onChange={(on) => store.setFollowView(on)}
          />
          <Switch
            label="Lock the stage against dragging"
            hint="Stops a stray drag moving the shot mid-call. Saved with the board."
            checked={doc.stageLocked}
            onChange={(on) => store.setStageLocked(on)}
          />
          <div className="btn-row">
            <Button block onClick={() => store.showStage()}>
              Show me the stage
            </Button>
            <Button block onClick={() => store.bringThem()}>
              Move it to my view
            </Button>
          </div>
        </Group>

        <Group title="Going back">
          <p className="settings__note">
            Keeps the last 45 seconds of the shot so you can show something
            again. In memory only — nothing is written to disk, the oldest
            second falls off the end continuously, and it ends when the app
            does. That is a different thing from recording a session.
          </p>
          <Switch
            label="Remember the last 45 seconds"
            hint="About 15 MB of memory. Never leaves this machine."
            checked={replayOn}
            onChange={(on) => store.setReplayOn(on)}
          />
        </Group>

        <Group title="Capture defaults">
          <Field label="Frame rate" inline>
            <Select
              size="sm"
              value={String(doc.fps)}
              onChange={(v) => store.setBoardProp({ fps: Number(v) })}
              options={[10, 15, 24, 30, 60].map((n) => ({ value: String(n), label: `${n} fps` }))}
            />
          </Field>
          <Field label="Quality" inline>
            <Select
              size="sm"
              value={String(doc.quality)}
              onChange={(v) => store.setBoardProp({ quality: Number(v) })}
              options={[
                { value: "70", label: "Draft — smallest" },
                { value: "85", label: "Standard" },
                { value: "95", label: "High — crispest text" },
              ]}
            />
          </Field>
          <Switch
            label="Show the grid in the cockpit"
            hint="Never appears on air"
            checked={doc.showGrid}
            onChange={(showGrid) => store.setBoardProp({ showGrid })}
          />
        </Group>

        <ControlSettings />

        <Group title="Keyboard">
          <dl className="keys">
            {SHORTCUTS.map(([keys, what]) => (
              <div key={keys}>
                <dt>
                  {keys.split(" ").map((k) => (
                    <kbd key={k}>{k}</kbd>
                  ))}
                </dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
        </Group>

        <Group title="This install">
          <Field label="Version" inline>
            <span className="readout numeric">{info?.version ?? "—"}</span>
          </Field>
          <Field label="Boards live in">
            <span className="readout">{info?.dataDir ?? "—"}</span>
          </Field>
          <Button
            icon={FileIcon}
            onClick={async () => {
              if (!info) return;
              try {
                const { openPath } = await import("@tauri-apps/plugin-opener");
                await openPath(info.dataDir);
              } catch {
                /* the path is on screen either way */
              }
            }}
          >
            Open the boards folder
          </Button>
        </Group>
      </div>
    </div>
  );
}

const SHORTCUTS: Array<[string, string]> = [
  ["0", "show the stage"],
  ["Shift+0", "fit everything in your view"],
  ["Ctrl+←", "back to the last view"],
  ["Ctrl+→", "forward again"],
  ["1 – 9", "jump to that scene"],
  ["Enter", "move the stage to your view"],
  ["Z (hold)", "punch in on your cursor"],
  ["G", "go private / come back"],
  ["F", "grab the window in front"],
  ["S", "add screens"],
  ["N", "add a note"],
  ["P H A B O", "pen, highlighter, arrow, box, ellipse"],
  ["Esc", "back to the pointer"],
  ["Space +drag", "pan the canvas"],
  ["← ↑ → ↓", "nudge the selection, or the stage"],
  ["Ctrl+D", "duplicate"],
  ["Ctrl+L", "lock"],
  ["Ctrl+Z", "undo"],
  ["Ctrl+S", "save the stage as a scene"],
  ["Ctrl+Shift+S", "save the board"],
  ["Del", "remove selected"],
  ["Alt +drag", "move the board window"],
  ["Ctrl+Alt+B", "show or hide the board, from anywhere"],
  ["Ctrl+Alt+G", "go private, from anywhere"],
  ["Ctrl+Alt+Enter", "move the stage to your view, from anywhere"],
  ["Ctrl+Alt+0", "show the stage, from anywhere"],
  ["Ctrl+Alt+F", "grab the front window, from anywhere"],
];

function kindWord(kind: Tile["kind"]): string {
  switch (kind) {
    case "source":
      return "Screen";
    case "camera":
      return "Camera";
    case "image":
      return "Image";
    case "video":
      return "Video";
    case "pdf":
      return "PDF";
    case "note":
      return "Note";
    case "web":
      return "Page";
  }
}

function relativeTime(seconds: number): string {
  if (!seconds) return "never saved";
  const delta = Date.now() / 1000 - seconds;
  if (delta < 60) return "just now";
  if (delta < 3600) return `${Math.floor(delta / 60)} min ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)} h ago`;
  return `${Math.floor(delta / 86400)} d ago`;
}

export { ScreenIcon, VideoIcon, NoteIcon, WebIcon, SearchIcon };
