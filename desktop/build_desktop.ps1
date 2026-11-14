$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) {
    $csc = 'C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe'
}
if (-not (Test-Path $csc)) {
    throw 'csc.exe (.NET Framework 4.x) not found.'
}

$icoPath = Join-Path $PSScriptRoot 'tsp_pro.ico'
$srcPath = Join-Path $PSScriptRoot 'TspDesktopLauncher.cs'
$outExe  = Join-Path $projectRoot 'TSP_Pro_Desktop.exe'

# Generate crisp 32x32 PNG-wrapped ICO with Wind-orange W glyph
Add-Type -AssemblyName System.Drawing
$size = 32
$bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::FromArgb(9, 12, 16))
$borderPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(34, 40, 50), 1)
$g.DrawRectangle($borderPen, 0, 0, $size - 1, $size - 1)
$accentBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 136, 0))
$g.FillRectangle($accentBrush, 0, 0, $size, 3)
$wPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 136, 0), 3.4)
$wPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Square
$wPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Square
$wPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Miter
$pts = [System.Drawing.PointF[]]@(
    (New-Object System.Drawing.PointF(6, 9)),
    (New-Object System.Drawing.PointF(11, 25)),
    (New-Object System.Drawing.PointF(16, 15)),
    (New-Object System.Drawing.PointF(21, 25)),
    (New-Object System.Drawing.PointF(26, 9))
)
$g.DrawLines($wPen, $pts)
$g.Dispose()
$borderPen.Dispose()
$accentBrush.Dispose()
$wPen.Dispose()

$pngStream = New-Object System.IO.MemoryStream
$bmp.Save($pngStream, [System.Drawing.Imaging.ImageFormat]::Png)
$pngBytes = $pngStream.ToArray()
$pngStream.Dispose()
$bmp.Dispose()

$icoStream = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($icoStream)
$bw.Write([UInt16]0)   # Reserved
$bw.Write([UInt16]1)   # Type: Icon
$bw.Write([UInt16]1)   # Count: 1
$bw.Write([Byte]32)    # Width
$bw.Write([Byte]32)    # Height
$bw.Write([Byte]0)     # ColorCount
$bw.Write([Byte]0)     # Reserved
$bw.Write([UInt16]1)   # Planes
$bw.Write([UInt16]32)  # BitCount
$bw.Write([UInt32]$pngBytes.Length)
$bw.Write([UInt32]22)  # Offset = 6 + 16
$bw.Write($pngBytes)
$bw.Flush()
[System.IO.File]::WriteAllBytes($icoPath, $icoStream.ToArray())
$bw.Dispose()
$icoStream.Dispose()

Write-Host "[BUILD] Compiling $srcPath -> $outExe"
& $csc /nologo /target:winexe /optimize+ /platform:anycpu "/win32icon:$icoPath" "/out:$outExe" `
    /r:System.dll /r:System.Core.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll `
    "$srcPath"

if ($LASTEXITCODE -ne 0) {
    throw "csc.exe failed with exit code $LASTEXITCODE"
}

$info = Get-Item $outExe
Write-Host ("[BUILD] Success: {0} ({1} bytes)" -f $info.FullName, $info.Length)
