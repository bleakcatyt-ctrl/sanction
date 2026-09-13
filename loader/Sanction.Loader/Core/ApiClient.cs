using System.Diagnostics;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Sanction.Loader.Core;

internal enum IdentityState
{
    /// <summary>Key was compiled into the build — the only fully trusted mode.</summary>
    Embedded,
    /// <summary>Key was fetched from the server on first run (TOFU).</summary>
    Fetched,
    /// <summary>No key yet.</summary>
    Missing
}

/// <summary>
/// Transport for loader API v1. Everything above the handshake is encrypted and
/// replay-protected with a per-message counter; nothing sensitive is ever sent
/// in clear text.
/// </summary>
internal sealed class ApiClient : IDisposable
{
    private readonly HttpClient _http;
    private readonly object _gate = new();

    private string? _sid;
    private string? _challenge;
    private string? _serverPub;
    private byte[]? _key;
    private long _counter;

    public string BaseUrl { get; }
    public string Build { get; }

    public ECDsa? Identity { get; private set; }
    public IdentityState IdentityState { get; private set; } = IdentityState.Missing;
    public string? IdentityFingerprint { get; private set; }

    public string? Sid { get { lock (_gate) return _sid; } }
    public bool HasSession { get { lock (_gate) return _key is not null && _sid is not null; } }
    public int HeartbeatInterval { get; private set; } = 60;
    public long ServerTime { get; private set; }
    public BuildPolicy? Policy { get; private set; }
    public int LatencyMs { get; private set; }

    /// <summary>Raised for the UI log.</summary>
    public event Action<string>? OnLog;

    public ApiClient(string baseUrl, string build)
    {
        BaseUrl = baseUrl.TrimEnd('/');
        Build = build;

        _http = new HttpClient(new HttpClientHandler
        {
            AllowAutoRedirect = false,
            AutomaticDecompression = System.Net.DecompressionMethods.All
        })
        {
            Timeout = TimeSpan.FromSeconds(25)
        };
        _http.DefaultRequestHeaders.UserAgent.ParseAdd($"Sanction.Loader/{build} (Windows)");
        _http.DefaultRequestHeaders.Accept.ParseAdd("application/json");
        _http.DefaultRequestHeaders.Add("X-Loader-Build", build);
        _http.DefaultRequestHeaders.CacheControl = new CacheControlHeaderValue { NoCache = true, NoStore = true };

        LoadIdentity();
    }

    private void Log(string message) => OnLog?.Invoke(message);

    /* ---------------------------------------------------------------- identity -- */

    private void LoadIdentity()
    {
        if (!string.IsNullOrWhiteSpace(BuildConfig.ServerPublicKeyPem))
        {
            try
            {
                Identity?.Dispose();
                Identity = Protocol.LoadPublicKey(BuildConfig.ServerPublicKeyPem);
                IdentityFingerprint = Protocol.Fingerprint(Identity);
                IdentityState = IdentityState.Embedded;
                Log("Ключ сервера зашит в сборку: " + IdentityFingerprint);
                return;
            }
            catch (Exception ex)
            {
                Log("Вшитый ключ повреждён: " + ex.Message);
            }
        }

        IdentityState = IdentityState.Missing;
    }

    /// <summary>Fetches the server identity key. Only used when the build has none embedded.</summary>
    public async Task<Result<string>> FetchIdentityAsync(CancellationToken ct = default)
    {
        try
        {
            var pem = await _http.GetStringAsync(BaseUrl + "/api/loader/v1/pubkey", ct).ConfigureAwait(false);
            if (string.IsNullOrWhiteSpace(pem) || !pem.Contains("PUBLIC KEY"))
                return Result<string>.Fail(new ApiError { Code = "bad_pubkey", Message = "Сервер вернул некорректный ключ.", Status = 502 });

            Identity?.Dispose();
            Identity = Protocol.LoadPublicKey(pem);
            IdentityFingerprint = Protocol.Fingerprint(Identity);
            IdentityState = IdentityState.Fetched;
            Log("Ключ сервера получен с сервера: " + IdentityFingerprint);
            return Result<string>.Success(IdentityFingerprint);
        }
        catch (Exception ex)
        {
            return Result<string>.Fail(Network(ex));
        }
    }

    /* --------------------------------------------------------------- bootstrap -- */

    public async Task<Result<BootstrapResponse>> BootstrapAsync(CancellationToken ct = default)
    {
        var sw = Stopwatch.StartNew();
        try
        {
            var res = await _http.PostAsJsonAsync(
                BaseUrl + "/api/loader/v1/bootstrap",
                new { build = Build, channel = AppConfig.Channel },
                Json.Options, ct).ConfigureAwait(false);

            LatencyMs = (int)sw.ElapsedMilliseconds;
            var body = await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            var parsed = Json.Parse<BootstrapResponse>(body);

            if (parsed is null || !parsed.Ok || string.IsNullOrEmpty(parsed.Sid))
                return Result<BootstrapResponse>.Fail(FromResponse(res, body, parsed?.Code, parsed?.Message));

            HeartbeatInterval = Math.Clamp(parsed.HeartbeatInterval, 15, 600);
            ServerTime = parsed.ServerTime;
            Policy = parsed.Build;

            lock (_gate)
            {
                _sid = parsed.Sid;
                _challenge = parsed.Challenge;
                _serverPub = parsed.ServerPub;
                _key = null;
                _counter = 0;
            }

            // A proxy with its own identity key is a tampering attempt — refuse it.
            if (Identity is not null && !string.IsNullOrEmpty(parsed.Identity?.Kid) &&
                IdentityFingerprint != parsed.Identity!.Kid)
            {
                InvalidateSession();
                return Result<BootstrapResponse>.Fail(new ApiError
                {
                    Code = "identity_mismatch",
                    Message = "Отпечаток ключа сервера не совпал. Соединение прервано.",
                    Status = 409
                });
            }

            if (Identity is null)
                await FetchIdentityAsync(ct).ConfigureAwait(false);

            Log($"Соединение установлено ({LatencyMs} мс), sid {Fmt.Short(parsed.Sid)}");
            return Result<BootstrapResponse>.Success(parsed);
        }
        catch (Exception ex)
        {
            LatencyMs = (int)sw.ElapsedMilliseconds;
            return Result<BootstrapResponse>.Fail(Network(ex));
        }
    }

    /* --------------------------------------------------------------------- auth -- */

    public async Task<Result<LoaderPayload>> AuthAsync(
        string login, string password, string hwid, string hwidLabel, CancellationToken ct = default)
    {
        if (!HasBootstrap())
        {
            var boot = await BootstrapAsync(ct).ConfigureAwait(false);
            if (!boot.Ok) return Result<LoaderPayload>.Fail(boot.Error!);
        }

        string sid, challenge, serverPub;
        lock (_gate)
        {
            sid = _sid!;
            challenge = _challenge!;
            serverPub = _serverPub!;
        }

        Protocol.Agreement agreement;
        try
        {
            agreement = Protocol.Agree(serverPub, challenge);
        }
        catch (Exception ex)
        {
            return Result<LoaderPayload>.Fail(new ApiError
            {
                Code = "handshake_failed",
                Message = "Не удалось выполнить обмен ключами: " + ex.Message,
                Status = 400
            });
        }

        var inner = new Dictionary<string, object?>
        {
            ["challenge"] = challenge,
            ["login"] = login,
            ["password"] = password,
            ["hwid"] = hwid,
            ["hwid_label"] = hwidLabel,
            ["build"] = Build,
            ["channel"] = AppConfig.Channel
        };

        var request = new RpcRequest
        {
            Sid = sid,
            ClientPub = agreement.ClientPublicKeyHex,
            V = Protocol.Version,
            N = 1,
            Ts = Protocol.NowSeconds,
            P = Protocol.Seal(agreement.Key, sid, 1, Json.Write(inner))
        };

        ClearSecrets(inner);

        try
        {
            var res = await _http.PostAsJsonAsync(BaseUrl + "/api/loader/v1/handshake", request, Json.Options, ct)
                .ConfigureAwait(false);
            var body = await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false);

            if (!res.IsSuccessStatusCode)
            {
                var err = ParseError(body, (int)res.StatusCode);
                Log($"Отказ авторизации: {err.Code}");
                return Result<LoaderPayload>.Fail(err);
            }

            var wrapper = Json.Parse<EnvelopeResponse>(body);
            if (wrapper is null || !wrapper.Ok || wrapper.Envelope is null)
                return Result<LoaderPayload>.Fail(ParseError(body, (int)res.StatusCode));

            string plain;
            try
            {
                plain = Protocol.Open(agreement.Key, wrapper.Envelope.Sid, wrapper.Envelope.N, wrapper.Envelope.P);
            }
            catch (CryptographicException)
            {
                return Result<LoaderPayload>.Fail(new ApiError
                {
                    Code = "decrypt_failed",
                    Message = "Ответ сервера не расшифровывается — ключи не совпали.",
                    Status = 502
                });
            }

            var payload = Json.Parse<LoaderPayload>(plain);
            if (payload is null || !payload.Ok)
                return Result<LoaderPayload>.Fail(new ApiError
                {
                    Code = payload?.Code ?? "bad_payload",
                    Message = payload?.Message ?? "Сервер не вернул данные лицензии.",
                    Status = 502
                });

            lock (_gate)
            {
                _key = agreement.Key;
                _counter = 1;
                if (payload.Session?.HeartbeatInterval is > 0) HeartbeatInterval = payload.Session.HeartbeatInterval;
                if (payload.Session?.ServerTime is > 0) ServerTime = payload.Session.ServerTime;
            }

            Log("Авторизация пройдена, сессия защищена AES-256-GCM");
            return Result<LoaderPayload>.Success(payload);
        }
        catch (Exception ex)
        {
            return Result<LoaderPayload>.Fail(Network(ex));
        }
    }

    /* ---------------------------------------------------------------------- rpc -- */

    public async Task<Result<JsonElement>> CallAsync(
        string action, Dictionary<string, object?>? extra = null, CancellationToken ct = default)
    {
        byte[] key;
        string sid;
        long n;
        lock (_gate)
        {
            if (_key is null || _sid is null)
                return Result<JsonElement>.Fail(new ApiError
                {
                    Code = "no_session",
                    Message = "Нет активной сессии. Войдите заново.",
                    Status = 401
                });
            key = _key;
            sid = _sid;
            n = ++_counter;
        }

        var inner = new Dictionary<string, object?> { ["action"] = action };
        if (extra is not null)
            foreach (var kv in extra) inner[kv.Key] = kv.Value;

        var envelope = new Envelope
        {
            V = Protocol.Version,
            Sid = sid,
            N = n,
            Ts = Protocol.NowSeconds,
            P = Protocol.Seal(key, sid, n, Json.Write(inner))
        };

        try
        {
            var res = await _http.PostAsJsonAsync(BaseUrl + "/api/loader/v1/rpc", envelope, Json.Options, ct)
                .ConfigureAwait(false);
            var body = await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false);

            if (!res.IsSuccessStatusCode)
            {
                var err = ParseError(body, (int)res.StatusCode);
                if (err.Fatal || err.Code is "session_not_found" or "session_state" or "no_session") InvalidateSession();
                Log($"{action}: отказ {err.Code}");
                return Result<JsonElement>.Fail(err);
            }

            var wrapper = Json.Parse<EnvelopeResponse>(body);
            if (wrapper is null || !wrapper.Ok || wrapper.Envelope is null)
                return Result<JsonElement>.Fail(ParseError(body, (int)res.StatusCode));

            string plain;
            try
            {
                plain = Protocol.Open(key, wrapper.Envelope.Sid, wrapper.Envelope.N, wrapper.Envelope.P);
            }
            catch (CryptographicException)
            {
                InvalidateSession();
                return Result<JsonElement>.Fail(new ApiError
                {
                    Code = "decrypt_failed",
                    Message = "Пакет повреждён, сессия сброшена.",
                    Status = 502
                });
            }

            using var doc = JsonDocument.Parse(plain);
            return Result<JsonElement>.Success(doc.RootElement.Clone());
        }
        catch (Exception ex)
        {
            return Result<JsonElement>.Fail(Network(ex));
        }
    }

    public async Task<Result<LoaderPayload>> LicenseAsync(CancellationToken ct = default)
    {
        var r = await CallAsync("license", null, ct).ConfigureAwait(false);
        if (!r.Ok) return Result<LoaderPayload>.Fail(r.Error!);
        var payload = Deserialize<LoaderPayload>(r.Value!);
        return payload is null
            ? Result<LoaderPayload>.Fail(new ApiError { Code = "bad_payload", Message = "Некорректный ответ сервера.", Status = 502 })
            : Result<LoaderPayload>.Success(payload);
    }

    public async Task<Result<HeartbeatPayload>> HeartbeatAsync(CancellationToken ct = default)
    {
        var r = await CallAsync("heartbeat", null, ct).ConfigureAwait(false);
        if (!r.Ok) return Result<HeartbeatPayload>.Fail(r.Error!);
        var payload = Deserialize<HeartbeatPayload>(r.Value!);
        return payload is null
            ? Result<HeartbeatPayload>.Fail(new ApiError { Code = "bad_payload", Message = "Некорректный ответ сервера.", Status = 502 })
            : Result<HeartbeatPayload>.Success(payload);
    }

    public async Task<Result<JsonElement>> HwidStatusAsync(CancellationToken ct = default) =>
        await CallAsync("hwid_status", null, ct).ConfigureAwait(false);

    public async Task<Result<JsonElement>> DownloadTicketAsync(CancellationToken ct = default) =>
        await CallAsync("download", null, ct).ConfigureAwait(false);

    public async Task LogoutAsync(CancellationToken ct = default)
    {
        try { await CallAsync("logout", null, ct).ConfigureAwait(false); }
        catch { /* best effort */ }
        InvalidateSession();
    }

    /* ---------------------------------------------------------------- downloads -- */

    public async Task<Result<byte[]>> FetchBytesAsync(string url, CancellationToken ct = default)
    {
        try
        {
            var bytes = await _http.GetByteArrayAsync(url, ct).ConfigureAwait(false);
            return Result<byte[]>.Success(bytes);
        }
        catch (Exception ex)
        {
            return Result<byte[]>.Fail(Network(ex));
        }
    }

    /* ------------------------------------------------------------------ plumbing -- */

    private bool HasBootstrap()
    {
        lock (_gate) return !string.IsNullOrEmpty(_sid) && !string.IsNullOrEmpty(_serverPub) && !string.IsNullOrEmpty(_challenge);
    }

    public void InvalidateSession()
    {
        lock (_gate)
        {
            if (_key is not null) CryptographicOperations.ZeroMemory(_key);
            _key = null;
            _sid = null;
            _challenge = null;
            _serverPub = null;
            _counter = 0;
        }
    }

    private static void ClearSecrets(Dictionary<string, object?> inner)
    {
        // The dictionary was already serialized; drop references so the password
        // does not linger in managed memory longer than needed.
        inner["password"] = null;
        inner.Clear();
    }

    private static T? Deserialize<T>(JsonElement el)
    {
        try { return el.Deserialize<T>(Json.Options); }
        catch (JsonException) { return default; }
    }

    private static ApiError FromResponse(HttpResponseMessage res, string body, string? code, string? message)
    {
        var err = ParseError(body, (int)res.StatusCode);
        return string.IsNullOrEmpty(err.Code) || err.Code == "http_error"
            ? new ApiError
            {
                Code = code ?? "http_error",
                Message = message ?? $"Сервер ответил {(int)res.StatusCode}.",
                Status = (int)res.StatusCode
            }
            : err;
    }

    private static ApiError ParseError(string body, int status)
    {
        try
        {
            using var doc = JsonDocument.Parse(body);
            var root = doc.RootElement;
            return new ApiError
            {
                Code = root.Str("code") ?? "http_error",
                Message = root.Str("message") ?? $"Ошибка сервера ({status}).",
                Status = status,
                Detail = root.Clone()
            };
        }
        catch (JsonException)
        {
            return new ApiError
            {
                Code = "http_error",
                Message = status switch
                {
                    404 => "Сервер не найден (404).",
                    429 => "Слишком много запросов. Подождите минуту.",
                    502 or 503 or 504 => "Сервер недоступен.",
                    _ => $"Сервер ответил {status}."
                },
                Status = status
            };
        }
    }

    private static ApiError Network(Exception ex)
    {
        var (code, message) = ex switch
        {
            TaskCanceledException => ("timeout", "Сервер не ответил вовремя."),
            HttpRequestException hre => ("network", hre.StatusCode is null
                ? "Нет соединения с сервером."
                : $"Сервер недоступен ({(int)hre.StatusCode})."),
            CryptographicException ce => ("crypto", "Ошибка шифрования: " + ce.Message),
            _ => ("internal", ex.Message)
        };
        return new ApiError { Code = code, Message = message, Status = 0 };
    }

    public void Dispose()
    {
        InvalidateSession();
        Identity?.Dispose();
        _http.Dispose();
    }
}

