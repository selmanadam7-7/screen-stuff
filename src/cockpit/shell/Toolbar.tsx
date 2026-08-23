/**
 * The floating toolbar.
 *
 * It hovers over the canvas rather than sitting in a bar, exactly as in the
 * references — which is also why it is short: anything that is not reached
 * mid-sentence belongs in a panel, not here.
 */

import { useState } from "react";
import * as api from "../../core/api";
import {
  CameraIcon,
  CommentIcon,
  HideIcon,
  ImageIcon,
  NoteIcon,
  PanIcon,
  PenIcon,
  PeopleIcon,
  RegionIcon,
  ScreenIcon,
  SelectIcon,
  StageIcon,
  WebIcon,
} from "../../ui/icons";
import { IconButton, Menu, cx, useTooltip } from "../../ui/primitives";
import type { InkTool } from "../../core/types";
import { useActions, useStore } from "../store";

const INK_TOOLS: Array<{ tool: InkTool; label: string; key: string }> = [
  { tool: "pen", label: "Pen", key: "P" },
  { tool: "highlighter", label: "Highlighter", key: "H" },
  { tool: "arrow", label: "Arrow", key: "A" },
  { tool: "box", label: "Box", key: "B" },
  { tool: "ellipse", label: "Ellipse", key: "O" },
];

const INK_COLORS = ["#FA3928", "#FD9F0A", "#14B18D", "#0562FE", "#846AFC", "#1E2329"];

export function Toolbar({
  onAddScreens,
  onInvite,
  onAddMedia,
  onAddWeb,
}: {
  onAddScreens: () => void;
  onInvite: () => void;
  onAddMedia: () => void;
  onAddWeb: () => void;
}) {
  const store = useActions();
  const ink = useStore((s) => s.ink);
  const panMode = useStore((s) => s.panMode);
  const stageSelected = useStore((s) => s.stageSelected);
  const redacting = useStore((s) => s.redacting);
  const [inkMenu, setInkMenu] = useState<{ x: number; y: number } | null>(null);

  const selectActive = !ink.tool && !panMode && !stageSelected && !redacting;

  return (
    <div className="toolbar">
      <Tool
        icon={SelectIcon}
        label="Select"
        shortcut="V"
        active={selectActive}
        onClick={() => {
          store.setInk({ tool: null });
          store.setPanMode(false);
        }}
      />
      <Tool
        icon={PanIcon}
        label="Pan"
        shortcut="Space"
        active={panMode}
        onClick={() => {
          store.setInk({ tool: null });
          store.setPanMode(!panMode);
        }}
      />

      <span className="toolbar__rule" />

      {/* Next to the two navigation tools, because aiming the stage is
          navigation — it is where the audience is pointed, not a thing to add. */}
      <Tool
        icon={StageIcon}
        label="The stage — what they see"
        active={stageSelected}
        onClick={() => {
          store.setInk({ tool: null });
          store.setPanMode(false);
          store.selectStage(!stageSelected);
          if (!stageSelected) store.showStage();
        }}
      />

      <span className="toolbar__rule" />

      <Tool icon={ScreenIcon} label="Add a screen" shortcut="S" onClick={onAddScreens} />
      <Tool
        icon={RegionIcon}
        label="Grab a region"
        shortcut="R"
        onClick={() => void api.openRegionPicker()}
      />
      <Tool icon={CameraIcon} label="Add your camera" onClick={() => store.addCamera()} />
      <Tool icon={ImageIcon} label="Add media" onClick={onAddMedia} />
      <Tool icon={WebIcon} label="Add a web page" onClick={onAddWeb} />

      <span className="toolbar__rule" />

      <Tool
        icon={HideIcon}
        label="Hide a part of a tile from the audience"
        active={redacting}
        onClick={() => store.setRedacting(!redacting)}
      />
      <Tool icon={NoteIcon} label="Add a note" shortcut="N" onClick={() => store.addNote()} />
      <button
        className={cx("tool", ink.tool && "is-active")}
        aria-label="Annotate"
        title="Annotate"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setInkMenu(inkMenu ? null : { x: rect.left, y: rect.bottom + 8 });
        }}
      >
        <PenIcon size={18} aria-hidden />
        {ink.tool && <span className="tool__swatch" style={{ background: ink.color }} />}
      </button>
      <Tool
        icon={CommentIcon}
        label="Clear all ink"
        onClick={() => store.clearInk()}
      />

      <span className="toolbar__rule" />

      <Tool icon={PeopleIcon} label="Invite people" onClick={onInvite} />

      {inkMenu && (
        <InkMenu
          x={inkMenu.x}
          y={inkMenu.y}
          onClose={() => setInkMenu(null)}
        />
      )}
    </div>
  );
}

function Tool({
  icon: IconComponent,
  label,
  shortcut,
  active,
  onClick,
}: {
  icon: typeof SelectIcon;
  label: string;
  shortcut?: string;
  active?: boolean;
  onClick: () => void;
}) {
  const tip = useTooltip(shortcut ? `${label} · ${shortcut}` : label);
  return (
    <button
      className={cx("tool", active && "is-active")}
      aria-label={label}
      onClick={onClick}
      {...tip}
    >
      <IconComponent size={18} aria-hidden />
    </button>
  );
}

function InkMenu({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  const store = useActions();
  const ink = useStore((s) => s.ink);

  return (
    <Menu
      x={x}
      y={y}
      onClose={onClose}
      align="start"
      entries={[
        ...INK_TOOLS.map((entry) => ({
          label: entry.label,
          shortcut: entry.key,
          checked: ink.tool === entry.tool,
          onSelect: () =>
            store.setInk({ tool: ink.tool === entry.tool ? null : entry.tool }),
        })),
        { separator: true as const },
        {
          label: ink.temporary ? "Ink fades away" : "Ink stays put",
          checked: ink.temporary,
          onSelect: () => store.setInk({ temporary: !ink.temporary }),
        },
      ]}
    />
  );
}

/** The colour and width row, shown under the toolbar while a pen is chosen. */
export function InkBar() {
  const store = useActions();
  const ink = useStore((s) => s.ink);
  if (!ink.tool) return null;

  return (
    <div className="inkbar">
      {INK_COLORS.map((color) => (
        <button
          key={color}
          className={cx("inkbar__swatch", ink.color === color && "is-active")}
          style={{ background: color }}
          aria-label={`Ink colour ${color}`}
          onClick={() => store.setInk({ color })}
        />
      ))}
      <span className="inkbar__rule" />
      <input
        className="inkbar__width"
        type="range"
        min={2}
        max={28}
        value={ink.width}
        aria-label="Ink width"
        onChange={(e) => store.setInk({ width: Number(e.target.value) })}
      />
      <span className="inkbar__preview" style={{ width: ink.width, height: ink.width, background: ink.color }} />
      <span className="inkbar__rule" />
      <button className="inkbar__text" onClick={() => store.setInk({ tool: null })}>
        Done
      </button>
    </div>
  );
}

export { IconButton };
