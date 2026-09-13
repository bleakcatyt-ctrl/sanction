using System.Drawing.Drawing2D;

namespace Sanction.Loader.Ui;

/// <summary>
/// Icon set drawn with GDI+ paths. No icon fonts, no emoji, no bitmaps —
/// everything stays crisp at any DPI and matches the site's line-icon style.
/// All glyphs are addressed in normalized coordinates inside the given box.
/// </summary>
internal static class Glyphs
{
    private static PointF P(RectangleF r, float x, float y) => new(r.X + r.Width * x, r.Y + r.Height * y);

    private static Pen Stroke(Color c, float w)
    {
        var pen = new Pen(c, w)
        {
            StartCap = LineCap.Round,
            EndCap = LineCap.Round,
            LineJoin = LineJoin.Round
        };
        return pen;
    }

    public static void Check(Graphics g, RectangleF r, Color c, float w = 2f)
    {
        using var pen = Stroke(c, w);
        g.DrawLines(pen, new[] { P(r, .18f, .55f), P(r, .40f, .75f), P(r, .82f, .28f) });
    }

    public static void Cross(Graphics g, RectangleF r, Color c, float w = 2f)
    {
        using var pen = Stroke(c, w);
        g.DrawLines(pen, new[] { P(r, .28f, .28f), P(r, .72f, .72f) });
        g.DrawLines(pen, new[] { P(r, .72f, .28f), P(r, .28f, .72f) });
    }

    public static void Clock(Graphics g, RectangleF r, Color c, float w = 1.8f)
    {
        using var pen = Stroke(c, w);
        var circle = new RectangleF(r.X + r.Width * .18f, r.Y + r.Height * .18f, r.Width * .64f, r.Height * .64f);
        g.DrawEllipse(pen, circle);
        g.DrawLines(pen, new[] { P(r, .50f, .34f), P(r, .50f, .52f), P(r, .64f, .60f) });
    }

    public static void Warn(Graphics g, RectangleF r, Color c, float w = 1.8f)
    {
        using var pen = Stroke(c, w);
        g.DrawLines(pen, new[] { P(r, .50f, .16f), P(r, .88f, .82f), P(r, .12f, .82f), P(r, .50f, .16f) });
        g.DrawLines(pen, new[] { P(r, .50f, .42f), P(r, .50f, .62f) });
        using var dot = new SolidBrush(c);
        g.FillEllipse(dot, r.X + r.Width * .46f, r.Y + r.Height * .70f, r.Width * .08f, r.Height * .08f);
    }

    public static void Copy(Graphics g, RectangleF r, Color c, float w = 1.6f)
    {
        using var pen = Stroke(c, w);
        using var back = Theme.Rounded(new Rectangle((int)(r.X + r.Width * .30f), (int)(r.Y + r.Height * .12f),
            (int)(r.Width * .56f), (int)(r.Height * .60f)), 2);
        g.DrawPath(pen, back);
        using var front = Theme.Rounded(new Rectangle((int)(r.X + r.Width * .14f), (int)(r.Y + r.Height * .28f),
            (int)(r.Width * .56f), (int)(r.Height * .60f)), 2);
        using var fill = new SolidBrush(Theme.Panel);
        g.FillPath(fill, front);
        g.DrawPath(pen, front);
    }

    public static void Eye(Graphics g, RectangleF r, Color c, bool open, float w = 1.7f)
    {
        using var pen = Stroke(c, w);
        g.DrawBezier(pen, P(r, .10f, .50f), P(r, .30f, .20f), P(r, .70f, .20f), P(r, .90f, .50f));
        g.DrawBezier(pen, P(r, .10f, .50f), P(r, .30f, .80f), P(r, .70f, .80f), P(r, .90f, .50f));
        using var iris = new SolidBrush(c);
        g.FillEllipse(iris, r.X + r.Width * .40f, r.Y + r.Height * .40f, r.Width * .20f, r.Height * .20f);
        if (!open) g.DrawLines(pen, new[] { P(r, .20f, .80f), P(r, .80f, .20f) });
    }

    public static void Download(Graphics g, RectangleF r, Color c, float w = 1.8f)
    {
        using var pen = Stroke(c, w);
        g.DrawLine(pen, P(r, .50f, .16f), P(r, .50f, .62f));
        g.DrawLines(pen, new[] { P(r, .32f, .46f), P(r, .50f, .64f), P(r, .68f, .46f) });
        g.DrawLines(pen, new[] { P(r, .20f, .80f), P(r, .80f, .80f) });
    }

    public static void Refresh(Graphics g, RectangleF r, Color c, float w = 1.8f)
    {
        using var pen = Stroke(c, w);
        var box = new RectangleF(r.X + r.Width * .18f, r.Y + r.Height * .18f, r.Width * .64f, r.Height * .64f);
        g.DrawArc(pen, box, -40, 290);
        g.DrawLines(pen, new[] { P(r, .68f, .16f), P(r, .80f, .28f), P(r, .64f, .34f) });
    }

    public static void Logout(Graphics g, RectangleF r, Color c, float w = 1.8f)
    {
        using var pen = Stroke(c, w);
        g.DrawLines(pen, new[] { P(r, .46f, .18f), P(r, .22f, .18f), P(r, .22f, .82f), P(r, .46f, .82f) });
        g.DrawLine(pen, P(r, .44f, .50f), P(r, .82f, .50f));
        g.DrawLines(pen, new[] { P(r, .68f, .36f), P(r, .82f, .50f), P(r, .68f, .64f) });
    }

    public static void Bolt(Graphics g, RectangleF r, Color c, float w = 1.8f)
    {
        using var pen = Stroke(c, w);
        g.DrawPolygon(pen, new[]
        {
            P(r, .58f, .10f), P(r, .28f, .54f), P(r, .48f, .54f),
            P(r, .42f, .90f), P(r, .74f, .44f), P(r, .53f, .44f)
        });
    }

    public static void Shield(Graphics g, RectangleF r, Color c, float w = 1.7f)
    {
        using var pen = Stroke(c, w);
        g.DrawLines(pen, new[]
        {
            P(r, .50f, .12f), P(r, .84f, .26f), P(r, .84f, .52f),
            P(r, .50f, .88f), P(r, .16f, .52f), P(r, .16f, .26f), P(r, .50f, .12f)
        });
        g.DrawLines(pen, new[] { P(r, .36f, .50f), P(r, .47f, .61f), P(r, .66f, .38f) });
    }

    public static void Key(Graphics g, RectangleF r, Color c, float w = 1.7f)
    {
        using var pen = Stroke(c, w);
        g.DrawEllipse(pen, r.X + r.Width * .12f, r.Y + r.Height * .26f, r.Width * .38f, r.Height * .38f);
        g.DrawLine(pen, P(r, .48f, .50f), P(r, .86f, .50f));
        g.DrawLine(pen, P(r, .72f, .50f), P(r, .72f, .64f));
        g.DrawLine(pen, P(r, .84f, .50f), P(r, .84f, .62f));
    }

    public static void Chip(Graphics g, RectangleF r, Color c, float w = 1.6f)
    {
        using var pen = Stroke(c, w);
        var body = new RectangleF(r.X + r.Width * .26f, r.Y + r.Height * .26f, r.Width * .48f, r.Height * .48f);
        g.DrawRectangle(pen, body.X, body.Y, body.Width, body.Height);
        for (var i = 0; i < 3; i++)
        {
            var t = .34f + i * .16f;
            g.DrawLine(pen, P(r, t, .14f), P(r, t, .26f));
            g.DrawLine(pen, P(r, t, .74f), P(r, t, .86f));
            g.DrawLine(pen, P(r, .14f, t), P(r, .26f, t));
            g.DrawLine(pen, P(r, .74f, t), P(r, .86f, t));
        }
    }

    public static void Link(Graphics g, RectangleF r, Color c, float w = 1.6f)
    {
        using var pen = Stroke(c, w);
        g.DrawLine(pen, P(r, .40f, .60f), P(r, .76f, .24f));
        g.DrawLines(pen, new[] { P(r, .56f, .22f), P(r, .78f, .22f), P(r, .78f, .44f) });
        g.DrawLines(pen, new[] { P(r, .70f, .54f), P(r, .70f, .78f), P(r, .24f, .78f), P(r, .24f, .32f), P(r, .46f, .32f) });
    }

    public static void Minimize(Graphics g, RectangleF r, Color c, float w = 1.5f)
    {
        using var pen = Stroke(c, w);
        g.DrawLine(pen, P(r, .28f, .58f), P(r, .72f, .58f));
    }

    public static void Logo(Graphics g, RectangleF r, float radius = 5f)
    {
        g.SmoothingMode = SmoothingMode.AntiAlias;
        var rect = Rectangle.Round(r);
        using var path = Theme.Rounded(rect, (int)radius);
        using var brush = new LinearGradientBrush(rect, Theme.Accent, Theme.Accent2, 60f);
        g.FillPath(brush, path);

        var mark = RectangleF.Inflate(r, -r.Width * .22f, -r.Height * .22f);
        using var pen = Stroke(Color.FromArgb(255, 6, 12, 24), Math.Max(1.8f, r.Width * .13f));
        g.DrawBezier(pen, P(mark, .82f, .22f), P(mark, .30f, .06f), P(mark, .10f, .56f), P(mark, .54f, .54f));
        g.DrawBezier(pen, P(mark, .54f, .54f), P(mark, .96f, .52f), P(mark, .70f, .98f), P(mark, .20f, .80f));
    }
}
