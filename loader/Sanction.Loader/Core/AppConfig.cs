using System.Reflection;
using System.Text.Json;

namespace Sanction.Loader.Core;

/// <summary>
/// Runtime configuration of the loader.
///
/// Resolution order for the API base:
///   1. sanction.json next to the executable   (operator override, no rebuild)
///   2. SANCTION_API environment variable      (support / local testing)
///   3. BuildConfig.ApiBase                    (embedded at build time)
/// </summary>
internal static class AppConfig
{
    public static string ExecutableDirectory { get; } =
        Path.GetDirectoryName(Environment.ProcessPath ?? Assembly.GetEntryAssembly()?.Location) ??
        AppContext.BaseDirectory;

    public static string DataDirectory { get; } =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Sanction");

    public static string LogDirectory => DataDirectory;

    public static string VaultPath => Path.Combine(DataDirectory, "vault.bin");

    public static string Version { get; } = ResolveVersion();

    public static string Channel => BuildConfig.Channel;

    public static string ApiBase { get; } = ResolveApiBase();

    public static bool InsecureTransport => ApiBase.StartsWith("http://", StringComparison.OrdinalIgnoreCase);

    private static string ResolveVersion()
    {
        var v = Assembly.GetExecutingAssembly().GetName().Version;
        return v is null ? "1.0.0" : $"{v.Major}.{v.Minor}.{v.Build}";
    }

    private static string ResolveApiBase()
    {
        try
        {
            var file = Path.Combine(ExecutableDirectory, "sanction.json");
            if (File.Exists(file))
            {
                using var doc = JsonDocument.Parse(File.ReadAllText(file));
                if (doc.RootElement.TryGetProperty("api", out var api))
                {
                    var value = Trim(api.GetString());
                    if (value is not null) return value;
                }
            }
        }
        catch
        {
            // a broken override file must not brick the loader
        }

        var env = Trim(Environment.GetEnvironmentVariable("SANCTION_API"));
        if (env is not null) return env;

        return Trim(BuildConfig.ApiBase) ?? "http://127.0.0.1:3000";
    }

    private static string? Trim(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var v = value.Trim();
        if (!v.StartsWith("http://", StringComparison.OrdinalIgnoreCase) &&
            !v.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) return null;
        return v.TrimEnd('/');
    }

    public static string Url(string path) => ApiBase + (path.StartsWith('/') ? path : "/" + path);
}
