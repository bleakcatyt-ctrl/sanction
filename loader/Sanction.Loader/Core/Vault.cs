using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Sanction.Loader.Core;

internal sealed record SavedCredentials(string Login, string Password);

/// <summary>
/// "Remember me" storage.
///
/// The blob is AES-256-GCM under a key derived from this machine's fingerprint,
/// so copying vault.bin to another PC yields nothing. This is obfuscation for a
/// convenience feature, not a secret store — the authoritative password lives on
/// the server and can be rotated from the dashboard at any time.
/// </summary>
internal static class Vault
{
    private const int IvSize = 12;
    private const int TagSize = 16;

    private static byte[] Key()
    {
        var secret = Encoding.UTF8.GetBytes("sanction-vault|" + Machine.Hwid);
        return HKDF.DeriveKey(HashAlgorithmName.SHA256, SHA256.HashData(secret), 32,
            Encoding.UTF8.GetBytes("sanction-vault-v1"), Encoding.UTF8.GetBytes("vault"));
    }

    public static SavedCredentials? Load()
    {
        try
        {
            var path = AppConfig.VaultPath;
            if (!File.Exists(path)) return null;

            var raw = File.ReadAllBytes(path);
            if (raw.Length < IvSize + TagSize + 2) return null;

            var iv = raw.AsSpan(0, IvSize).ToArray();
            var tag = raw.AsSpan(IvSize, TagSize).ToArray();
            var ct = raw.AsSpan(IvSize + TagSize).ToArray();
            var plain = new byte[ct.Length];

            using var gcm = new AesGcm(Key(), TagSize);
            gcm.Decrypt(iv, ct, tag, plain);

            using var doc = JsonDocument.Parse(plain);
            var login = doc.RootElement.Str("login");
            var password = doc.RootElement.Str("password");
            if (string.IsNullOrEmpty(login) || password is null) return null;
            return new SavedCredentials(login, password);
        }
        catch
        {
            // corrupt or foreign blob — behave as if nothing was saved
            return null;
        }
    }

    public static void Save(string login, string password)
    {
        try
        {
            Directory.CreateDirectory(AppConfig.DataDirectory);
            var plain = Encoding.UTF8.GetBytes(Json.Write(new { login, password }));
            var iv = RandomNumberGenerator.GetBytes(IvSize);
            var ct = new byte[plain.Length];
            var tag = new byte[TagSize];

            using var gcm = new AesGcm(Key(), TagSize);
            gcm.Encrypt(iv, plain, ct, tag);

            var packed = new byte[IvSize + TagSize + ct.Length];
            Buffer.BlockCopy(iv, 0, packed, 0, IvSize);
            Buffer.BlockCopy(tag, 0, packed, IvSize, TagSize);
            Buffer.BlockCopy(ct, 0, packed, IvSize + TagSize, ct.Length);

            File.WriteAllBytes(AppConfig.VaultPath, packed);
        }
        catch
        {
            // convenience only — never fail the login because of it
        }
    }

    public static void Clear()
    {
        try { File.Delete(AppConfig.VaultPath); } catch { /* ignore */ }
    }
}
