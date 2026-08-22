# Lists every Screen Stuff window and says whether any web tile is somewhere a
# person can see it.
#
# Web tiles are browser windows parked past the edge of the desktop. When that
# goes wrong the window appears over whatever you were doing, mid-call, so this
# is the check worth having.
#
#   powershell -ExecutionPolicy Bypass -File scripts\watch-windows.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\watch-windows.ps1 -Seconds 60

param([int]$Seconds = 0)

$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class Win {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int n);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }

  static List<object[]> _found;
  static string _match;

  static bool Collect(IntPtr h, IntPtr p) {
    if (!IsWindowVisible(h) || IsIconic(h)) return true;
    StringBuilder sb = new StringBuilder(512);
    GetWindowTextW(h, sb, sb.Capacity);
    string title = sb.ToString();
    if (title.IndexOf(_match, StringComparison.OrdinalIgnoreCase) < 0) return true;
    RECT r; GetWindowRect(h, out r);
    _found.Add(new object[] { title, r.L, r.T, r.R - r.L, r.B - r.T });
    return true;
  }

  public static List<object[]> Windows(string match) {
    _found = new List<object[]>();
    _match = match;
    EnumWindows(new EnumProc(Collect), IntPtr.Zero);
    return _found;
  }

  /// x, y, width, height of everything the user can see, as one rectangle.
  public static int[] Desktop() {
    return new int[] { GetSystemMetrics(76), GetSystemMetrics(77), GetSystemMetrics(78), GetSystemMetrics(79) };
  }
}
'@

[void][Win]::SetProcessDpiAwarenessContext([IntPtr](-4))
$d = [Win]::Desktop()
$dx = $d[0]; $dy = $d[1]; $dw = $d[2]; $dh = $d[3]
Write-Host ("desktop: {0},{1} {2}x{3}  (right edge {4})" -f $dx, $dy, $dw, $dh, ($dx + $dw))

function Show-Once {
  $rows = [Win]::Windows("Screen Stuff")
  if ($rows.Count -eq 0) { Write-Host "  (no Screen Stuff windows open)"; return $true }
  $clear = $true
  foreach ($r in $rows) {
    $title = [string]$r[0]; $x = [int]$r[1]; $y = [int]$r[2]; $w = [int]$r[3]; $h = [int]$r[4]
    $onScreen = ($x -lt ($dx + $dw)) -and ($dx -lt ($x + $w)) -and ($y -lt ($dy + $dh)) -and ($dy -lt ($y + $h))
    # The cockpit and the board are meant to be seen. A web tile is not.
    $isWebTile = $title -match 'https?://'
    if ($isWebTile -and $onScreen) {
      $verdict = "ON SCREEN - stray web tile"
      $clear = $false
    } elseif ($isWebTile) {
      $verdict = "parked"
    } else {
      $verdict = "ok (meant to be visible)"
    }
    $short = if ($title.Length -gt 52) { $title.Substring(0, 52) } else { $title }
    Write-Host ("  {0,-52} {1,7},{2,-7} {3,5}x{4,-5} {5}" -f $short, $x, $y, $w, $h, $verdict)
  }
  return $clear
}

if ($Seconds -le 0) {
  Write-Host "windows:"
  $ok = Show-Once
  if ($ok) { Write-Host "`nVERDICT: nothing stray on screen" } else { Write-Host "`nVERDICT: a web tile is visible - parking failed" }
  if ($ok) { exit 0 } else { exit 1 }
}

$deadline = (Get-Date).AddSeconds($Seconds)
$everBad = $false
while ((Get-Date) -lt $deadline) {
  $left = [int]($deadline - (Get-Date)).TotalSeconds
  Write-Host "`n--- ${left}s left - add a web page in the app now ---"
  if (-not (Show-Once)) { $everBad = $true }
  Start-Sleep -Milliseconds 1200
}
if ($everBad) { "`nVERDICT: a web tile became visible at some point" ; exit 1 }
"`nVERDICT: nothing stray appeared"
exit 0
