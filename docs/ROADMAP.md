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
- **Guest links** — a second listener, off by default, on the local network or
  through a Cloudflare tunnel, with
  its own short token. Guests run the same renderer, may only reach the sources
  actually on the board, and can draw, drop files and roam if you let them.
- **Boards and templates** — saved as JSON, autosaved once named, atomic writes.
- **Installer** — a signed-able NSIS setup you can hand to someone.

## Not built

### A camera of our own

Screen Stuff appearing in the camera list itself, rather than through another
tool's virtual camera.

**There is a working answer today, and it is the output link.** Share → the
output link is the board with none of the furniture, at `/o/<token>`. Point a
Browser source at it in OBS, Streamlabs, vMix or Ecamm, start that tool's virtual
camera, and Screen Stuff is a webcam in Discord, Meet, Zoom and Teams. No driver,
no admin, nothing registered, and it works the same on macOS. `check-output.mjs`
loads it at four window shapes and asserts the letterboxing and the absence of
every piece of interface, because both failures are silent.

**Why not a native one.** Windows' own route is `MFCreateVirtualCamera`, and
[the documentation](https://learn.microsoft.com/en-us/windows/win32/api/mfvirtualcamera/nf-mfvirtualcamera-mfcreatevirtualcamera)
is unambiguous about what it costs: the `sourceId` must be the CLSID of a
registered Media Foundation media source. That source is a separate COM DLL, and
because the Frame Server loads it as LOCAL SERVICE in session 0, it must be
registered under `HKLM` — HKCU is invisible to the service — which means an
elevated install step. The DLL then runs inside a Microsoft service, where a
crash degrades the camera stack for every app on the machine, not just this one.

That is the specific thing this project was told not to do: no drivers, nothing
that could corrupt what is already working. An admin-installed COM server living
inside the Windows camera service is not a driver, but it is the same category of
risk, and the output link reaches the same place without taking it.

**What a native camera would still buy.** One fewer application in the chain, and
a camera that is there without OBS running. Worth doing eventually, behind an
explicit opt-in and a one-click removal — and worth doing only when it can be
verified in Discord rather than reasoned about.

### Guests beyond the local network — done, with a ceiling

**Built.** Share -> **Anywhere** opens a Cloudflare quick tunnel to the guest
port and hands out a public `https://….trycloudflare.com` link. Outbound only,
so no port forwarding and no static address; no account and no payment. The
helper is fetched once on first use rather than shipped in the installer.

**Where the ceiling still is.** Every guest gets their own encode of every tile
they can see. That is fine for a handful of people and wrong for fifty — past
roughly ten, an SFU stops being an optimisation and becomes the only way. The
architecture already assumes that swap: guests receive a document and open
per-tile streams, so moving to an SFU means replacing the socket, not the design.

**What a hosted relay would buy on top.** A stable address that survives a
restart, so a recurring meeting can keep one link; and frames that do not pass
through a third party. Neither is worth running infrastructure for yet.

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
  any app. Rather than install an audio driver by default, Screen Stuff leans on
  share mode when sound matters. If that ever stops being enough, the device
  becomes an optional separate download — never something the installer does to
  a machine on its own.
