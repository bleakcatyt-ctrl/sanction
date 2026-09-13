using System.Security.Cryptography;

namespace Sanction.Loader.Core;

internal enum GateState
{
    /// <summary>Not evaluated yet.</summary>
    Wait,
    /// <summary>Verified.</summary>
    Ok,
    /// <summary>Verified with a caveat the user should see.</summary>
    Warn,
    /// <summary>Failed — injection stays locked.</summary>
    Fail
}

internal sealed record Gate(string Id, string Label, GateState State, string Detail)
{
    public bool Blocking => State is GateState.Wait or GateState.Fail;
}

/// <summary>Everything the loader knows at the moment of evaluation.</summary>
internal sealed class VerificationInput
{
    public bool ServerOnline { get; init; }
    public IdentityState IdentityState { get; init; } = IdentityState.Missing;
    public string? IdentityFingerprint { get; init; }
    public bool SessionActive { get; init; }
    public LoaderPayload? Payload { get; init; }
    public LicenseClaims? Claims { get; init; }
    public bool TokenSignatureValid { get; init; }
    public string Hwid { get; init; } = string.Empty;
    public BuildPolicy? Policy { get; init; }
    public string Build { get; init; } = "0.0.0";
    public GameProcess? Game { get; init; }
    public bool PayloadConfigured { get; init; }
    public long NowSeconds { get; init; }
}

/// <summary>
/// The single place that decides whether the Inject button may light up.
/// Every gate must be Ok (or Warn, which is informational); one Fail locks it.
/// </summary>
internal static class Verification
{
    public static List<Gate> Evaluate(VerificationInput input)
    {
        var gates = new List<Gate>
        {
            Server(input),
            Identity(input),
            Channel(input),
            Token(input),
            Subscription(input),
            Device(input),
            Build(input),
            Game(input),
            Module(input)
        };
        return gates;
    }

    public static bool InjectReady(IEnumerable<Gate> gates) => gates.All(g => !g.Blocking);

    public static string? FirstProblem(IEnumerable<Gate> gates) =>
        gates.FirstOrDefault(g => g.Blocking)?.Detail;

    /* ------------------------------------------------------------------- gates -- */

    private static Gate Server(VerificationInput i) => i.ServerOnline
        ? new Gate("server", "Соединение", GateState.Ok, "Сервер отвечает")
        : new Gate("server", "Соединение", GateState.Fail, "Нет связи с сервером");

    private static Gate Identity(VerificationInput i) => i.IdentityState switch
    {
        IdentityState.Embedded => new Gate("identity", "Ключ сервера", GateState.Ok,
            "Вшит в сборку · " + Fmt.Short(i.IdentityFingerprint, 12)),
        IdentityState.Fetched => new Gate("identity", "Ключ сервера", GateState.Warn,
            "Получен с сервера · " + Fmt.Short(i.IdentityFingerprint, 12)),
        _ => new Gate("identity", "Ключ сервера", GateState.Fail, "Ключ не получен")
    };

    private static Gate Channel(VerificationInput i) => i.SessionActive
        ? new Gate("channel", "Канал", GateState.Ok, "AES-256-GCM · сессия активна")
        : new Gate("channel", "Канал", GateState.Fail, "Шифрованная сессия не установлена");

    private static Gate Token(VerificationInput i)
    {
        var c = i.Claims;
        if (!i.TokenSignatureValid || c is null)
            return new Gate("token", "Токен лицензии", GateState.Fail, "Подпись сервера не подтверждена");
        if (c.Typ != "license" || c.Iss != "sanction")
            return new Gate("token", "Токен лицензии", GateState.Fail, "Некорректный тип токена");
        if (c.Ver != Protocol.Version)
            return new Gate("token", "Токен лицензии", GateState.Fail, $"Протокол {c.Ver} не поддерживается");
        if (c.NotYetValid(i.NowSeconds))
            return new Gate("token", "Токен лицензии", GateState.Fail, "Проверьте системное время");
        if (c.Expired(i.NowSeconds))
            return new Gate("token", "Токен лицензии", GateState.Fail, "Токен истёк — обновите статус");

        return new Gate("token", "Токен лицензии", GateState.Ok,
            $"Подпись верна · {Fmt.Short(c.Jti, 10)} · до {Fmt.DateSeconds(c.Exp)}");
    }

    private static Gate Subscription(VerificationInput i)
    {
        var lic = i.Payload?.License;
        var state = i.Payload?.State ?? lic?.Status;
        if (lic is null || state is null)
            return new Gate("plan", "Подписка", GateState.Fail, "Нет данных о подписке");
        if (state != "active")
            return new Gate("plan", "Подписка", GateState.Fail, StatusText(state));
        if (lic.RemainingMs <= 0)
            return new Gate("plan", "Подписка", GateState.Fail, "Подписка истекла");

        return new Gate("plan", "Подписка", GateState.Ok,
            $"{lic.Plan} · {Fmt.Remaining(lic.RemainingMs)}");
    }

    private static Gate Device(VerificationInput i)
    {
        var lic = i.Payload?.License;
        if (string.IsNullOrEmpty(i.Hwid))
            return new Gate("hwid", "Устройство", GateState.Fail, "HWID не сформирован");
        if (lic is { HwidBound: false })
            return new Gate("hwid", "Устройство", GateState.Fail, "Ключ не привязан к устройству");

        // The server sends sha256(hwid)[0..32]; the raw fingerprint never leaves the PC.
        var local = Hashing.Sha256Hex(i.Hwid)[..32];
        if (!string.IsNullOrEmpty(i.Claims?.Hwid) && !FixedTimeEquals(local, i.Claims!.Hwid!))
            return new Gate("hwid", "Устройство", GateState.Fail, "Токен выдан другому устройству");

        return new Gate("hwid", "Устройство", GateState.Ok,
            Machine.ShortId + " · " + (lic?.HwidResetsLeft ?? 0) + " " +
            Fmt.Plural(lic?.HwidResetsLeft ?? 0, "сброс", "сброса", "сбросов"));
    }

    private static Gate Build(VerificationInput i)
    {
        var min = i.Policy?.Min;
        var latest = i.Policy?.Latest;
        if (!string.IsNullOrEmpty(min) && CompareVersions(i.Build, min) < 0)
            return new Gate("build", "Сборка", GateState.Fail, $"Требуется {min} или новее");
        if (!string.IsNullOrEmpty(latest) && CompareVersions(i.Build, latest) < 0)
            return new Gate("build", "Сборка", GateState.Warn, $"Доступна {latest} · установлена {i.Build}");

        return new Gate("build", "Сборка", GateState.Ok, i.Build);
    }

    private static Gate Game(VerificationInput i) => i.Game is null
        ? new Gate("game", "Игра", GateState.Fail, "Counter-Strike 2 не запущена")
        : new Gate("game", "Игра", GateState.Ok, $"{i.Game.Name}.exe · PID {i.Game.Pid}");

    private static Gate Module(VerificationInput i) => i.PayloadConfigured
        ? new Gate("module", "Модуль", GateState.Ok, "Готов к запуску")
        : new Gate("module", "Модуль", GateState.Warn, "Не подключён к этой сборке");

    /* ------------------------------------------------------------------ helpers -- */

    public static string StatusText(string? state) => state switch
    {
        "active" => "Активна",
        "pending" => "Не активирована",
        "expired" => "Истекла",
        "revoked" => "Отозвана",
        "banned" => "Заблокирована",
        _ => state ?? "—"
    };

    public static int CompareVersions(string a, string b)
    {
        var pa = Split(a);
        var pb = Split(b);
        for (var i = 0; i < Math.Max(pa.Length, pb.Length); i++)
        {
            var x = i < pa.Length ? pa[i] : 0;
            var y = i < pb.Length ? pb[i] : 0;
            if (x != y) return x < y ? -1 : 1;
        }
        return 0;
    }

    private static int[] Split(string v) =>
        (v ?? string.Empty).Split('.').Select(p => int.TryParse(p, out var n) ? n : 0).ToArray();

    private static bool FixedTimeEquals(string a, string b)
    {
        if (a.Length != b.Length) return false;
        return CryptographicOperations.FixedTimeEquals(
            System.Text.Encoding.ASCII.GetBytes(a),
            System.Text.Encoding.ASCII.GetBytes(b));
    }
}
