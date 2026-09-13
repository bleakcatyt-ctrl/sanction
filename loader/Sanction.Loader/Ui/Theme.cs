using System.Drawing.Drawing2D;

namespace Sanction.Loader.Ui;

/// <summary>
/// Palette and typography of the loader. Mirrors the site (blue/cyan on deep
/// navy) so the product reads as one thing across browser and desktop.
/// </summary>
internal static class Theme
{
    public static readonly Color Bg = FromHex("070B14");
    public static readonly Color BgSoft = FromHex("0A1120");
    public static readonly Color Panel = FromHex("0E1526");
    public static readonly Color PanelAlt = FromHex("131C31");
    public static readonly Color Field = FromHex("080E1B");
    public static readonly Color Border = FromHex("1E2A45");
    public static readonly Color BorderSoft = FromHex("17213A");

    public static readonly Color Text = FromHex("E6EDF7");
    public static readonly Color Muted = FromHex("8A9AB8");
    public static readonly Color Dim = FromHex("5C6C8A");

    public static readonly Color Accent = FromHex("38BDF8");
    public static readonly Color Accent2 = FromHex("22D3EE");
    public static readonly Color AccentDeep = FromHex("0B4F73");
    public static readonly Color AccentSoft = FromHex("12283D");

    public static readonly Color Ok = FromHex("34D399");
    public static readonly Color Warn = FromHex("FBBF24");
    public static readonly Color Err = FromHex("F87171");

    public static readonly Font Title = new("Segoe UI", 16.5f, FontStyle.Bold, GraphicsUnit.Point);
    public static readonly Font H2 = new("Segoe UI", 12f, FontStyle.Bold, GraphicsUnit.Point);
    public static readonly Font H3 = new("Segoe UI", 10f, FontStyle.Bold, GraphicsUnit.Point);
    public static readonly Font Body = new("Segoe UI", 9.5f, FontStyle.Regular, GraphicsUnit.Point);
    public static readonly Font BodyBold = new("Segoe UI", 9.5f, FontStyle.Bold, GraphicsUnit.Point);
    public static readonly Font Small = new("Segoe UI", 8.5f, FontStyle.Regular, GraphicsUnit.Point);
    public static readonly Font SmallBold = new("Segoe UI", 8.5f, FontStyle.Bold, GraphicsUnit.Point);
    public static readonly Font Mono = new("Consolas", 9f, FontStyle.Regular, GraphicsUnit.Point);
    public static readonly Font MonoSmall = new("Consolas", 8f, FontStyle.Regular, GraphicsUnit.Point);
    public static readonly Font Wordmark = new("Segoe UI", 10.5f, FontStyle.Bold, GraphicsUnit.Point);
    public static readonly Font Button = new("Segoe UI", 10.5f, FontStyle.Bold, GraphicsUnit.Point);
    public static readonly Font ButtonSmall = new("Segoe UI", 9f, FontStyle.Bold, GraphicsUnit.Point);

    public static Color FromHex(string hex)
    {
        var v = hex.Replace("#", string.Empty);
        return Color.FromArgb(
            255,
            Convert.ToInt32(v.Substring(0, 2), 16),
            Convert.ToInt32(v.Substring(2, 2), 16),
            Convert.ToInt32(v.Substring(4, 2), 16));
    }

    public static Color Mix(Color a, Color b, float t) => Color.FromArgb(
        (int)(a.A + (b.A - a.A) * t),
        (int)(a.R + (b.R - a.R) * t),
        (int)(a.G + (b.G - a.G) * t),
        (int)(a.B + (b.B - a.B) * t));

    public static Color Alpha(Color c, int alpha) => Color.FromArgb(alpha, c.R, c.G, c.B);

    public static GraphicsPath Rounded(Rectangle r, int radius)
    {
        var path = new GraphicsPath();
        var d = radius * 2;
        if (d <= 0 || r.Width <= d || r.Height <= d)
        {
            path.AddRectangle(r);
            return path;
        }
        path.AddArc(r.X, r.Y, d, d, 180, 90);
        path.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        path.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }

    public static void Panel(Graphics g, Rectangle r, Color fill, Color border, int radius = 12)
    {
        g.SmoothingMode = SmoothingMode.AntiAlias;
        using var path = Rounded(r, radius);
        using var b = new SolidBrush(fill);
        g.FillPath(b, path);
        using var pen = new Pen(border, 1f);
        g.DrawPath(pen, path);
    }

    public static void Text(Graphics g, string text, Font font, Color color, Rectangle r,
        ContentAlignment align = ContentAlignment.MiddleLeft)
    {
        var flags = TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix;
        flags |= align switch
        {
            ContentAlignment.MiddleRight => TextFormatFlags.Right,
            ContentAlignment.MiddleCenter => TextFormatFlags.HorizontalCenter,
            ContentAlignment.TopLeft => TextFormatFlags.Top | TextFormatFlags.Left,
            _ => TextFormatFlags.Left
        };
        TextRenderer.DrawText(g, text, font, r, color, flags);
    }

    public static Size Measure(string text, Font font) =>
        TextRenderer.MeasureText(text, font, Size.Empty, TextFormatFlags.NoPrefix);

    public static void Quality(Graphics g)
    {
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
    }
}
