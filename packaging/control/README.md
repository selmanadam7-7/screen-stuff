# Driving Screen Stuff from something else

Everything the operator can do, available to anything else on the machine — a
Stream Deck, a script, the hotkey daemon you already live in.

Turn it on first: **Settings → Other software on this machine**. It is off until
you do, because a control surface that appears by itself is a surprise, and this
one can move what an audience sees.

Settings then shows an address and a token. It listens on `127.0.0.1` only; the
guest link and the tunnel have no route into it, so turning this on does not put
a control surface on the internet.

## The one line

```bash
curl -X POST "http://127.0.0.1:4488/stage" \
  -H "X-Control-Token: YOUR_TOKEN" \
  -H "content-type: application/json" \
  -d '{"preset":"everything"}'
```

The stage moves to hold everything on the board. `Show me the stage` puts it
back.

## What there is

| | |
|---|---|
| `GET /` | Every action, what it does, and a body that works. Generated from the code that runs it, so it cannot be out of date. |
| `GET /state` | What is on air right now: the stage, the tiles, the card, the guests. |
| `GET /sources` | Screens and windows you could add. |
| `GET /shot` | A PNG of the shot, drawn by the same renderer the audience is watching. |
| `GET /events` | A WebSocket. State, every time it changes — for anything that lights up a button. |
| `POST /<action>` | Do something. The reply says what actually happened. |

The token goes in an `X-Control-Token` header or as `?token=`. The header is
tidier: a token in a URL ends up in shell history and in any log that records
the line.

Requests carrying an `Origin` header are refused outright. curl, Python, Node, a
Stream Deck plugin and a shell script send no such header; a web page cannot
avoid sending one. So a page that somehow learned your token still cannot drive
your app.

## The actions

Ask the app rather than trusting this list — `GET /` is generated from the
dispatch table itself. As of writing:

```
stage         Move the rectangle the audience sees.
layout        Rearrange the tiles inside the stage.
scene         Recall a saved shot, or save the one you are on.
card          Put a holding card over the shot, or take it down.
lower-third   Put your name in the corner of the shot, or take it off.
tile          Move, resize, hide or relabel one tile.
add           Put something new on the board.
remove        Take something off the board.
spotlight     Follow one tile with the stage, or stop following.
preview       Set up the next shot where the audience cannot see it.
take          Cut the preview to air.
private       Hold the audience on the stage while you work elsewhere.
follow        Make the audience follow wherever you look.
autoframe     Let the stage follow your work between monitors or windows.
punch         Snap in tight on something, then snap back.
guests        Open or close the link people watch from.
board         Change how the board itself is set up.
flash         Put a line of text on your own screen. Nobody else sees it.
shot          A PNG of the shot as it is going out right now.
```

Tiles and scenes are addressed the way a person would: `{"tile": "Code"}` finds
the tile labelled Code, case-insensitively, and a partial name works if it is
unambiguous. Two matches is a refusal rather than a guess — picking the wrong
one mid-call is worse than doing nothing, because nothing is visible and wrong
is not.

Every refusal is a sentence. Ask for a tile that is not there and you get the
names of the ones that are.

## The wrapper

[`stuff.ps1`](stuff.ps1) exists mostly so nobody has to paste a token into a
Stream Deck button. It reads the port and token out of Screen Stuff's own
settings file, so it keeps working after you roll the token.

```powershell
.\stuff.ps1 scene Wide            # cut to a saved scene
.\stuff.ps1 stage Code            # frame the tile called Code
.\stuff.ps1 stage everything      # everything on the board
.\stuff.ps1 card brb              # back in a minute
.\stuff.ps1 card off              # take it down
.\stuff.ps1 layout grid
.\stuff.ps1 private on            # they stay on the stage while you work
.\stuff.ps1 punch Code            # snap in tight
.\stuff.ps1 punch out
.\stuff.ps1 shot C:\shots\now.png
.\stuff.ps1 state
.\stuff.ps1 help
.\stuff.ps1 tile -Body '{"tile":"camera","hidden":true}'
```

## On a Stream Deck

One button, one line. Add a **System → Open** action and set it to:

```
powershell -NoProfile -WindowStyle Hidden -File "C:\path\to\stuff.ps1" scene Wide
```

`-WindowStyle Hidden` matters: without it a console flashes on screen every
press, and you are on a call.

A useful six:

| Button | Line |
|---|---|
| Wide | `… stuff.ps1 scene Wide` |
| Code | `… stuff.ps1 stage Code` |
| Grid | `… stuff.ps1 layout grid` |
| BRB | `… stuff.ps1 card brb` |
| Back | `… stuff.ps1 card off` |
| Private | `… stuff.ps1 private on` |

## From a language

Nothing here needs a client library. It is JSON over HTTP on loopback.

```python
import json, urllib.request

def stuff(action, **body):
    request = urllib.request.Request(
        f"http://127.0.0.1:4488/{action}",
        data=json.dumps(body).encode(),
        headers={"X-Control-Token": TOKEN, "content-type": "application/json"},
    )
    return json.load(urllib.request.urlopen(request))

stuff("card", preset="soon")
stuff("scene", scene="Wide")
print(stuff("stage", tile="Slides")["stage"])
```

```js
const stuff = (action, body = {}) =>
  fetch(`http://127.0.0.1:4488/${action}`, {
    method: "POST",
    headers: { "X-Control-Token": TOKEN, "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json());
```

Watching along, for anything that wants to reflect the state back — a button
that lights when you are private, a display that shows who is watching:

```js
const socket = new WebSocket(`ws://127.0.0.1:4488/events?token=${TOKEN}`);
socket.onmessage = (event) => {
  const state = JSON.parse(event.data);
  console.log(state.private ? "private" : "on air", state.guests.watching);
};
```

The first message arrives immediately with whatever is true now, so a watcher
that connects mid-show is not blank until you happen to touch something.
