<#
.SYNOPSIS
  Drive Screen Stuff from anywhere on this machine.

.DESCRIPTION
  A thin wrapper over the control API, written mostly so nobody has to paste a
  token into a Stream Deck button. It reads the port and token out of Screen
  Stuff's own settings file, which means it keeps working after the token is
  rolled and after the app is reinstalled.

  Turn the API on first: Settings -> Other software on this machine.

.EXAMPLE
  .\stuff.ps1 scene Wide
  Cut to the saved scene called Wide.

.EXAMPLE
  .\stuff.ps1 stage -Body '{"tile":"Code"}'
  Put the stage around the tile labelled Code.

.EXAMPLE
  .\stuff.ps1 card brb
  Raise the "back in a minute" card. `.\stuff.ps1 card off` takes it down.

.EXAMPLE
  .\stuff.ps1 shot C:\Users\me\Desktop\now.png
  Save what is going out right now.

.EXAMPLE
  .\stuff.ps1 help
  Every action there is, straight from the running app.
#>
[CmdletBinding()]
param(
  # The action: stage, layout, scene, card, take, shot, help, and the rest.
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Action,

  # What the action needs. A scene or tile name, a card preset, a file path for
  # `shot`. Anything more involved goes in -Body.
  [Parameter(Position = 1)]
  [string]$Argument,

  # A raw JSON body, for anything the shorthand above does not cover.
  [string]$Body
)

$ErrorActionPreference = 'Stop'

function Get-Config {
  $file = Join-Path $env:APPDATA 'screen-stuff\settings.json'
  if (-not (Test-Path $file)) {
    throw "Screen Stuff has not saved any settings yet. Open it once, then turn on the control API in Settings."
  }
  $settings = Get-Content $file -Raw | ConvertFrom-Json
  if (-not $settings.controlToken) {
    throw "The control API is off. Turn it on in Settings -> Other software on this machine."
  }
  $port = if ($settings.controlPort) { $settings.controlPort } else { 4488 }
  [pscustomobject]@{ Base = "http://127.0.0.1:$port"; Token = $settings.controlToken }
}

# The shorthand: one positional argument, turned into the body that action wants.
function Get-Body {
  param([string]$Action, [string]$Argument, [string]$Body)

  if ($Body) { return $Body }
  if (-not $Argument) { return '{}' }

  switch ($Action) {
    'scene'  { return (@{ scene = $Argument } | ConvertTo-Json -Compress) }
    'layout' { return (@{ layout = $Argument } | ConvertTo-Json -Compress) }
    'card'   {
      if ($Argument -in @('off', 'clear', 'down')) { return '{"clear":true}' }
      return (@{ preset = $Argument } | ConvertTo-Json -Compress)
    }
    'stage'  {
      if ($Argument -in @('everything', 'home')) {
        return (@{ preset = $Argument } | ConvertTo-Json -Compress)
      }
      return (@{ tile = $Argument } | ConvertTo-Json -Compress)
    }
    'flash'  { return (@{ message = $Argument } | ConvertTo-Json -Compress) }
    'private' { return (@{ on = ($Argument -ne 'off') } | ConvertTo-Json -Compress) }
    'follow'  { return (@{ on = ($Argument -ne 'off') } | ConvertTo-Json -Compress) }
    'autoframe' { return (@{ mode = $Argument } | ConvertTo-Json -Compress) }
    'punch'  {
      if ($Argument -eq 'out') { return '{"out":true}' }
      return (@{ tile = $Argument } | ConvertTo-Json -Compress)
    }
    default  { return (@{ tile = $Argument } | ConvertTo-Json -Compress) }
  }
}

$config = Get-Config
# The header rather than the query string: a token in a URL ends up in shell
# history and in any log that records the line.
$headers = @{ 'X-Control-Token' = $config.Token }

try {
  switch ($Action) {
    'shot' {
      $out = if ($Argument) { $Argument } else { Join-Path $PWD 'screen-stuff.png' }
      Invoke-WebRequest -Uri "$($config.Base)/shot" -Headers $headers -OutFile $out | Out-Null
      Write-Host "Saved $out"
    }
    'state' {
      Invoke-RestMethod -Uri "$($config.Base)/state" -Headers $headers | ConvertTo-Json -Depth 6
    }
    'help' {
      Invoke-RestMethod -Uri "$($config.Base)/" -Headers $headers | ConvertTo-Json -Depth 6
    }
    default {
      $payload = Get-Body -Action $Action -Argument $Argument -Body $Body
      Invoke-RestMethod -Uri "$($config.Base)/$Action" -Method Post -Headers $headers `
        -ContentType 'application/json' -Body $payload | ConvertTo-Json -Depth 6
    }
  }
} catch {
  # Untyped on purpose: Windows PowerShell 5.1 raises WebException and
  # PowerShell 7 raises HttpResponseException, and naming a type the running
  # host has never heard of fails before the handler gets a chance to run.
  #
  # The API answers a refusal in words, and the words are the whole point of
  # having written them, so this digs them out of the response body.
  $message = $_.Exception.Message
  $reply = $_.ErrorDetails.Message
  if ($reply) {
    $parsed = $null
    try { $parsed = $reply | ConvertFrom-Json } catch { }
    $message = if ($parsed -and $parsed.error) { $parsed.error } else { $reply }
  } elseif ($message -match 'Unable to connect|actively refused|No connection could be made') {
    $message = 'Screen Stuff is not listening. Is it running, and is the control API on?'
  }
  # Not Write-Error: $ErrorActionPreference is Stop, which would make writing
  # the message itself throw, and the reason would be replaced by a stack.
  [Console]::Error.WriteLine($message)
  exit 1
}
