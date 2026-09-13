namespace Sanction.Loader.Core;

internal enum PayloadStatus
{
    /// <summary>No module is wired into this build.</summary>
    NotConfigured,
    Success,
    Failed
}

internal sealed record PayloadResult(PayloadStatus Status, string Message)
{
    public static PayloadResult NotConfiguredResult { get; } =
        new(PayloadStatus.NotConfigured, "Модуль не подключён к этой сборке.");
}

/// <summary>
/// The payload stage — the single extension point of the loader.
///
/// What this project ships and guarantees:
///   • an encrypted, replay-protected channel to the Sanction API (ECDH P-256 +
///     HKDF-SHA256 + AES-256-GCM),
///   • offline verification of the server signature on every license token,
///   • HWID binding, subscription expiry, revocation, kill-switch and build gates,
///   • a signed one-time ticket for downloading your own artifact, with SHA-256
///     verification before the file is written to disk.
///
/// What it deliberately does NOT contain is the module that runs inside the game
/// and any code that hides it. Delivery of that module is your own build
/// pipeline: implement <see cref="RunAsync"/> (or replace this type) with the
/// logic for your product, and set <see cref="Configured"/> to true so the
/// Inject gate unlocks. Keeping it out of the shared source means the licensing
/// layer stays auditable and the loader never carries code it cannot account for.
///
/// Everything the gate chain decided is passed in already verified — do not
/// re-check licenses here, and do not weaken <see cref="Verification"/> to make
/// this stage reachable.
/// </summary>
internal static class Payload
{
    /// <summary>Flips the "Модуль" gate. Stock build: false.</summary>
    public const bool Configured = false;

    /// <summary>
    /// Called only after every gate in <see cref="Verification"/> is green.
    /// </summary>
    /// <param name="claims">The signed license claims (plan, features, expiry).</param>
    /// <param name="game">The running game process.</param>
    public static Task<PayloadResult> RunAsync(LicenseClaims claims, GameProcess game, CancellationToken ct = default)
    {
        _ = claims;
        _ = game;
        _ = ct;
        return Task.FromResult(PayloadResult.NotConfiguredResult);
    }
}
