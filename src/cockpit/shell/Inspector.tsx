/**
 * The right-hand inspector.
 *
 * Laid out the way the references do it: an identity header, then property
 * groups in a fixed order, then destructive actions at the bottom where they
 * cannot be hit by accident. Every group here is backed by something real — no
 * control is drawn that does not change what the audience sees.
 */

import { useEffect, useState } from "react";
import * as api from "../../core/api";
import {
  CloseIcon,
  CopyIcon,
  ExpandIcon,
  HideIcon,
  EyeIcon,
  LockedIcon,
  StageIcon,
  TrashIcon,
  UnlockedIcon,
  VolumeIcon,
  tileIcon,
} from "../../ui/icons";
import {
  Avatar,
  Badge,
  Button,
  Checkbox,
  Field,
  Group,
  IconButton,
  Input,
  LiveBadge,
  NumberField,
  Segmented,
  Select,
  Slider,
  Switch,
  Tabs,
  cx,
} from "../../ui/primitives";
import type { CameraTile, NoteTile, PdfTile, SourceTile, Tile, VideoTile, WebTile } from "../../core/types";
import { redactionsOf } from "../../core/redact";
import {
  CORNERS,
  DEFAULT_PIN,
  MAX_MARGIN,
  MAX_SIZE,
  MIN_SIZE,
  type PinCorner,
} from "../../core/pin";
import { MIN_STAGE, stageLabel } from "../../core/stage";
import { selectedTiles, useActions, useStore, webLabels } from "../store";
import { useShallow } from "zustand/react/shallow";
import { tileName } from "./Sidebar";

export function Inspector() {
  const [tab, setTab] = useState<"inspector" | "comments">("inspector");
  const tiles = useStore(useShallow(selectedTiles));
  const stageSelected = useStore((s) => s.stageSelected);
  const guests = useStore((s) => s.guests);

  return (
    <aside className="inspector">
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "inspector", label: "Inspector" },
          { value: "comments", label: "Guests", count: guests.guests.length || undefined },
        ]}
      />
      <div className="inspector__scroll">
        {tab === "inspector" ? (
          stageSelected ? (
            <StageInspector />
          ) : tiles.length === 1 ? (
            <TileInspector tile={tiles[0]} />
          ) : tiles.length > 1 ? (
            <MultiInspector count={tiles.length} />
          ) : (
            <BoardInspector />
          )
        ) : (
          <GuestsTab />
        )}
      </div>
    </aside>
  );
}

/* ==========================================================================
   One tile
   ========================================================================== */

function TileInspector({ tile }: { tile: Tile }) {
  const store = useActions();
  const guests = useStore((s) => s.guests);
  const TileIcon = tileIcon(tile.kind);
  const isLive = tile.kind === "source" || tile.kind === "camera" || tile.kind === "web";

  return (
    <>
      <header className="inspector__identity">
        <span className="inspector__identity-icon">
          <TileIcon size={17} aria-hidden />
        </span>
        <span className="inspector__identity-text">
          <span className="inspector__identity-name">{tileName(tile)}</span>
          <span className="inspector__identity-kind">{kindLabel(tile)}</span>
        </span>
        <IconButton
          icon={ExpandIcon}
          label="Spotlight this tile"
          onClick={() => store.toggleSpotlight(tile.id)}
        />
      </header>

      {isLive && (
        <div className="inspector__live">
          <LiveBadge />
          {guests.running && (
            <span className="inspector__live-meta">
              {guests.guests.length === 0
                ? "link open, nobody watching"
                : `${guests.guests.length} watching`}
            </span>
          )}
        </div>
      )}

      {guests.running && guests.guests.length > 0 && (
        <Group title="Sharing">
          <div className="viewers">
            <span className="viewers__avatars">
              {guests.guests.slice(0, 6).map((guest) => (
                <Avatar key={guest.id} name={guest.name} size={26} />
              ))}
            </span>
            <Button tone="danger" size="sm" onClick={() => void store.stopGuests()}>
              Stop
            </Button>
          </div>
        </Group>
      )}

      {tile.kind === "source" && <SourceGroup tile={tile as SourceTile} />}
      {tile.kind === "camera" && <CameraGroup tile={tile as CameraTile} />}
      {tile.kind === "web" && <WebGroup tile={tile as WebTile} />}
      {tile.kind === "video" && <VideoGroup tile={tile as VideoTile} />}
      {tile.kind === "pdf" && <PdfGroup tile={tile as PdfTile} />}
      {tile.kind === "note" && <NoteGroup tile={tile as NoteTile} />}

      <PinGroup tile={tile} />
      <FrameGroup tile={tile} />
      <AppearanceGroup tile={tile} />
      {tile.kind !== "note" && <PrivacyGroup tile={tile} />}

      <footer className="inspector__foot">
        <IconButton icon={CopyIcon} label="Duplicate" onClick={() => store.duplicateSelection()} />
        <IconButton
          icon={tile.locked ? LockedIcon : UnlockedIcon}
          label={tile.locked ? "Unlock" : "Lock"}
          active={tile.locked}
          onClick={() => store.toggleLock()}
        />
        <IconButton
          icon={EyeIcon}
          label={tile.hidden ? "Show" : "Hide"}
          active={tile.hidden}
          onClick={() => store.patchTile(tile.id, { hidden: !tile.hidden })}
        />
        <span className="inspector__foot-spacer" />
        <IconButton
          icon={TrashIcon}
          label="Remove from the board"
          tone="danger"
          onClick={() => store.deleteSelection()}
        />
      </footer>
    </>
  );
}

function MultiInspector({ count }: { count: number }) {
  const store = useActions();
  return (
    <>
      <header className="inspector__identity">
        <span className="inspector__identity-text">
          <span className="inspector__identity-name">{count} tiles</span>
          <span className="inspector__identity-kind">selected</span>
        </span>
      </header>
      <Group title="Arrange">
        <div className="btn-row">
          <Button block onClick={() => store.arrange("selection")}>
            Into the frame
          </Button>
        </div>
        <div className="btn-row">
          <Button block onClick={() => store.order("front")}>
            Front
          </Button>
          <Button block onClick={() => store.order("back")}>
            Back
          </Button>
        </div>
      </Group>
      <Group title="All of them">
        <Switch
          label="Locked"
          checked={false}
          onChange={() => store.toggleLock()}
        />
        <Field label="Opacity">
          <Slider
            min={0.1}
            max={1}
            step={0.01}
            value={1}
            onChange={(v) => store.patchSelection(() => ({ opacity: v }))}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </Field>
      </Group>
      <footer className="inspector__foot">
        <IconButton icon={CopyIcon} label="Duplicate" onClick={() => store.duplicateSelection()} />
        <span className="inspector__foot-spacer" />
        <IconButton
          icon={TrashIcon}
          label="Remove from the board"
          tone="danger"
          onClick={() => store.deleteSelection()}
        />
      </footer>
    </>
  );
}

/* ==========================================================================
   Property groups
   ========================================================================== */

/**
 * Parked in a corner of the shot.
 *
 * Sits above the coordinates rather than below them, because when a tile is
 * pinned the coordinates do not describe where it is — the corner does, and a
 * panel that leads with numbers nobody is reading is a panel that lies.
 */
function PinGroup({ tile }: { tile: Tile }) {
  const store = useActions();
  const pin = tile.pin ?? null;

  return (
    <Group title="Corner of the shot">
      <Switch
        label="Keep it in the corner of the shot"
        hint="Moves with the stage — including when auto-framing follows you to another screen."
        checked={!!pin}
        onChange={(on) => store.setPin(tile.id, on ? DEFAULT_PIN : null)}
      />
      {pin && (
        <>
          <Field label="Corner" inline>
            <Select
              size="sm"
              value={pin.corner}
              onChange={(corner) => store.setPin(tile.id, { ...pin, corner: corner as PinCorner })}
              options={CORNERS.map((c) => ({ value: c.value, label: c.label }))}
            />
          </Field>
          <Field label="Size">
            <Slider
              min={MIN_SIZE * 100}
              max={MAX_SIZE * 100}
              step={1}
              value={pin.size * 100}
              onChange={(v) => store.setPin(tile.id, { ...pin, size: v / 100 })}
              format={(v) => `${Math.round(v)}% of the shot`}
            />
          </Field>
          <Field label="Inset">
            <Slider
              min={0}
              max={MAX_MARGIN * 100}
              step={0.5}
              value={pin.margin * 100}
              onChange={(v) => store.setPin(tile.id, { ...pin, margin: v / 100 })}
              format={(v) => `${v.toFixed(1)}%`}
            />
          </Field>
          <p className="inspector__note">
            Drag it to another corner on the board and it re-pins there.
          </p>
        </>
      )}
    </Group>
  );
}

function FrameGroup({ tile }: { tile: Tile }) {
  const store = useActions();
  const set = (patch: Partial<Tile>) => store.patchTile(tile.id, patch);

  return (
    <Group title="Frame">
      {tile.pin && (
        <p className="inspector__note">
          Pinned to the {CORNERS.find((c) => c.value === tile.pin!.corner)?.label.toLowerCase()} of
          the shot, so these numbers are not where it appears.
        </p>
      )}
      <div className="grid-2">
        <Field label="X">
          <NumberField value={tile.x} onCommit={(x) => set({ x })} />
        </Field>
        <Field label="Y">
          <NumberField value={tile.y} onCommit={(y) => set({ y })} />
        </Field>
        <Field label="W">
          <NumberField value={tile.w} min={24} onCommit={(w) => set({ w })} />
        </Field>
        <Field label="H">
          <NumberField value={tile.h} min={24} onCommit={(h) => set({ h })} />
        </Field>
      </div>
      <Field label="Rotation">
        <Slider
          min={-45}
          max={45}
          step={0.5}
          value={tile.rotation}
          onChange={(rotation) => set({ rotation })}
          format={(v) => `${v.toFixed(1)}°`}
        />
      </Field>
      <Checkbox
        label="Crop to fill the box"
        checked={tile.fit === "cover"}
        onChange={(on) => set({ fit: on ? "cover" : "contain" })}
      />
    </Group>
  );
}

/**
 * The parts of this tile nobody else sees.
 *
 * Listed rather than only drawn, because a promise you cannot audit is not
 * worth much: before a call you want to read the list and know.
 */
function PrivacyGroup({ tile }: { tile: Tile }) {
  const store = useActions();
  const redacting = useStore((s) => s.redacting);
  const regions = redactionsOf(tile);

  return (
    <Group title="Never shared">
      {regions.length === 0 ? (
        <p className="inspector__note">
          Nothing on this tile is hidden. Draw over a part of it and that part
          stays out of the output — on the board, for every guest, at every zoom.
        </p>
      ) : (
        <ul className="redactions">
          {regions.map((region) => (
            <li key={region.id}>
              <span className={cx("redactions__swatch", region.style === "blur" && "is-blur")} />
              <span className="redactions__label">{region.label}</span>
              <Badge tone={region.style === "blur" ? "neutral" : "success"}>
                {region.style === "blur" ? "blurred" : "hidden"}
              </Badge>
              <IconButton
                icon={CloseIcon}
                label={`Stop hiding ${region.label}`}
                onClick={() => store.removeRedaction(tile.id, region.id)}
              />
            </li>
          ))}
        </ul>
      )}
      <div className="btn-row">
        <Button
          block
          tone={redacting ? "primary" : "secondary"}
          icon={HideIcon}
          onClick={() => store.setRedacting(!redacting)}
        >
          {redacting ? "Drawing…" : "Hide a part"}
        </Button>
        {regions.length > 0 && (
          <Button block onClick={() => store.clearRedactions(tile.id)}>
            Show it all
          </Button>
        )}
      </div>
      {regions.some((r) => r.style === "blur") && (
        <p className="inspector__note">
          Blur is for tidiness, not secrecy — it can be undone from enough
          frames. Use hidden for anything that actually matters.
        </p>
      )}
    </Group>
  );
}

function AppearanceGroup({ tile }: { tile: Tile }) {
  const store = useActions();
  const set = (patch: Partial<Tile>) => store.patchTile(tile.id, patch);

  return (
    <Group title="Appearance">
      <Field label="Opacity">
        <Slider
          min={0.1}
          max={1}
          step={0.01}
          value={tile.opacity}
          onChange={(opacity) => set({ opacity })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
      </Field>
      <Field label="Corner">
        <Slider
          min={0}
          max={80}
          step={1}
          value={tile.radius}
          onChange={(radius) => set({ radius })}
          format={(v) => `${Math.round(v)}`}
        />
      </Field>
      <Field label="Caption">
        <Input
          value={tile.label}
          placeholder="None"
          onChange={(e) => set({ label: e.target.value })}
        />
      </Field>
      <Checkbox label="Drop shadow" checked={tile.shadow} onChange={(shadow) => set({ shadow })} />
    </Group>
  );
}

function SourceGroup({ tile }: { tile: SourceTile }) {
  const store = useActions();
  const doc = useStore((s) => s.doc);
  const [alive, setAlive] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const check = () => void api.sourceIsAlive(tile.source).then((ok) => !cancelled && setAlive(ok));
    check();
    const timer = window.setInterval(check, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [tile.source]);

  return (
    <Group title="Source">
      <div className="readout numeric">{tile.source}</div>
      {!alive && <p className="warn-line">That source has closed. The tile will stay dark.</p>}
      <Field label="Frame rate" inline>
        <Select
          size="sm"
          value={String(tile.fps ?? doc.fps)}
          onChange={(v) => store.patchTile(tile.id, { fps: Number(v) } as Partial<Tile>)}
          options={[10, 15, 24, 30, 60].map((n) => ({ value: String(n), label: `${n} fps` }))}
        />
      </Field>
      <Field label="Quality" inline>
        <Select
          size="sm"
          value={String(tile.quality ?? doc.quality)}
          onChange={(v) => store.patchTile(tile.id, { quality: Number(v) } as Partial<Tile>)}
          options={[
            { value: "70", label: "Draft" },
            { value: "85", label: "Standard" },
            { value: "95", label: "High" },
          ]}
        />
      </Field>
    </Group>
  );
}

function CameraGroup({ tile }: { tile: CameraTile }) {
  const autoCamera = useStore((s) => s.autoCamera);
  const micError = useStore((s) => s.micError);
  const store = useActions();
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    void navigator.mediaDevices
      ?.enumerateDevices()
      .then((all) => setDevices(all.filter((d) => d.kind === "videoinput")))
      .catch(() => setDevices([]));
  }, []);

  return (
    <Group title="Camera">
      <Field label="Device">
        <Select
          value={tile.deviceId ?? ""}
          onChange={(deviceId) =>
            store.patchTile(tile.id, { deviceId: deviceId || undefined } as Partial<Tile>)
          }
          options={[
            { value: "", label: "Default camera" },
            ...devices.map((d) => ({ value: d.deviceId, label: d.label || "Camera" })),
          ]}
        />
      </Field>
      <Field label="Shape">
        <Segmented
          value={tile.shape}
          onChange={(shape) => store.patchTile(tile.id, { shape } as Partial<Tile>)}
          options={[
            { value: "rect" as const, label: "Rectangle" },
            { value: "circle" as const, label: "Circle" },
          ]}
        />
      </Field>
      <Switch
        label="Mirror me"
        hint="How you look in a mirror, not to them"
        checked={tile.mirrored}
        onChange={(mirrored) => store.patchTile(tile.id, { mirrored } as Partial<Tile>)}
      />
      <Switch
        label="Grow while I talk"
        hint="Listens to the microphone for one number — how loud. Nothing is recorded or sent."
        checked={autoCamera}
        onChange={(on) => store.setAutoCamera(on)}
      />
      {micError && (
        <p className="inspector__note">
          The microphone would not open: {micError}
        </p>
      )}
    </Group>
  );
}

function WebGroup({ tile }: { tile: WebTile }) {
  const store = useActions();
  const [url, setUrl] = useState(tile.url);
  useEffect(() => setUrl(tile.url), [tile.url]);
  const label = webLabels.get(tile.id);

  const go = async () => {
    const next = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    store.patchTile(tile.id, { url: next } as Partial<Tile>);
    if (label) await api.webSourceNavigate(label, next);
  };

  return (
    <Group title="Page">
      <Field label="Address">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void go()}
        />
      </Field>
      <div className="btn-row">
        <Button
          block
          tone={tile.interacting ? "primary" : "secondary"}
          onClick={async () => {
            if (!label) return;
            const next = !tile.interacting;
            store.patchTile(tile.id, { interacting: next } as Partial<Tile>);
            await api.webSourceInteract(label, next);
          }}
        >
          {tile.interacting ? "Put it back" : "Click in it"}
        </Button>
        <Button block onClick={() => label && void api.webSourceReload(label)}>
          Reload
        </Button>
      </div>
      <p className="field__hint">
        Web tiles are real browser windows parked off screen, so they composite into
        the output like any other source.
      </p>
    </Group>
  );
}

function VideoGroup({ tile }: { tile: VideoTile }) {
  const store = useActions();
  return (
    <Group title="Playback">
      <div className="readout">{tile.name}</div>
      <Switch
        label="Playing"
        checked={tile.autoplay}
        onChange={(autoplay) => store.patchTile(tile.id, { autoplay } as Partial<Tile>)}
      />
      <Switch
        label="Loop"
        checked={tile.loop}
        onChange={(loop) => store.patchTile(tile.id, { loop } as Partial<Tile>)}
      />
      <div className="audio-row">
        <VolumeIcon size={15} aria-hidden />
        <Switch
          checked={!tile.muted}
          onChange={(on) => store.patchTile(tile.id, { muted: !on } as Partial<Tile>)}
        />
        <span className="audio-row__hint">
          Sound only travels when you share this window
        </span>
      </div>
    </Group>
  );
}

function PdfGroup({ tile }: { tile: PdfTile }) {
  const store = useActions();
  return (
    <Group title="Document">
      <div className="readout">{tile.name}</div>
      <Field label="Page" inline>
        <div className="pager">
          <IconButton
            icon={CopyIcon}
            label="Previous page"
            onClick={() => store.patchTile(tile.id, { page: Math.max(1, tile.page - 1) } as Partial<Tile>)}
          />
          <span className="pager__value numeric">
            {tile.page} / {tile.pageCount || "?"}
          </span>
          <IconButton
            icon={CopyIcon}
            label="Next page"
            onClick={() => store.patchTile(tile.id, { page: tile.page + 1 } as Partial<Tile>)}
          />
        </div>
      </Field>
    </Group>
  );
}

const NOTE_COLORS = ["#FEF4D7", "#DBE6FF", "#DFF5EE", "#FFE3D6", "#F0E7FF", "#FFFFFF"];

function NoteGroup({ tile }: { tile: NoteTile }) {
  const store = useActions();
  return (
    <Group title="Note">
      <textarea
        className="field-textarea"
        rows={5}
        value={tile.text}
        placeholder="Type on the note…"
        onChange={(e) => store.patchTile(tile.id, { text: e.target.value } as Partial<Tile>)}
      />
      <Field label="Paper">
        <div className="swatches">
          {NOTE_COLORS.map((color) => (
            <button
              key={color}
              className={cx("swatch", tile.color === color && "is-active")}
              style={{ background: color }}
              aria-label={`Note colour ${color}`}
              onClick={() => store.patchTile(tile.id, { color } as Partial<Tile>)}
            />
          ))}
        </div>
      </Field>
      <Field label="Text size">
        <Slider
          min={16}
          max={110}
          value={tile.fontSize}
          onChange={(fontSize) => store.patchTile(tile.id, { fontSize } as Partial<Tile>)}
          format={(v) => `${Math.round(v)}`}
        />
      </Field>
    </Group>
  );
}

/* ==========================================================================
   The stage
   ========================================================================== */

/**
 * Everything about the rectangle the audience sees.
 *
 * Shown whenever the stage is the selection — click its edge or its name tab on
 * the canvas. The numbers are live and editable, because lining a shot up on a
 * monitor edge by dragging is fine right up until you want it exact.
 */
function StageInspector() {
  const doc = useStore((s) => s.doc);
  const followView = useStore((s) => s.followView);
  const autoFrame = useStore((s) => s.autoFrame);
  const isPrivate = useStore((s) => s.isPrivate);
  const store = useActions();
  const stage = doc.frame;

  const move = (patch: Partial<{ x: number; y: number; w: number; h: number }>) =>
    store.setStage({ ...stage, ...patch }, { force: true });

  return (
    <>
      <header className="inspector__identity">
        <span className="inspector__identity-icon">
          <StageIcon size={16} aria-hidden />
        </span>
        <span className="inspector__identity-text">
          <span className="inspector__identity-name">Stage</span>
          <span className="inspector__identity-kind">
            {isPrivate ? "held — they see the last shot" : "what everyone sees"}
          </span>
        </span>
        <IconButton
          icon={doc.stageLocked ? LockedIcon : UnlockedIcon}
          label={doc.stageLocked ? "Unlock the stage" : "Lock the stage against dragging"}
          onClick={() => store.setStageLocked(!doc.stageLocked)}
        />
      </header>

      <p className="inspector__hint inspector__hint--lead">
        Only what is inside this rectangle is shared. The rest of the board is
        yours — pan and zoom around it freely, nobody follows you.
      </p>

      <Group title="Where">
        <div className="grid-2">
          <Field label="X">
            <NumberField value={stage.x} onCommit={(x) => move({ x })} />
          </Field>
          <Field label="Y">
            <NumberField value={stage.y} onCommit={(y) => move({ y })} />
          </Field>
          <Field label="W">
            <NumberField value={stage.w} min={MIN_STAGE} onCommit={(w) => move({ w })} />
          </Field>
          <Field label="H">
            <NumberField value={stage.h} min={MIN_STAGE} onCommit={(h) => move({ h })} />
          </Field>
        </div>
        {/* Height follows width: the stage is an output frame, so its shape is
            the output shape and nothing else. */}
        <p className="inspector__note">Locked to {aspectKey(doc.aspect)} — the output shape.</p>
      </Group>

      <Group title="Shape">
        <Field label="Output shape">
          <Segmented
            size="sm"
            value={aspectKey(doc.aspect)}
            onChange={(key) => store.setBoardProp({ aspect: ASPECTS[key] })}
            options={Object.keys(ASPECTS).map((k) => ({ value: k as AspectKey, label: k }))}
          />
        </Field>
      </Group>

      <Group title="Aim it">
        <div className="btn-row">
          <Button block onClick={() => store.bringThem()}>
            Move it to my view
          </Button>
          <Button block onClick={() => store.stageAroundEverything()}>
            Fit around everything
          </Button>
        </div>
        <div className="btn-row">
          <Button block onClick={() => store.showStage()}>
            Show me the stage
          </Button>
          <Button block onClick={() => store.arrange("all")}>
            Arrange tiles onto it
          </Button>
        </div>
        <Button block tone="primary" onClick={() => store.saveScene()}>
          Save this stage as a scene
        </Button>
      </Group>

      <Group title="Behaviour">
        <Switch
          label="Drag the audience with my view"
          hint="Off, the stage stays put and the rest of the board is private. On, they see whatever you look at."
          checked={followView}
          onChange={(on) => store.setFollowView(on)}
        />
        <Switch
          label="Lock against dragging"
          hint="Stops a stray drag moving the shot mid-call. Scenes and the buttons above still work."
          checked={doc.stageLocked}
          onChange={(on) => store.setStageLocked(on)}
        />
        <Field label="Follow my work">
          <Segmented
            size="sm"
            value={autoFrame}
            onChange={(mode) => store.setAutoFrame(mode as typeof autoFrame)}
            options={[
              { value: "off", label: "Off" },
              { value: "monitor", label: "Screens" },
              { value: "window", label: "Windows" },
            ]}
          />
        </Field>
        <p className="inspector__note">
          The stage points itself at whatever you are working in. It can only
          ever frame something already on the board, and touching the stage
          hands control straight back.
        </p>
      </Group>
    </>
  );
}

/* ==========================================================================
   Nothing selected, and the guests tab
   ========================================================================== */

function BoardInspector() {
  const doc = useStore((s) => s.doc);
  const followView = useStore((s) => s.followView);
  const store = useActions();

  return (
    <>
      <header className="inspector__identity">
        <span className="inspector__identity-text">
          <span className="inspector__identity-name">{doc.name}</span>
          <span className="inspector__identity-kind">
            {doc.tiles.length} {doc.tiles.length === 1 ? "tile" : "tiles"}
          </span>
        </span>
      </header>

      <Group title="Board">
        <Field label="Name">
          <Input value={doc.name} onChange={(e) => store.setBoardProp({ name: e.target.value })} />
        </Field>
        <Field label="Output shape">
          <Segmented
            size="sm"
            value={aspectKey(doc.aspect)}
            onChange={(key) => store.setBoardProp({ aspect: ASPECTS[key] })}
            options={Object.keys(ASPECTS).map((k) => ({ value: k as AspectKey, label: k }))}
          />
        </Field>
      </Group>

      <Group title="Stage">
        <p className="inspector__note">
          Only the {stageLabel(doc.frame)} rectangle is shared. Everything else on
          the board is yours alone.
        </p>
        <div className="btn-row">
          <Button block onClick={() => store.selectStage(true)}>
            Edit the stage
          </Button>
          <Button block onClick={() => store.showStage()}>
            Show me the stage
          </Button>
        </div>
        <Switch
          label="Drag the audience with my view"
          hint="Off, the stage stays put and roaming the board is private."
          checked={followView}
          onChange={(on) => store.setFollowView(on)}
        />
      </Group>

      <Group title="Your name on the shot">
        <p className="inspector__note">
          A banner in the corner of the stage. Leave both empty for none.
        </p>
        <div className="grid-2">
          <Field label="Name">
            <Input
              value={doc.lowerThird?.name ?? ""}
              placeholder="Adam Selman"
              onChange={(e) =>
                store.setLowerThird({ name: e.target.value, role: doc.lowerThird?.role ?? "" })
              }
            />
          </Field>
          <Field label="What you do">
            <Input
              value={doc.lowerThird?.role ?? ""}
              placeholder="BrandBased"
              onChange={(e) =>
                store.setLowerThird({ name: doc.lowerThird?.name ?? "", role: e.target.value })
              }
            />
          </Field>
        </div>
        {(doc.lowerThird?.name || doc.lowerThird?.role) && (
          <Button block onClick={() => store.setLowerThird(null)}>
            Take the banner off
          </Button>
        )}
      </Group>

      <Group title="Capture">
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
              { value: "70", label: "Draft" },
              { value: "85", label: "Standard" },
              { value: "95", label: "High" },
            ]}
          />
        </Field>
      </Group>

      <Group title="Canvas">
        <Checkbox
          label="Show the grid in the cockpit"
          checked={doc.showGrid}
          onChange={(showGrid) => store.setBoardProp({ showGrid })}
        />
        <div className="btn-row">
          <Button block onClick={() => store.arrange("all")}>
            Arrange onto the stage
          </Button>
          <Button block onClick={() => store.clearInk()}>
            Clear ink
          </Button>
        </div>
      </Group>

      <p className="inspector__hint">
        Nothing selected. Click a tile on the canvas, or pick one from the list on
        the left.
      </p>
    </>
  );
}

function GuestsTab() {
  const guests = useStore((s) => s.guests);
  const powers = useStore((s) => s.guestPowers);
  const store = useActions();
  const [copied, setCopied] = useState(false);

  return (
    <>
      <Group title="Guest link">
        {guests.running && guests.link ? (
          <>
            <div className="link-row">
              <code>{guests.link}</code>
              <Button
                size="sm"
                onClick={async () => {
                  await navigator.clipboard.writeText(guests.link!);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1600);
                }}
              >
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <Button block tone="danger" onClick={() => void store.stopGuests()}>
              Close the link
            </Button>
          </>
        ) : (
          <Button block tone="primary" onClick={() => void store.startGuests()}>
            Open a guest link
          </Button>
        )}
      </Group>

      {guests.running && (
        <Group title="What guests can do">
          <Switch
            label="Draw on the board"
            hint="Their marks become ink you can clear"
            checked={powers.draw}
            onChange={(draw) => store.setGuestPowers({ draw })}
          />
          <Switch
            label="Look around on their own"
            hint="Pan and zoom away from your frame"
            checked={powers.roam}
            onChange={(roam) => store.setGuestPowers({ roam })}
          />
          <Switch
            label="Drop files in"
            hint="Images and PDFs, up to 12 MB"
            checked={powers.files}
            onChange={(files) => store.setGuestPowers({ files })}
          />
          <Switch
            label="Share their screen or camera"
            hint="Lands on your board off the stage. Nothing they share reaches the call until you put it in the shot."
            checked={powers.share}
            onChange={(share) => store.setGuestPowers({ share })}
          />
          <Switch
            label="Move things and move the shot"
            hint="Makes them a co-host: they can drag tiles around and change what everyone is looking at."
            checked={powers.control}
            onChange={(control) => store.setGuestPowers({ control })}
          />
        </Group>
      )}

      <Group title={`In the room${guests.guests.length ? ` · ${guests.guests.length}` : ""}`}>
        {guests.guests.map((guest) => (
          <div className="guest-row" key={guest.id}>
            <Avatar name={guest.name} size={26} />
            <span className="guest-row__name">{guest.name}</span>
            <Badge tone={guest.view ? "neutral" : "success"}>
              {guest.view ? "roaming" : "with you"}
            </Badge>
          </div>
        ))}
        {guests.guests.length === 0 && (
          <p className="field__hint">
            {guests.running ? "Nobody yet — send them the link." : "Open the link to let people in."}
          </p>
        )}
      </Group>

      <p className="inspector__hint">
        Guests see the board, not your desktop — only the tiles you have put on it,
        and only while they are on it.
      </p>
    </>
  );
}

/* ==========================================================================
   Helpers
   ========================================================================== */

const ASPECTS = { "16:9": 16 / 9, "16:10": 16 / 10, "4:3": 4 / 3, "1:1": 1 } as const;
type AspectKey = keyof typeof ASPECTS;

function aspectKey(aspect: number): AspectKey {
  let best: AspectKey = "16:9";
  let delta = Infinity;
  for (const key of Object.keys(ASPECTS) as AspectKey[]) {
    const d = Math.abs(ASPECTS[key] - aspect);
    if (d < delta) {
      delta = d;
      best = key;
    }
  }
  return best;
}

function kindLabel(tile: Tile): string {
  switch (tile.kind) {
    case "source":
      return "Live source";
    case "camera":
      return "Camera";
    case "image":
      return "Image";
    case "web":
      return "Web page";
    case "video":
      return "Video";
    case "pdf":
      return "Document";
    case "note":
      return "Note";
  }
}
