/**
 * The window's own title bar.
 *
 * The references show macOS traffic lights; this is a Windows app, so the
 * controls sit on the right where Windows users reach for them. Everything else
 * — the board switcher on the left, the actions on the right, the height, the
 * type — follows the references exactly.
 */

import { useEffect, useState } from "react";
import * as api from "../../core/api";
import {
  BellIcon,
  BoardIcon,
  ChevronDownIcon,
  CloseIcon,
  MaximizeIcon,
  MoreIcon,
  PeopleIcon,
  RemoveIcon,
  SearchIcon,
  ShareIcon,
} from "../../ui/icons";
import { Avatar, AvatarStack, Badge, Button, IconButton, MenuButton } from "../../ui/primitives";
import { runningInTauri } from "../../core/bus";
import { useActions, useStore } from "../store";

export function TitleBar({
  onOpenShare,
  onOpenSearch,
}: {
  onOpenShare: () => void;
  onOpenSearch: () => void;
}) {
  const store = useActions();
  const doc = useStore((s) => s.doc);
  const dirty = useStore((s) => s.dirty);
  const boards = useStore((s) => s.boards);
  const guests = useStore((s) => s.guests);
  const boardVisible = useStore((s) => s.boardVisible);
  const look = useStore((s) => s.look);

  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!runningInTauri()) return;
    void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
      setMaximized(await getCurrentWindow().isMaximized());
    });
  }, []);

  const windowAction = async (action: "minimize" | "toggle" | "close") => {
    if (!runningInTauri()) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    if (action === "minimize") await win.minimize();
    if (action === "close") await win.close();
    if (action === "toggle") {
      await win.toggleMaximize();
      setMaximized(await win.isMaximized());
    }
  };

  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="titlebar__left">
        <span className="brand" aria-hidden />
        <MenuButton
          tone="ghost"
          size="sm"
          trailing={ChevronDownIcon}
          entries={[
            { label: "New board", icon: BoardIcon, onSelect: () => store.newBoard() },
            { label: "Save board", shortcut: "Ctrl+Shift+S", onSelect: () => void store.saveBoard() },
            { separator: true },
            ...boards.slice(0, 8).map((board) => ({
              label: board.name,
              checked: board.id === useStore.getState().boardId,
              onSelect: () => void store.loadBoard(board.id),
            })),
          ]}
          align="start"
        >
          {doc.name}
        </MenuButton>
        {dirty && <span className="titlebar__dirty" title="Unsaved changes" />}
      </div>

      <div className="titlebar__right">
        {guests.guests.length > 0 && (
          <AvatarStack names={guests.guests.map((g) => g.name)} size={26} />
        )}
        {boardVisible && <Badge tone="live" dot>On air</Badge>}

        <IconButton icon={SearchIcon} label="Search the board" onClick={onOpenSearch} />
        <Button tone="primary" size="sm" icon={PeopleIcon} onClick={onOpenShare}>
          Invite
        </Button>
        <Button tone="secondary" size="sm" icon={ShareIcon} onClick={onOpenShare}>
          Share
        </Button>

        <MenuButton
          tone="ghost"
          size="sm"
          icon={MoreIcon}
          entries={[
            {
              label: boardVisible ? "Hide the board window" : "Show the board window",
              shortcut: "Ctrl+Alt+B",
              onSelect: () =>
                void (boardVisible ? store.hideBoardWindow() : store.showBoardWindow()),
            },
            { separator: true },
            { label: "Pure white studio", checked: look === "pure-white", onSelect: () => store.setLook("pure-white") },
            { label: "Liquid glass", checked: look === "liquid-glass", onSelect: () => store.setLook("liquid-glass") },
            { label: "Arctic blue", checked: look === "arctic-blue", onSelect: () => store.setLook("arctic-blue") },
            { label: "Graphite dark", checked: look === "graphite-dark", onSelect: () => store.setLook("graphite-dark") },
            { label: "Spectrum pro", checked: look === "spectrum-pro", onSelect: () => store.setLook("spectrum-pro") },
            { separator: true },
            { label: "Open the boards folder", onSelect: () => void openDataDir() },
          ]}
        />
        <IconButton icon={BellIcon} label="Notifications" />

        {runningInTauri() && (
          <div className="window-controls">
            <button aria-label="Minimise" onClick={() => void windowAction("minimize")}>
              <RemoveIcon size={14} />
            </button>
            <button
              aria-label={maximized ? "Restore" : "Maximise"}
              onClick={() => void windowAction("toggle")}
            >
              <MaximizeIcon size={13} />
            </button>
            <button
              className="window-controls__close"
              aria-label="Close"
              onClick={() => void windowAction("close")}
            >
              <CloseIcon size={14} />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

async function openDataDir() {
  const session = await api.sessionInfo();
  try {
    const { openPath } = await import("@tauri-apps/plugin-opener");
    await openPath(session.dataDir);
  } catch {
    /* the path is visible in settings either way */
  }
}

/** Small helper used by panels that show a person. */
export function Person({ name, meta }: { name: string; meta?: string }) {
  return (
    <span className="person">
      <Avatar name={name} size={26} />
      <span className="person__text">
        <span className="person__name">{name}</span>
        {meta && <span className="person__meta">{meta}</span>}
      </span>
    </span>
  );
}
