/**
 * Share board.
 *
 * The reference lays this out as invite / link / permissions / access summary,
 * and that shape is kept. What it is wired to is what Screen Stuff actually has:
 * a real link, three live powers, and a real roster. There is no invite-by-email
 * box here, because there are no accounts to invite.
 *
 * The link has two reaches, and the difference matters enough to be a visible
 * choice rather than a setting: **this network**, which is a server on your own
 * machine and goes no further, and **anywhere**, which opens a public address
 * through Cloudflare. The second is what you need for a call with someone in
 * another building, and it is also the one that puts a door onto the internet,
 * so it says so.
 */

import { useState } from "react";
import {
  CameraIcon,
  CheckIcon,
  EyeIcon,
  ImageIcon,
  PenIcon,
  ScreenIcon,
  ShieldIcon,
  WebIcon,
} from "../../ui/icons";
import { Avatar, Badge, Button, Group, Modal, Switch, cx } from "../../ui/primitives";
import { useActions, useStore } from "../store";

/**
 * The link a broadcast tool takes, and what it is for.
 *
 * This is how Screen Stuff becomes a webcam. Windows' own virtual camera API
 * wants a COM server registered machine-wide and loaded into the Frame Server
 * service, which is system surgery this app promised not to do. Every broadcast
 * tool already ships a virtual camera and a browser source, so this hands the
 * shot to the one already installed -- and it works the same on macOS, where
 * the equivalent API is no friendlier.
 */
function OutputLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Group title="Into OBS, and from there into anything">
      <div className="link-row">
        <code>{url}</code>
        <Button
          size="sm"
          onClick={async () => {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="field__hint">
        The same board with none of the furniture -- no toolbar, no cursors, no
        names. Add a <strong>Browser</strong> source in OBS, Streamlabs, vMix or
        Ecamm, paste this, set it to 1920&nbsp;&times;&nbsp;1080, and start that
        tool's virtual camera. Screen Stuff is then a webcam in Discord, Meet,
        Zoom, Teams and anywhere else that takes one.
      </p>
    </Group>
  );
}

export function ShareBoard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const guests = useStore((s) => s.guests);
  const powers = useStore((s) => s.guestPowers);
  const doc = useStore((s) => s.doc);
  const store = useActions();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const tunnel = guests.tunnel;
  const publicOn = tunnel.state === "running" && !!guests.publicLink;
  const working = tunnel.state === "preparing" || tunnel.state === "starting";
  // The address people are actually given, so Copy and the readout can never
  // disagree about which one is live.
  const shareUrl = publicOn ? guests.publicLink : guests.link;

  const sourceCount = doc.tiles.filter((t) => t.kind === "source" || t.kind === "web").length;

  const copy = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const toggleReach = async () => {
    setBusy(true);
    await (publicOn ? store.stopTunnel() : store.startTunnel());
    setBusy(false);
  };

  const toggleLink = async () => {
    setBusy(true);
    await (guests.running ? store.stopGuests() : store.startGuests());
    setBusy(false);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Share board"
      subtitle={doc.name}
      width={860}
      footer={
        <>
          <span className="modal__foot-spacer" />
          <Button onClick={onClose}>Done</Button>
        </>
      }
    >
      <div className="share">
        <div className="share__main">
          <Group title="Link sharing">
            <div className={cx("share__link", guests.running && "is-open")}>
              <span className="share__link-icon">
                <WebIcon size={16} aria-hidden />
              </span>
              <div className="share__link-text">
                <span className="share__link-title">
                  {guests.running ? "Anyone with the link" : "The link is closed"}
                </span>
                <code>{shareUrl ?? "open the link to generate one"}</code>
              </div>
              {guests.running && shareUrl && (
                <Button size="sm" onClick={() => void copy()}>
                  {copied ? "Copied" : "Copy link"}
                </Button>
              )}
            </div>

            {guests.running && (
              <div className="reach">
                <ReachOption
                  active={!publicOn && !working}
                  disabled={busy || working}
                  title="This network only"
                  detail="A server on your machine. It cannot be reached from outside your wifi."
                  onSelect={() => void (publicOn ? toggleReach() : undefined)}
                />
                <ReachOption
                  active={publicOn}
                  busy={working}
                  disabled={busy}
                  title="Anywhere"
                  detail={
                    working
                      ? tunnel.message || "opening a public address"
                      : "A public address through Cloudflare, for people off your network."
                  }
                  onSelect={() => void (publicOn ? undefined : toggleReach())}
                />
              </div>
            )}

            {publicOn && (
              <p className="share__warn">
                <ShieldIcon size={14} aria-hidden />
                <span>
                  The board is reachable from the internet while this is on. The
                  token in the link is what keeps strangers out, so treat the link
                  like a password and close it when the call ends.
                </span>
              </p>
            )}
            {tunnel.state === "failed" && tunnel.message && (
              <p className="share__warn is-bad">
                <ShieldIcon size={14} aria-hidden />
                <span>{tunnel.message}</span>
              </p>
            )}

            <Button
              block
              tone={guests.running ? "danger" : "primary"}
              disabled={busy}
              onClick={() => void toggleLink()}
            >
              {guests.running ? "Close the link" : "Open a guest link"}
            </Button>
            <p className="field__hint">
              The link lives on its own port behind its own token, and closing it
              disconnects everyone at once -- and takes the public address down
              with it.
            </p>
          </Group>

          {guests.running && (publicOn ? guests.publicOutputLink : guests.outputLink) ? (
            <OutputLink url={(publicOn ? guests.publicOutputLink : guests.outputLink)!} />
          ) : null}

          <Group title="Permissions">
            <table className="perm">
              <thead>
                <tr>
                  <th />
                  <th>Can see</th>
                  <th>Can change</th>
                </tr>
              </thead>
              <tbody>
                <PermRow
                  icon={ScreenIcon}
                  label="Screens on the board"
                  see
                  change={false}
                  note={`${sourceCount} live`}
                />
                <PermRow icon={CameraIcon} label="Your camera" see change={false} />
                <PermRow
                  icon={PenIcon}
                  label="Ink"
                  see
                  change={powers.draw}
                  onChange={(draw) => store.setGuestPowers({ draw })}
                />
                <PermRow
                  icon={ImageIcon}
                  label="Dropping files in"
                  see
                  change={powers.files}
                  onChange={(files) => store.setGuestPowers({ files })}
                />
                <PermRow
                  icon={EyeIcon}
                  label="Looking around on their own"
                  see
                  change={powers.roam}
                  onChange={(roam) => store.setGuestPowers({ roam })}
                />
              </tbody>
            </table>
          </Group>
        </div>

        <aside className="share__side">
          <Group
            title="Access summary"
            action={
              <Badge tone={guests.running ? "success" : "neutral"}>
                <ShieldIcon size={11} aria-hidden />
                {guests.running ? "Open" : "Closed"}
              </Badge>
            }
          >
            <dl className="summary">
              <div>
                <dt>Link sharing</dt>
                <dd>{guests.running ? "On" : "Off"}</dd>
              </div>
              <div>
                <dt>Reachable from</dt>
                {/* The summary has to agree with the cards above it. Saying
                    "your network" while a public address is live would be the
                    most dangerous sentence in the app. */}
                <dd className={cx(publicOn && "is-warn")}>
                  {!guests.running ? "Nowhere" : publicOn ? "Anywhere" : "Your network"}
                </dd>
              </div>
              <div>
                <dt>Sources exposed</dt>
                <dd className="numeric">{sourceCount}</dd>
              </div>
              <div>
                <dt>Recording</dt>
                <dd>Never</dd>
              </div>
            </dl>
            <p className="field__hint">
              Guests can only open the sources this board is showing. Take a tile
              off and their access to it stops immediately.
            </p>
          </Group>

          <Group title={`In the room · ${guests.guests.length}`}>
            {guests.guests.map((guest) => (
              <div className="guest-row" key={guest.id}>
                <Avatar name={guest.name} size={28} />
                <span className="guest-row__name">{guest.name}</span>
                <Badge tone={guest.view ? "neutral" : "success"}>
                  {guest.view ? "roaming" : "with you"}
                </Badge>
              </div>
            ))}
            {guests.guests.length === 0 && (
              <p className="field__hint">
                {guests.running ? "Nobody has joined yet." : "Nobody can join while the link is closed."}
              </p>
            )}
          </Group>
        </aside>
      </div>
    </Modal>
  );
}

/**
 * One of the two reaches.
 *
 * A pair of cards rather than a switch: "on/off" does not say what is being
 * turned on, and this is the control that decides whether the board is on the
 * internet.
 */
function ReachOption({
  active,
  busy,
  disabled,
  title,
  detail,
  onSelect,
}: {
  active: boolean;
  busy?: boolean;
  disabled?: boolean;
  title: string;
  detail: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={cx("reach__option", active && "is-active", busy && "is-busy")}
      disabled={disabled}
      aria-pressed={active}
      onClick={onSelect}
    >
      <span className="reach__mark">
        {busy ? <span className="reach__spin" /> : active ? <CheckIcon size={12} /> : null}
      </span>
      <span className="reach__text">
        <span className="reach__title">{title}</span>
        <span className="reach__detail">{detail}</span>
      </span>
    </button>
  );
}


function PermRow({
  icon: IconComponent,
  label,
  see,
  change,
  note,
  onChange,
}: {
  icon: typeof ScreenIcon;
  label: string;
  see: boolean;
  change: boolean;
  note?: string;
  onChange?: (on: boolean) => void;
}) {
  return (
    <tr>
      <th scope="row">
        <IconComponent size={15} aria-hidden />
        <span>{label}</span>
        {note && <em>{note}</em>}
      </th>
      <td>
        <span className={cx("perm__mark", see && "is-on")} aria-label={see ? "Yes" : "No"}>
          {see && <CheckIcon size={12} weight="Filled" />}
        </span>
      </td>
      <td>
        {onChange ? (
          <Switch checked={change} onChange={onChange} label={`${label} — can change`} hideLabel />
        ) : (
          <span className="perm__mark" aria-label="No" />
        )}
      </td>
    </tr>
  );
}
