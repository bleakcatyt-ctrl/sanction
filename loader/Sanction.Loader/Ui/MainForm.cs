using System.Diagnostics;
using System.Runtime.InteropServices;
using Sanction.Loader.Core;

namespace Sanction.Loader.Ui;

internal sealed class MainForm : Form
{
    private const int W = 472;
    private const int H = 724;
    private const int TitleH = 46;

    private readonly ApiClient _api;
    private readonly Panel _content;
    private readonly AuthView _auth;
    private readonly DashboardView _dash;

    private readonly System.Windows.Forms.Timer _ticker = new() { Interval = 1000 };
    private readonly System.Windows.Forms.Timer _heartbeat = new() { Interval = 60_000 };
    private readonly System.Windows.Forms.Timer _gameProbe = new() { Interval = 2000 };

    private LoaderPayload? _payload;
    private LicenseClaims? _claims;
    private bool _tokenValid;
    private bool _online;
    private GameProcess? _game;
    private long _expiresAtMs;
    private bool _authed;
    private bool _busy;

    private Point _titleHover = Point.Empty;
    private bool _dragging;

    public MainForm()
    {
        Text = "Sanction";
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(W, H);
        MinimumSize = new Size(W, H);
        MaximumSize = new Size(W, H);
        BackColor = Theme.Bg;
        DoubleBuffered = true;
        Font = Theme.Body;
        AutoScaleMode = AutoScaleMode.Dpi;
        AutoScaleDimensions = new SizeF(96f, 96f);
        KeyPreview = true;

        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint |
                 ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);

        _api = new ApiClient(AppConfig.ApiBase, AppConfig.Version);
        _api.OnLog += line => _dash.Log(line);

        _content = new Panel { Bounds = new Rectangle(0, TitleH, W, H - TitleH), BackColor = Theme.Bg };

        _auth = new AuthView { Dock = DockStyle.Fill };
        _dash = new DashboardView { Dock = DockStyle.Fill };

        _auth.LoginSubmitted += async (_, e) => await LoginAsync(e);
        _auth.OpenUrl += OpenSite;
        _auth.CopyHwid += () => CopyToClipboard(Machine.Hwid, "HWID скопирован");

        _dash.RefreshRequested += async () => await RefreshAsync();
        _dash.DownloadRequested += async () => await DownloadAsync();
        _dash.LogoutRequested += async () => await LogoutAsync();
        _dash.InjectRequested += async () => await InjectAsync();
        _dash.ResetHwidRequested += () => OpenSite("/dashboard/license");
        _dash.CopyTokenRequested += () => CopyToClipboard(_payload?.Token, "Токен лицензии скопирован");

        _content.Controls.Add(_auth);
        Controls.Add(_content);

        _ticker.Tick += (_, _) => OnTick();
        _heartbeat.Tick += async (_, _) => await HeartbeatAsync();
        _gameProbe.Tick += (_, _) => ProbeGame();

        Region = new Region(Theme.Rounded(new Rectangle(0, 0, W, H), 14));
        MouseDown += OnFormMouseDown;
        MouseMove += OnFormMouseMove;
        MouseUp += OnFormMouseUp;
        KeyDown += async (_, e) =>
        {
            if (e.KeyCode == Keys.F5 && _authed) { e.Handled = true; await RefreshAsync(); }
            if (e.KeyCode == Keys.Escape && _authed) await LogoutAsync();
        };
    }

    /* ---------------------------------------------------------------- lifecycle -- */

    protected override async void OnShown(EventArgs e)
    {
        base.OnShown(e);
        _dash.ResetLog();
        _dash.Log($"Sanction {AppConfig.Version} · {AppConfig.ApiBase}");

        var saved = Vault.Load();
        if (saved is not null)
        {
            _auth.Prefill(saved.Login, saved.Password);
            _dash.Log("Учётные данные загружены из хранилища");
        }

        await ProbeAsync();
        _auth.FocusFirst();
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        _ticker.Stop();
        _heartbeat.Stop();
        _gameProbe.Stop();
        _api.Dispose();
        base.OnFormClosed(e);
    }

    private async Task ProbeAsync()
    {
        _auth.SetBusy(true);
        var boot = await _api.BootstrapAsync();
        _auth.SetBusy(false);

        if (boot.Ok)
        {
            _online = true;
            _auth.SetServer(true, _api.LatencyMs, $"протокол v{boot.Value!.Protocol} · сессия {Fmt.Short(boot.Value.Sid, 12)}");
            if (_api.IdentityState == IdentityState.Fetched)
                _auth.SetError("Ключ сервера не зашит в сборку — получен с сервера. Для релиза выполните npm run loader:config.");
        }
        else
        {
            _online = false;
            _auth.SetServer(false, _api.LatencyMs, boot.Error?.Message ?? "Сервер недоступен");
            if (boot.Error?.Code is "killswitch" or "maintenance") _auth.SetError(boot.Error.Message);
        }

        if (_authed) RebuildState();
    }

    /* -------------------------------------------------------------------- login -- */

    private async Task LoginAsync(LoginEventArgs e)
    {
        if (_busy) return;
        _busy = true;
        _auth.SetBusy(true);
        _auth.SetError(string.Empty);

        if (!_api.HasSession)
        {
            var boot = await _api.BootstrapAsync();
            if (!boot.Ok)
            {
                Finish(boot.Error);
                return;
            }
        }

        var res = await _api.AuthAsync(e.Login, e.Password, Machine.Hwid, Machine.Label);
        if (!res.Ok)
        {
            Finish(res.Error);
            return;
        }

        if (e.Remember) Vault.Save(e.Login, e.Password);
        else Vault.Clear();

        _payload = res.Value;
        _authed = true;
        _busy = false;

        ApplyPayload();
        ShowDashboard();
        _dash.Log($"Вход выполнен · {_payload?.License?.Plan ?? "—"}");
        _dash.SetNotice(string.Empty, Tone.Mute);

        _heartbeat.Interval = Math.Clamp(_api.HeartbeatInterval, 15, 600) * 1000;
        _heartbeat.Start();
        _ticker.Start();
        _gameProbe.Start();
        ProbeGame();
        return;

        void Finish(ApiError? error)
        {
            _busy = false;
            _auth.SetBusy(false);
            var message = error?.Message ?? "Не удалось войти.";
            var hint = error?.Hint;
            _auth.SetError(string.IsNullOrEmpty(hint) ? message : $"{message} {hint}");
            _auth.SetServer(error is not null && error.Status > 0, _api.LatencyMs, message);
            if (error?.Code is "session_not_found" or "no_session" or "timeout" or "network") _ = ProbeAsync();
        }
    }

    private void ApplyPayload()
    {
        _claims = VerifyToken(_payload?.Token);
        _tokenValid = _claims is not null;
        _expiresAtMs = _payload?.License?.ExpiresAt ?? 0;

        if (!_tokenValid && _payload?.Token is not null)
            _dash.Log("Подпись токена не подтверждена — проверьте ключ сервера");
    }

    private LicenseClaims? VerifyToken(string? token)
    {
        if (string.IsNullOrEmpty(token) || _api.Identity is null) return null;
        var claims = Protocol.VerifySigned(_api.Identity, token);
        return claims is null ? null : LicenseClaims.From(claims.Value);
    }

    /* ---------------------------------------------------------------- dashboard -- */

    private void ShowDashboard()
    {
        _content.Controls.Clear();
        _content.Controls.Add(_dash);
        RebuildState();
        Invalidate();
    }

    private async Task ShowAuthAsync(string message)
    {
        _authed = false;
        _payload = null;
        _claims = null;
        _heartbeat.Stop();
        _ticker.Stop();
        _gameProbe.Stop();
        _content.Controls.Clear();
        _content.Controls.Add(_auth);
        _auth.SetError(message);
        _auth.SetBusy(false);
        await ProbeAsync();
        _auth.FocusFirst();
        Invalidate();
    }

    private void RebuildState()
    {
        if (_payload?.License is { } lic && _expiresAtMs > 0)
            lic.RemainingMs = Math.Max(0, _expiresAtMs - DateTimeOffset.Now.ToUnixTimeMilliseconds());

        var input = new VerificationInput
        {
            ServerOnline = _online,
            IdentityState = _api.IdentityState,
            IdentityFingerprint = _api.IdentityFingerprint,
            SessionActive = _api.HasSession,
            Payload = _payload,
            Claims = _claims,
            TokenSignatureValid = _tokenValid,
            Hwid = Machine.Hwid,
            Policy = _api.Policy,
            Build = AppConfig.Version,
            Game = _game,
            PayloadConfigured = Payload.Configured,
            NowSeconds = Protocol.NowSeconds
        };

        var gates = Verification.Evaluate(input);
        _dash.Update(new DashboardState
        {
            Payload = _payload,
            Claims = _claims,
            Gates = gates,
            InjectReady = Verification.InjectReady(gates),
            InjectHint = Verification.FirstProblem(gates),
            Game = _game,
            Hwid = Machine.Hwid,
            NowSeconds = Protocol.NowSeconds
        });
    }

    private void OnTick()
    {
        if (!_authed) return;
        RebuildState();
    }

    private void ProbeGame()
    {
        var found = Game.Find();
        var changed = (found?.Pid ?? 0) != (_game?.Pid ?? 0);
        _game = found;
        if (changed && _authed)
        {
            _dash.Log(found is null ? "Игра не обнаружена" : $"Игра обнаружена: {found.Name} (PID {found.Pid})");
            RebuildState();
        }
    }

    /* --------------------------------------------------------------- rpc calls -- */

    private async Task RefreshAsync()
    {
        if (_busy || !_authed) return;
        _busy = true;
        _dash.SetBusy("Обновление…");

        var res = await _api.LicenseAsync();
        _busy = false;
        _dash.SetBusy(string.Empty);

        if (res.Ok)
        {
            _payload = res.Value;
            ApplyPayload();
            _online = true;
            _dash.SetNotice("Данные обновлены", Tone.Ok);
            _dash.Log("Статус лицензии обновлён");
            RebuildState();
            return;
        }

        _online = res.Error?.Status != 0;
        _dash.SetNotice(res.Error?.Message ?? "Сервер не ответил", Tone.Err);
        _dash.Log("Отказ обновления: " + (res.Error?.Code ?? "unknown"));
        RebuildState();

        if (res.Error is { Fatal: true } || res.Error?.Code is "session_not_found" or "session_state" or "no_session")
            await ShowAuthAsync(res.Error.Message);
    }

    private async Task HeartbeatAsync()
    {
        if (_busy || !_authed) return;

        var res = await _api.HeartbeatAsync();
        if (res.Ok)
        {
            var hb = res.Value!;
            _online = true;
            if (hb.RemainingMs > 0 && _payload?.License is { } lic)
            {
                lic.RemainingMs = hb.RemainingMs;
                _expiresAtMs = DateTimeOffset.Now.ToUnixTimeMilliseconds() + hb.RemainingMs;
            }
            if (!string.IsNullOrEmpty(hb.RefreshToken))
            {
                var claims = VerifyToken(hb.RefreshToken);
                if (claims is not null)
                {
                    _claims = claims;
                    _tokenValid = true;
                    if (_payload is not null) _payload.Token = hb.RefreshToken;
                }
                else
                {
                    _tokenValid = false;
                    _dash.Log("Обновлённый токен не прошёл проверку подписи");
                }
            }
            if (hb.State is not null && _payload is not null) _payload.State = hb.State;
            if (hb.State is "expired" or "revoked" or "banned")
            {
                await ShowAuthAsync($"Доступ прекращён: {Verification.StatusText(hb.State)}.");
                return;
            }
            _dash.SetNotice(string.Empty, Tone.Mute);
            RebuildState();
            return;
        }

        _online = res.Error?.Status != 0;
        _dash.Log("Сердцебиение: " + (res.Error?.Code ?? "unknown"));
        RebuildState();

        if (res.Error is not null && (res.Error.Fatal || res.Error.Code is "session_not_found" or "session_state" or "no_session"))
            await ShowAuthAsync(res.Error.Message + (string.IsNullOrEmpty(res.Error.Hint) ? "" : " " + res.Error.Hint));
        else if (!_online)
            await ProbeAsync();
    }

    private async Task LogoutAsync()
    {
        if (_busy) return;
        _busy = true;
        _dash.SetBusy("Выход…");
        await _api.LogoutAsync();
        _busy = false;
        _dash.SetBusy(string.Empty);
        await ShowAuthAsync(string.Empty);
        _auth.Prefill(Vault.Load()?.Login ?? string.Empty, Vault.Load()?.Password ?? string.Empty);
    }

    /* ------------------------------------------------------------------ inject -- */

    private async Task InjectAsync()
    {
        if (_busy || !_authed) return;

        var input = new VerificationInput
        {
            ServerOnline = _online,
            IdentityState = _api.IdentityState,
            IdentityFingerprint = _api.IdentityFingerprint,
            SessionActive = _api.HasSession,
            Payload = _payload,
            Claims = _claims,
            TokenSignatureValid = _tokenValid,
            Hwid = Machine.Hwid,
            Policy = _api.Policy,
            Build = AppConfig.Version,
            Game = Game.Find(),
            PayloadConfigured = Payload.Configured,
            NowSeconds = Protocol.NowSeconds
        };

        // Re-checked at the moment of the click, never taken from a cached UI state.
        var gates = Verification.Evaluate(input);
        if (!Verification.InjectReady(gates))
        {
            var problem = Verification.FirstProblem(gates) ?? "Проверка не пройдена.";
            _dash.SetNotice(problem, Tone.Err);
            _dash.Log("Inject отклонён: " + problem);
            RebuildState();
            return;
        }

        if (input.Game is null) return;

        _busy = true;
        _dash.SetBusy("Запуск…");
        _dash.SetNotice("Проверки пройдены, запуск модуля…", Tone.Accent);

        PayloadResult result;
        try
        {
            result = await Payload.RunAsync(_claims!, input.Game);
        }
        catch (Exception ex)
        {
            result = new PayloadResult(PayloadStatus.Failed, "Модуль остановлен: " + ex.Message);
        }

        _busy = false;
        _dash.SetBusy(string.Empty);

        switch (result.Status)
        {
            case PayloadStatus.Success:
                _dash.SetNotice(result.Message, Tone.Ok);
                _dash.Log("Модуль запущен");
                break;
            case PayloadStatus.NotConfigured:
                _dash.SetNotice(result.Message, Tone.Warn);
                _dash.Log(result.Message + " Точка подключения: Core/Payload.cs");
                break;
            default:
                _dash.SetNotice(result.Message, Tone.Err);
                _dash.Log("Ошибка модуля: " + result.Message);
                break;
        }
        RebuildState();
    }

    /* ---------------------------------------------------------------- download -- */

    private async Task DownloadAsync()
    {
        if (_busy || !_authed) return;
        _busy = true;
        _dash.SetBusy("Загрузка…");

        var ticket = await _api.DownloadTicketAsync();
        if (!ticket.Ok)
        {
            Fail(ticket.Error?.Message ?? "Билет загрузки не получен.");
            return;
        }

        var url = ticket.Value!.Str("url");
        var hash = ticket.Value.Str("sha256");
        var fileName = ticket.Value.Str("file_name") ?? "Sanction.Loader.exe";
        var build = ticket.Value.Str("build") ?? AppConfig.Version;

        if (string.IsNullOrEmpty(url))
        {
            Fail("Сервер не вернул ссылку на сборку.");
            return;
        }

        var data = await _api.FetchBytesAsync(url);
        if (!data.Ok)
        {
            Fail(data.Error?.Message ?? "Не удалось скачать сборку.");
            return;
        }

        var actual = Hashing.Sha256Hex(data.Value!);
        if (!string.IsNullOrEmpty(hash) && !string.Equals(hash, actual, StringComparison.OrdinalIgnoreCase))
        {
            Fail($"Контрольная сумма не совпала. Ожидалось {Fmt.Short(hash, 12)}, получено {Fmt.Short(actual, 12)}.");
            return;
        }

        try
        {
            var dir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads", "Sanction");
            Directory.CreateDirectory(dir);
            var target = Path.Combine(dir, fileName);
            await File.WriteAllBytesAsync(target, data.Value!);

            _dash.SetNotice($"Сборка {build} сохранена: {target}", Tone.Ok);
            _dash.Log($"Файл проверен (SHA-256 {Fmt.Short(actual, 12)}) и сохранён");
        }
        catch (Exception ex)
        {
            Fail("Не удалось сохранить файл: " + ex.Message);
            return;
        }

        _busy = false;
        _dash.SetBusy(string.Empty);
        RebuildState();
        return;

        void Fail(string message)
        {
            _busy = false;
            _dash.SetBusy(string.Empty);
            _dash.SetNotice(message, Tone.Err);
            _dash.Log("Загрузка: " + message);
            RebuildState();
        }
    }

    /* ------------------------------------------------------------------ chrome -- */

    private Rectangle MinBox => new(W - 76, 10, 28, 26);
    private Rectangle CloseBox => new(W - 44, 10, 28, 26);

    private void OnFormMouseDown(object? sender, MouseEventArgs e)
    {
        if (e.Y > TitleH || e.Button != MouseButtons.Left) return;

        if (CloseBox.Contains(e.Location)) { Close(); return; }
        if (MinBox.Contains(e.Location)) { WindowState = FormWindowState.Minimized; return; }

        _dragging = true;
        ReleaseCapture();
        SendMessage(Handle, WmNcLButtonDown, (IntPtr)HtCaption, IntPtr.Zero);
    }

    private void OnFormMouseMove(object? sender, MouseEventArgs e)
    {
        var hover = MinBox.Contains(e.Location) ? MinBox.Location
                  : CloseBox.Contains(e.Location) ? CloseBox.Location
                  : Point.Empty;

        if (hover != _titleHover)
        {
            _titleHover = hover;
            Invalidate(new Rectangle(0, 0, W, TitleH));
        }

        Cursor = e.Y <= TitleH && e.X < MinBox.X && !_dragging ? Cursors.SizeAll : Cursors.Default;
    }

    private void OnFormMouseUp(object? sender, MouseEventArgs e) => _dragging = false;

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        Theme.Quality(g);

        // title bar
        using (var path = Theme.Rounded(new Rectangle(0, 0, W, TitleH + 14), 14))
        {
            g.SetClip(path);
            using var brush = new SolidBrush(Theme.Panel);
            g.FillRectangle(brush, 0, 0, W, TitleH + 14);
            g.ResetClip();
        }
        using (var pen = new Pen(Theme.Border, 1f))
            g.DrawLine(pen, 0, TitleH, W, TitleH);

        Glyphs.Logo(g, new RectangleF(16, 13, 20, 20), 6f);
        Theme.DrawText(g, "SANCTION", Theme.Wordmark, Theme.Text,
            new Rectangle(44, 0, 140, TitleH), ContentAlignment.MiddleLeft);
        Theme.DrawText(g, AppConfig.Version, Theme.MonoSmall, Theme.Dim,
            new Rectangle(128, 0, 60, TitleH), ContentAlignment.MiddleLeft);

        var minHover = _titleHover == MinBox.Location;
        var closeHover = _titleHover == CloseBox.Location;

        PaintTitleButton(g, MinBox, minHover, Theme.Accent2,
            (gg, r, c) => Glyphs.Minimize(gg, r, c, 1.5f));
        PaintTitleButton(g, CloseBox, closeHover, Theme.Err,
            (gg, r, c) => Glyphs.Cross(gg, r, c, 1.6f));
    }

    private static void PaintTitleButton(Graphics g, Rectangle box, bool hover, Color accent,
        Action<Graphics, RectangleF, Color> draw)
    {
        if (hover)
        {
            using var fill = new SolidBrush(Theme.Alpha(accent, 34));
            g.FillRectangle(fill, box);
        }
        var icon = new RectangleF(box.X + 7, box.Y + 6, 14, 14);
        draw(g, icon, hover ? accent : Theme.Muted);
    }

    /* ------------------------------------------------------------------ helpers -- */

    private void OpenSite(string path)
    {
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = AppConfig.Url(path),
                UseShellExecute = true
            });
        }
        catch (Exception ex)
        {
            _auth.SetError("Не удалось открыть браузер: " + ex.Message);
        }
    }

    private void CopyToClipboard(string? value, string message)
    {
        if (string.IsNullOrEmpty(value)) return;
        try
        {
            Clipboard.SetText(value);
            _dash.Log(message);
            if (_authed) _dash.SetNotice(message, Tone.Ok);
        }
        catch (ExternalException)
        {
            _dash.Log("Буфер обмена недоступен");
        }
    }

    /* ---------------------------------------------------------------- P/Invoke -- */

    private const int WmNcLButtonDown = 0x00A1;
    private const int HtCaption = 0x2;

    [DllImport("user32.dll")]
    private static extern bool ReleaseCapture();

    [DllImport("user32.dll")]
    private static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);
}
