using System.Text.Json;
using System.Text.Json.Serialization;

namespace Sanction.Loader.Core;

/* ---------------------------------------------------------------- envelopes -- */

internal sealed class Envelope
{
    [JsonPropertyName("v")] public int V { get; set; } = Protocol.Version;
    [JsonPropertyName("sid")] public string Sid { get; set; } = string.Empty;
    [JsonPropertyName("n")] public long N { get; set; }
    [JsonPropertyName("ts")] public long Ts { get; set; }
    [JsonPropertyName("p")] public string P { get; set; } = string.Empty;
}

internal sealed class RpcRequest
{
    [JsonPropertyName("sid")] public string Sid { get; set; } = string.Empty;
    [JsonPropertyName("client_pub")] public string? ClientPub { get; set; }
    [JsonPropertyName("v")] public int V { get; set; } = Protocol.Version;
    [JsonPropertyName("n")] public long N { get; set; } = 1;
    [JsonPropertyName("ts")] public long Ts { get; set; }
    [JsonPropertyName("p")] public string P { get; set; } = string.Empty;
}

internal sealed class EnvelopeResponse
{
    [JsonPropertyName("ok")] public bool Ok { get; set; }
    [JsonPropertyName("envelope")] public Envelope? Envelope { get; set; }
    [JsonPropertyName("code")] public string? Code { get; set; }
    [JsonPropertyName("message")] public string? Message { get; set; }
}

/* ---------------------------------------------------------------- bootstrap -- */

internal sealed class BuildPolicy
{
    [JsonPropertyName("latest")] public string? Latest { get; set; }
    [JsonPropertyName("min")] public string? Min { get; set; }
}

internal sealed class IdentityInfo
{
    [JsonPropertyName("kid")] public string? Kid { get; set; }
    [JsonPropertyName("alg")] public string? Alg { get; set; }
}

internal sealed class BootstrapResponse
{
    [JsonPropertyName("ok")] public bool Ok { get; set; }
    [JsonPropertyName("protocol")] public int Protocol { get; set; }
    [JsonPropertyName("sid")] public string? Sid { get; set; }
    [JsonPropertyName("challenge")] public string? Challenge { get; set; }
    [JsonPropertyName("server_pub")] public string? ServerPub { get; set; }
    [JsonPropertyName("identity")] public IdentityInfo? Identity { get; set; }
    [JsonPropertyName("expires_at")] public long ExpiresAt { get; set; }
    [JsonPropertyName("server_time")] public long ServerTime { get; set; }
    [JsonPropertyName("heartbeat_interval")] public int HeartbeatInterval { get; set; } = 60;
    [JsonPropertyName("build")] public BuildPolicy? Build { get; set; }
    [JsonPropertyName("code")] public string? Code { get; set; }
    [JsonPropertyName("message")] public string? Message { get; set; }
}

/* ------------------------------------------------------------------ payload -- */

internal sealed class LicenseInfo
{
    [JsonPropertyName("plan")] public string? Plan { get; set; }
    [JsonPropertyName("days")] public int Days { get; set; }
    [JsonPropertyName("status")] public string? Status { get; set; }
    [JsonPropertyName("activated_at")] public long? ActivatedAt { get; set; }
    [JsonPropertyName("expires_at")] public long? ExpiresAt { get; set; }
    [JsonPropertyName("expires_at_unix")] public long? ExpiresAtUnix { get; set; }
    [JsonPropertyName("remaining_ms")] public long RemainingMs { get; set; }
    [JsonPropertyName("remaining_days")] public double RemainingDays { get; set; }
    [JsonPropertyName("hwid_bound")] public bool HwidBound { get; set; }
    [JsonPropertyName("hwid_resets_left")] public int HwidResetsLeft { get; set; }
    [JsonPropertyName("max_devices")] public int MaxDevices { get; set; }
    [JsonPropertyName("features")] public List<string> Features { get; set; } = new();
}

internal sealed class SessionInfo
{
    [JsonPropertyName("sid")] public string? Sid { get; set; }
    [JsonPropertyName("heartbeat_interval")] public int HeartbeatInterval { get; set; } = 60;
    [JsonPropertyName("server_time")] public long ServerTime { get; set; }
    [JsonPropertyName("expires_at")] public long? ExpiresAt { get; set; }
}

internal sealed class DownloadInfo
{
    [JsonPropertyName("enabled")] public bool Enabled { get; set; }
    [JsonPropertyName("reason")] public string? Reason { get; set; }
    [JsonPropertyName("build")] public string? Build { get; set; }
    [JsonPropertyName("url")] public string? Url { get; set; }
    [JsonPropertyName("ttl")] public int Ttl { get; set; }
}

internal sealed class SiteInfo
{
    [JsonPropertyName("status")] public string? Status { get; set; }
    [JsonPropertyName("status_text")] public string? StatusText { get; set; }
    [JsonPropertyName("announcement")] public string? Announcement { get; set; }
}

internal sealed class LoaderPayload
{
    [JsonPropertyName("ok")] public bool Ok { get; set; }
    [JsonPropertyName("state")] public string? State { get; set; }
    [JsonPropertyName("license")] public LicenseInfo? License { get; set; }
    [JsonPropertyName("session")] public SessionInfo? Session { get; set; }
    [JsonPropertyName("token")] public string? Token { get; set; }
    [JsonPropertyName("download")] public DownloadInfo? Download { get; set; }
    [JsonPropertyName("site")] public SiteInfo? Site { get; set; }
    [JsonPropertyName("code")] public string? Code { get; set; }
    [JsonPropertyName("message")] public string? Message { get; set; }
}

internal sealed class HeartbeatPayload
{
    [JsonPropertyName("ok")] public bool Ok { get; set; }
    [JsonPropertyName("action")] public string? Action { get; set; }
    [JsonPropertyName("state")] public string? State { get; set; }
    [JsonPropertyName("expires_at")] public long? ExpiresAt { get; set; }
    [JsonPropertyName("remaining_ms")] public long RemainingMs { get; set; }
    [JsonPropertyName("server_time")] public long ServerTime { get; set; }
    [JsonPropertyName("heartbeat_interval")] public int HeartbeatInterval { get; set; } = 60;
    [JsonPropertyName("site")] public SiteInfo? Site { get; set; }
    [JsonPropertyName("refresh_token")] public string? RefreshToken { get; set; }
    [JsonPropertyName("code")] public string? Code { get; set; }
    [JsonPropertyName("message")] public string? Message { get; set; }
}

/* ------------------------------------------------------------- signed claims -- */

internal sealed class LicenseClaims
{
    public string Typ { get; init; } = string.Empty;
    public int Ver { get; init; }
    public string Iss { get; init; } = string.Empty;
    public string? Sub { get; init; }
    public string? Login { get; init; }
    public string? Plan { get; init; }
    public int Days { get; init; }
    public string? Status { get; init; }
    public string? Hwid { get; init; }
    public string? Sid { get; init; }
    public string? Build { get; init; }
    public List<string> Features { get; init; } = new();
    public long Iat { get; init; }
    public long Nbf { get; init; }
    public long Exp { get; init; }
    public string? Jti { get; init; }

    public static LicenseClaims? From(JsonElement el)
    {
        if (el.ValueKind != JsonValueKind.Object) return null;
        var features = new List<string>();
        if (el.TryGetProperty("features", out var f) && f.ValueKind == JsonValueKind.Array)
            foreach (var item in f.EnumerateArray())
                if (item.ValueKind == JsonValueKind.String) features.Add(item.GetString() ?? string.Empty);

        return new LicenseClaims
        {
            Typ = el.Str("typ") ?? string.Empty,
            Ver = (int)el.Num("ver"),
            Iss = el.Str("iss") ?? string.Empty,
            Sub = el.Str("sub"),
            Login = el.Str("login"),
            Plan = el.Str("plan"),
            Days = (int)el.Num("days"),
            Status = el.Str("status"),
            Hwid = el.Str("hwid"),
            Sid = el.Str("sid"),
            Build = el.Str("build"),
            Features = features,
            Iat = el.Num("iat"),
            Nbf = el.Num("nbf"),
            Exp = el.Num("exp"),
            Jti = el.Str("jti")
        };
    }

    public bool Expired(long nowSeconds, int skewSeconds = 30) => Exp > 0 && Exp + skewSeconds < nowSeconds;
    public bool NotYetValid(long nowSeconds, int skewSeconds = 30) => Nbf > 0 && Nbf - skewSeconds > nowSeconds;
}

/* -------------------------------------------------------------------- errors -- */

internal sealed class ApiError
{
    public required string Code { get; init; }
    public required string Message { get; init; }
    public int Status { get; init; }
    public JsonElement? Detail { get; init; }

    public string? DetailString(string name) => Detail?.Str(name);

    /// <summary>Human hint for the well-known refusal codes.</summary>
    public string Hint => Code switch
    {
        "invalid_credentials" => "Проверьте логин и пароль из личного кабинета.",
        "hwid_mismatch" => "Ключ привязан к другому устройству. Сбросьте HWID на сайте.",
        "hwid_blacklisted" => "Устройство заблокировано. Обратитесь в поддержку.",
        "subscription_expired" => "Подписка истекла — продлите доступ на сайте.",
        "not_entitled" => "Нет активной подписки.",
        "license_revoked" => "Доступ отозван администрацией.",
        "account_banned" => "Аккаунт заблокирован.",
        "killswitch" => "Сервис временно недоступен. Попробуйте позже.",
        "maintenance" => "На сервере технические работы.",
        "build_outdated" => "Сборка устарела — скачайте новую версию лоадера.",
        "locked" => "Слишком много попыток входа. Подождите и повторите.",
        "session_not_found" => "Сессия истекла. Лоадер переподключится автоматически.",
        "replay_detected" => "Пакет отклонён. Проверьте системное время.",
        _ => string.Empty
    };

    public bool Fatal => Code is "invalid_credentials" or "hwid_mismatch" or "subscription_expired"
        or "not_entitled" or "license_revoked" or "account_banned" or "hwid_blacklisted" or "build_outdated";
}

internal sealed class Result<T>
{
    public T? Value { get; init; }
    public ApiError? Error { get; init; }
    public bool Ok => Error is null && Value is not null;

    public static Result<T> Success(T value) => new() { Value = value };
    public static Result<T> Fail(ApiError error) => new() { Error = error };
}
