/**
 * What floats over the canvas: the scene rail, the zoom control and the minimap.
 *
 * All of it is positioned over the board rather than docked beside it, which is
 * how the references keep the canvas as wide as the window.
 */

import { useEffect, useRef, useState } from "react";
import { contentBounds } from "../../core/doc";
import { boundingRect, fitAspect } from "../../core/geometry";
import { LAYOUTS, layoutsFor } from "../../core/layouts";
import { CARD_PRESETS } from "../../core/overlays";
import { agoLabel } from "../../core/replay";
import type { ReplayCapture } from "../replayCapture";
import { homeView } from "../../core/stage";
import {
  AddIcon,
  BackIcon,
  CameraIcon,
  CardIcon,
  LayoutIcon,
  PreviewIcon,
  ReplayIcon,
  ExpandIcon,
  FollowIcon,
  ForwardIcon,
  HelpIcon,
  HomeIcon,
  PointerIcon,
  RemoveIcon,
  ScreenIcon,
  StageIcon,
  WindowIcon,
} from "../../ui/icons";
import { Button, IconButton, Menu, cx, useTooltip, type MenuEntry } from "../../ui/primitives";
import { useActions, useStore } from "../store";

/* ==========================================================================
   Zoom
   ========================================================================== */

export function ZoomControl({ onHelp }: { onHelp: () => void }) {
  const view = useStore((s) => s.view);
  const doc = useStore((s) => s.doc);
  const canGoBack = useStore((s) => s.canGoBack);
  const canGoForward = useStore((s) => s.canGoForward);
  const store = useActions();

  // 100% is "the stage exactly fills the view".
  const percent = Math.round((doc.frame.w / Math.max(1, view.w)) * 100);

  return (
    <div className="zoom">
      {/* Back before anything else: every jump from here is reversible, and the
          control that undoes them should be the one nearest the ones that make
          them. */}
      <IconButton
        icon={BackIcon}
        label="Back to the last view — Ctrl+←"
        disabled={!canGoBack}
        onClick={() => store.viewBack()}
      />
      <IconButton
        icon={ForwardIcon}
        label="Forward — Ctrl+→"
        disabled={!canGoForward}
        onClick={() => store.viewForward()}
      />
      <span className="zoom__rule" />
      <IconButton icon={RemoveIcon} label="Zoom out" onClick={() => store.zoom(1 / 1.25)} />
      <button
        className="zoom__value numeric"
        onClick={() => store.showStage()}
        title="Show the stage — 0"
      >
        {percent}%
      </button>
      <IconButton icon={AddIcon} label="Zoom in" onClick={() => store.zoom(1.25)} />
      <span className="zoom__rule" />
      <IconButton icon={HomeIcon} label="Show the stage — 0" onClick={() => store.showStage()} />
      <IconButton
        icon={ExpandIcon}
        label="Fit everything in view — Shift+0"
        onClick={() => store.fitEverything()}
      />
      <IconButton icon={HelpIcon} label="Keyboard shortcuts" onClick={onHelp} />
    </div>
  );
}

/* ==========================================================================
   Off-stage hint
   ========================================================================== */

/**
 * The answer to "why does the board window not show what I am looking at?".
 *
 * Panning away from the stage is the normal, intended way to work — but the
 * first time it happens it looks like a bug, so the app says what is going on
 * and offers the way back in the same breath.
 */
export function OffStageHint() {
  const viewAway = useStore((s) => s.viewAway);
  const followView = useStore((s) => s.followView);
  const store = useActions();

  if (!viewAway || followView) return null;

  return (
    <div className="offstage">
      <StageIcon size={14} aria-hidden />
      <span>You are off the stage. They still see it.</span>
      <button className="linkish" onClick={() => store.showStage()}>
        Show the stage
      </button>
      <button className="linkish" onClick={() => store.bringThem()}>
        Bring it here
      </button>
    </div>
  );
}

/* ==========================================================================
   Scenes
   ========================================================================== */

export function SceneRail() {
  const scenes = useStore((s) => s.doc.scenes);
  const isPrivate = useStore((s) => s.isPrivate);
  const spotlight = useStore((s) => s.spotlight);
  const store = useActions();

  return (
    <div className="scene-rail">
      {scenes.map((scene) => (
        <SceneChip key={scene.id} id={scene.id} name={scene.name} hotkey={scene.hotkey} />
      ))}
      <button
        className="scene-chip scene-chip--add"
        onClick={() => store.saveScene()}
        title="Remember where the stage is right now — Ctrl+S"
      >
        <AddIcon size={13} aria-hidden />
        Save this stage
      </button>

      <span className="scene-rail__rule" />

      <DirectorMenu />

      <CardChip />

      <PreviewChips />

      {spotlight && (
        <button className="scene-chip is-active" onClick={() => store.setSpotlight(null)}>
          Leave spotlight
        </button>
      )}
      <button
        className={cx("scene-chip", isPrivate && "is-private")}
        onClick={() => store.setPrivate(!isPrivate)}
        title="Detach the audience from your view — G"
      >
        {isPrivate ? "Private" : "Go private"}
      </button>
      <Button size="sm" tone="primary" onClick={() => store.bringThem()}>
        Bring them here
      </Button>
    </div>
  );
}

function SceneChip({ id, name, hotkey }: { id: string; name: string; hotkey: string }) {
  const store = useActions();
  const [editing, setEditing] = useState(false);
  const tip = useTooltip(hotkey ? `Scene ${hotkey}` : name);

  return (
    <span className="scene-chip-wrap">
      <button className="scene-chip" onClick={() => store.applyScene(id)} {...tip}>
        {hotkey && <kbd>{hotkey}</kbd>}
        {editing ? (
          <input
            autoFocus
            defaultValue={name}
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => {
              store.updateScene(id, { name: e.target.value });
              setEditing(false);
            }}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
        ) : (
          <span onDoubleClick={() => setEditing(true)}>{name}</span>
        )}
      </button>
      <button
        className="scene-chip__x"
        aria-label={`Remove ${name}`}
        onClick={() => store.removeScene(id)}
      >
        ×
      </button>
    </span>
  );
}

/**
 * Everything you decide once, in one place.
 *
 * Following the work, showing the pointer and arranging tiles are all things
 * you set before a call or change rarely. As separate chips they pushed the
 * rail to three rows, which is the state where nothing on it is quick to find.
 * The chips that remain are the ones you reach for mid-sentence.
 */
function DirectorMenu() {
  const mode = useStore((s) => s.autoFrame);
  const holding = useStore((s) => s.autoFrameOn);
  const pointer = useStore((s) => s.spotlightCursor);
  const hasCamera = useStore((s) => s.doc.tiles.some((t) => t.kind === "camera"));
  const cameraPinned = useStore((s) =>
    s.doc.tiles.some((t) => t.kind === "camera" && !!t.pin),
  );
  const count = useStore((s) => s.doc.tiles.filter((t) => !t.hidden).length);
  const selected = useStore((s) => s.selection.length);
  const store = useActions();
  const [open, setOpen] = useState<{ x: number; y: number } | null>(null);

  const active = mode !== "off" || pointer;
  const summary =
    mode === "monitor"
      ? `Following screens${holding ? ` — ${holding}` : ""}`
      : mode === "window"
        ? `Following windows${holding ? ` — ${holding}` : ""}`
        : pointer
          ? "Pointer shown"
          : "Director";

  const usable = layoutsFor(selected || count);
  const layoutEntries: MenuEntry[] =
    count > 0
      ? [
          { separator: true },
          ...LAYOUTS.filter((l) => usable.includes(l.kind)).map((l) => ({
            label: l.label,
            icon: LayoutIcon,
            shortcut: l.hint,
            onSelect: () => store.applyLayout(l.kind),
          })),
        ]
      : [];

  return (
    <span className="scene-chip-wrap">
      <button
        className={cx("scene-chip", active && "is-active")}
        title="How the shot behaves: following your work, showing your pointer, arranging tiles"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setOpen(open ? null : { x: r.left, y: r.top - 8 });
        }}
      >
        <FollowIcon size={13} aria-hidden />
        {summary}
      </button>
      {open && (
        <Menu
          x={open.x}
          y={open.y}
          onClose={() => setOpen(null)}
          entries={[
            {
              label: "Follow the screen I work on",
              icon: ScreenIcon,
              checked: mode === "monitor",
              onSelect: () => store.setAutoFrame(mode === "monitor" ? "off" : "monitor"),
            },
            {
              label: "Follow the window I work in",
              icon: WindowIcon,
              checked: mode === "window",
              onSelect: () => store.setAutoFrame(mode === "window" ? "off" : "window"),
            },
            // Directly under the two following options, because this is the
            // thing that makes them wearable: without it, following the work to
            // another screen leaves your face behind on the one you left.
            {
              label: "Keep my camera in the corner",
              icon: CameraIcon,
              shortcut: cameraPinned ? "on" : undefined,
              checked: cameraPinned,
              disabled: !hasCamera,
              onSelect: () => store.toggleCameraPin(),
            },
            { separator: true },
            {
              label: "Show the audience my pointer",
              icon: PointerIcon,
              shortcut: "hold Z to punch in",
              checked: pointer,
              onSelect: () => store.setSpotlightCursor(!pointer),
            },
            ...layoutEntries,
          ]}
        />
      )}
    </span>
  );
}



/**
 * What the audience sees instead of your screens.
 *
 * On the rail because you reach for it at exactly the moment you need to stop
 * showing your desktop, and hunting through a settings page is the one thing
 * you cannot do then.
 */
function CardChip() {
  const card = useStore((s) => s.doc.card);
  const store = useActions();
  const [open, setOpen] = useState<{ x: number; y: number } | null>(null);

  if (card) {
    return (
      <button
        className="scene-chip is-card"
        onClick={() => store.showCard(null)}
        title="Take the card down and go back to the board"
      >
        <CardIcon size={13} aria-hidden />
        {card.title} — take it down
      </button>
    );
  }

  return (
    <span className="scene-chip-wrap">
      <button
        className="scene-chip"
        title="Cover the shot with a card"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setOpen(open ? null : { x: r.left, y: r.top - 8 });
        }}
      >
        <CardIcon size={13} aria-hidden />
        Hold the shot
      </button>
      {open && (
        <Menu
          x={open.x}
          y={open.y}
          onClose={() => setOpen(null)}
          entries={CARD_PRESETS.map((preset) => ({
            label: preset.minutes ? `${preset.title} (${preset.minutes} min)` : preset.title,
            onSelect: () => store.raisePreset(preset.key),
          }))}
        />
      )}
    </span>
  );
}

/**
 * The next shot, and the button that puts it on air.
 *
 * The broadcast idiom, and the thing the private board was always for: arrange
 * the shot nobody can see yet, then cut to it in one press. Taking swaps them,
 * so cutting back and forth between two shots is one key rather than a rebuild.
 */
function PreviewChips() {
  const preview = useStore((s) => s.preview);
  const store = useActions();

  if (!preview) {
    return (
      <button
        className="scene-chip"
        onClick={() => store.openPreview()}
        title="Arrange the next shot without anyone seeing it"
      >
        <PreviewIcon size={13} aria-hidden />
        Set up next
      </button>
    );
  }

  return (
    <span className="preview-chips">
      <button
        className="scene-chip is-preview"
        onClick={() => store.closePreview()}
        title="Throw the next shot away"
      >
        <PreviewIcon size={13} aria-hidden />
        Next shot
      </button>
      <Button size="sm" tone="take" onClick={() => store.take()} title="Put it on air — T">
        Take
      </Button>
    </span>
  );
}


/**
 * Going back to what was on the shot a moment ago.
 *
 * Appears only once there is something to go back to. Scrubbing shows the
 * remembered frame to the audience as well — the whole point is "let me show
 * you that again", so a private rewind would be the wrong feature.
 */
export function ReplayBar({ capture }: { capture: ReplayCapture }) {
  const on = useStore((s) => s.replayOn);
  const frame = useStore((s) => s.replayFrame);
  const index = useStore((s) => s.replayIndex);
  const store = useActions();
  const [count, setCount] = useState(0);

  // The buffer is not React state — it changes four times a second and nothing
  // should re-render for that. Polled for its length, which is all the UI needs.
  useEffect(() => {
    if (!on) return;
    const timer = window.setInterval(() => setCount(capture.buffer.length), 500);
    return () => window.clearInterval(timer);
  }, [on, capture]);

  if (!on || count < 2) return null;

  const show = (i: number) => {
    const clamped = Math.max(0, Math.min(capture.buffer.length - 1, i));
    const at = capture.buffer.at(clamped);
    store.showReplayFrame(at?.image ?? null, clamped, capture.buffer.length);
  };

  if (!frame) {
    return (
      <div className="replay">
        <button className="scene-chip" onClick={() => show(capture.buffer.length - 1)}>
          <ReplayIcon size={13} aria-hidden />
          Go back {Math.round(capture.buffer.seconds(Date.now()))}s
        </button>
      </div>
    );
  }

  const current = capture.buffer.at(index);
  return (
    <div className="replay is-open">
      <IconButton icon={BackIcon} label="Back a frame" onClick={() => show(index - 1)} />
      <input
        className="replay__scrub"
        type="range"
        min={0}
        max={Math.max(0, capture.buffer.length - 1)}
        value={index}
        onChange={(e) => show(Number(e.target.value))}
        aria-label="Scrub the replay"
      />
      <IconButton icon={ForwardIcon} label="Forward a frame" onClick={() => show(index + 1)} />
      <span className="replay__at numeric">
        {current ? agoLabel(current, Date.now()) : ""}
      </span>
      <Button size="sm" tone="primary" onClick={() => store.showReplayFrame(null, 0, 0)}>
        Back to live
      </Button>
    </div>
  );
}

/* ==========================================================================
   Minimap
   ========================================================================== */

export function Minimap() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const doc = useStore((s) => s.doc);
  const frame = useStore((s) => s.frame);
  const view = useStore((s) => s.view);
  const store = useActions();
  const [collapsed, setCollapsed] = useState(false);

  const world = () => {
    const bounds =
      boundingRect([contentBounds(doc), frame, view]) ?? { x: 0, y: 0, w: 1920, h: 1080 };
    return {
      x: bounds.x - bounds.w * 0.08,
      y: bounds.y - bounds.h * 0.08,
      w: bounds.w * 1.16,
      h: bounds.h * 1.16,
    };
  };

  useEffect(() => {
    if (collapsed) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);

    const padded = world();
    const scale = Math.min(canvas.width / padded.w, canvas.height / padded.h);
    const ox = (canvas.width - padded.w * scale) / 2 - padded.x * scale;
    const oy = (canvas.height - padded.h * scale) / 2 - padded.y * scale;
    const styles = getComputedStyle(document.documentElement);
    const tone = (name: string) => styles.getPropertyValue(name).trim();

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const tile of [...doc.tiles].sort((a, b) => a.z - b.z)) {
      if (tile.hidden) continue;
      // Theme tokens, not ramp values: --n-200 is light in every look and turns
      // the minimap into a glowing block on a dark canvas.
      ctx.fillStyle = tile.kind === "note" ? tone("--note") : tone("--panel-hover");
      ctx.fillRect(tile.x * scale + ox, tile.y * scale + oy, tile.w * scale, tile.h * scale);
    }

    ctx.strokeStyle = tone("--ink-3");
    ctx.setLineDash([3 * dpr, 3 * dpr]);
    ctx.lineWidth = dpr;
    ctx.strokeRect(view.x * scale + ox, view.y * scale + oy, view.w * scale, view.h * scale);
    ctx.setLineDash([]);

    ctx.strokeStyle = tone("--accent");
    ctx.lineWidth = 2 * dpr;
    ctx.strokeRect(frame.x * scale + ox, frame.y * scale + oy, frame.w * scale, frame.h * scale);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, frame, view, collapsed]);

  return (
    <div className={cx("minimap", collapsed && "is-collapsed")}>
      <header className="minimap__head">
        <span className="eyebrow">Overview</span>
        <button className="linkish" onClick={() => setCollapsed((c) => !c)}>
          {collapsed ? "show" : "hide"}
        </button>
      </header>
      {!collapsed && (
        <canvas
          ref={canvasRef}
          onClick={(event) => {
            const canvas = canvasRef.current!;
            const rect = canvas.getBoundingClientRect();
            const padded = world();
            const scale = Math.min(rect.width / padded.w, rect.height / padded.h);
            const ox = (rect.width - padded.w * scale) / 2 - padded.x * scale;
            const oy = (rect.height - padded.h * scale) / 2 - padded.y * scale;
            const bx = (event.clientX - rect.left - ox) / scale;
            const by = (event.clientY - rect.top - oy) / scale;
            const next = fitAspect(
              { x: bx - frame.w / 2, y: by - frame.h / 2, w: frame.w, h: frame.h },
              doc.aspect,
            );
            store.jumpView(homeView(next, doc.aspect));
            store.setStage(next, { force: true });
          }}
        />
      )}
    </div>
  );
}

/* ==========================================================================
   On-air pill
   ========================================================================== */

export function OnAirPill({ onOpenScreens }: { onOpenScreens: () => void }) {
  const boardVisible = useStore((s) => s.boardVisible);
  const status = useStore((s) => s.status);
  const tiles = useStore((s) => s.doc.tiles.length);
  const store = useActions();

  if (tiles === 0) {
    return (
      <div className="onair onair--empty">
        <ScreenIcon size={15} aria-hidden />
        <span>Nothing on the board yet</span>
        <Button size="sm" tone="primary" onClick={onOpenScreens}>
          Add screens
        </Button>
      </div>
    );
  }

  return (
    <div className={cx("onair", boardVisible && "is-live")}>
      <span className="onair__dot" />
      <span className="onair__text">{boardVisible ? "On air" : "Off air"}</span>
      {status && boardVisible && (
        <span className="onair__meta numeric">
          {status.outputWidth}×{status.outputHeight} · {status.fps}fps
        </span>
      )}
      <Button
        size="sm"
        tone={boardVisible ? "secondary" : "primary"}
        onClick={() => void (boardVisible ? store.hideBoardWindow() : store.showBoardWindow())}
      >
        {boardVisible ? "Hide board" : "Go live"}
      </Button>
    </div>
  );
}
