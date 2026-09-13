using System.Net.NetworkInformation;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

namespace Sanction.Loader.Core;

/// <summary>
/// Hardware fingerprint (HWID).
///
/// The server normalizes any 64-hex string as-is, so the loader sends
/// sha256(machine guid | system volume serial | primary MAC) and stores nothing
/// identifying on disk. Deliberately excluded: machine name, OS build, CPU count
/// — they change on a normal upgrade and would burn a user's HWID resets.
/// </summary>
internal static class Machine
{
    private const string FallbackFile = "install.id";

    private static string? _hwid;
    private static string? _label;
    private static string? _description;

    public static string Hwid => _hwid ??= Compute();

    public static string Label => _label ??= ComputeLabel();

    /// <summary>Human readable device info for the UI.</summary>
    public static string Description => _description ??= ComputeDescription();

    /// <summary>Short form shown in the dashboard.</summary>
    public static string ShortId => Hwid[..16].ToUpperInvariant();

    /* ------------------------------------------------------------- components -- */

    internal static string? MachineGuid()
    {
        try
        {
            var size = 0u;
            RegGetValue(Hklm, @"SOFTWARE\Microsoft\Cryptography", "MachineGuid",
                RrfRtRegSz | RrfSubkeyWow6464Key, IntPtr.Zero, null, ref size);
            if (size == 0 || size > 512) return null;

            var buffer = new StringBuilder((int)size);
            var rc = RegGetValue(Hklm, @"SOFTWARE\Microsoft\Cryptography", "MachineGuid",
                RrfRtRegSz | RrfSubkeyWow6464Key, IntPtr.Zero, buffer, ref size);
            if (rc != 0) return null;

            var value = buffer.ToString().Trim().TrimEnd('\0');
            return string.IsNullOrEmpty(value) ? null : value;
        }
        catch
        {
            return null;
        }
    }

    internal static string? VolumeSerial()
    {
        try
        {
            var root = Path.GetPathRoot(Environment.GetFolderPath(Environment.SpecialFolder.Windows)) ?? "C:\\";
            var ok = GetVolumeInformationW(root, null, 0, out var serial, out _, out _, null, 0);
            return ok ? serial.ToString("X8") : null;
        }
        catch
        {
            return null;
        }
    }

    internal static string? PrimaryMac()
    {
        try
        {
            var candidates = NetworkInterface.GetAllNetworkInterfaces()
                .Where(n => n.OperationalStatus == OperationalStatus.Up)
                .Where(n => n.NetworkInterfaceType != NetworkInterfaceType.Loopback)
                .Where(n => n.NetworkInterfaceType != NetworkInterfaceType.Tunnel)
                .Select(n => n.GetPhysicalAddress()?.ToString())
                .Where(m => !string.IsNullOrEmpty(m) && m != "0000000000000000")
                .OrderBy(m => m, StringComparer.Ordinal)
                .ToList();

            return candidates.Count > 0 ? candidates[0] : null;
        }
        catch
        {
            return null;
        }
    }

    /// <summary>
    /// Last resort when neither the registry nor a NIC is readable (rare, mostly
    /// locked-down VMs): a persistent random id stored next to the vault.
    /// </summary>
    private static string InstallationId()
    {
        try
        {
            Directory.CreateDirectory(AppConfig.DataDirectory);
            var path = Path.Combine(AppConfig.DataDirectory, FallbackFile);
            if (File.Exists(path))
            {
                var existing = File.ReadAllText(path).Trim();
                if (existing.Length >= 32) return existing;
            }
            var created = Hex.Encode(RandomNumberGenerator.GetBytes(32));
            File.WriteAllText(path, created);
            return created;
        }
        catch
        {
            return "unknown-machine";
        }
    }

    private static string Compute()
    {
        var guid = MachineGuid();
        var serial = VolumeSerial();
        var mac = PrimaryMac();

        var material = (guid, serial, mac) switch
        {
            (null, null, null) => "fallback|" + InstallationId(),
            _ => string.Join("|", guid ?? "-", serial ?? "-", mac ?? InstallationId())
        };

        return Hashing.Sha256Hex(Encoding.UTF8.GetBytes(material));
    }

    private static string ComputeLabel()
    {
        var os = OperatingSystem.IsWindowsVersionAtLeast(10, 0, 22000) ? "Windows 11"
               : OperatingSystem.IsWindowsVersionAtLeast(10) ? "Windows 10"
               : "Windows";
        var label = $"{Environment.MachineName} · {os} · {Environment.ProcessorCount} CPU";
        return label.Length > 120 ? label[..120] : label;
    }

    private static string ComputeDescription()
    {
        var parts = new List<string>
        {
            Environment.MachineName,
            OperatingSystem.IsWindowsVersionAtLeast(10, 0, 22000) ? "Windows 11" : "Windows 10",
            RuntimeInformation.OSArchitecture.ToString().ToLowerInvariant(),
            Environment.ProcessorCount + " " + Fmt.Plural(Environment.ProcessorCount, "ядро", "ядра", "ядер")
        };
        if (MachineGuid() is { } g) parts.Add("GUID " + Fmt.Short(g, 8));
        if (VolumeSerial() is { } s) parts.Add("VOL " + s);
        return string.Join(" · ", parts);
    }

    /* ---------------------------------------------------------------- P/Invoke -- */

    private static readonly IntPtr Hklm = new(unchecked((int)0x80000002));
    private const uint RrfRtRegSz = 0x00000002;
    private const uint RrfSubkeyWow6464Key = 0x00000010;

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "RegGetValueW")]
    private static extern int RegGetValue(
        IntPtr hKey,
        string? lpSubKey,
        string lpValue,
        uint dwFlags,
        IntPtr pdwType,
        StringBuilder? pvData,
        ref uint pcbData);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "GetVolumeInformationW")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetVolumeInformationW(
        string lpRootPathName,
        StringBuilder? lpVolumeNameBuffer,
        uint nVolumeNameSize,
        out uint lpVolumeSerialNumber,
        out uint lpMaximumComponentLength,
        out uint lpFileSystemFlags,
        StringBuilder? lpFileSystemNameBuffer,
        uint nFileSystemNameSize);
}
