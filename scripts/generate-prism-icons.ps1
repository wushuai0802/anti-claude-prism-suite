[CmdletBinding()]
param(
    [string]$PreviewOut = ""
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot

$csharp = @"
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;

public static class PrismIconStudio
{
    private static GraphicsPath CreateSquircle(float x, float y, float w, float h, float r)
    {
        GraphicsPath gp = new GraphicsPath();
        float d = r * 2f;
        gp.AddArc(x, y, d, d, 180, 90);
        gp.AddArc(x + w - d, y, d, d, 270, 90);
        gp.AddArc(x + w - d, y + h - d, d, d, 0, 90);
        gp.AddArc(x, y + h - d, d, d, 90, 90);
        gp.CloseFigure();
        return gp;
    }

    public static Bitmap RenderMaster(int targetPx)
    {
        float smallBoost = targetPx <= 20 ? 1.65f : (targetPx <= 32 ? 1.32f : 1.0f);
        float scaleK = targetPx <= 24 ? 1.08f : 1.0f;
        int S = Math.Max(512, targetPx * 4);

        using (Bitmap hi = new Bitmap(S, S, PixelFormat.Format32bppArgb))
        using (Graphics g = Graphics.FromImage(hi))
        {
            g.SmoothingMode = SmoothingMode.HighQuality;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.CompositingQuality = CompositingQuality.HighQuality;
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.Clear(Color.Transparent);

            float margin = S * (targetPx <= 24 ? 0.035f : 0.055f);
            float tileW = S - margin * 2f;
            float radius = tileW * 0.235f;

            using (GraphicsPath tilePath = CreateSquircle(margin, margin, tileW, tileW, radius))
            {
                using (LinearGradientBrush bgBrush = new LinearGradientBrush(
                    new PointF(margin, margin),
                    new PointF(S - margin, S - margin),
                    Color.FromArgb(255, 11, 18, 35),
                    Color.FromArgb(255, 23, 39, 78)))
                {
                    ColorBlend cb = new ColorBlend(3);
                    cb.Colors = new Color[] {
                        Color.FromArgb(255, 10, 15, 30),
                        Color.FromArgb(255, 17, 29, 60),
                        Color.FromArgb(255, 27, 46, 94)
                    };
                    cb.Positions = new float[] { 0f, 0.55f, 1f };
                    bgBrush.InterpolationColors = cb;
                    g.FillPath(bgBrush, tilePath);
                }

                Region oldClip = g.Clip;
                g.SetClip(tilePath, CombineMode.Intersect);

                using (GraphicsPath glowPath = new GraphicsPath())
                {
                    float gr = S * 0.38f;
                    glowPath.AddEllipse(S * 0.48f - gr, S * 0.53f - gr, gr * 2f, gr * 2f);
                    using (PathGradientBrush pgb = new PathGradientBrush(glowPath))
                    {
                        pgb.CenterColor = Color.FromArgb(80, 56, 189, 248);
                        pgb.SurroundColors = new Color[] { Color.FromArgb(0, 56, 189, 248) };
                        g.FillPath(pgb, glowPath);
                    }
                }
                using (GraphicsPath warmGlow = new GraphicsPath())
                {
                    float gr2 = S * 0.28f;
                    warmGlow.AddEllipse(S * 0.64f - gr2, S * 0.50f - gr2, gr2 * 2f, gr2 * 2f);
                    using (PathGradientBrush pgb2 = new PathGradientBrush(warmGlow))
                    {
                        pgb2.CenterColor = Color.FromArgb(62, 251, 146, 60);
                        pgb2.SurroundColors = new Color[] { Color.FromArgb(0, 251, 146, 60) };
                        g.FillPath(pgb2, warmGlow);
                    }
                }

                Func<float, float, PointF> Pt = (nx, ny) =>
                {
                    float px = 0.5f + (nx - 0.5f) * scaleK;
                    float py = 0.5f + (ny - 0.5f) * scaleK;
                    return new PointF(px * S, py * S);
                };

                PointF apex = Pt(0.460f, 0.185f);
                PointF bLeft = Pt(0.190f, 0.775f);
                PointF bMid = Pt(0.450f, 0.818f);
                PointF bRight = Pt(0.720f, 0.752f);

                float rayW = Math.Max(4f, S * 0.040f * smallBoost);
                PointF incStart = Pt(0.075f, 0.560f);
                PointF incHit = Pt(0.322f, 0.486f);

                using (Pen incGlow = new Pen(Color.FromArgb(88, 186, 230, 253), rayW * 1.85f))
                using (Pen incPen = new Pen(Color.FromArgb(248, 240, 249, 255), rayW * 1.05f))
                {
                    incGlow.StartCap = LineCap.Round; incGlow.EndCap = LineCap.Round;
                    incPen.StartCap = LineCap.Round; incPen.EndCap = LineCap.Round;
                    g.DrawLine(incGlow, incStart, incHit);
                    g.DrawLine(incPen, incStart, incHit);
                }

                PointF[] rStarts = new PointF[] { Pt(0.558f, 0.422f), Pt(0.588f, 0.495f), Pt(0.615f, 0.568f) };
                PointF[] rEnds   = new PointF[] { Pt(0.910f, 0.308f), Pt(0.925f, 0.485f), Pt(0.902f, 0.662f) };
                Color[] rCols    = new Color[] {
                    Color.FromArgb(255, 56, 189, 248),
                    Color.FromArgb(255, 251, 146, 60),
                    Color.FromArgb(255, 168, 85, 247)
                };
                for (int i = 0; i < 3; i++)
                {
                    using (Pen halo = new Pen(Color.FromArgb(88, rCols[i]), rayW * 1.85f))
                    using (Pen core = new Pen(rCols[i], rayW))
                    {
                        halo.StartCap = LineCap.Round; halo.EndCap = LineCap.Round;
                        core.StartCap = LineCap.Round; core.EndCap = LineCap.Round;
                        g.DrawLine(halo, rStarts[i], rEnds[i]);
                        g.DrawLine(core, rStarts[i], rEnds[i]);
                    }
                }

                using (GraphicsPath leftFacet = new GraphicsPath())
                {
                    leftFacet.AddPolygon(new PointF[] { apex, bLeft, bMid });
                    using (LinearGradientBrush lb = new LinearGradientBrush(
                        apex, bLeft,
                        Color.FromArgb(250, 224, 242, 254),
                        Color.FromArgb(242, 37, 99, 235)))
                    {
                        ColorBlend lcb = new ColorBlend(3);
                        lcb.Colors = new Color[] {
                            Color.FromArgb(252, 235, 248, 255),
                            Color.FromArgb(246, 56, 189, 248),
                            Color.FromArgb(242, 37, 99, 235)
                        };
                        lcb.Positions = new float[] { 0f, 0.52f, 1f };
                        lb.InterpolationColors = lcb;
                        g.FillPath(lb, leftFacet);
                    }
                }

                using (GraphicsPath rightFacet = new GraphicsPath())
                {
                    rightFacet.AddPolygon(new PointF[] { apex, bMid, bRight });
                    using (LinearGradientBrush rb = new LinearGradientBrush(
                        apex, bRight,
                        Color.FromArgb(236, 129, 140, 248),
                        Color.FromArgb(232, 30, 58, 138)))
                    {
                        g.FillPath(rb, rightFacet);
                    }
                }

                using (GraphicsPath prismUnion = new GraphicsPath())
                {
                    prismUnion.AddPolygon(new PointF[] { apex, bLeft, bMid, bRight });
                    Region prePrismClip = g.Clip;
                    g.SetClip(prismUnion, CombineMode.Intersect);
                    using (GraphicsPath fan = new GraphicsPath())
                    {
                        fan.AddPolygon(new PointF[] { incHit, rStarts[0], rStarts[2] });
                        using (LinearGradientBrush fb = new LinearGradientBrush(
                            incHit, rStarts[1],
                            Color.FromArgb(145, 255, 255, 255),
                            Color.FromArgb(48, 251, 191, 36)))
                        {
                            g.FillPath(fb, fan);
                        }
                    }
                    g.SetClip(prePrismClip, CombineMode.Replace);

                    float edgeW = Math.Max(3f, S * 0.022f * smallBoost);
                    using (Pen edgePen = new Pen(Color.FromArgb(248, 224, 242, 254), edgeW))
                    {
                        edgePen.LineJoin = LineJoin.Round;
                        g.DrawPolygon(edgePen, new PointF[] { apex, bLeft, bMid, bRight });
                    }
                    using (Pen ridgePen = new Pen(Color.FromArgb(245, 255, 255, 255), Math.Max(3f, S * 0.020f * smallBoost)))
                    {
                        ridgePen.StartCap = LineCap.Round;
                        ridgePen.EndCap = LineCap.Round;
                        g.DrawLine(ridgePen, apex, bMid);
                    }
                }

                float nr = Math.Max(4f, S * 0.026f * smallBoost);
                using (SolidBrush wb = new SolidBrush(Color.White))
                {
                    g.FillEllipse(wb, incHit.X - nr, incHit.Y - nr, nr * 2f, nr * 2f);
                    if (targetPx >= 24)
                    {
                        PointF sc = Pt(0.652f, 0.212f);
                        float sr = S * 0.056f;
                        float si = sr * 0.26f;
                        PointF[] star = new PointF[] {
                            new PointF(sc.X, sc.Y - sr), new PointF(sc.X + si, sc.Y - si),
                            new PointF(sc.X + sr, sc.Y), new PointF(sc.X + si, sc.Y + si),
                            new PointF(sc.X, sc.Y + sr), new PointF(sc.X - si, sc.Y + si),
                            new PointF(sc.X - sr, sc.Y), new PointF(sc.X - si, sc.Y - si)
                        };
                        g.FillPolygon(wb, star);
                    }
                }

                g.SetClip(oldClip, CombineMode.Replace);

                float rimW = Math.Max(2f, S * 0.016f * smallBoost);
                using (GraphicsPath rimPath = CreateSquircle(margin + rimW * 0.5f, margin + rimW * 0.5f, tileW - rimW, tileW - rimW, Math.Max(4f, radius - rimW * 0.5f)))
                using (LinearGradientBrush rimBrush = new LinearGradientBrush(
                    new PointF(margin, margin),
                    new PointF(S - margin, S - margin),
                    Color.FromArgb(175, 125, 211, 252),
                    Color.FromArgb(115, 99, 102, 241)))
                using (Pen rimPen = new Pen(rimBrush, rimW))
                {
                    g.DrawPath(rimPen, rimPath);
                }
            }

            Bitmap outBmp = new Bitmap(targetPx, targetPx, PixelFormat.Format32bppArgb);
            using (Graphics go = Graphics.FromImage(outBmp))
            {
                go.SmoothingMode = SmoothingMode.HighQuality;
                go.PixelOffsetMode = PixelOffsetMode.HighQuality;
                go.CompositingQuality = CompositingQuality.HighQuality;
                go.InterpolationMode = InterpolationMode.HighQualityBicubic;
                go.DrawImage(hi, new Rectangle(0, 0, targetPx, targetPx), new Rectangle(0, 0, S, S), GraphicsUnit.Pixel);
            }
            return outBmp;
        }
    }

    private static byte[] EncodeDibFrame(Bitmap bmp)
    {
        int w = bmp.Width;
        int h = bmp.Height;
        int andStride = ((w + 31) / 32) * 4;
        byte[] xorBytes = new byte[w * h * 4];
        byte[] andBytes = new byte[andStride * h];

        for (int y = 0; y < h; y++)
        {
            int dstRow = h - 1 - y;
            for (int x = 0; x < w; x++)
            {
                Color c = bmp.GetPixel(x, y);
                int off = (dstRow * w + x) * 4;
                xorBytes[off] = c.B;
                xorBytes[off + 1] = c.G;
                xorBytes[off + 2] = c.R;
                xorBytes[off + 3] = c.A;
                if (c.A < 16)
                {
                    andBytes[dstRow * andStride + (x >> 3)] |= (byte)(0x80 >> (x & 7));
                }
            }
        }

        using (MemoryStream ms = new MemoryStream())
        using (BinaryWriter bw = new BinaryWriter(ms))
        {
            bw.Write((uint)40);
            bw.Write((int)w);
            bw.Write((int)(h * 2));
            bw.Write((ushort)1);
            bw.Write((ushort)32);
            bw.Write((uint)0);
            bw.Write((uint)(xorBytes.Length + andBytes.Length));
            bw.Write((int)0);
            bw.Write((int)0);
            bw.Write((uint)0);
            bw.Write((uint)0);
            bw.Write(xorBytes);
            bw.Write(andBytes);
            return ms.ToArray();
        }
    }

    public static void WriteAll(string icoPath, string bridgeIconsDir, string previewPath)
    {
        int[] sizes = new int[] { 16, 20, 24, 32, 48, 64, 256 };
        Dictionary<int, Bitmap> rendered = new Dictionary<int, Bitmap>();
        List<byte[]> payloads = new List<byte[]>();

        foreach (int sz in sizes)
        {
            Bitmap bmp = RenderMaster(sz);
            rendered[sz] = bmp;
            if (sz >= 256)
            {
                using (MemoryStream pms = new MemoryStream())
                {
                    bmp.Save(pms, ImageFormat.Png);
                    payloads.Add(pms.ToArray());
                }
            }
            else
            {
                payloads.Add(EncodeDibFrame(bmp));
            }
        }

        using (FileStream fs = new FileStream(icoPath, FileMode.Create, FileAccess.Write))
        using (BinaryWriter bw = new BinaryWriter(fs))
        {
            bw.Write((ushort)0);
            bw.Write((ushort)1);
            bw.Write((ushort)sizes.Length);
            int offset = 6 + 16 * sizes.Length;
            for (int i = 0; i < sizes.Length; i++)
            {
                int sz = sizes[i];
                bw.Write((byte)(sz >= 256 ? 0 : sz));
                bw.Write((byte)(sz >= 256 ? 0 : sz));
                bw.Write((byte)0);
                bw.Write((byte)0);
                bw.Write((ushort)1);
                bw.Write((ushort)32);
                bw.Write((uint)payloads[i].Length);
                bw.Write((uint)offset);
                offset += payloads[i].Length;
            }
            foreach (byte[] pl in payloads) bw.Write(pl);
        }

        using (Icon testIco16 = new Icon(icoPath, new Size(16, 16)))
        using (Icon testIco32 = new Icon(icoPath, new Size(32, 32)))
        {
            if (testIco16.Width <= 0 || testIco32.Width <= 0) throw new InvalidOperationException("Icon verification failed");
        }

        rendered[16].Save(Path.Combine(bridgeIconsDir, "icon16.png"), ImageFormat.Png);
        rendered[48].Save(Path.Combine(bridgeIconsDir, "icon48.png"), ImageFormat.Png);
        using (Bitmap b128 = RenderMaster(128))
        {
            b128.Save(Path.Combine(bridgeIconsDir, "icon128.png"), ImageFormat.Png);
        }

        if (!string.IsNullOrEmpty(previewPath))
        {
            using (Bitmap sheet = new Bitmap(760, 320, PixelFormat.Format32bppArgb))
            using (Graphics gs = Graphics.FromImage(sheet))
            {
                gs.SmoothingMode = SmoothingMode.HighQuality;
                gs.InterpolationMode = InterpolationMode.HighQualityBicubic;
                gs.Clear(Color.FromArgb(255, 243, 244, 246));
                using (SolidBrush darkBg = new SolidBrush(Color.FromArgb(255, 15, 23, 42)))
                {
                    gs.FillRectangle(darkBg, 0, 160, 760, 160);
                }
                int[] showSz = new int[] { 256, 64, 48, 32, 24, 16 };
                int[] dispSz = new int[] { 120, 64, 48, 32, 24, 16 };
                int x = 30;
                for (int i = 0; i < showSz.Length; i++)
                {
                    int d = dispSz[i];
                    gs.DrawImage(rendered[showSz[i]], new Rectangle(x, 80 - d / 2, d, d));
                    gs.DrawImage(rendered[showSz[i]], new Rectangle(x, 240 - d / 2, d, d));
                    x += d + 38;
                }
                sheet.Save(previewPath, ImageFormat.Png);
            }
        }

        foreach (Bitmap b in rendered.Values) b.Dispose();
    }
}
"@

Add-Type -TypeDefinition $csharp -ReferencedAssemblies System.Drawing
$icoPath = Join-Path (Join-Path $RepoRoot "installer") (Join-Path "win" "prism-suite.ico")
$bridgeIconsDir = Join-Path (Join-Path $RepoRoot "extensions") (Join-Path "chrome-cua-bridge" "icons")
[PrismIconStudio]::WriteAll($icoPath, $bridgeIconsDir, $PreviewOut)
Write-Host ("Generated Prism icon: {0} ({1} bytes)" -f $icoPath, (Get-Item -LiteralPath $icoPath).Length)
