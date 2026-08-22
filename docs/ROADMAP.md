# What is built, and what is not

## Built

- **Capture** — displays, individual windows (including ones buried behind
  others), and drawn regions. One capture per source however many tiles use it,
  and none at all for a source nothing is watching.
- **The board** — an infinite canvas with source, camera, image, web, video, PDF
  and note tiles, an ink layer, snapping, arrange-into-frame, spotlight, scenes,
  and a public/private frame split.
- **The cockpit** — source rail with live previews, editor canvas, inspector,
  minimap, scene strip, health readout, and a collapsed strip for mid-call.
- **Share mode** — the board is a real window; share it in anything.
- **Guest links** — a second listener on the local network, off by default, with
  its own short token. Guests run the same renderer, may only reach the sources
  actually on the board, and can draw, drop files and roam if you let them.
- **Boards and templates** — saved as JSON, autosaved once named, atomic writes.
- **Installer** — a signed-able NSIS setup you can hand to someone.

## Not built

### Camera output

Screen Drop appearing as a webcam, so it works in apps you never share a window
in.

**What it needs.** Windows has no way for a normal process to *be* a camera. The
supported route is `MFCreateVirtualCamera`, which needs a Media Foundation media
source registered under its own CLSID — a separate COM DLL, registered at install
time, that reads frames the app writes into shared memory. That is a real
component with its own lifetime, not a function call: roughly a thousand lines of
COM, a registration step, and a compatibility matrix across Discord, Zoom, Meet
and Teams, each of which enumerates cameras slightly differently.

**Why it was left until last.** It is the only piece whose failure mode is
invisible from here: I can build it, but I cannot verify that Discord lists it
without driving Discord's UI. Everything else in this app was verified running.
Shipping an unverified camera would have meant telling you something works when I
had not seen it work.

**What you lose without it, honestly.** Share mode covers Discord, Meet, Zoom and
Slack today, carries audio, and is what most calls use anyway. Camera mode buys
you two things: it frees the screen-share slot, and it works in the handful of
places where sharing is awkward. It is a real gap, not a fatal one.

### Guests beyond the local network

The guest link works for anyone on the same network. For someone across the
country you currently need to point a tunnel at the port.

**What it needs.** Either a hosted relay you run, or an SFU. The architecture
already assumes this: guests receive a document and open per-tile streams, so
swapping the transport for LiveKit means replacing the socket, not the design.

**Where the ceiling is.** Every guest currently gets their own encode of every
tile they can see. That is fine for a handful of people and wrong for fifty —
past roughly ten, an SFU stops being an optimisation and starts being the only
way.

### Smaller things

- **Cursor-follow framing.** The nav modes are in place; the follow-the-cursor
  mode is not wired to a cursor source yet.
- **A QR code for the guest link.** Typing a LAN address into a phone is the one
  rough edge in the guest flow.
- **Per-guest kick.** Powers are room-wide; there is no way to revoke one person.
- **Code signing.** Shipping unsigned, so anyone installing clicks through
  SmartScreen. A certificate is the whole fix.

## Deliberately not doing

- **Session recording.** Decided against: the call is the call.
- **A bundled virtual audio device.** Camera streams carry no audio anywhere, in
  any app. Rather than install an audio driver by default, Screen Drop leans on
  share mode when sound matters. If that ever stops being enough, the device
  becomes an optional separate download — never something the installer does to
  a machine on its own.
