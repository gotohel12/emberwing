# ARVEX v10.0 — operations guide

How the launcher, update system, backend, admin panel and release pipeline fit together, and where to change things.

## 1. One version, one build id

| What | Where it comes from |
|---|---|
| Version (`10.0.0`, shown as `v10.0`) | `package.json` → `version`. Nothing else hard-codes it. |
| Build id (`10.0.0-<hash>`) | `tools/build.mjs`: a hash of `src/` and `public/`. Same sources → same id. Written to `public/build.json`. |
| Game client | `__ARVEX_VERSION__` / `__ARVEX_BUILD__` injected at build time (`src/main.js`). |
| Backend | reads `public/build.json` at start (`server/server.mjs`). `/health`, `/api/servers`, `/api/config` report it. |
| Launcher | `-X main.launcherVersion` set by `tools/release.sh`. Installed version/build is in `<install>/.arvex/installed.json`. |
| Manifest | `/launcher/manifest.json?channel=stable` → `version`, `buildId`, `releaseDate`, `minVersion`, `mandatory`. |
| Minimum supported version | highest of: `PROTOCOL_MIN` in `server/server.mjs`, the live release's own floor, Admin → Settings. |

To ship a new version: bump `package.json`, add the entry to `server/versions.json`, run `./tools/release.sh`, run the tests, push, deploy.

## 2. Release pipeline

Two ways to publish:

1. **Deploy** (default). The build inside the repository (`public/`) registers itself as the "bundled" release and becomes the live stable release when it is newer than the current one. Set `AUTO_PUBLISH_BUNDLED=0` to stop that and publish by hand.
2. **Admin → Releases → Create release.** A draft starts as a copy of a base release. Upload changed files (or a whole build folder), press *Verify files + hashes*, then move it `draft → testing → qa → approved` and *Publish*. Files are locked after testing. Publishing needs explicit confirmation.

*Rollback* (Admin → Releases) makes the previously published release of a channel live again and archives the current one. Launchers follow on their next check (every 3 minutes) and download only the files that differ.

Patches are file-level deltas computed from the releases (Admin → Patches). A launcher downloads only files whose SHA-256 differs from its install record, so a patch cannot be applied to the wrong base.

Uploaded releases live in `DATA_DIR/releases/`. **On Render's free plan that disk is wiped on every deploy**; attach a persistent disk and point `DATA_DIR` at it to keep uploaded releases, staff accounts, bans, reports, tickets and the audit log.

## 3. Update security

- Every file in a manifest has a size and SHA-256. The launcher hashes each download before staging it and again after installing.
- Manifests are signed with Ed25519 when the server has `ARVEX_SIGN_KEY`. The public key is embedded in the launcher (`launcher/signing.pub`).
- Trust on first use: once a launcher has seen one correctly signed manifest from its server, it refuses unsigned manifests (`ARVEX-U006`), bad signatures (`ARVEX-U005`) and older signed manifests replayed later (`ARVEX-U009`).
- The launcher's own self-update must match the SHA-256 in `/api/versions` (and its signature once signing is enforced).
- New key pair: `node tools/keygen.mjs <private-key-file>`, rebuild the launcher, set the private key as `ARVEX_SIGN_KEY`. Never commit the private key.

## 4. What the launcher does during an update

`check → download to staging (.part files, HTTP Range resume, retry with backoff, shared speed limit, 1–6 parallel) → SHA-256 → journal + backup → move files → SHA-256 again → write installed.json → clean up`

- A failure or a crash while moving files is undone from the backup on the same run or the next start (`.arvex/journal.json`).
- One updater per install folder (`.arvex/update.lock`, released if its owner dies).
- Disk space is checked before downloading (`ARVEX-F002` with required/available).
- Updating is refused while the game window is open (`ARVEX-U007`).
- Saves and game settings live in the browser profile under `%LOCALAPPDATA%\ARVEX\webview-game`, never in the game folder, so updates, repair and uninstall do not touch them.

Launcher data: `%LOCALAPPDATA%\ARVEX\` — `settings.json`, `logs/launcher.log` (rotated, 1 MB × 3), `trust.json`, `tickets.json`, `cache/`.

### Error codes

| Code | Meaning | | Code | Meaning |
|---|---|---|---|---|
| L002 | game not installed | | U005 | bad manifest signature |
| L003 | no Edge/Chrome found | | U006 | unsigned manifest refused |
| L004 | game already running / port busy | | U007 | game is open |
| N001 | server unreachable | | U008 | release changed while downloading |
| N002 | timeout / stalled download | | U009 | older signed release offered |
| N003 | server error (5xx) | | F001 | files missing or damaged |
| N004 | rate limited | | F002 | not enough disk space |
| U001 | invalid manifest | | F003 | cannot write to the folder |
| U002 | file not available | | F004 | verification after install failed (rolled back) |
| U003 | hash mismatch | | A001 | maintenance |
| U004 | another operation / updater running | | A002 / A003 | mandatory update / version unsupported |

## 5. Backend layout

```
server/server.mjs        game shards, WebSocket protocol, static files, routing
server/lib/core.mjs      logging (levels + ring buffer), JSON store, HTTP helpers, rate limiter
server/lib/auth.mjs      scrypt passwords, sessions, TOTP, login throttling
server/lib/rbac.mjs      roles and the permission matrix (single source of truth)
server/lib/audit.mjs     append-only, hash-chained audit log
server/lib/releases.mjs  release registry, manifests, signing, gzip blobs, patches, rollback
server/lib/admin.mjs     admin API (/api/admin/v1), public live-ops API, moderation, reports, tickets, content, remote config
server/admin-ui/         the admin panel (static, strict CSP)
```

Environment variables: `PORT`, `DATA_DIR`, `ADMIN_KEY` (owner key for first-run setup and legacy script endpoints), `ADMIN_HASH`, `ARVEX_SIGN_KEY`, `AUTO_PUBLISH_BUNDLED`, `SERVERS_JSON`, `RESTART_MS`, `PUBLIC_URL`, `LOG_LEVEL`, `TRUST_PROXY`.

Public API: `/health`, `/api/config`, `/api/servers`, `/api/news`, `/api/versions`, `/api/changelog`, `POST /api/telemetry`, `POST /api/tickets`, `/launcher/latest.json`, `/launcher/manifest.json`, `/launcher/files/<build>/<path>`, `/launcher/gz/<sha256>`.

## 6. Admin panel

Open `/admin`. On a fresh data directory it asks once for the owner key (the same key as the in-game admin panel) and creates the OWNER account. After that: username + password (scrypt), optional 2FA, HttpOnly SameSite=Strict session cookie + CSRF token, 12 h lifetime, 2 h idle timeout, 5 failed sign-ins lock for 15 minutes.

Every admin request goes `authenticate → authorize → validate → execute → audit`. Roles and permissions: Admin → Security → Permission matrix (source: `server/lib/rbac.mjs`). Destructive actions need a reason and explicit confirmation on the server, not only in the page. The audit log cannot be edited or deleted through the API; *Verify chain* re-checks its hashes.

Where to do what:

| Task | Place |
|---|---|
| Publish / roll back a release | Releases |
| See what an update will download | Patches |
| Write patch notes | Changelog → publish (shown in the launcher) |
| Post news | Announcements → publish / schedule / expire |
| Maintenance, force update, minimum version, feature flags | Settings |
| Ban, mute, kick, warn | Users → player |
| Player reports (`/report` in game) | Reports |
| Launcher support tickets | Tickets |
| Restart / lock / broadcast | Servers |
| Errors from launchers and games, backend log, audit | Logs |
| Staff accounts, sessions, 2FA, signing status | Security |

## 6b. Item codes
A code typed in the pause menu gives every weapon, tool and outfit with ammunition (kit `all`). It gives items only: no admin rights, no building materials. Online the game server checks it (`case 'redeem'` in `server/server.mjs`): five wrong tries per ten minutes, one redemption per ten minutes per player, every redemption written to the audit log (`code.redeem`). Only the SHA-256 of `ARVEX-CODE:<CODE>` is stored (`CODE_KITS`), in the server and, for solo play, in the client. To change the code, replace that hash in both places; to switch all codes off, turn off the `redeemCodes` flag in Admin → Settings. Anyone who knows the code can use it.

## 7. Game settings

Settings are stored in `localStorage["arvex.settings"]` with a config version (`v: 3`). A missing file uses defaults plus a preset detected from the real hardware; an old file is migrated; invalid values are clamped or replaced; a corrupt file is replaced by defaults.

| Preset | Detail | Shadows | Shadow reach | AA | View / object distance | Vegetation |
|---|---|---|---|---|---|---|
| LOW | 0 | off | – | off | 300 / 180 m | 0 % |
| MEDIUM | 1 | 1024 | 45 m | off | 420 / 260 m | 40 % |
| HIGH | 2 | 2048 | 60 m | FXAA | 560 / 360 m | 80 % |
| EXTRA | 3 | 2048 | 85 m | FXAA | 680 / 440 m | 100 % |
| MAX | 3 | 4096 | 110 m | FXAA | 760 / 520 m | 100 % |

Resolution (1080p / 2K / 4K / 6K / 8K) is the internal render size, clamped to what the GPU accepts; a size the driver refuses steps down instead of failing. The game has no bitmap textures (surfaces are shaded procedurally), so "texture quality" maps to model and surface detail.

## 8. Tests

```
node tests/run-all.mjs             admin (100) + server (17) + restart (9)
node tests/run-all.mjs --launcher  + launcher and update engine (47), needs Go
```
