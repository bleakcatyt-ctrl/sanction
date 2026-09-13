using System.Drawing.Drawing2D;
using Sanction.Loader.Core;

namespace Sanction.Loader.Ui;

internal sealed class DashboardState
{
    public LoaderPayload? Payload { get; init; }
    public LicenseClaims? Claims { get; init; }
    public List<Gate> Gates { get; init; } = new();
    public bool InjectReady { get; init; }
    public string? InjectHint { get; init; }
    public GameProcess? Game { get; init; }
    public string Hwid { get; init; } = string.Empty;
    public long NowSeconds { get; init; }
}

/// <summary>Subscription state, verification chain and the Inject action.</summary>
internal sealed class DashboardView : Panel
{
    private static readonly string[] GateIds =
        { "server", "identity", "channel", "token", "plan", "hwid", "build", "game", "module" };

    private readonly Chip _state;
    private readonly Dictionary<string, GateRow> _gates = new();
    private readonly FlatButton _inject;
    private readonly FlatButton _refresh;
    private readonly FlatButton _download;
    private readonly FlatButton _logout;
    private readonly FlatButton _hwid;
    private readonly LogView _log;

    private DashboardState _s = new();
    private string _notice = string.Empty;
    private Tone _noticeTone = Tone.Mute;
    private string _busyText = string.Empty;

    public event Action? RefreshRequested;
    public event Action? DownloadRequested;
    public event Action? LogoutRequested;
    public event Action? InjectRequested;
    public event Action? ResetHwidRequested;

    public DashboardView()
    {
        DoubleBuffered = true;
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint |
                 ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        BackColor = Theme.Bg;

        _state = new Chip { Text = "—", Tone = Tone.Mute, Width = 104 };

        foreach (var id in GateIds)
        {
            var row = new GateRow();
            _gates[id] = row;
            Controls.Add(row);
        }

        _inject = new FlatButton
        {
            Text = "Inject",
            Kind = ButtonKind.Primary,
            Glyph = "bolt",
            Height = 58,
            Radius = 14,
            Enabled = false
        };
        _inject.Click += (_, _) => { if (_inject.Enabled) InjectRequested?.Invoke(); };

        _refresh = new FlatButton { Text = "Обновить", Kind = ButtonKind.Ghost, Glyph = "refresh", Height = 40 };
        _refresh.Click += (_, _) => RefreshRequested?.Invoke();

        _download = new FlatButton { Text = "Сборка", Kind = ButtonKind.Ghost, Glyph = "download", Height = 40 };
        _download.Click += (_, _) => DownloadRequested?.Invoke();

        _hwid = new FlatButton { Text = "HWID", Kind = ButtonKind.Ghost, Glyph = "chip", Height = 40 };
        _hwid.Click += (_, _) => ResetHwidRequested?.Invoke();

        _logout = new FlatButton { Text = "Выйти", Kind = ButtonKind.Danger, Glyph = "logout", Height = 40 };
        _logout.Click += (_, _) => LogoutRequested?.Invoke();

        _log = new LogView { Height = 70 };

        Controls.AddRange(new Control[]
        {
            _state, _inject, _refresh, _download, _hwid, _logout, _log
        });
    }

    /* ------------------------------------------------------------------ public -- */

    public void Update(DashboardState state)
    {
        _s = state;

        foreach (var gate in state.Gates)
            if (_gates.TryGetValue(gate.Id, out var row)) row.Set(gate);

        var lic = state.Payload?.License;
        _state.Set(Verification.StatusText(state.Payload?.State), state.Payload?.State switch
        {
            "active" => Tone.Ok,
            "pending" => Tone.Warn,
            "expired" => Tone.Err,
            _ => Tone.Err
        });

        _inject.Enabled = state.InjectReady && string.IsNullOrEmpty(_busyText);
        _download.Enabled = lic is not null && state.Payload?.Download?.Enabled == true;
        _log.Enabled = true;
        Invalidate();
    }

    public void Log(string line) => _log.Push(line);

    public void ResetLog() => _log.Reset();

    public void SetNotice(string message, Tone tone)
    {
        _notice = message ?? string.Empty;
        _noticeTone = tone;
        Invalidate();
    }

    public void SetBusy(string text)
    {
        _busyText = text ?? string.Empty;
        _inject.Busy = !string.IsNullOrEmpty(_busyText);
        _inject.Text = string.IsNullOrEmpty(_busyText) ? "Inject" : _busyText;
        _refresh.Enabled = string.IsNullOrEmpty(_busyText);
        _download.Enabled = string.IsNullOrEmpty(_busyText) && _s.Payload?.Download?.Enabled == true;
        _logout.Enabled = string.IsNullOrEmpty(_busyText);
        Invalidate();
    }

    /* ------------------------------------------------------------------ layout -- */

    protected override void OnLayout(LayoutEventArgs e)
    {
        base.OnLayout(e);
        var pad = 24;
        var w = Width - pad * 2;

        _state.SetBounds(Width - pad - 116, 24, 116, 24);

        var y = 174;
        foreach (var id in GateIds)
        {
            _gates[id].SetBounds(pad, y, w, 30);
            y += 30;
        }

        _inject.SetBounds(pad, y + 12, w, 58);
        y += 100;                     // 58 на кнопку + 18 на строку-подсказку + отступы

        const int gap = 8;
        var bw = (w - gap * 3) / 4;
        _refresh.SetBounds(pad, y, bw, 40);
        _download.SetBounds(pad + (bw + gap), y, bw, 40);
        _hwid.SetBounds(pad + (bw + gap) * 2, y, bw, 40);
        _logout.SetBounds(pad + (bw + gap) * 3, y, w - (bw + gap) * 3, 40);
        y += 48;

        _log.SetBounds(pad, y, w, 70);
    }

    /* ------------------------------------------------------------------- paint -- */

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        Theme.Quality(g);
        var pad = 24;
        var w = Width - pad * 2;
        var lic = _s.Payload?.License;

        PaintSubscriptionCard(g, new Rectangle(pad, 14, w, 132), lic);
        PaintGatesHeader(g, new Rectangle(pad, 150, w, 20));
        PaintHint(g, new Rectangle(pad, _inject.Bottom + 6, w, 18));
    }

    private void PaintSubscriptionCard(Graphics g, Rectangle card, LicenseInfo? lic)
    {
        Theme.Card(g, card, Theme.Panel, Theme.Border, 14);

        var planName = lic is null ? "Нет активной подписки" : PlanName(lic.Plan, lic.Days);
        Theme.DrawText(g, planName, Theme.H2, Theme.Text, new Rectangle(card.X + 16, card.Y + 12, card.Width - 150, 24));

        if (lic is null)
        {
            Theme.DrawText(g, "Войдите, чтобы получить данные лицензии.", Theme.Small, Theme.Muted,
                new Rectangle(card.X + 16, card.Y + 42, card.Width - 32, 20));
            return;
        }

        var expires = Fmt.Date(lic.ExpiresAt);
        Theme.DrawText(g, $"действует до {expires}", Theme.Small, Theme.Muted,
            new Rectangle(card.X + 16, card.Y + 40, 220, 20));
        Theme.DrawText(g, Fmt.Remaining(lic.RemainingMs), Theme.Mono, Theme.Accent2,
            new Rectangle(card.X + card.Width - 236, card.Y + 38, 220, 22), ContentAlignment.MiddleRight);

        var total = Math.Max(1, lic.Days * 86_400_000L);
        var progress = Math.Clamp((double)lic.RemainingMs / total, 0, 1);
        PaintBar(g, new Rectangle(card.X + 16, card.Y + 68, card.Width - 32, 6), progress);

        var features = lic.Features.Count > 0 ? string.Join(" · ", lic.Features) : "базовый набор";
        Theme.DrawText(g, features, Theme.Small, Theme.Dim,
            new Rectangle(card.X + 16, card.Y + 82, card.Width - 32, 18));

        var resets = $"{lic.HwidResetsLeft} {Fmt.Plural(lic.HwidResetsLeft, "сброс", "сброса", "сбросов")} HWID";
        var device = lic.HwidBound ? Machine.ShortId : "не привязан";
        Theme.DrawText(g, $"{device} · {resets}", Theme.MonoSmall, Theme.Muted,
            new Rectangle(card.X + 16, card.Y + 102, card.Width - 32, 18));

        var token = _s.Claims;
        if (token is not null)
            Theme.DrawText(g, $"токен {Fmt.Short(token.Jti, 10)} · до {Fmt.DateSeconds(token.Exp)}",
                Theme.MonoSmall, Theme.Dim,
                new Rectangle(card.X + 16, card.Y + 102, card.Width - 32, 18), ContentAlignment.MiddleRight);
    }

    private static void PaintBar(Graphics g, Rectangle r, double value)
    {
        g.SmoothingMode = SmoothingMode.AntiAlias;
        using (var path = Theme.Rounded(r, r.Height / 2))
        {
            using var back = new SolidBrush(Theme.PanelAlt);
            g.FillPath(back, path);
            using var edge = new Pen(Theme.BorderSoft, 1f);
            g.DrawPath(edge, path);
        }
        if (value <= 0.002) return;
        var fillRect = new Rectangle(r.X, r.Y, Math.Max(r.Height, (int)(r.Width * value)) - 1, r.Height - 1);
        using var fillPath = Theme.Rounded(fillRect, r.Height / 2);
        using var grad = new LinearGradientBrush(new Rectangle(r.X, r.Y, Math.Max(2, r.Width), r.Height),
            value < .15 ? Theme.Warn : Theme.Accent, value < .15 ? Theme.Err : Theme.Accent2, 0f);
        g.FillPath(grad, fillPath);
    }

    private void PaintGatesHeader(Graphics g, Rectangle r)
    {
        Theme.DrawText(g, "ЦЕПОЧКА ПРОВЕРОК", Theme.SmallBold, Theme.Dim, r, ContentAlignment.MiddleLeft);
        var ready = _s.Gates.Count(x => x.State == GateState.Ok);
        Theme.DrawText(g, $"{ready} / {_s.Gates.Count} пройдено", Theme.MonoSmall,
            _s.InjectReady ? Theme.Ok : Theme.Muted, r, ContentAlignment.MiddleRight);
    }

    private void PaintHint(Graphics g, Rectangle r)
    {
        if (!string.IsNullOrEmpty(_notice))
        {
            var color = _noticeTone switch
            {
                Tone.Ok => Theme.Ok,
                Tone.Warn => Theme.Warn,
                Tone.Err => Theme.Err,
                _ => Theme.Muted
            };
            Theme.DrawText(g, _notice, Theme.Small, color, r, ContentAlignment.MiddleCenter);
            return;
        }

        var hint = _s.InjectReady
            ? (_s.Game is null ? "Все проверки пройдены." : $"Все проверки пройдены · {_s.Game.Name} PID {_s.Game.Pid}")
            : _s.InjectHint ?? "Inject заблокирован до завершения проверок.";
        Theme.DrawText(g, hint, Theme.Small, Theme.Dim, r, ContentAlignment.MiddleCenter);
    }

    private static string PlanName(string? plan, int days) => plan switch
    {
        "SANCTION-30" => "Sanction · 30 дней",
        "SANCTION-90" => "Sanction · 90 дней",
        "SANCTION-180" => "Sanction · 180 дней",
        _ => days > 0 ? $"Sanction · {days} дней" : "Sanction"
    };
}
