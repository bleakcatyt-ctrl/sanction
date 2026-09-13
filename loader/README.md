# Sanction Loader

Desktop client for the Sanction platform: .NET 8, WinForms, **zero NuGet packages**.
Everything cryptographic comes from `System.Security.Cryptography`, so the published
binary is small, reproducible and easy to audit.

```
loader/
├── build.sh / build.cmd          publish scripts (win-x64, single file)
├── dist/Sanction.Loader.exe      build output — served by the site at /dl/loader
└── Sanction.Loader/
    ├── Sanction.Loader.csproj    net8.0-windows, WinForms, PublishSingleFile
    ├── app.manifest              asInvoker, PerMonitorV2 DPI, UTF-8 code page
    ├── Program.cs                entry point, single-instance mutex, crash log
    ├── Core/
    │   ├── BuildConfig.g.cs      generated: API base + embedded server public key
    │   ├── AppConfig.cs          config resolution (sanction.json → env → embedded)
    │   ├── Protocol.cs           ECDH P-256, HKDF-SHA256, AES-256-GCM, ECDSA verify
    │   ├── ApiClient.cs          bootstrap / handshake / rpc / download transport
    │   ├── Models.cs             wire types + signed license claims
    │   ├── Verification.cs       the nine gates that unlock Inject
    │   ├── Machine.cs            HWID (registry GUID + volume serial + MAC)
    │   ├── Vault.cs              "remember me" (AES-GCM, machine-bound)
    │   ├── Game.cs               read-only lookup of the running game process
    │   └── Payload.cs            the payload stage — your extension point
    └── Ui/
        ├── Theme.cs, Glyphs.cs   palette, typography, hand-drawn icon set
        ├── Controls.cs           buttons, fields, gate rows, chips, log
        ├── AuthView.cs           login screen
        ├── DashboardView.cs      subscription + verification chain + Inject
        └── MainForm.cs           window chrome and orchestration
```

---

## Build

Requirements: [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0). Building the
Windows `.exe` from Linux or macOS works (`EnableWindowsTargeting` is already set).

```bash
# 1. embed the production API URL and the server identity public key
npm run loader:config -- https://api.example.com

# 2. publish
cd loader && ./build.sh              # Windows: build.cmd
```

Three flavours:

| Command | Result | Use when |
|---|---|---|
| `./build.sh` | self-contained single `.exe` (~70–90 MB) | you ship to end users — no runtime install; downloads runtime packs from nuget.org |
| `./build.sh --small` | framework-dependent single `.exe` (~2 MB) | users already have the .NET 8 Desktop Runtime |
| `./build.sh --portable` | framework-dependent, no RID (~2 MB) | nuget.org is blocked or slow — this mode downloads nothing |

On Windows use `build.cmd`, `build.cmd small`, `build.cmd portable`. It verifies the
SDK is 8+, tees the publish output to `loader/build.log`, and on failure prints the
likely cause. When asking for help, attach `loader/build.log`.

No .NET SDK on the machine at all? `docs/ci/loader-build.yml` is a ready GitHub
Actions recipe: copy it to `.github/workflows/loader.yml`, push, and the run uploads
both variants as artifacts you can download from the Actions page.

The artifact lands in `loader/dist/Sanction.Loader.exe`, which is exactly
`config.build.artifactPath` on the server — the site starts serving it at `/dl/loader`
and in the dashboard immediately. Pin the checksum in the environment so the admin
panel can verify what it hands out:

```bash
LOADER_SHA256=$(sha256sum loader/dist/Sanction.Loader.exe | cut -d' ' -f1) npm start
```

Versioning: `Version` in `Sanction.Loader.csproj` must match `LOADER_VERSION` on the
server. `LOADER_MIN_VERSION` rejects older builds at bootstrap — that is how a leaked
binary is retired without touching the database.

---

## What the loader verifies

`Core/Verification.cs` is the only place that decides whether Inject lights up. Every
gate is re-evaluated at click time, never taken from cached UI state:

| Gate | Condition |
|---|---|
| Соединение | server answered the bootstrap call |
| Ключ сервера | identity key is embedded in the build (`Warn` if fetched at runtime) |
| Канал | ECDH handshake done, AES-256-GCM session live |
| Токен лицензии | ECDSA signature over the token verifies with the embedded key, `typ`/`iss`/`ver` correct, not expired, not from the future |
| Подписка | `state == active` and remaining time > 0 |
| Устройство | `sha256(HWID)[0..32]` equals the claim in the signed token |
| Сборка | local version ≥ server `min` (`Warn` when an update exists) |
| Игра | the game process is running |
| Модуль | a payload is wired into the build |

One `Fail` locks Inject. The identity check is the important one: because the public key
is compiled in and the bootstrap response carries its fingerprint, a proxy, a patched
hosts file or a fake local server cannot mint a token the loader will accept.

HWID is `sha256(machineGuid | systemVolumeSerial | primaryMac)` — 64 lowercase hex
characters, which the server accepts as-is. Machine name, OS build and CPU count are
deliberately excluded: they change during a normal upgrade and would burn a user's
resets. The raw fingerprint never leaves the PC; the token carries only a 32-char prefix
of its hash.

---

## Wire protocol (v1)

Counterpart of `server/lib/protocol.js`:

```
POST /api/loader/v1/bootstrap    { build }            → sid, challenge, server_pub (04||X||Y hex)
GET  /api/loader/v1/pubkey                            → SPKI PEM of the identity key
POST /api/loader/v1/handshake    { sid, client_pub, v, n:1, ts, p }
POST /api/loader/v1/rpc          { v, sid, n, ts, p } → heartbeat | license | download | hwid_status | logout
GET  /dl/loader?t=<signed ticket>                     → artifact, one-time, SHA-256 checked client-side
```

* ECDH on NIST P-256 with the server's ephemeral key.
* `key = HKDF-SHA256(shared, salt = challenge, info = "sanction-loader-v1", 32)`.
* `p = base64url(iv[12] | tag[16] | ciphertext)`, AES-256-GCM,
  AAD = `"1|sid|n"` — the counter is authenticated, so replays are rejected.
* The server requires a strictly increasing `n`; the client keeps it per session.
* License tokens: `base64url(canonical json) + "." + base64url(ECDSA-P1363 signature)`,
  signed over the ASCII bytes of the base64url body, verified offline by the loader.

After a successful handshake the client knows nothing that survives the session: the key
is derived per connection, zeroed on logout, and the server revokes it on expiry,
revocation, ban, HWID reset, credential rotation or kill-switch — the next heartbeat is
where the loader finds out.

---

## The payload stage

`Core/Payload.cs` is intentionally a plug-in point, not an implementation. This project
ships the licensing and delivery layer — encrypted channel, offline signature
verification, HWID binding, expiry/revocation/kill-switch gates, signed one-time download
tickets with SHA-256 verification — and leaves the module that runs inside the game to
your own build pipeline:

```csharp
internal static class Payload
{
    public const bool Configured = false;          // flips the "Модуль" gate

    public static Task<PayloadResult> RunAsync(LicenseClaims claims, GameProcess game,
                                               CancellationToken ct = default)
        => Task.FromResult(PayloadResult.NotConfiguredResult);
}
```

Wire your module here and set `Configured = true`; the Inject button unlocks as soon as
the other eight gates are green. `claims.Features` carries the per-plan feature flags
resolved server-side (`private_channel`, `early_builds`, …), so entitlement decisions
belong in your payload code and never in the client's hands.

---

## Local testing

```bash
# terminal 1 — platform
npm run reset && npm start

# terminal 2 — embed the local key so the loader can verify tokens
npm run loader:config -- http://127.0.0.1:3000
cd loader && ./build.sh --small
```

Credentials for the seeded accounts are written to `data/seed-credentials.txt`
(`tiran` / `drake` for the admin panel, `demo` for a buyer with an active key).
Buy a plan as `demo`, open the dashboard, copy the loader login and password into the
loader. The UI marks an `http://` API as an unprotected channel and a runtime-fetched
identity key with a `Warn` gate — both are expected in development and both must be
green before you ship.

Overrides without a rebuild: `sanction.json` next to the exe (`{ "api": "https://…" }`)
or the `SANCTION_API` environment variable.

Troubleshooting lives in `%LOCALAPPDATA%\Sanction\crash.log`.
