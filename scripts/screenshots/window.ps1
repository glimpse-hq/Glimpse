# Captures one window by HWND, for run.mjs on Windows.
#   window.ps1 -Hwnd 123456 -Out C:\shots\home.png
param(
  [Parameter(Mandatory)] [long] $Hwnd,
  [Parameter(Mandatory)] [string] $Out
)
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Win {
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hh, uint flags);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out RECT r, int size);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

# Per-monitor aware, so every coordinate below is in physical pixels.
[void][Win]::SetProcessDpiAwarenessContext([IntPtr]-4)
$hwnd = [IntPtr]$Hwnd

# PrintWindow can't see WebView2's content, so this copies the window from the
# screen. The sandbox keeps its windows at the bottom of the z-order; topmost
# raises this one over everything for the copy without activating it.
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

# Back to the bottom: HWND_BOTTOM, same flags.
[void][Win]::SetWindowPos($hwnd, [IntPtr]1, 0, 0, 0, 0, 0x0053)
