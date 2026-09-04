# 立绘归一化：把所有角色 PNG 重绘到统一画布（600x800，3:4）。
# 规则：按不透明边界框缩放，角色高度统一占画布 86%（宽度受限时以 92% 宽度为准），
# 水平居中、底部对齐（脚底统一基线）。这样各端 object-fit: contain 渲染出来角色大小一致。
#
# 用法：
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/normalize-character-art.ps1 -DryRun   # 只扫描统计，不写文件
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/normalize-character-art.ps1           # 正式执行
#
# 注意：web/public/assets/characters/yukari.png 若存在且 data/yukari.user-original.png 不存在，
# 会先备份到 data/（已 gitignore），防止覆盖未提交的人工修改。

param(
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$drawingAssembly = [System.Drawing.Bitmap].Assembly.Location
Add-Type -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class PngArt {
  public static string Process(string srcPath, string dstPath, int canvasW, int canvasH, int fitH, int fitW) {
    // 注意：canvas.Save 之前必须先释放 srcPath 的 Bitmap，
    // 否则 GDI+ 不允许覆盖仍被打开的源文件（「GDI+ 中发生一般性错误」）。
    Bitmap canvas = null;
    int w = 0, h = 0, bw = 0, bh = 0, dw = 0, dh = 0;
    double scale = 1;
    using (var bmp = new Bitmap(srcPath)) {
      w = bmp.Width;
      h = bmp.Height;
      int x0 = w, x1 = -1, y0 = h, y1 = -1;
      var rect = new Rectangle(0, 0, w, h);
      var data = bmp.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
      try {
        int stride = Math.Abs(data.Stride);
        byte[] buf = new byte[stride * h];
        Marshal.Copy(data.Scan0, buf, 0, buf.Length);
        for (int y = 0; y < h; y++) {
          int row = y * stride;
          for (int x = 0; x < w; x++) {
            if (buf[row + x * 4 + 3] > 8) {
              if (x < x0) { x0 = x; }
              if (x > x1) { x1 = x; }
              if (y < y0) { y0 = y; }
              if (y > y1) { y1 = y; }
            }
          }
        }
      } finally {
        bmp.UnlockBits(data);
      }

      bw = x1 - x0 + 1;
      bh = y1 - y0 + 1;
      scale = Math.Min((double)fitH / bh, (double)fitW / bw);
      dw = Math.Max(1, (int)Math.Round(w * scale));
      dh = Math.Max(1, (int)Math.Round(h * scale));

      canvas = new Bitmap(canvasW, canvasH, PixelFormat.Format32bppArgb);
      using (var g = Graphics.FromImage(canvas)) {
        g.Clear(Color.Transparent);
        g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
        g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.HighQuality;
        g.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.HighQuality;
        int dx = (canvasW - dw) / 2;
        int dy = canvasH - dh;
        g.DrawImage(bmp, new Rectangle(dx, dy, dw, dh), new Rectangle(0, 0, w, h), GraphicsUnit.Pixel);
      }
    }
    if (!string.IsNullOrEmpty(dstPath)) {
      canvas.Save(dstPath, ImageFormat.Png);
    }
    canvas.Dispose();
    return string.Format("{0}x{1} bbox {2}x{3} scale {4:F3} -> {5}x{6}", w, h, bw, bh, scale, dw, dh);
  }
}
'@ -ReferencedAssemblies $drawingAssembly

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$charDir = Join-Path $repoRoot 'web/public/assets/characters'
$backupDir = Join-Path $repoRoot 'data'

$canvasW = 600
$canvasH = 800
$fitH = [int]($canvasH * 0.86)
$fitW = [int]($canvasW * 0.92)

$yukari = Join-Path $charDir 'yukari.png'
$yukariBackup = Join-Path $backupDir 'yukari.user-original.png'
if (Test-Path $yukari) {
  if (-not (Test-Path $yukariBackup)) {
    Copy-Item -Path $yukari -Destination $yukariBackup -Force
    Write-Output "[备份] yukari.png 原图已备份到 data/yukari.user-original.png"
  }
}

$files = Get-ChildItem -Path $charDir -Filter *.png | Sort-Object Name
Write-Output ("归一化 {0} 张：画布 {1}x{2}，角色高度 {3} / 宽度上限 {4}" -f $files.Count, $canvasW, $canvasH, $fitH, $fitW)
if ($DryRun) {
  Write-Output "（DryRun：仅统计，不写文件）"
}

foreach ($file in $files) {
  $dst = if ($DryRun) { $null } else { $file.FullName }
  $stats = [PngArt]::Process($file.FullName, $dst, $canvasW, $canvasH, $fitH, $fitW)
  Write-Output ("  {0,-10} {1}" -f $file.BaseName, $stats)
}
Write-Output "完成。"
