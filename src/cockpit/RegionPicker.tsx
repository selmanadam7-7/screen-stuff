/**
 * The region picker.
 *
 * A transparent window stretched over every monitor. Drag a rectangle and that
 * crop becomes a live tile — the fastest way to show one chart without showing
 * the desktop around it.
 */

import { useEffect, useRef, useState } from "react";
import * as api from "../core/api";
import { emitTo } from "../core/bus";
import type { SourceInfo, Vec2 } from "../core/types";

export const REGION_PICKED_EVENT = "sd:region-picked";

export function RegionPicker() {
  const [monitors, setMonitors] = useState<SourceInfo[]>([]);
  const [origin, setOrigin] = useState({ x: 0, y: 0 });
  const [scaleFactor, setScaleFactor] = useState(1);
  const [start, setStart] = useState<Vec2 | null>(null);
  const [current, setCurrent] = useState<Vec2 | null>(null);
  const [cursor, setCursor] = useState<Vec2>({ x: 0, y: 0 });
  const surfaceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void (async () => {
      const [session, list] = await Promise.all([api.sessionInfo(), api.listMonitors()]);
      setOrigin({ x: session.desktop.x, y: session.desktop.y });
      setMonitors(list);
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        setScaleFactor(await getCurrentWindow().scaleFactor());
      } catch {
        setScaleFactor(window.devicePixelRatio || 1);
      }
    })();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") void api.closeRegionPicker();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /** CSS pixels in this overlay -> physical desktop coordinates. */
  const toDesktop = (point: Vec2): Vec2 => ({
    x: origin.x + point.x * scaleFactor,
    y: origin.y + point.y * scaleFactor,
  });

  const finish = async (from: Vec2, to: Vec2) => {
    const a = toDesktop(from);
    const b = toDesktop(to);
    const rect = {
      x: Math.round(Math.min(a.x, b.x)),
      y: Math.round(Math.min(a.y, b.y)),
      w: Math.round(Math.abs(b.x - a.x)),
      h: Math.round(Math.abs(b.y - a.y)),
    };
    if (rect.w < 12 || rect.h < 12) {
      await api.closeRegionPicker();
      return;
    }

    // Which display does the middle of the selection sit on?
    const centre = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
    const monitor =
      monitors.find(
        (m) =>
          centre.x >= m.x && centre.x < m.x + m.width && centre.y >= m.y && centre.y < m.y + m.height,
      ) ?? monitors[0];

    if (!monitor) {
      await api.closeRegionPicker();
      return;
    }

    // Clamp into that display, then express the crop in display-local pixels.
    const localX = Math.max(0, rect.x - monitor.x);
    const localY = Math.max(0, rect.y - monitor.y);
    const localW = Math.min(rect.w, monitor.width - localX);
    const localH = Math.min(rect.h, monitor.height - localY);
    const source = `region:${monitor.id}@${localX},${localY},${localW},${localH}`;

    await emitTo("main", REGION_PICKED_EVENT, { source, title: `Region of ${monitor.title}` });
    await api.closeRegionPicker();
  };

  const selection =
    start && current
      ? {
          left: Math.min(start.x, current.x),
          top: Math.min(start.y, current.y),
          width: Math.abs(current.x - start.x),
          height: Math.abs(current.y - start.y),
        }
      : null;

  return (
    <div
      className="region"
      ref={surfaceRef}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        setStart({ x: e.clientX, y: e.clientY });
        setCurrent({ x: e.clientX, y: e.clientY });
      }}
      onPointerMove={(e) => {
        setCursor({ x: e.clientX, y: e.clientY });
        if (start) setCurrent({ x: e.clientX, y: e.clientY });
      }}
      onPointerUp={(e) => {
        if (start) void finish(start, { x: e.clientX, y: e.clientY });
        setStart(null);
        setCurrent(null);
      }}
    >
      {/* Four panes around the selection, so the chosen area stays clear. */}
      {selection ? (
        <>
          <div className="region__shade" style={{ left: 0, top: 0, right: 0, height: selection.top }} />
          <div
            className="region__shade"
            style={{ left: 0, top: selection.top + selection.height, right: 0, bottom: 0 }}
          />
          <div
            className="region__shade"
            style={{ left: 0, top: selection.top, width: selection.left, height: selection.height }}
          />
          <div
            className="region__shade"
            style={{
              left: selection.left + selection.width,
              top: selection.top,
              right: 0,
              height: selection.height,
            }}
          />
          <div className="region__box" style={selection}>
            <span className="region__size numeric">
              {Math.round(selection.width * scaleFactor)} × {Math.round(selection.height * scaleFactor)}
            </span>
          </div>
        </>
      ) : (
        <div className="region__shade region__shade--full" />
      )}

      {!selection && (
        <div className="region__hint" style={{ left: cursor.x + 18, top: cursor.y + 18 }}>
          Drag a rectangle — Esc to cancel
        </div>
      )}
    </div>
  );
}
