/**
 * What floats over the canvas: the scene rail, the zoom control and the minimap.
 *
 * All of it is positioned over the board rather than docked beside it, which is
 * how the references keep the canvas as wide as the window.
 */

import { useEffect, useRef, useState } from "react";
import { contentBounds } from "../../core/doc";
import { boundingRect, fitAspect } from "../../core/geometry";
import { homeView } from "../../core/stage";
import {
  AddIcon,
  BackIcon,
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
import { Button, IconButton, Menu, cx, useTooltip } from "../../ui/primitives";
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

      <AutoFrameChip />

      <PointerChip />

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
 * Whether the shot follows the work.
 *
 * On the rail rather than buried in settings because it is a decision you make
 * during a call, not before one — and because the moment it does something
 * surprising you want the off switch in the same place you were already
 * looking.
 */
function AutoFrameChip() {
  const mode = useStore((s) => s.autoFrame);
  const holding = useStore((s) => s.autoFrameOn);
  const store = useActions();
  const [open, setOpen] = useState<{ x: number; y: number } | null>(null);

  const label =
    mode === "off" ? "Follow my work" : mode === "monitor" ? "Following screens" : "Following windows";

  return (
    <span className="scene-chip-wrap">
      <button
        className={cx("scene-chip", mode !== "off" && "is-active")}
        title={
          mode === "off"
            ? "Point the stage at whatever you are working in"
            : `${label}${holding ? ` — on ${holding}` : ""}. Click to change.`
        }
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setOpen(open ? null : { x: r.left, y: r.top - 8 });
        }}
      >
        <FollowIcon size={13} aria-hidden />
        {label}
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
              onSelect: () => store.setAutoFrame("monitor"),
            },
            {
              label: "Follow the window I work in",
              icon: WindowIcon,
              onSelect: () => store.setAutoFrame("window"),
            },
            { separator: true },
            { label: "Leave the stage alone", onSelect: () => store.setAutoFrame("off") },
          ]}
        />
      )}
    </span>
  );
}

/**
 * Whether the audience can see where you are pointing.
 *
 * Zoomed out to four monitors, a real cursor is about two pixels in the output.
 * "It's right there" is the most repeated sentence on any screen share, and it
 * is the app's fault.
 */
function PointerChip() {
  const on = useStore((s) => s.spotlightCursor);
  const store = useActions();
  return (
    <button
      className={cx("scene-chip", on && "is-active")}
      onClick={() => store.setSpotlightCursor(!on)}
      title={
        on
          ? "They can see a ring where your pointer is. Hold Z to punch in on it."
          : "Show the audience where you are pointing — and hold Z to punch in"
      }
    >
      <PointerIcon size={13} aria-hidden />
      {on ? "Pointer shown" : "Show my pointer"}
    </button>
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
