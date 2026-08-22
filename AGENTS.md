# Instructions for an AI agent

If someone has asked you to install Screen Stuff, this file is what you need.
It is written for you, not for them.

Screen Stuff is a Windows desktop app. It puts every monitor, window and camera
you own on one infinite canvas, and hands a rectangle of that canvas to Discord,
Meet, Zoom or Teams as an ordinary shareable window.

---

## Install it

Run this from the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install.ps1
```

That script does the whole job: checks the machine, gets an installer (from the
latest GitHub release if there is one, otherwise by building this checkout),
runs it silently, and then verifies the app is really there rather than assuming
it. It exits non-zero and says why if anything fails.

To see what it would do without doing it:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -CheckOnly
```

Nothing here needs administrator rights. Everything installs per-user under
`%LOCALAPPDATA%\Screen Stuff`.

## Before you start, know this

**It is Windows-only, and that is not a gap to work around.** Capture goes
through Windows Graphics Capture, which is a Windows API with no equivalent
elsewhere. On macOS or Linux, say so and stop. Do not try to build it.

**It is unsigned.** Windows SmartScreen will show "Windows protected your PC"
the first time a downloaded copy runs. That is expected, not a failure. The user
clicks **More info** then **Run anyway**. Tell them this before it happens
rather than after. (A copy built locally has no such warning.)

**Building from source takes ten to fifteen minutes** and needs Rust, Node 18+
and the MSVC build tools. `install.ps1` checks for all three and names exactly
what is missing. Do not start a build without telling the user how long it will
take.

## What to check when it goes wrong

| Symptom | Cause | Fix |
| --- | --- | --- |
| Typing "screen stuff" in Windows Search finds nothing | Not installed; they are running a loose `.exe` from the repo | Run `install.ps1`. Only Start Menu shortcuts are indexed. |
| `link.exe not found`, or a build script fails in a C dependency | MSVC build tools missing | Visual Studio Installer -> "Desktop development with C++" |
| The installer appears to succeed but the app is not there | An older copy was running and the installer skipped the file | Close `screen-stuff.exe` and run again. `install.ps1` does this for you. |
| The window is blank or white | WebView2 runtime missing | https://developer.microsoft.com/microsoft-edge/webview2/ |
| Tiles say "waiting for the first frame" forever | Normal for a second or two. Longer means the capture engine did not start | Check `%LOCALAPPDATA%\Screen Stuff` logs, and that the source still exists |
| A black console window opens with the app | A debug build. Release builds are windows-subsystem binaries | Install the release, do not run `target\debug\screen-stuff.exe` |
| "Anywhere" sharing sits on "setting up" | First use downloads ~40 MB of `cloudflared` | Wait, or drop `cloudflared.exe` into `%APPDATA%\screen-stuff\` yourself |
| The public link 404s or 530s for a few seconds | Cloudflare's edge has not started routing yet | Wait ten seconds and reload. `scripts/check-tunnel.mjs` proves the path works |

## After it installs

Tell the user this much, and no more:

1. Open Screen Stuff from the Start Menu.
2. **Add screens** to put monitors, windows or a camera on the board.
3. **Go live**, then share the window called **Screen Stuff - Board** in
   whichever call app they use. It is an ordinary window; every app can share it.
4. Only the blue rectangle -- the **stage** -- is ever shared. Everything else
   on the board is private to them. Press `0` to come back to the stage from
   anywhere.

If they want to hand someone a link instead of sharing a window: **Share** ->
**Open a guest link**, then choose **This network only** or **Anywhere**. Tell
them what "Anywhere" means -- it puts a public address on the internet, guarded
only by the token in the link -- and that closing the link takes it down.

## Working on the code

If the request is to change the app rather than install it:

```bash
pnpm install
pnpm app          # run it
pnpm test         # 177 frontend tests
pnpm test:rust    # 70 Rust tests
pnpm check        # types and clippy, both must be clean
```

Read [`README.md`](README.md) for the architecture and
[`docs/DESIGN.md`](docs/DESIGN.md) for the interface rules before changing
anything visual. Both exist because the decisions in them are not guessable from
the code.

Three traps that will cost you an afternoon if you rediscover them:

- `[lib] crate-type` in `src-tauri/Cargo.toml` must stay `["rlib"]`. The Tauri
  template's `cdylib` is for mobile, and building one with `opt-level = 1` plus
  incremental makes rustc leak `anon.*.llvm.*` symbols across codegen units --
  LNK1120 on every rebuild.
- `[profile.dev] opt-level = 1` is required, not just
  `[profile.dev.package."*"]`. The resize and encode entry points are generic, so
  their bodies compile at *this* crate's opt-level. At `0`, one 1440p frame takes
  434 ms instead of 4.6.
- A grid track written `1fr` or `auto` will not shrink below its content's
  min-content width, and a text input reports about twenty characters. Use
  `minmax(0, 1fr)`. Two shipped layout bugs came from exactly this.

**The brand is a folder, not a drawing.** `assets/brand` holds the icon, the
mark and the illustrations, and two scripts copy them into place:
`scripts/make-icons.mjs` (Tauri bundle icons and favicons) and
`scripts/make-brand-component.mjs` (`logo-current.svg` into `src/ui/Brand.tsx`).
Neither redraws anything. If an icon needs to change, change the file in
`assets/brand` and re-run the script — never hand-draw one, and never edit
`src/ui/Brand.tsx`, which is generated.

There are Playwright harnesses that drive the real app rather than a mock --
`scripts/check-stage.mjs` and `scripts/check-layout.mjs`. Run them after
touching the canvas or the shell. They need a dev server on port 4483.
`scripts/check-tunnel.mjs` opens a genuine Cloudflare tunnel and fetches it back
over the internet; it exits 3, not 1, when the shell itself has no outbound
access, because those two failures look identical and mean opposite things.
