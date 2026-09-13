using System.Drawing.Drawing2D;
using Sanction.Loader.Core;

namespace Sanction.Loader.Ui;

internal enum ButtonKind { Primary, Ghost, Danger, Quiet }

internal enum Tone { Mute, Accent, Ok, Warn, Err }

/* ------------------------------------------------------------------- button -- */

internal sealed class FlatButton : Control
{
    private bool _hot;
    private bool _down;

    public ButtonKind Kind { get; set; } = ButtonKind.Primary;
    public string Glyph { get; set; } = string.Empty;
    public bool Busy { get; set; }
    public int Radius { get; set; } = 11;

    public FlatButton()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint |
                 ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw |
                 ControlStyles.Selectable, true);
        DoubleBuffered = true;
        Height = 46;
        Cursor = Cursors.Hand;
        TabStop = true;
    }

    protected override void OnMouseEnter(EventArgs e) { _hot = true; Invalidate(); base.OnMouseEnter(e); }
    protected override void OnMouseLeave(EventArgs e) { _hot = false; _down = false; Invalidate(); base.OnMouseLeave(e); }
    protected override void OnMouseDown(MouseEventArgs e) { if (e.Button == MouseButtons.Left) { _down = true; Focus(); Invalidate(); } base.OnMouseDown(e); }
    protected override void OnMouseUp(MouseEventArgs e) { if (_down) { _down = false; Invalidate(); } base.OnMouseUp(e); }

    protected override bool IsInputKey(Keys keyData) =>
        keyData is Keys.Enter or Keys.Space or Keys.Tab || base.IsInputKey(keyData);

    protected override void OnKeyUp(KeyEventArgs e)
    {
        if (Enabled && e.KeyCode is Keys.Enter or Keys.Space) OnClick(EventArgs.Empty);
        base.OnKeyUp(e);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        Theme.Quality(g);
        var r = new Rectangle(0, 0, Width - 1, Height - 1);

        var (fill, border, text, glyph) = Palette();
        if (!Enabled)
        {
            fill = Theme.Mix(fill, Theme.Panel, .55f);
            border = Theme.BorderSoft;
            text = Theme.Dim;
            glyph = Theme.Dim;
        }
        else if (_down)
        {
            fill = Theme.Mix(fill, Color.Black, .12f);
        }

        using (var path = Theme.Rounded(r, Radius))
        {
            if (Enabled && Kind == ButtonKind.Primary)
            {
                using var grad = new LinearGradientBrush(r, Theme.Mix(fill, Color.White, _hot ? .10f : 0f), fill, 90f);
                g.FillPath(grad, path);
                using var glow = new Pen(Theme.Alpha(Theme.Accent2, _hot ? 120 : 60), 1f);
                g.DrawPath(glow, path);
            }
            else
            {
                using var b = new SolidBrush(fill);
                g.FillPath(b, path);
                using var p = new Pen(border, 1f);
                g.DrawPath(p, path);
            }
        }

        if (Busy)
        {
            Theme.DrawText(g, Text, Theme.Button, text, r, ContentAlignment.MiddleCenter);
            return;
        }

        var label = Text ?? string.Empty;
        var font = Width < 132 ? Theme.ButtonSmall : Theme.Button;
        var size = Theme.Measure(label, font);
        var glyphBox = 18;
        var gap = string.IsNullOrEmpty(Glyph) ? 0 : 8;
        var total = size.Width + gap + glyphBox;
        var x = (Width - total) / 2;

        if (!string.IsNullOrEmpty(Glyph))
        {
            var box = new RectangleF(x, (Height - glyphBox) / 2f, glyphBox, glyphBox);
            DrawGlyph(g, Glyph, box, glyph);
            x += glyphBox + gap;
        }

        Theme.DrawText(g, label, font, text,
            new Rectangle(x, 0, Math.Max(1, Width - x), Height), ContentAlignment.MiddleLeft);
    }

    private (Color fill, Color border, Color text, Color glyph) Palette() => Kind switch
    {
        ButtonKind.Primary => (Theme.AccentDeep, Theme.Accent, Color.White, Color.White),
        ButtonKind.Ghost => (Theme.PanelAlt, _hot ? Theme.Accent : Theme.Border, Theme.Text, _hot ? Theme.Accent2 : Theme.Muted),
        ButtonKind.Danger => (Color.FromArgb(38, 16, 24), _hot ? Theme.Err : Theme.Border, Theme.Err, Theme.Err),
        _ => (Color.Transparent, Color.Transparent, _hot ? Theme.Accent2 : Theme.Muted, _hot ? Theme.Accent2 : Theme.Muted)
    };

    internal static void DrawGlyph(Graphics g, string name, RectangleF box, Color color)
    {
        switch (name)
        {
            case "bolt": Glyphs.Bolt(g, box, color, 1.9f); break;
            case "refresh": Glyphs.Refresh(g, box, color, 1.9f); break;
            case "download": Glyphs.Download(g, box, color, 1.9f); break;
            case "logout": Glyphs.Logout(g, box, color, 1.9f); break;
            case "copy": Glyphs.Copy(g, box, color, 1.7f); break;
            case "link": Glyphs.Link(g, box, color, 1.7f); break;
            case "key": Glyphs.Key(g, box, color, 1.7f); break;
            case "shield": Glyphs.Shield(g, box, color, 1.7f); break;
            case "chip": Glyphs.Chip(g, box, color, 1.7f); break;
            case "check": Glyphs.Check(g, box, color, 2f); break;
            case "warn": Glyphs.Warn(g, box, color, 1.8f); break;
        }
    }
}

/* ---------------------------------------------------------------- text field -- */

internal sealed class TextField : Panel
{
    private readonly TextBox _input;
    private readonly Label _placeholder;
    private bool _focused;
    private bool _hot;
    private bool _revealed;
    private Rectangle _eyeBox;

    public string Caption { get; set; } = string.Empty;
    public string Placeholder { get; set; } = string.Empty;
    public bool Password { get; set; }
    public bool ShowEye { get; set; }
    public bool HasError { get; set; }
    public int MaxLength { get => _input.MaxLength; set => _input.MaxLength = value; }

    public string Value
    {
        get => _input.Text;
        set { _input.Text = value; SyncPlaceholder(); }
    }

    public event EventHandler? Submitted;

    /// <summary>Raised after every edit, so hosts can clear error state live.</summary>
    public event EventHandler? ValueChanged;

    public TextField()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint |
                 ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        DoubleBuffered = true;
        Height = 62;
        BackColor = Theme.Bg;

        _input = new TextBox
        {
            BorderStyle = BorderStyle.None,
            BackColor = Theme.Field,
            ForeColor = Theme.Text,
            Font = Theme.Body,
            TabStop = true
        };
        _input.GotFocus += (_, _) => { _focused = true; SyncPlaceholder(); Invalidate(); };
        _input.LostFocus += (_, _) => { _focused = false; SyncPlaceholder(); Invalidate(); };
        _input.TextChanged += (_, _) => { SyncPlaceholder(); Invalidate(); OnValueChanged(); };
        _input.KeyDown += (_, e) =>
        {
            if (e.KeyCode == Keys.Enter) { e.SuppressKeyPress = true; Submitted?.Invoke(this, EventArgs.Empty); }
        };
        Controls.Add(_input);

        _placeholder = new Label
        {
            AutoSize = false,
            BackColor = Theme.Field,
            ForeColor = Theme.Dim,
            Font = Theme.Body,
            TextAlign = ContentAlignment.MiddleLeft,
            Visible = false,
            TabStop = false
        };
        _placeholder.Click += (_, _) => _input.Focus();
        Controls.Add(_placeholder);
    }

    public void ClearValue() => Value = string.Empty;

    public void FocusInput() => _input.Focus();

    protected override void OnMouseEnter(EventArgs e) { _hot = true; Invalidate(); base.OnMouseEnter(e); }
    protected override void OnMouseLeave(EventArgs e) { _hot = false; Invalidate(); base.OnMouseLeave(e); }

    protected override void OnMouseMove(MouseEventArgs e)
    {
        Cursor = ShowEye && _eyeBox.Contains(e.Location) ? Cursors.Hand : Cursors.Default;
        base.OnMouseMove(e);
    }

    protected override void OnMouseDown(MouseEventArgs e)
    {
        if (ShowEye && _eyeBox.Contains(e.Location))
        {
            _revealed = !_revealed;
            _input.UseSystemPasswordChar = Password && !_revealed;
            Invalidate();
            return;
        }
        if (!FieldBox.Contains(e.Location)) _input.Focus();
        base.OnMouseDown(e);
    }

    private Rectangle FieldBox => new(0, 22, Width, Height - 22);

    private void OnValueChanged() => ValueChanged?.Invoke(this, EventArgs.Empty);

    private void SyncPlaceholder()
    {
        var show = string.IsNullOrEmpty(_input.Text) && !_focused && !string.IsNullOrEmpty(Placeholder);
        _placeholder.Text = Placeholder;
        _placeholder.Visible = show;
        _input.UseSystemPasswordChar = Password && !_revealed;
    }

    protected override void OnLayout(LayoutEventArgs e)
    {
        base.OnLayout(e);
        var box = FieldBox;
        var pad = 13;
        var eyeW = ShowEye ? 34 : 0;
        _input.SetBounds(box.X + pad, box.Y + (box.Height - _input.PreferredHeight) / 2, box.Width - pad * 2 - eyeW, _input.PreferredHeight);
        _placeholder.SetBounds(_input.Left, _input.Top - 1, _input.Width, box.Height);
        _eyeBox = new Rectangle(box.Right - eyeW + 6, box.Y + (box.Height - 18) / 2, 18, 18);
        SyncPlaceholder();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        Theme.Quality(g);

        if (!string.IsNullOrEmpty(Caption))
            Theme.DrawText(g, Caption, Theme.Small, Theme.Muted, new Rectangle(2, 2, Width - 4, 18), ContentAlignment.MiddleLeft);

        var box = new Rectangle(FieldBox.X, FieldBox.Y, FieldBox.Width - 1, FieldBox.Height - 1);
        var border = HasError ? Theme.Err
                   : _focused ? Theme.Accent
                   : _hot ? Theme.Mix(Theme.Border, Theme.Accent, .5f)
                   : Theme.Border;

        using (var path = Theme.Rounded(box, 10))
        {
            using var fill = new SolidBrush(Theme.Field);
            g.FillPath(fill, path);
            using var pen = new Pen(border, 1f);
            g.DrawPath(pen, path);
            if (_focused)
            {
                using var glow = new Pen(Theme.Alpha(Theme.Accent, 40), 3f);
                g.DrawPath(glow, Theme.Rounded(Rectangle.Inflate(box, -2, -2), 9));
            }
        }

        if (ShowEye)
            Glyphs.Eye(g, _eyeBox, _revealed ? Theme.Accent2 : Theme.Dim, !_revealed, 1.6f);
    }
}

/* ------------------------------------------------------------------ gate row -- */

internal sealed class GateRow : Control
{
    public Gate? Model { get; set; }

    public GateRow()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint |
                 ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        DoubleBuffered = true;
        Height = 30;
    }

    public void Set(Gate gate)
    {
        Model = gate;
        Invalidate();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        Theme.Quality(g);
        var gate = Model ?? new Gate("", "—", GateState.Wait, "ожидание");

        var color = gate.State switch
        {
            GateState.Ok => Theme.Ok,
            GateState.Warn => Theme.Warn,
            GateState.Fail => Theme.Err,
            _ => Theme.Dim
        };

        var iconBox = new RectangleF(10, (Height - 18) / 2f, 18, 18);
        using (var ring = new SolidBrush(Theme.Alpha(color, 26)))
            g.FillEllipse(ring, iconBox.X - 3, iconBox.Y - 3, iconBox.Width + 6, iconBox.Height + 6);

        switch (gate.State)
        {
            case GateState.Ok: Glyphs.Check(g, iconBox, color, 2.1f); break;
            case GateState.Warn: Glyphs.Warn(g, iconBox, color, 1.7f); break;
            case GateState.Fail: Glyphs.Cross(g, iconBox, color, 2.1f); break;
            default: Glyphs.Clock(g, iconBox, color, 1.6f); break;
        }

        Theme.DrawText(g, gate.Label, Theme.Body, Theme.Text, new Rectangle(38, 0, 130, Height), ContentAlignment.MiddleLeft);

        var detailBox = new Rectangle(170, 0, Math.Max(20, Width - 180), Height);
        Theme.DrawText(g, gate.Detail, Theme.MonoSmall, Theme.Mix(color, Theme.Muted, .45f), detailBox, ContentAlignment.MiddleRight);
    }
}

/* ------------------------------------------------------------------ progress -- */

internal sealed class Bar : Control
{
    public double Value { get; set; }
    public Color From { get; set; } = Theme.Accent;
    public Color To { get; set; } = Theme.Accent2;

    public Bar()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint |
                 ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        DoubleBuffered = true;
        Height = 6;
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        var track = new Rectangle(0, 0, Width - 1, Height - 1);
        using (var path = Theme.Rounded(track, Height / 2))
        {
            using var back = new SolidBrush(Theme.PanelAlt);
            g.FillPath(back, path);
            using var edge = new Pen(Theme.BorderSoft, 1f);
            g.DrawPath(edge, path);
        }

        var t = Math.Clamp(Value, 0, 1);
        if (t <= 0.001) return;
        var fillRect = new Rectangle(0, 0, Math.Max(Height, (int)(Width * t)) - 1, Height - 1);
        using var fillPath = Theme.Rounded(fillRect, Height / 2);
        using var grad = new LinearGradientBrush(new Rectangle(0, 0, Math.Max(2, Width), Height), From, To, 0f);
        g.FillPath(grad, fillPath);
    }
}

/* ----------------------------------------------------------------------- chip -- */

internal sealed class Chip : Control
{
    public Tone Tone { get; set; } = Tone.Mute;

    public Chip()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint |
                 ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        DoubleBuffered = true;
        Height = 24;
    }

    public void Set(string text, Tone tone)
    {
        Text = text;
        Tone = tone;
        Invalidate();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        Theme.Quality(g);
        var color = Tone switch
        {
            Tone.Ok => Theme.Ok,
            Tone.Warn => Theme.Warn,
            Tone.Err => Theme.Err,
            Tone.Accent => Theme.Accent2,
            _ => Theme.Muted
        };

        var r = new Rectangle(0, 0, Width - 1, Height - 1);
        using var path = Theme.Rounded(r, Height / 2);
        using var fill = new SolidBrush(Theme.Alpha(color, 26));
        g.FillPath(fill, path);
        using var pen = new Pen(Theme.Alpha(color, 70), 1f);
        g.DrawPath(pen, path);

        Theme.DrawText(g, Text ?? string.Empty, Theme.SmallBold, color, r, ContentAlignment.MiddleCenter);
    }
}

/* ------------------------------------------------------------------ log view -- */

internal sealed class LogView : Control
{
    private readonly List<string> _lines = new();

    public int Capacity { get; set; } = 40;

    public LogView()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint |
                 ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        DoubleBuffered = true;
        Height = 74;
    }

    public void Push(string line)
    {
        if (InvokeRequired) { BeginInvoke(new Action<string>(Push), line); return; }
        _lines.Add($"{DateTime.Now:HH:mm:ss}  {line}");
        while (_lines.Count > Capacity) _lines.RemoveAt(0);
        Invalidate();
    }

    public void Reset()
    {
        if (InvokeRequired) { BeginInvoke(new Action(Reset)); return; }
        _lines.Clear();
        Invalidate();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        Theme.Quality(g);

        var r = new Rectangle(0, 0, Width - 1, Height - 1);
        using (var path = Theme.Rounded(r, 10))
        {
            using var fill = new SolidBrush(Theme.BgSoft);
            g.FillPath(fill, path);
            using var pen = new Pen(Theme.BorderSoft, 1f);
            g.DrawPath(pen, path);
        }

        var lineH = 15;
        var visible = Math.Max(1, (Height - 14) / lineH);
        var start = Math.Max(0, _lines.Count - visible);
        var y = 7;
        for (var i = start; i < _lines.Count; i++)
        {
            var color = _lines[i].Contains("ошибка", StringComparison.OrdinalIgnoreCase) ||
                        _lines[i].Contains("отказ", StringComparison.OrdinalIgnoreCase)
                ? Theme.Mix(Theme.Err, Theme.Muted, .25f)
                : Theme.Dim;
            Theme.DrawText(g, _lines[i], Theme.MonoSmall, color, new Rectangle(10, y, Width - 20, lineH), ContentAlignment.MiddleLeft);
            y += lineH;
        }

        if (_lines.Count == 0)
            Theme.DrawText(g, "журнал сессии", Theme.MonoSmall, Theme.Alpha(Theme.Dim, 150),
                new Rectangle(10, 7, Width - 20, lineH), ContentAlignment.MiddleLeft);
    }
}

/* ------------------------------------------------------------------- toggle --- */

internal sealed class CheckToggle : Control
{
    private bool _hot;

    public bool Checked { get; set; }

    public CheckToggle()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint |
                 ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw |
                 ControlStyles.Selectable, true);
        DoubleBuffered = true;
        Height = 22;
        Width = 140;
        Cursor = Cursors.Hand;
        TabStop = true;
    }

    protected override void OnMouseEnter(EventArgs e) { _hot = true; Invalidate(); base.OnMouseEnter(e); }
    protected override void OnMouseLeave(EventArgs e) { _hot = false; Invalidate(); base.OnMouseLeave(e); }

    protected override void OnMouseUp(MouseEventArgs e)
    {
        if (e.Button == MouseButtons.Left) { Checked = !Checked; Invalidate(); OnClick(e); }
        base.OnMouseUp(e);
    }

    protected override bool IsInputKey(Keys keyData) => keyData is Keys.Space or Keys.Enter || base.IsInputKey(keyData);

    protected override void OnKeyUp(KeyEventArgs e)
    {
        if (e.KeyCode is Keys.Space or Keys.Enter) { Checked = !Checked; Invalidate(); OnClick(EventArgs.Empty); }
        base.OnKeyUp(e);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        Theme.Quality(g);
        var box = new Rectangle(0, (Height - 16) / 2, 16, 16);
        var accent = Checked ? Theme.Accent : (_hot ? Theme.Mix(Theme.Border, Theme.Accent, .6f) : Theme.Border);

        using (var path = Theme.Rounded(box, 4))
        {
            using var fill = new SolidBrush(Checked ? Theme.AccentDeep : Theme.Field);
            g.FillPath(fill, path);
            using var pen = new Pen(accent, 1f);
            g.DrawPath(pen, path);
        }
        if (Checked) Glyphs.Check(g, new RectangleF(box.X + 3, box.Y + 3, 10, 10), Color.White, 1.9f);

        Theme.DrawText(g, Text ?? string.Empty, Theme.Body, Checked ? Theme.Text : Theme.Muted,
            new Rectangle(24, 0, Width - 26, Height), ContentAlignment.MiddleLeft);
    }
}

/* ------------------------------------------------------------------ text link -- */

internal sealed class TextLink : Control
{
    private bool _hot;

    public string Url { get; set; } = string.Empty;
    public bool External { get; set; } = true;

    public TextLink()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint |
                 ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw |
                 ControlStyles.Selectable, true);
        DoubleBuffered = true;
        Height = 20;
        Cursor = Cursors.Hand;
        TabStop = true;
    }

    protected override void OnMouseEnter(EventArgs e) { _hot = true; Invalidate(); base.OnMouseEnter(e); }
    protected override void OnMouseLeave(EventArgs e) { _hot = false; Invalidate(); base.OnMouseLeave(e); }

    protected override void OnMouseUp(MouseEventArgs e)
    {
        if (e.Button == MouseButtons.Left) OnClick(e);
        base.OnMouseUp(e);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        Theme.Quality(g);
        var color = _hot ? Theme.Accent2 : Theme.Muted;
        var size = Theme.Measure(Text ?? string.Empty, Theme.Small);
        Theme.DrawText(g, Text ?? string.Empty, Theme.Small, color, new Rectangle(0, 0, size.Width + 2, Height), ContentAlignment.MiddleLeft);

        using var pen = new Pen(Theme.Alpha(color, _hot ? 200 : 90), 1f);
        var y = Height / 2 + 6;
        g.DrawLine(pen, 1, y, Math.Min(size.Width, Width - 1), y);

        if (External && Width > size.Width + 20)
            Glyphs.Link(g, new RectangleF(size.Width + 6, (Height - 13) / 2f, 13, 13), color, 1.4f);
    }
}
