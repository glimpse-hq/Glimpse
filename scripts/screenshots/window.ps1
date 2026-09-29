# Places or captures the Glimpse window of a given process, for run.mjs on Windows.
#   window.ps1 -ProcessId 1234 -Place -X 80 -Y 60 -Width 1000 -Height 800   (logical px)
#   window.ps1 -ProcessId 1234 -Out C:\shots\home.png
param(
  [Parameter(Mandatory)] [int] $ProcessId,
  [switch] $Place,
  [int] $X, [int] $Y, [int] $Width, [int] $Height,
  [string] $Out
)
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class Win {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hh, uint flags);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out RECT r, int size);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

# Per-monitor aware, so every coordinate below is in physical pixels.
[void][Win]::SetProcessDpiAwarenessContext([IntPtr]-4)

# The largest visible window titled "Glimpse" is the main app window; the pill
# and toast windows are small.
$script:best = [IntPtr]::Zero
$script:bestArea = 0
[void][Win]::EnumWindows({
  param($h, $l)
  $procId = 0
  [void][Win]::GetWindowThreadProcessId($h, [ref]$procId)
  if ($procId -eq $ProcessId -and [Win]::IsWindowVisible($h)) {
    $title = New-Object System.Text.StringBuilder 256
    [void][Win]::GetWindowText($h, $title, 256)
    $r = New-Object Win+RECT
    [void][Win]::GetWindowRect($h, [ref]$r)
    $area = ($r.Right - $r.Left) * ($r.Bottom - $r.Top)
    if ($title.ToString() -eq "Glimpse" -and $area -gt $script:bestArea) {
      $script:best = $h
      $script:bestArea = $area
    }
  }
  return $true
}, [IntPtr]::Zero)
if ($script:best -eq [IntPtr]::Zero) { Write-Error "No Glimpse window for process $ProcessId" }
$hwnd = $script:best

if ($Place) {
  $scale = [Win]::GetDpiForWindow($hwnd) / 96.0
  # SWP_NOZORDER | SWP_NOACTIVATE | SWP_SHOWWINDOW
  [void][Win]::SetWindowPos($hwnd, [IntPtr]::Zero, $X, $Y,
    [int]($Width * $scale), [int]($Height * $scale), 0x0054)
  exit 0
}

# PrintWindow can't see WebView2's content, so this copies the window from the
# screen. Windows won't let a script take focus, but it does allow topmost,
# which keeps anything else from covering the window during the copy.
# SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW
[void][Win]::SetWindowPos($hwnd, [IntPtr]-1, 0, 0, 0, 0, 0x0053)
Start-Sleep -Milliseconds 600

# The visible frame, without the invisible resize borders Windows adds.
$frame = New-Object Win+RECT
[void][Win]::DwmGetWindowAttribute($hwnd, 9, [ref]$frame, 16)
$w = $frame.Right - $frame.Left
$h = $frame.Bottom - $frame.Top
$bitmap = New-Object System.Drawing.Bitmap $w, $h
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($frame.Left, $frame.Top, 0, 0, $bitmap.Size)
$graphics.Dispose()
$bitmap.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Dispose()

[void][Win]::SetWindowPos($hwnd, [IntPtr]-2, 0, 0, 0, 0, 0x0053)
