/**
 * The Add Screens picker.
 *
 * Every card is a live preview of the real thing, not an icon — picking the
 * right window out of thirty by name alone is the part everyone gets wrong, and
 * the references solve it by showing them. Previews only run while the picker is
 * open, so the cost disappears the moment it closes.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { FrameClient } from "../../core/frames";
import { CameraIcon, CheckIcon, DisplayIcon, RefreshIcon, WindowIcon } from "../../ui/icons";
import { Button, EmptyState, Modal, SearchField, Select, Switch, cx } from "../../ui/primitives";
import type { SourceInfo } from "../../core/types";
import { useActions, useStore } from "../store";

export function AddScreens({
  open,
  onClose,
  client,
}: {
  open: boolean;
  onClose: () => void;
  client: FrameClient | null;
}) {
  const sources = useStore((s) => s.sources);
  const monitors = useStore((s) => s.monitors);
  const doc = useStore((s) => s.doc);
  const store = useActions();

  const [picked, setPicked] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [quality, setQuality] = useState("85");
  const [withCamera, setWithCamera] = useState(false);
  const [busy, setBusy] = useState(false);

  const alreadyOn = useMemo(
    () => new Set(doc.tiles.flatMap((t) => (t.kind === "source" ? [t.source] : []))),
    [doc.tiles],
  );

  useEffect(() => {
    if (!open) return;
    setPicked([]);
    setQuery("");
    setWithCamera(false);
    void store.refreshSources();
    const timer = window.setInterval(() => void store.refreshSources(), 6000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const windows = sources.filter(
    (s) =>
      s.kind === "window" &&
      (!query || `${s.title} ${s.subtitle}`.toLowerCase().includes(query.toLowerCase())),
  );

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const addAll = async () => {
    setBusy(true);
    if (picked.length > 0) {
      store.setBoardProp({ quality: Number(quality) });
      store.addSources(picked);
    }
    if (withCamera) store.addCamera();
    setBusy(false);
    onClose();
  };

  const count = picked.length + (withCamera ? 1 : 0);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add screens"
      subtitle="Everything here is live. Pick what goes on the board."
      width={880}
      footer={
        <>
          <Switch
            label="Include my camera"
            checked={withCamera}
            onChange={setWithCamera}
          />
          <span className="modal__foot-spacer" />
          <label className="modal__foot-field">
            <span>Quality</span>
            <Select
              size="sm"
              value={quality}
              onChange={setQuality}
              options={[
                { value: "70", label: "Draft" },
                { value: "85", label: "Standard" },
                { value: "95", label: "High" },
              ]}
            />
          </label>
          <Button onClick={onClose}>Cancel</Button>
          <Button tone="primary" onClick={() => void addAll()} disabled={count === 0 || busy}>
            {count === 0 ? "Add to board" : `Add ${count} to board`}
          </Button>
        </>
      }
    >
      <section className="picker__section">
        <header className="picker__head">
          <h3 className="eyebrow">
            <DisplayIcon size={13} aria-hidden /> Displays
          </h3>
          {monitors.length > 1 && (
            <button
              className="linkish"
              onClick={() =>
                setPicked((p) =>
                  monitors.every((m) => p.includes(m.id))
                    ? p.filter((id) => !monitors.some((m) => m.id === id))
                    : Array.from(new Set([...p, ...monitors.map((m) => m.id)])),
                )
              }
            >
              {monitors.every((m) => picked.includes(m.id)) ? "Clear all" : "Select all"}
            </button>
          )}
        </header>
        <div className="picker__grid">
          {monitors.map((monitor) => (
            <PickCard
              key={monitor.id}
              info={monitor}
              client={client}
              picked={picked.includes(monitor.id)}
              onBoard={alreadyOn.has(monitor.id)}
              onToggle={() => toggle(monitor.id)}
            />
          ))}
          {monitors.length === 0 && (
            <EmptyState icon={DisplayIcon} title="No displays found" />
          )}
        </div>
      </section>

      <section className="picker__section">
        <header className="picker__head">
          <h3 className="eyebrow">
            <WindowIcon size={13} aria-hidden /> Windows
          </h3>
          <div className="picker__head-tools">
            <SearchField
              value={query}
              onChange={setQuery}
              placeholder={`Search ${windows.length}`}
            />
            <button className="linkish" onClick={() => void store.refreshSources()}>
              <RefreshIcon size={12} aria-hidden /> Refresh
            </button>
          </div>
        </header>
        <div className="picker__grid">
          {windows.map((win) => (
            <PickCard
              key={win.id}
              info={win}
              client={client}
              picked={picked.includes(win.id)}
              onBoard={alreadyOn.has(win.id)}
              onToggle={() => toggle(win.id)}
            />
          ))}
          {windows.length === 0 && (
            <EmptyState
              icon={WindowIcon}
              title={query ? "Nothing matches that" : "No capturable windows open"}
              hint={query ? undefined : "Windows smaller than 160×120 are left out."}
            />
          )}
        </div>
      </section>

      <section className="picker__section">
        <header className="picker__head">
          <h3 className="eyebrow">
            <CameraIcon size={13} aria-hidden /> Camera
          </h3>
        </header>
        <p className="picker__note">
          Your camera goes on as its own tile — croppable, circular if you like, and
          published to guests so they see you rather than themselves.
        </p>
      </section>
    </Modal>
  );
}

function PickCard({
  info,
  client,
  picked,
  onBoard,
  onToggle,
}: {
  info: SourceInfo;
  client: FrameClient | null;
  picked: boolean;
  onBoard: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      className={cx("pick", picked && "is-picked")}
      onClick={onToggle}
      aria-pressed={picked}
      title={`${info.title} — ${info.subtitle}`}
    >
      <span className="pick__shot">
        <LivePreview source={info.id} client={client} />
        <span className="pick__check" aria-hidden>
          {picked && <CheckIcon size={12} weight="Filled" />}
        </span>
        {onBoard && <span className="pick__on-board">On the board</span>}
      </span>
      <span className="pick__name">{info.title}</span>
      <span className="pick__meta numeric">{info.subtitle}</span>
    </button>
  );
}

/** A live thumbnail. Subscribes only while mounted. */
export function LivePreview({
  source,
  client,
  fps = 6,
}: {
  source: string;
  client: FrameClient | null;
  fps?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!client) return;
    let raf = 0;
    const handle = client.subscribe(source, { width: 480, height: 300, fps, quality: 72 });

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      if (handle.status === "error") {
        setFailed(handle.error ?? "unavailable");
        return;
      }
      if (!handle.bitmap) return;
      const { width, height } = canvas;
      const scale = Math.max(width / handle.bitmap.width, height / handle.bitmap.height);
      const w = handle.bitmap.width * scale;
      const h = handle.bitmap.height * scale;
      ctx.drawImage(handle.bitmap, (width - w) / 2, (height - h) / 2, w, h);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      handle.close();
    };
  }, [client, source, fps]);

  return (
    <>
      <canvas ref={canvasRef} width={480} height={300} />
      {failed && <span className="pick__failed">{failed}</span>}
    </>
  );
}
