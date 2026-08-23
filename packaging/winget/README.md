# Getting onto winget

`winget install ScreenStuff` is the difference between a download people finish
and one they abandon, so it is worth the one-time setup.

## Once, by hand

The first version has to be *created* rather than updated, because the package
does not exist yet:

```powershell
Invoke-WebRequest https://aka.ms/wingetcreate/latest -OutFile wingetcreate.exe
.\wingetcreate.exe new https://github.com/selmanadam7-7/screen-stuff/releases/download/v0.1.0/Screen.Stuff_0.1.0_x64-setup.exe
```

It will ask for the identifier, publisher and moniker. Use:

| | |
| --- | --- |
| Package identifier | `ScreenStuff.ScreenStuff` |
| Publisher | the name on the signing certificate, exactly |
| Package name | `Screen Stuff` |
| Moniker | `screenstuff` |
| License | the repository's licence |
| Short description | An infinite board that holds every screen you have, and hands one rectangle of it to any call. |

Then submit the pull request it generates. Microsoft's validation takes a day or
two the first time.

## After that, automatically

[`.github/workflows/winget.yml`](../../.github/workflows/winget.yml) runs on every
published release and opens the update pull request on its own. It needs one
secret:

| Secret | What |
| --- | --- |
| `WINGET_TOKEN` | A classic GitHub token with `public_repo`, used to open the pull request against `microsoft/winget-pkgs` from your fork. |

## Signing, which winget effectively expects

An unsigned installer will pass validation but every user still sees "Windows
protected your PC" on first run, which defeats the point of a one-line install.

[SignPath](https://signpath.io/open-source) issues free certificates to
open-source projects. Once approved, add:

| Setting | Where | What |
| --- | --- | --- |
| `SIGNPATH_API_TOKEN` | repository secret | The API token from SignPath. |
| `SIGNPATH_ORGANIZATION_ID` | repository variable | The organisation id. |

The release workflow signs the installer when both exist and skips signing when
they do not, so a fork without a certificate still builds.
