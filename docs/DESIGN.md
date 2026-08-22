# The design system

Screen Drop's interface is built from fifteen reference screenshots. This is how
that translated into a system, and the rules that keep it one.

## The palette was measured, not matched

Eyeballing a hex out of a screenshot is how a design ends up two shades off
across forty components. Every colour here came out of the references by
counting pixels:

```bash
pnpm design:palette   # frequency by area — grounds and surfaces
pnpm design:accents   # ranked by saturation — the colours that carry meaning
pnpm design:exact     # exact hexes grouped by hue family
```

What they found, and what the ramps are built around:

| | | |
| --- | --- | --- |
| Primary | `#0562FE` | hue 217, saturation 0.95 — bluer and harder than Tailwind's blue-600 |
| Tint | `#EFF4FE` | behind a selected row, a picked card, an active tool |
| Border | `#DDDDE1` | every hairline in the app |
| Ink | `#1E2329` | a near-black with a cool bias, never pure `#000` |
| Success | `#14B18D` | |
| Warning | `#FD9F0A` | |
| Danger | `#FA3928` | |
| Violet | `#846AFC` | presence only |
| Note paper | `#FEF4D7` | |
| Arctic canvas | `#ECF4FC` | the third look's ground |

`tests/design.test.ts` asserts these anchors. If someone rounds `#0562FE` to
`#0566FF` because it looks tidier, the suite fails — the palette's whole claim is
that it came from the references.

## Five looks, one system

The references included five named directions, and all five ship. They are
**token overrides on `[data-look]`** and nothing downstream knows which is on:

| Look | Ground | Character |
| --- | --- | --- |
| **Pure white studio** | `#FCFCFD` | The default. What the ten product pages use. |
| **Liquid glass** | `#F4F5F8` | Frosted panels floating over the canvas. |
| **Arctic blue** | `#ECF4FC` | A cool blue canvas under white chrome. |
| **Graphite dark** | `#141820` | For a dark room and a long call. |
| **Spectrum pro** | `#FCFCFD` | White ground, sections washed in their own hue. |

Switch in **Settings → Look**, or from the `···` menu in the title bar. The choice
is a preference, not board content, so it lives in settings and survives boards.

A look that defines a canvas but forgets a panel renders half-themed, which is
worse than not shipping it — so the test suite checks each block defines both.

## Rules

**One accent.** Blue means "this is yours to press", "this is selected", and
"this is live". Nothing else is blue.

**Red is reserved.** `--danger` marks destruction and failure. It is not used for
emphasis, and it is not the on-air colour — the on-air colour is the accent,
because on-air is a normal state, not an alarm.

**Presence is identity.** Avatar and cursor colours come from a fixed set of
eight, assigned by hashing the name. The same person is the same colour twice, in
every panel, on every machine. Never random.

**Icons mean things, not shapes.** Everything imports `ScreenIcon`, never
`Monitor`. [Reicon](https://reicon.dev) is mapped in exactly one file,
`src/ui/icons.tsx`, which keeps the library swappable and stops one concept being
drawn two ways in two panels.

**No bespoke controls.** Every button, input, switch and tab in the app is a
primitive from `src/ui/primitives.tsx`. A new panel is assembled, not drawn.

**An icon button always has a name.** `IconButton` requires a `label`; there is no
way to ship a mystery button.

## Shape and type

Read off the references: **8px** radius on controls, **10px** on cards and menus,
**14px** on the floating toolbar, **18px** on modals, full round on pills.
Control height **34px**, **28px** for small, **36px** in the toolbar.

Type is **Inter**, bundled via `@fontsource-variable/inter` rather than assumed —
a desktop app cannot rely on a font being installed, and Windows has no Inter.
Body **13px**, labels **11px** uppercase with `0.04em` tracking, page titles
**26px** at `-0.02em`.

## The canvas is not CSS

The board is drawn into a canvas element, so it cannot inherit tokens. It reads
them instead, through `src/core/theme.ts`, cached per look — reading a dozen
custom properties every frame at 60fps is a real cost, and they only change when
the look does.

Two decisions there worth knowing:

- **A dot grid, not hairlines.** Dots read as texture rather than structure,
  which matters when the thing on top is a screenshot full of its own lines. The
  dot radius is computed in *screen* pixels and converted back — sizing it in
  board units makes the grid collapse to sub-pixel the moment you zoom out, which
  reads as "the grid is broken" rather than "the grid is small".
- **Tiles are windows.** Screens, pages, videos and documents get a title bar
  with their name and a Live badge, exactly as every reference draws them. It is
  not decoration: four unlabelled captures of the same desktop are impossible to
  tell apart.
- **The stage has a name tab.** A rectangle drawn on a canvas explains nothing,
  and the first question anyone asked was "what is that box?". It now says
  `Stage · 1920 × 1080` on a chip above its corner — which doubles as the thing
  you grab to move it. The tab is sized in screen pixels through the same helper
  the hit-test uses, so what you can see is always what you can click.

## Rules for the stage

The stage is the rectangle the audience sees. Three rules keep it honest, and all
three exist because the opposite was tried first:

**Your view is not the stage.** Panning and zooming is private. If the stage
followed the viewport there would be no private area at all, which throws away
the only reason the board is bigger than the shot. Following is still available
as a switch, off by default.

**Grabbed by the edge, never the middle.** The stage sits over the tiles. A frame
that swallowed clicks in its middle would make the board unusable, so — like
Figma's frames — it is grabbed by its outline or its name, and its interior
belongs to whatever is under it.

**No control is a dead end.** Anything that jumps the view records where it came
from. `0` comes home, `Ctrl+←` steps back, and both are buttons on the zoom pill.
This is the rule the old build broke: double-clicking empty canvas zoomed onto
the stage and there was no way back to the view you had opened on.

Two supporting decisions:

- **The stage lives in the document**, not in runtime state. That is what makes
  it survive a save, respond to undo, and stay the same rectangle that arranging
  tiles, placing new ones and the zoom readout all reason about. When it lived in
  two places those four things quietly disagreed.
- **Locking blocks the mouse, not the operator.** A lock exists to stop a stray
  drag re-aiming the broadcast mid-call. Scenes, `Enter` and the inspector's
  number fields still move it, because none of those is an accident.

## What the references show that Screen Drop does not do

The reference set includes screens for features this app has no backing for, and
they were deliberately not faked:

- **Workspace members, roles, billing, storage quotas.** There are no accounts.
- **An activity feed with comment threads and assignments.** There is no server
  keeping history.
- **Invite-by-email.** The Share dialog keeps the reference's *shape* — link,
  permissions, access summary, participants — wired to what actually exists: a
  link on the local network, three live powers, and a real roster.

Drawing those with placeholder data would have made the app look finished and
behave like a mockup. Where a reference screen mapped onto something real —
Add Screens onto capture, the inspector onto tile properties, Media onto the
board's contents — it was built for real, with live previews.

## Changing it

```bash
pnpm design:palette                            # re-measure from a folder of references
node scripts/shoot-system.mjs <ws-url> <out>   # every look, page and modal in one pass
node scripts/shoot-stage.mjs <out>             # the stage in every state
node scripts/check-layout.mjs                  # five window widths, measured
```

`shoot-system` is the review tool. Reviewing a redesign one screenshot at a time
is how inconsistencies survive; twelve at once is how they get caught.

`check-layout` is the other half, and it catches what screenshots at one width
never will: anything wider than the panel holding it, two floating controls
overlapping, a page that scrolls sideways. Two real bugs were sitting in the
shipped build — a grid track that would not shrink pushed the inspector's number
fields off the panel, and the sidebar's contents were three pixels wider than the
sidebar at every width — because a `1fr` or an `auto` grid track refuses to go
below its content's min-content width, and a text input reports about twenty
characters. `minmax(0, 1fr)` is the fix, every time.
