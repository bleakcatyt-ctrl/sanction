using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Sanction.Loader.Core;

internal static class B64Url
{
    public static string Encode(byte[] data) =>
        Convert.ToBase64String(data).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    public static byte[] Decode(string value)
    {
        var s = value.Replace('-', '+').Replace('_', '/');
        switch (s.Length % 4)
        {
            case 2: s += "=="; break;
            case 3: s += "="; break;
            case 0: break;
            default: throw new FormatException("invalid base64url length");
        }
        return Convert.FromBase64String(s);
    }
}

internal static class Hex
{
    public static string Encode(byte[] data) => Convert.ToHexString(data).ToLowerInvariant();

    public static byte[] Decode(string value) =>
        Convert.FromHexString(value.Replace(" ", string.Empty).ToUpperInvariant());
}

internal static class Hashing
{
    public static string Sha256Hex(string text) => Sha256Hex(Encoding.UTF8.GetBytes(text));

    public static string Sha256Hex(byte[] data) => Hex.Encode(SHA256.HashData(data));
}

/// <summary>Shared serializer settings — the wire format is defined by the server.</summary>
internal static class Json
{
    public static readonly JsonSerializerOptions Options = new()
    {
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        NumberHandling = JsonNumberHandling.AllowReadingFromString,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true
    };

    public static T? Parse<T>(string json) => JsonSerializer.Deserialize<T>(json, Options);

    public static string Write(object value) => JsonSerializer.Serialize(value, Options);
}

internal static class JsonElementExtensions
{
    public static string? Str(this JsonElement el, string name) =>
        el.ValueKind == JsonValueKind.Object && el.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString()
            : null;

    public static long Num(this JsonElement el, string name) =>
        el.ValueKind == JsonValueKind.Object && el.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number
            ? v.GetInt64()
            : 0;

    public static bool Flag(this JsonElement el, string name) =>
        el.ValueKind == JsonValueKind.Object && el.TryGetProperty(name, out var v) &&
        (v.ValueKind == JsonValueKind.True || (v.ValueKind == JsonValueKind.Number && v.GetInt64() == 1));

    public static JsonElement? Obj(this JsonElement el, string name) =>
        el.ValueKind == JsonValueKind.Object && el.TryGetProperty(name, out var v) &&
        (v.ValueKind == JsonValueKind.Object || v.ValueKind == JsonValueKind.Array)
            ? v
            : null;
}

internal static class Fmt
{
    /// <summary>dd.MM.yyyy HH:mm — the format used across the site.</summary>
    public static string Date(long? unixMs)
    {
        if (unixMs is null or <= 0) return "—";
        var dt = DateTimeOffset.FromUnixTimeMilliseconds(unixMs.Value).LocalDateTime;
        return $"{dt.Day:00}.{dt.Month:00}.{dt.Year}";
    }

    public static string DateFull(long? unixMs)
    {
        if (unixMs is null or <= 0) return "—";
        var dt = DateTimeOffset.FromUnixTimeMilliseconds(unixMs.Value).LocalDateTime;
        return $"{dt.Day:00}.{dt.Month:00}.{dt.Year} {dt.Hour:00}:{dt.Minute:00}";
    }

    public static string DateSeconds(long? unixSec)
    {
        if (unixSec is null or <= 0) return "—";
        return DateFull(unixSec.Value * 1000);
    }

    public static string Remaining(long ms)
    {
        if (ms <= 0) return "истекла";
        var span = TimeSpan.FromMilliseconds(ms);
        var days = (int)span.TotalDays;
        if (days >= 1) return $"{days} {Plural(days, "день", "дня", "дней")} {span.Hours:00}:{span.Minutes:00}";
        return $"{span.Hours:00}:{span.Minutes:00}:{span.Seconds:00}";
    }

    public static string Plural(int n, string one, string few, string many)
    {
        var m10 = n % 10;
        var m100 = n % 100;
        if (m10 == 1 && m100 != 11) return one;
        if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
        return many;
    }

    public static string Short(string? value, int take = 8) =>
        string.IsNullOrEmpty(value) ? "—" : value.Length <= take ? value : value[..take];

    public static string Bytes(long size)
    {
        if (size <= 0) return "0 Б";
        string[] units = { "Б", "КБ", "МБ", "ГБ" };
        double v = size;
        var i = 0;
        while (v >= 1024 && i < units.Length - 1) { v /= 1024; i++; }
        return $"{v:0.##} {units[i]}";
    }
}
