/**
 * The one thing on the page that is not the product.
 *
 * A visitor arriving at a demo has two questions: what am I looking at, and is
 * this real. The answer to both is "the actual app, minus your screens", and it
 * is worth saying in one line rather than making them work it out.
 *
 * It also carries the only call to action, because a demo that does not tell
 * you where to get the thing is a toy.
 */

import { useState } from "react";
import { CloseIcon, DownloadIcon } from "../ui/icons";
import { Brand } from "../ui/Brand";
import { Button, IconButton } from "../ui/primitives";

const RELEASES = "https://github.com/selmanadam7-7/screen-stuff/releases/latest";

const TRY: Array<[string, string]> = [
  ["Drag the blue rectangle", "that is the stage — the only part your call sees"],
  ["Press 0", "come back to it from anywhere"],
  ["Press T", "cut to the shot you set up off air"],
  ["Director → Picture in picture", "rearrange the shot in one click"],
];

export function DemoBanner() {
  const [open, setOpen] = useState(true);
  if (!open) return null;

  return (
    <aside className="demo-banner">
      <header className="demo-banner__head">
        <Brand size={22} className="demo-banner__mark" />
        <div>
          <b>This is Screen Stuff, actually running.</b>
          <p>
            The same app, the same code — with drawn desktops instead of your
            monitors. Everything you click is real.
          </p>
        </div>
        <IconButton icon={CloseIcon} label="Hide this" onClick={() => setOpen(false)} />
      </header>

      <ul className="demo-banner__try">
        {TRY.map(([what, why]) => (
          <li key={what}>
            <b>{what}</b>
            <span>{why}</span>
          </li>
        ))}
      </ul>

      <Button
        block
        tone="primary"
        icon={DownloadIcon}
        onClick={() => window.open(RELEASES, "_blank", "noopener")}
      >
        Get it for Windows
      </Button>
      <p className="demo-banner__foot">
        Free and open source. Your screens never leave your machine.
      </p>
    </aside>
  );
}
