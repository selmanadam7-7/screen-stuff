<p align="center">
  <img src="assets/brand/icon/screen-stuff-256.png" width="132" alt="Screen Stuff" />
</p>

<h1 align="center">Screen Stuff</h1>

<p align="center">
  <b>An infinite board that holds every screen you have,<br />
  and hands one rectangle of it to any call.</b>
</p>

<p align="center">
  Windows 10 1809+ &middot; 64-bit &middot; Tauri&nbsp;2 + Rust &middot; 3&nbsp;MB installer
</p>

---

Every monitor, every window, every crop you care about becomes a live tile on a
Figma-style canvas. One rectangle on that canvas — the **stage** — is what the
call sees. Everything else is yours: you pan, zoom and rummage around your own
board while you talk, and nobody follows. No alt-tabbing, no restarting a share,
no "hold on, let me share a different screen".

<table>
<tr>
<td width="33%" align="center">
  <img src="assets/brand/illustrations/screen-wall.png" height="112" alt="" /><br />
  <b>Everything, at once</b><br />
  <sub>Four monitors, buried windows, a crop of one corner, your camera — all live tiles on one canvas.</sub>
</td>
<td width="33%" align="center">
  <img src="assets/brand/illustrations/board-glyph.png" height="112" alt="" /><br />
  <b>One rectangle is shared</b><br />
  <sub>The stage is what they see. The rest of the board is your private workspace, mid-call.</sub>
</td>
<td width="33%" align="center">
  <img src="assets/brand/illustrations/device-stack.png" height="112" alt="" /><br />
  <b>Any app takes it</b><br />
  <sub>The board is an ordinary window. Discord, Meet, Zoom and Teams all share it, with audio.</sub>
</td>
</tr>
</table>

---

## Installing it

Windows 10 1809 or newer, 64-bit.

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install.ps1
```

That takes the published installer if there is one and builds from source if
there is not, then checks the app is actually there rather than assuming. Add
`-CheckOnly` to see what it would do first. It installs per-user, needs no
administrator rights, and touches no drivers or system settings.

Or hand this repository to your coding agent and ask it to install Screen Stuff
-- [`AGENTS.md`](AGENTS.md) tells it everything it needs, including the failure
modes worth knowing about.

Builds are unsigned, so a downloaded copy trips SmartScreen once: **More info**
then **Run anyway**.

## Running it

```bash
pnpm install
pnpm app          # dev: cockpit + board, hot reloading
pnpm app:build    # release: writes an installer to src-tauri/target/release/bundle
```

Other useful scripts:

```bash
pnpm test         # frontend suite (vitest)
pnpm test:rust    # engine suite (cargo)
pnpm check        # typecheck + clippy, no warnings allowed
```

## How it looks

The interface is built from fifteen reference screenshots, with the palette
measured out of them rather than matched by eye — primary `#0562FE`, ink
`#1E2329`, borders `#DDDDE1`. Five looks ship (pure white, liquid glass, arctic
blue, graphite dark, spectrum pro) as token overrides, switchable in
**Settings → Look**. Icons are [Reicon](https://reicon.dev), mapped by meaning in
one file. Type is Inter, bundled rather than assumed.

The rules, the measurements and what was deliberately *not* faked from the
references are in [`docs/DESIGN.md`](docs/DESIGN.md).

## Two windows

**Cockpit** (`index.html`) — the control surface. The board's contents on the
left, canvas in the middle under a floating toolbar, inspector on the right,
scenes along the bottom. Everything you do happens here. Park it on a spare
monitor.

**Board** (`board.html`) — the output. No title bar, no chrome, no cursor. This
is the window you share in Discord, and the canvas whose pixels a camera or a
guest would receive. Nothing is ever drawn on it that the audience should not
see. Alt-drag moves it; the cockpit does the rest.

## What can go on the board

| Tile | What it is |
| --- | --- |
| **Display** | One of your monitors, live. |
| **Window** | One app window — captured even when it is buried behind everything else. |
| **Region** | A rectangle you drag on any screen. Shows one chart without the desktop around it. |
| **Camera** | Your webcam, croppable, circular or rectangular, mirrored or not. |
| **Image** | Paste a screenshot, or drag a file in. |
| **Web page** | A real browser window, parked off screen and captured — see below. |
| **Video** | A file, played on the board. |
| **Document** | A PDF, a page at a time. |
| **Note** | Text on coloured paper. |

Plus an ink layer — pen, highlighter, arrow, box, ellipse — that draws on top of
live feeds while they are still moving. Ink can be permanent or set to fade on
its own, for pointing at something mid-sentence.

## Keyboard

Local keys work while the cockpit has focus. Global keys (`Ctrl+Alt+…`) fire even
while you are typing in Discord.

| Key | |
| --- | --- |
| `0` | show the stage |
| `Shift+0` | fit everything in your view |
| `Ctrl+←` / `Ctrl+→` | back / forward through the views you have jumped to |
| `1`–`9` | jump to that scene |
| `G` | go private / come back |
| `Enter` | move the stage to your view |
| `F` | grab the window in front |
| `P H A B O` | pen, highlighter, arrow, box, ellipse |
| `Esc` | back to the pointer |
| `Space` + drag | pan the canvas |
| double-click | spotlight a tile |
| `←` `↑` `→` `↓` | nudge the selection, or the stage |
| `Ctrl+D` / `Ctrl+L` | duplicate / lock |
| `Ctrl+Z` / `Ctrl+Y` | undo / redo |
| `Ctrl+S` | save the stage as a scene |
| `Ctrl+Shift+S` | save the board |
| `Del` | remove selected |
| `Alt` + drag | move the board window |
| `Ctrl+Alt+B` | show or hide the board, from anywhere |
| `Ctrl+Alt+G` | go private, from anywhere |
| `Ctrl+Alt+Enter` | move the stage to your view, from anywhere |
| `Ctrl+Alt+0` | show the stage, from anywhere |
| `Ctrl+Alt+F` | grab the front window, from anywhere |
| `Ctrl+Alt+1`–`9` | scenes, from anywhere |

## The stage

The blue rectangle on the canvas is the stage. It is the only part of the board
anyone else ever sees, and it stays where you put it.

Everything outside it is private by default. Pan across to your notes, zoom into
a window to read it, drag in a new screen and park it off to one side — the call
keeps looking at the stage the whole time. That is the difference between a board
and a screen share: the board is bigger than the shot.

**Moving it.** Grab the stage by its edge or by the name tab above its corner and
drag. The eight handles resize it, always at the output shape. `Enter` moves it
to whatever you are looking at right now, and the inspector has exact numbers if
you want it lined up on a pixel. It is saved with the board, so it is where you
left it next time.

**Locking it.** Mid-call, one stray drag can re-aim the broadcast. **Lock against
dragging** stops the mouse moving it; scenes, `Enter` and the inspector still
work, because those are deliberate.

**Getting back.** Nothing in the app can take you somewhere you cannot leave.
`0` comes home to the stage from anywhere, `Ctrl+←` steps back through every jump
you have made, and the zoom pill has both as buttons. A hint appears when you
have wandered off, saying so and offering the way back.

**Following, if you want it.** Turn on **Drag the audience with my view** in
Settings and the old behaviour returns: whatever you look at is what they see.
It is off by default because with it on there is no private area at all.

**Going private.** **Go private** freezes the audience on the last shot while you
rearrange, then **Bring them here** moves the stage to where you now are.

In the cockpit everything outside the stage is dimmed and the stage is outlined
and named — so what is on air is never a guess.

## Audio, honestly

A webcam is a video-only device. When an app asks Windows for "the camera" it
gets picture and nothing else — so in camera mode, a video playing on your board
is seen and not heard. That is true of every app, not just this one.

There are exactly three ways sound reaches the other person: your microphone,
a screen share (which carries the shared app's own audio), or a virtual audio
device — a real driver install.

So Screen Stuff leans on share mode when sound matters. Share the board window and
the audio of anything playing on it travels with it. On Discord you can run both
at once: camera mode carrying the board, plus a screen share of the same window
carrying the sound.

## Web tiles

A web tile is not an iframe. An iframe cannot be composited into the output
canvas, so web tiles would vanish in camera mode and for guests. Instead each one
is a real browser window that Screen Stuff owns, parked off screen and captured
like any other window — so it behaves exactly like a monitor tile everywhere it
matters. **Click in it** brings the page forward for a moment so you can interact,
then parks it again. Same trade OBS makes.

## Guest links

A guest opens a link and sees the board in their browser. They get the board
*document* and subscribe to the same source streams, then run the same renderer
the cockpit does -- so they can look around on their own, draw, and drop a file
in, without any of that costing you a second encode.

The security boundary: a guest may only open sources the published board
actually uses. Take a tile off the board and their access to it stops in the
same breath.

### How far the link reaches

Two choices, and the Share dialog makes you pick rather than burying it:

**This network only** (the default). The guest server listens on this machine.
Anyone on the same wifi can open the link; nobody else can reach it at all.

**Anywhere.** Opens a public `https://….trycloudflare.com` address that
forwards to that same loopback port. `cloudflared` dials *out* to Cloudflare, so
it needs no port forwarding, no static address and no router conversation -- it
works from a hotel, an office network, or behind CGNAT. No account and no
payment either.

The helper binary is fetched once, on the first use, into
`%APPDATA%\screen-stuff\cloudflared.exe`, and only over HTTPS from Cloudflare's
own repository. It is about 40 MB, which is why it is not in the 2.6 MB
installer.

What that costs, said plainly:

- The guest server is reachable from the internet while the tunnel is up. The
  16-character token in the link is what keeps strangers out -- treat the link
  like a password. Closing the guest link takes the public address down with it.
- The address is random and changes every session, so yesterday's link is dead.
  Good for security, mildly annoying for a recurring meeting.
- Frames pass through Cloudflare. They are JPEG over TLS, but not end-to-end
  encrypted, and someone else's machine is carrying them. If that matters for a
  particular call, stay on the local option.

## Boards

Boards save whole — layout, tiles, ink, scenes, hotkeys — as JSON under
`%APPDATA%\screen-stuff\boards`. Save one as a **template** to spawn pre-arranged
boards for a call type. A board that already has a file autosaves a few seconds
after you stop making changes; an unnamed scratch board stays unsaved until you
decide it is worth keeping.

Nothing is recorded. The call is the call.

## How it fits together

```
WGC capture ──▶ scale + JPEG ──▶ WebSocket ──▶ decode ──▶ one canvas ──▶ share / camera / guests
 (one per source)   (one per tile)   (loopback)
```

- **`src-tauri/src/capture.rs`** — Windows Graphics Capture sessions, a lossy
  single-slot frame mailbox, a buffer pool, and one encode worker per rendition.
  Several tiles on the same source share one capture.
- **`src-tauri/src/server.rs`** — a loopback WebSocket, token-gated, serving
  frames as binary and control as JSON.
- **`src/core/render.ts`** — the compositor. One function draws the board, and it
  is called twice: by the board window with no chrome, and by the cockpit with
  selection, handles, guides and the frame outline. Sharing the draw path is what
  guarantees the cockpit is telling the truth.
- **`src/cockpit/store.ts`** — the document lives here. The board window is a
  renderer that receives snapshots, which is what lets the thing you edit and the
  thing on air be deliberately different.

A tile that is small on screen asks for fewer pixels; a tile that is spotlit asks
for more. An unwatched source stops capturing entirely.

## Performance

Measured on an RTX 5070 / i7-14700F, four 1440p displays:

| | |
| --- | --- |
| Scale + encode, 1440p → thumbnail | **3.3 ms** release, 4.6 ms dev |
| Four live displays + note + ink, composited | 60 fps at 1920×1080 |

Two notes for anyone changing the encode path:

- Dependencies build optimised even in dev (`[profile.dev.package."*"]`), **and so
  does this crate** (`[profile.dev] opt-level = 1`) — the resize and encode entry
  points are generic, so their bodies monomorphise into this crate and compile at
  *its* opt-level. At `0` a single thumbnail frame took 434 ms.
- Crop and scale happen in one pass over an immutable view of the frame. The
  obvious version copies the frame two or three times, which at 1440p is ~30 MB
  of memory traffic before any real work starts.

## Security

The frame server binds to `127.0.0.1` on an ephemeral port behind a token
generated fresh on every launch, and the token is checked before the WebSocket
upgrade is even considered. Without that, a web page that guessed the port could
read every screen you own.

Debug builds log the full stream URL so the cockpit can be opened in a browser
against a running engine. Release builds never do.

## Development tools

```bash
node scripts/probe-frame.mjs <ws-url> <out-dir> monitor:1 window:1234   # pull one frame from each source
node scripts/probe-stats.mjs <ws-url> [samples] [gap-ms]                # watch the engine's counters
node scripts/check-board.mjs <ws-url> out.png                           # end-to-end render check
node scripts/shoot.mjs <url> out.png                                    # screenshot the cockpit
node scripts/check-stage.mjs [base-url]                                 # drive the stage in a real browser
node scripts/check-layout.mjs [base-url]                                # measure the shell at five widths
node scripts/check-tunnel.mjs                                           # prove off-network sharing really works
node scripts/shoot-stage.mjs <out-dir> [base-url]                       # the stage in every state
node scripts/make-icons.mjs                                             # redraw the app icon
```

The stream URL is printed by `pnpm app` on startup in debug builds.

## Not built yet

Camera output — Screen Stuff appearing as a webcam — is the one promised piece
that is not here. It needs a registered Media Foundation media source, which is a
separate COM component rather than a function call, and it is the only part whose
failure mode could not be verified from a terminal. Share mode covers Discord,
Meet, Zoom and Slack today and carries audio.

See [`docs/ROADMAP.md`](docs/ROADMAP.md) for exactly what it needs, what you lose
without it, and the smaller gaps.

## Brand

Everything visual lives in [`assets/brand`](assets/brand), and the app reads it
from there rather than keeping its own copy:

| | |
| --- | --- |
| [`icon/`](assets/brand/icon) | The face of Screen Stuff. `scripts/make-icons.mjs` copies it into the Tauri bundle and the web pages, so the taskbar, the installer and every browser tab show the same one. |
| [`logo/`](assets/brand/logo) | The mark, in blue, white and black, plus `logo-current.svg` which draws in `currentColor`. `scripts/make-brand-component.mjs` turns that one into `src/ui/Brand.tsx`, which is the mark you see in the title bar and on the guest page. |
| [`illustrations/`](assets/brand/illustrations) | The drawings above. |

Both scripts only ever copy or transcribe. Nothing redraws the icon, because a
redrawn icon is one that drifts away from the brand folder without anyone
noticing.

```bash
node scripts/make-icons.mjs            # brand -> app icons and favicons
node scripts/make-brand-component.mjs  # logo SVG -> the React mark
```

## Tests

```
cargo test    70 passing   engine, feeds, protocol, sources, store, guests, tunnel
vitest       177 passing   geometry, document, stage, resize, wire, render, frames, design
```

Plus harnesses that exercise the real thing rather than a mock: `probe-frame`
pulls a frame from every source, `check-board` renders a full board against the
live engine, `check-guest` joins a guest link and verifies the security gate,
`check-camera-feed` proves the host's camera reaches a guest, `check-stage` drags
the stage around a running cockpit and checks that no control leaves you
stranded, `check-layout` measures the shell at five window widths, `shoot-system`
and `shoot-stage` capture every look, page, modal and stage state in one pass,
and `guest_harness` stands the whole guest path up without the app shell.
