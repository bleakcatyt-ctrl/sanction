using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Sanction.Loader.Core;

/// <summary>
/// Wire protocol v1 — the exact counterpart of server/lib/protocol.js.
///
///   ECDH  prime256v1 (NIST P-256)  -> per-session shared secret
///   HKDF  SHA-256                  -> AES key derivation (info: sanction-loader-v1)
///   AES   256-GCM                  -> envelope encryption, AAD = "1|sid|n"
///   ECDSA P-256 (IEEE P1363)       -> server identity, license tokens, tickets
///
/// Envelope payload layout: base64url( iv[12] | tag[16] | ciphertext ).
///
/// Only algorithms that exist natively in .NET 8 are used, so the loader ships
/// without a single third-party package.
/// </summary>
internal static class Protocol
{
    public const int Version = 1;
    public const string Info = "sanction-loader-v1";
    public const int KeySize = 32;
    public const int IvSize = 12;
    public const int TagSize = 16;

    /// <summary>DER prefix of a SubjectPublicKeyInfo for an uncompressed P-256 point.</summary>
    private static readonly byte[] SpkiPrefix =
    {
        0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2A, 0x86, 0x48, 0xCE, 0x3D, 0x02, 0x01,
        0x06, 0x08, 0x2A, 0x86, 0x48, 0xCE, 0x3D, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00
    };

    /* ------------------------------------------------------------ key agreement -- */

    public sealed class Agreement
    {
        public required string ClientPublicKeyHex { get; init; }
        public required byte[] Key { get; init; }
    }

    /// <summary>
    /// Generates an ephemeral P-256 key pair, derives the shared secret with the
    /// server's ephemeral public point and expands it into the session key.
    /// </summary>
    public static Agreement Agree(string serverPublicKeyHex, string challenge)
    {
        var point = Hex.Decode(serverPublicKeyHex);
        if (point.Length != 65 || point[0] != 0x04)
            throw new CryptographicException("server ephemeral key is not an uncompressed P-256 point");

        using var ours = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);

        using var theirs = ECDiffieHellman.Create();
        theirs.ImportSubjectPublicKeyInfo(BuildSpki(point), out _);

        var shared = ours.DeriveKeyMaterial(theirs.PublicKey);   // raw X coordinate, 32 bytes

        var key = HKDF.DeriveKey(
            HashAlgorithmName.SHA256,
            shared,
            KeySize,
            Encoding.UTF8.GetBytes(challenge),
            Encoding.UTF8.GetBytes(Info));

        var pub = ours.ExportParameters(false).Q;
        var clientPoint = new byte[65];
        clientPoint[0] = 0x04;
        Buffer.BlockCopy(pub.X!, 0, clientPoint, 1, pub.X!.Length);
        Buffer.BlockCopy(pub.Y!, 0, clientPoint, 1 + pub.X.Length, pub.Y!.Length);

        CryptographicOperations.ZeroMemory(shared);

        return new Agreement { ClientPublicKeyHex = Hex.Encode(clientPoint), Key = key };
    }

    private static byte[] BuildSpki(byte[] point)
    {
        var der = new byte[SpkiPrefix.Length + point.Length];
        Buffer.BlockCopy(SpkiPrefix, 0, der, 0, SpkiPrefix.Length);
        Buffer.BlockCopy(point, 0, der, SpkiPrefix.Length, point.Length);
        return der;
    }

    /* ------------------------------------------------------------------ envelope -- */

    public static string Seal(byte[] key, string sid, long counter, string plaintextJson)
    {
        var plain = Encoding.UTF8.GetBytes(plaintextJson);
        var iv = RandomNumberGenerator.GetBytes(IvSize);
        var aad = Encoding.UTF8.GetBytes($"{Version}|{sid}|{counter}");
        var ct = new byte[plain.Length];
        var tag = new byte[TagSize];

        using var gcm = new AesGcm(key, TagSize);
        gcm.Encrypt(iv, plain, ct, tag, aad);

        var packed = new byte[IvSize + TagSize + ct.Length];
        Buffer.BlockCopy(iv, 0, packed, 0, IvSize);
        Buffer.BlockCopy(tag, 0, packed, IvSize, TagSize);
        Buffer.BlockCopy(ct, 0, packed, IvSize + TagSize, ct.Length);

        CryptographicOperations.ZeroMemory(plain);
        return B64Url.Encode(packed);
    }

    public static string Open(byte[] key, string sid, long counter, string packed)
    {
        var raw = B64Url.Decode(packed);
        if (raw.Length < IvSize + TagSize)
            throw new CryptographicException("envelope is too short");

        var iv = raw.AsSpan(0, IvSize).ToArray();
        var tag = raw.AsSpan(IvSize, TagSize).ToArray();
        var ct = raw.AsSpan(IvSize + TagSize).ToArray();
        var aad = Encoding.UTF8.GetBytes($"{Version}|{sid}|{counter}");
        var plain = new byte[ct.Length];

        using var gcm = new AesGcm(key, TagSize);
        gcm.Decrypt(iv, ct, tag, plain, aad);

        return Encoding.UTF8.GetString(plain);
    }

    /* -------------------------------------------------------------------- identity -- */

    public static ECDsa LoadPublicKey(string pem)
    {
        var key = ECDsa.Create();
        try
        {
            key.ImportFromPem(pem.AsSpan());
            return key;
        }
        catch
        {
            key.Dispose();
            throw;
        }
    }

    /// <summary>sha256(SPKI DER)[0..16] — the "kid" the server advertises.</summary>
    public static string Fingerprint(ECDsa key) =>
        Hashing.Sha256Hex(key.ExportSubjectPublicKeyInfo())[..16];

    /// <summary>
    /// Verifies a compact signed payload: base64url(canonical json) + "." + base64url(signature).
    /// The signature covers the ASCII bytes of the base64url body, exactly like the server signs it.
    /// Returns the claims or null when anything is off.
    /// </summary>
    public static JsonElement? VerifySigned(ECDsa key, string? signed)
    {
        if (string.IsNullOrWhiteSpace(signed)) return null;
        var parts = signed.Split('.');
        if (parts.Length != 2) return null;

        byte[] signature;
        try { signature = B64Url.Decode(parts[1]); }
        catch (FormatException) { return null; }

        var bodyBytes = Encoding.UTF8.GetBytes(parts[0]);
        bool ok;
        try
        {
            ok = key.VerifyData(bodyBytes, signature, HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
        }
        catch (CryptographicException)
        {
            return null;
        }
        if (!ok) return null;

        try
        {
            using var doc = JsonDocument.Parse(B64Url.Decode(parts[0]));
            return doc.RootElement.Clone();
        }
        catch (JsonException)
        {
            return null;
        }
    }

    public static long NowSeconds => DateTimeOffset.UtcNow.ToUnixTimeSeconds();
}
