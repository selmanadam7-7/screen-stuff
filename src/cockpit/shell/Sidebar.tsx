/**
 * The left rail: everything on this board, grouped by what it is.
 *
 * The references show a contents list rather than a tool palette, and that is
 * the right call — mid-call you are looking for "Screen 3", not for a tool. It
 * doubles as the selection surface: clicking a row selects the tile, and
 * double-clicking spotlights it.
 */

import { useMemo, useState } from "react";
import {
  AddIcon,
  BoardIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  EyeIcon,
  ImageIcon,
  LayersIcon,
  LockedIcon,
  SettingsIcon,
  tileIcon,
} from "../../ui/icons";
import { Badge, IconButton, MenuButton, SearchField, cx } from "../../ui/primitives";
import type { Tile } from "../../core/types";
import { selectedTiles, useActions, useStore } from "../store";

interface Section {
  key: string;
  title: string;
  tiles: Tile[];
}

const GROUP_ORDER: Array<{ key: string; title: string; kinds: Tile["kind"][] }> = [
  { key: "screens", title: "Screens", kinds: ["source"] },
  { key: "camera", title: "Camera", kinds: ["camera"] },
  { key: "media", title: "Media", kinds: ["image", "video"] },
  { key: "pages", title: "Pages", kinds: ["web"] },
  { key: "files", title: "Files", kinds: ["pdf"] },
  { key: "notes", title: "Notes", kinds: ["note"] },
];

export function Sidebar({ onAddScreens }: { onAddScreens: () => void }) {
  const doc = useStore((s) => s.doc);
  const selection = useStore((s) => s.selection);
  const panel = useStore((s) => s.panel);
  const store = useActions();
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const sections = useMemo<Section[]>(() => {
    const needle = query.trim().toLowerCase();
    const match = (tile: Tile) =>
      !needle || tileName(tile).toLowerCase().includes(needle);
    return GROUP_ORDER.map(({ key, title, kinds }) => ({
      key,
      title,
      tiles: doc.tiles.filter((t) => kinds.includes(t.kind) && match(t)).sort((a, b) => b.z - a.z),
    })).filter((section) => section.tiles.length > 0);
  }, [doc.tiles, query]);

  const total = doc.tiles.length;

  return (
    <aside className="sidebar">
      <div className="sidebar__head">
        <MenuButton
          tone="ghost"
          size="sm"
          trailing={ChevronDownIcon}
          align="start"
          entries={[
            { label: "Boards", icon: BoardIcon, onSelect: () => store.setPanel("boards") },
            { label: "Media", icon: ImageIcon, onSelect: () => store.setPanel("media") },
            { label: "Guests", icon: EyeIcon, onSelect: () => store.setPanel("guests") },
            { label: "Settings", icon: SettingsIcon, onSelect: () => store.setPanel("settings") },
          ]}
        >
          {panel === "board" ? "Board" : panelTitle(panel)}
        </MenuButton>
      </div>

      <div className="sidebar__search">
        <SearchField value={query} onChange={setQuery} placeholder="Search" />
      </div>

      <button
        className={cx("nav-row", selection.length === 0 && "is-active")}
        onClick={() => store.select([])}
      >
        <LayersIcon size={15} aria-hidden />
        <span className="nav-row__label">All</span>
        <span className="nav-row__count numeric">{total}</span>
      </button>

      <div className="sidebar__scroll">
        {sections.map((section) => (
          <div className="sidebar__section" key={section.key}>
            <button
              className="sidebar__section-head"
              onClick={() =>
                setCollapsed((c) => ({ ...c, [section.key]: !c[section.key] }))
              }
            >
              {collapsed[section.key] ? (
                <ChevronRightIcon size={12} aria-hidden />
              ) : (
                <ChevronDownIcon size={12} aria-hidden />
              )}
              <span className="eyebrow">{section.title}</span>
              <span className="sidebar__section-count numeric">{section.tiles.length}</span>
            </button>

            {!collapsed[section.key] &&
              section.tiles.map((tile) => {
                const TileIcon = tileIcon(tile.kind);
                const active = selection.includes(tile.id);
                return (
                  <button
                    key={tile.id}
                    className={cx("nav-row", "nav-row--tile", active && "is-active")}
                    onClick={(e) => store.select([tile.id], e.shiftKey)}
                    onDoubleClick={() => store.toggleSpotlight(tile.id)}
                    title={tileName(tile)}
                  >
                    <TileIcon size={15} aria-hidden />
                    <span className="nav-row__label">{tileName(tile)}</span>
                    {tile.locked && <LockedIcon size={12} className="nav-row__flag" aria-hidden />}
                    {tile.kind === "source" && <span className="nav-row__live" />}
                  </button>
                );
              })}
          </div>
        ))}

        {total === 0 && (
          <div className="sidebar__empty">
            <p>Nothing on this board yet.</p>
            <button className="linkish" onClick={onAddScreens}>
              Add screens
            </button>
          </div>
        )}
      </div>

      <footer className="sidebar__foot">
        <IconButton icon={AddIcon} label="Add screens" onClick={onAddScreens} />
        <IconButton icon={BoardIcon} label="Boards" onClick={() => store.setPanel("boards")} />
        <IconButton icon={ImageIcon} label="Media" onClick={() => store.setPanel("media")} />
        <span className="sidebar__foot-spacer" />
        <IconButton
          icon={SettingsIcon}
          label="Settings"
          onClick={() => store.setPanel("settings")}
        />
      </footer>
    </aside>
  );
}

export function tileName(tile: Tile): string {
  if (tile.label) return tile.label;
  switch (tile.kind) {
    case "source":
      return tile.source;
    case "camera":
      return "Camera";
    case "image":
    case "video":
    case "pdf":
      return (tile as { name?: string }).name ?? tile.kind;
    case "web":
      return hostOf((tile as { url: string }).url);
    case "note": {
      const text = (tile as { text: string }).text.trim();
      return text ? text.split("\n")[0].slice(0, 32) : "Note";
    }
    default:
      // Unreachable while the union is fully covered above, but a board loaded
      // from a newer version could carry a kind this build has never seen.
      return (tile as Tile).kind;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function panelTitle(panel: string): string {
  switch (panel) {
    case "boards":
      return "Boards";
    case "media":
      return "Media";
    case "guests":
      return "Guests";
    case "settings":
      return "Settings";
    default:
      return "Board";
  }
}

/** Used by the inspector header, so a tile is named the same way in both. */
export function useSelectedTile() {
  const tiles = useStore(selectedTiles);
  return tiles.length === 1 ? tiles[0] : null;
}

export { Badge };
