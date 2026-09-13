using Sanction.Loader.Core;

namespace Sanction.Loader.Ui;

internal sealed class LoginEventArgs : EventArgs
{
    public required string Login { get; init; }
    public required string Password { get; init; }
    public bool Remember { get; init; }
}

/// <summary>Credentials screen. No hint of the product beyond the brand.</summary>
internal sealed class AuthView : Panel
{
    private readonly TextField _login;
    private readonly TextField _password;
    private readonly CheckToggle _remember;
    private readonly FlatButton _submit;
    private readonly Chip _serverChip;
    private readonly TextLink _buy;
    private readonly TextLink _dashboard;
    private readonly TextLink _status;
    private readonly TextLink _copyHwid;

    private string _error = string.Empty;
    private string _serverDetail = "проверка соединения…";
    private bool _serverOnline;
    private int _latency;
    private bool _busy;

    public event EventHandler<LoginEventArgs>? LoginSubmitted;
    public event Action<string>? OpenUrl;
    public event Action? CopyHwid;

    public AuthView()
    {
        DoubleBuffered = true;
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint |
                 ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        BackColor = Theme.Bg;
        Padding = new Padding(0);

        _login = new TextField { Caption = "ЛОГИН ЛОАДЕРА", Placeholder = "snc_xxxxxxxxxxxx", MaxLength = 64 };
        _password = new TextField { Caption = "ПАРОЛЬ", Placeholder = "пароль из личного кабинета", Password = true, ShowEye = true, MaxLength = 128 };
        _password.Submitted += (_, _) => TrySubmit();

        _remember = new CheckToggle { Text = "Запомнить на этом ПК", Checked = false };

        _submit = new FlatButton { Text = "Войти", Kind = ButtonKind.Primary, Glyph = "key", Height = 48 };
        _submit.Click += (_, _) => TrySubmit();

        _serverChip = new Chip { Text = "проверка", Tone = Tone.Mute, Width = 92 };

        _buy = new TextLink { Text = "Купить доступ", Url = "/pricing" };
        _dashboard = new TextLink { Text = "Личный кабинет", Url = "/dashboard" };
        _status = new TextLink { Text = "Статус сервера", Url = "/status" };
        _copyHwid = new TextLink { Text = "скопировать HWID", External = false };

        foreach (var link in new[] { _buy, _dashboard, _status })
            link.Click += (_, _) => OpenUrl?.Invoke(((TextLink)link!).Url);
        _copyHwid.Click += (_, _) => CopyHwid?.Invoke();

        Controls.AddRange(new Control[]
        {
            _login, _password, _remember, _submit, _serverChip,
            _buy, _dashboard, _status, _copyHwid
        });
    }

    /* ------------------------------------------------------------------ public -- */

    public void SetBusy(bool busy)
    {
        _busy = busy;
        _submit.Busy = busy;
        _submit.Text = busy ? "Проверка…" : "Войти";
        _submit.Enabled = !busy;
        _login.Enabled = !busy;
        _password.Enabled = !busy;
        Invalidate();
    }

    public void SetError(string message)
    {
        _error = message ?? string.Empty;
        _login.HasError = !string.IsNullOrEmpty(_error);
        _password.HasError = !string.IsNullOrEmpty(_error);
        Invalidate();
    }

    public void SetServer(bool online, int latency, string detail)
    {
        _serverOnline = online;
        _latency = latency;
        _serverDetail = detail;
        _serverChip.Set(online ? $"онлайн · {latency} мс" : "офлайн", online ? Tone.Ok : Tone.Err);
        Invalidate();
    }

    public void Prefill(string login, string password)
    {
        _login.Value = login;
        _password.Value = password;
        _remember.Checked = !string.IsNullOrEmpty(login);
    }

    public void FocusFirst()
    {
        if (string.IsNullOrEmpty(_login.Value)) _login.FocusInput();
        else _password.FocusInput();
    }

    private void TrySubmit()
    {
        if (_busy) return;

        var login = _login.Value.Trim();
        var password = _password.Value;

        if (login.Length == 0) { SetError("Введите логин лоадера."); _login.FocusInput(); return; }
        if (password.Length == 0) { SetError("Введите пароль."); _password.FocusInput(); return; }

        SetError(string.Empty);
        LoginSubmitted?.Invoke(this, new LoginEventArgs { Login = login, Password = password, Remember = _remember.Checked });
    }

    /* ------------------------------------------------------------------ layout -- */

    protected override void OnLayout(LayoutEventArgs e)
    {
        base.OnLayout(e);
        var pad = 24;
        var w = Width - pad * 2;

        _login.SetBounds(pad, 96, w, 62);
        _password.SetBounds(pad, 170, w, 62);
        _remember.SetBounds(pad, 244, 190, 22);
        _buy.SetBounds(Width - pad - 118, 244, 118, 22);
        _submit.SetBounds(pad, 284, w, 48);
        _serverChip.SetBounds(Width - pad - 104, 372, 104, 24);
        _dashboard.SetBounds(pad, 592, 128, 20);
        _status.SetBounds(pad + 146, 592, 128, 20);
        _copyHwid.SetBounds(Width - pad - 130, 592, 130, 20);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        Theme.Quality(g);
        var pad = 24;
        var w = Width - pad * 2;

        // heading
        Theme.DrawText(g, "Вход в лоадер", Theme.Title, Theme.Text, new Rectangle(pad, 26, w, 30), ContentAlignment.MiddleLeft);
        Theme.DrawText(g, "Логин и пароль выдаются после оплаты и видны в личном кабинете.",
            Theme.Small, Theme.Muted, new Rectangle(pad, 58, w, 18), ContentAlignment.MiddleLeft);

        // separator
        using (var pen = new Pen(Theme.BorderSoft, 1f))
            g.DrawLine(pen, pad, 86, Width - pad, 86);

        // error line
        if (!string.IsNullOrEmpty(_error))
        {
            var box = new Rectangle(pad, 342, w, 34);
            using var path = Theme.Rounded(box, 9);
            using var fill = new SolidBrush(Theme.Alpha(Theme.Err, 24));
            g.FillPath(fill, path);
            using var pen = new Pen(Theme.Alpha(Theme.Err, 90), 1f);
            g.DrawPath(pen, path);
            Glyphs.Warn(g, new RectangleF(box.X + 10, box.Y + 8, 17, 17), Theme.Err, 1.7f);
            Theme.DrawText(g, _error, Theme.Small, Theme.Mix(Theme.Err, Theme.Text, .35f),
                new Rectangle(box.X + 34, box.Y, box.Width - 44, box.Height), ContentAlignment.MiddleLeft);
        }

        // connection card
        var card = new Rectangle(pad, 366, w, 200);
        Theme.Card(g, card, Theme.Panel, Theme.Border, 14);

        Theme.DrawText(g, "СОСТОЯНИЕ", Theme.SmallBold, Theme.Dim, new Rectangle(card.X + 16, card.Y + 12, 200, 18));
        var rowY = card.Y + 38;
        Row(g, card, ref rowY, "Сервер", _serverOnline ? $"{AppConfig.ApiBase}" : "недоступен",
            _serverOnline ? Theme.Muted : Theme.Err, mono: true);
        Row(g, card, ref rowY, "Задержка", _serverOnline ? $"{_latency} мс" : "—");
        Row(g, card, ref rowY, "Устройство", Machine.Label);
        Row(g, card, ref rowY, "HWID", Machine.ShortId, Theme.Accent2, mono: true);
        Row(g, card, ref rowY, "Протокол", "ECDH P-256 · AES-256-GCM");

        using (var pen = new Pen(Theme.BorderSoft, 1f))
            g.DrawLine(pen, card.X + 16, card.Y + card.Height - 44, card.Right - 16, card.Y + card.Height - 44);
        Theme.DrawText(g, _serverDetail, Theme.Small, Theme.Dim,
            new Rectangle(card.X + 16, card.Y + card.Height - 40, card.Width - 32, 30), ContentAlignment.MiddleLeft);

        // footer
        Theme.DrawText(g, $"Sanction · сборка {AppConfig.Version} · канал {AppConfig.Channel}",
            Theme.MonoSmall, Theme.Alpha(Theme.Dim, 190),
            new Rectangle(pad, Height - 34, w, 18), ContentAlignment.MiddleLeft);
        if (AppConfig.InsecureTransport)
            Theme.DrawText(g, "незащищённый канал: локальный сервер", Theme.MonoSmall, Theme.Alpha(Theme.Warn, 210),
                new Rectangle(pad, Height - 34, w, 18), ContentAlignment.MiddleRight);
    }

    private static void Row(Graphics g, Rectangle card, ref int y, string label, string value, Color? color = null, bool mono = false)
    {
        Theme.DrawText(g, label, Theme.Small, Theme.Dim, new Rectangle(card.X + 16, y, 110, 22), ContentAlignment.MiddleLeft);
        Theme.DrawText(g, value, mono ? Theme.MonoSmall : Theme.Body, color ?? Theme.Text,
            new Rectangle(card.X + 126, y, card.Width - 142, 22), ContentAlignment.MiddleRight);
        y += 26;
    }
}
