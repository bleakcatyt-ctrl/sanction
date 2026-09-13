using System.Diagnostics;

namespace Sanction.Loader.Core;

internal sealed record GameProcess(int Pid, string Name, string? Path, IntPtr WindowHandle);

/// <summary>
/// Locates the running Counter-Strike 2 process. Read-only process enumeration —
/// the loader never writes to another process' memory here, it only reports state.
/// </summary>
internal static class Game
{
    /// <summary>cs2.exe is the retail process; csgo.exe is kept for legacy builds.</summary>
    private static readonly string[] ProcessNames = { "cs2", "csgo" };

    public static GameProcess? Find()
    {
        foreach (var name in ProcessNames)
        {
            Process[] found;
            try { found = Process.GetProcessesByName(name); }
            catch { return null; }

            GameProcess? match = null;
            foreach (var p in found)
            {
                try
                {
                    if (match is null && !p.HasExited)
                    {
                        string? path = null;
                        try { path = p.MainModule?.FileName; }
                        catch { /* 32/64-bit mismatch or access denied — not fatal */ }

                        match = new GameProcess(p.Id, p.ProcessName, path, p.MainWindowHandle);
                    }
                }
                catch
                {
                    // ignore and keep looking
                }
                finally
                {
                    p.Dispose();
                }
            }

            if (match is not null) return match;
        }
        return null;
    }

    public static bool IsRunning => Find() is not null;
}
