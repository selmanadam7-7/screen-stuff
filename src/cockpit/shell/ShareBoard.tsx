/**
 * Share board.
 *
 * The reference lays this out as invite / link / permissions / access summary,
 * and that shape is kept. What it is wired to is what Screen Drop actually has:
 * a link on the local network, three live powers, and a real roster. There is no
 * invite-by-email box here, because there are no accounts to invite.
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

export function ShareBoard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const guests = useStore((s) => s.guests);
  const powers = useStore((s) => s.guestPowers);
  const doc = useStore((s) => s.doc);
  const store = useActions();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const sourceCount = doc.tiles.filter((t) => t.kind === "source" || t.kind === "web").length;

  const copy = async () => {
    if (!guests.link) return;
    await navigator.clipboard.writeText(guests.link);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
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
                <code>{guests.link ?? "open the link to generate one"}</code>
              </div>
              {guests.running && (
                <Button size="sm" onClick={() => void copy()}>
                  {copied ? "Copied" : "Copy link"}
                </Button>
              )}
            </div>
            <Button
              block
              tone={guests.running ? "danger" : "primary"}
              disabled={busy}
              onClick={() => void toggleLink()}
            >
              {guests.running ? "Close the link" : "Open a guest link"}
            </Button>
            <p className="field__hint">
              The link works for anyone on your network. It lives on its own port
              behind its own token, and closing it disconnects everyone at once.
            </p>
          </Group>

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
                <dd>Your network</dd>
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
