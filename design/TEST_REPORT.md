# ARVEX v10.0 — Test report

Build `10.0.0` (build id in `public/build.json`), tested 2026-11-20 on Linux: the real Node server, the real Go launcher binary (Linux build of the same sources for the update-engine tests; the Windows `.exe` is cross-compiled and was **not** run on Windows here), and the game in Chrome with software WebGL (SwiftShader).

## Automated suites — `node tests/run-all.mjs --launcher`
| Suite | Checks | Result |
|---|---|---|
| Admin backend (`tests/admin.test.mjs`) | 100 | pass |
| Game server protocol (`tests/server.test.mjs`) | 17 | pass |
| Restart + queue (`tests/restart.test.mjs`) | 9 | pass |
| Launcher + update engine (`tests/launcher.test.mjs`) | 47 | pass |

**Admin backend:** first-run owner setup, wrong key refused, login, lockout after 5 failures, CSRF required, session expiry and revoke, 2FA enrol + verify, password policy, RBAC for all five roles (every forbidden route returns 403 from the server), staff create/disable/role change, owner protection, player search, warn/mute/kick/ban enforced by the live game server (a banned token cannot join), reports from `/report` with chat evidence, tickets with replies, announcements (draft/publish/schedule/expire), changelog → launcher feeds, release pipeline (draft → upload → verify → testing → QA → approved → publish → rollback), path traversal refused, hash mismatch detected, remote config (maintenance, force update, minimum version, feature flags), server restart/lock/broadcast, health, logs, audit chain verification and tamper detection.

**Launcher + update engine:** fresh install (compressed, parallel; 70 MB build), every file hashed, verify, repair of a corrupted and a deleted file only, publish → detect → delta update, interrupted download resumes with Range, crash in the middle of install is rolled back on next start, not enough disk space (F002), server down (N001), missing file (U002), hash mismatch (U003), second updater locked out (U004) and stale lock from a dead process released, unsigned manifest refused after enforcement (U006), tampered signature (U005), replayed older manifest (U009), rollback to the previous release, maintenance blocks play, mandatory update blocks play, tickets, settings validation + corrupt settings recovery, uninstall keeps saves.

The real signing key pair was checked separately: a server started with `ARVEX_SIGN_KEY` produces a manifest whose signature verifies against `launcher/signing.pub`.

## Game in a browser (25 checks, all pass, no console errors or warnings)
| Area | Result |
|---|---|
| Version | Menu shows v10.0; bundle and `build.json` carry the same build id. |
| Settings | Corrupt file → defaults; old file migrated (`ultra` → `extra`); invalid values clamped; settings persist across a restart; changing one option switches the preset to Custom. |
| Presets | LOW/MEDIUM/HIGH/EXTRA/MAX change shadow map 0/1024/2048/2048/4096, view distance 300/420/560/680/760 m, FXAA, bloom, detail, shadow reach. LOW drew about half the triangles of MAX in the same scene. |
| Resolution | Internal render target is really 1920×1080, 2560×1440, 3840×2160, 5760×3240 and 7680×4320 (allocated, no crash, never above the GPU limit). Keep/Revert countdown works. |
| Map loading | Real phases on the loading screen; 21 terrain chunks built before the player gets control; player stands on the ground; 94 % of the lower half of the first frame is land. |
| Movement | Walk, sprint (faster than walk), jump and land, crouch. Falling out of the world puts the player back. |
| Weapons | Revolver: shot uses ammo, aim down sights, reload completes at the end of the animation. |
| Renderer | The WebGL feedback-loop error that dropped terrain and props is gone; a second driver warning (stale vertex attribute on full-screen passes) found in this pass is fixed. |

Admin panel UI (login, every section, modals, upload, live events) was exercised in the same browser with a strict Content-Security-Policy and no violations.

## Realism pass (same day, after the suites above)
Added photographed PBR textures, the Blender/MPFB first-person arm and the new fire. Checked in the browser (software WebGL) with screenshots: beach sand, grassland, rock, birch bark, revolver (metal + wood grip), torch at night, hand on revolver / torch.

- Textured shaders compile and link; no console errors or warnings while playing with textures 1K.
- Automated suites re-run after the change: see the numbers at the top (all pass).
- **Not measured:** frame rate with textures on a real GPU (the textured terrain shader does up to ~18 texture reads per pixel). 2K textures were not screenshotted, only 1K. Campfire and furnace fire were changed with the torch but only the torch was looked at.
- **Foliage (added after):** oak, birch, pine and grass use alpha-cut cards; checked with two screenshots (grassland with trees at a distance, one oak up close). Software rendering takes several seconds per frame with them, so nothing about their real frame rate is known.
- **Known visual gaps:** animals, bushes and the third-person body are still the earlier low-poly meshes; the hand has one grip pose for all tools; photographed "aerial" grass and sand are used closer than they were shot.

## Not tested / limits of this pass
- No physical GPU: FPS, frame time, VRAM use and the FPS limiter could not be measured (software rendering runs at ~4 FPS). 4K–8K were verified as allocations, not as playable frame rates.
- The Windows launcher `.exe` was built but not executed on Windows in this pass.
- Audio was not listened to. Multiplayer was tested at protocol level, not with several human players.
- Bow, melee, building, crafting and animals were not re-run in this pass (their code is unchanged from 1.x; the 1.0 results are below).
- No long soak test, no load test of the backend.

---

# 1.0.0 — earlier test report

Tested in headless Chromium (software WebGL) against the real Node server, and with the real Go launcher binary.

## Game (tests run in a real browser session)
| Area | Result |
|---|---|
| WASD | W moves along the camera's forward vector, D along camera right, measured from position deltas (positive dot products). A/S are their exact negatives. |
| Camera / look | Mouse right increases yaw (turns right). Pitch is clamped. Look-down and look-up checked. |
| Gathering | Rock on tree: +30 wood over 6 hits. Stone hatchet fells the tree (falling animation, dust, sound). Node removed and respawn scheduled. |
| Crafting | Stone hatchet, bow, arrows (×2 per craft) queued and delivered. Metal hatchet correctly refused without Workbench Lv.1. |
| Building | Foundation → adjacent foundation (snap 1,0) → 3 walls → doorway → floor at level 1. Upgrade to stone, demolish a wall, door fitted into the doorway. |
| Deployables | Campfire placed, lit with wood. Raw meat cooked, wood consumed, warmth 7.4 °C at 2.5 m. |
| Animals | 75 animals populated (deer/boar/wolf/bear). Deer killed with hits, harvested (meat, hide, bone). |
| Ranged | Bow fired, projectile simulated and resolved. |
| Items | Berries +7 food. Hide vest equipped (armour 14 %, warmth +6). |
| Death / respawn | Death screen with cause and killer, backpack dropped with all items, respawn on beach with starter kit. |
| Save | Solo world saved to localStorage and restored on Continue. |
| UI | Menu (live 3D flyover), servers (online and offline error state), profile, settings (all tabs), about, credits, inventory, crafting, radial build menu, build preview (valid/invalid + reason), map, pause, death. Arabic RTL and English both checked. |
| Visual states | Day, night with torch light, storm with rain and lightning, campfire light. |

## Server — `tests/server.test.mjs` (17/17)
Server list with every card field · staggered restarts · join with token, seed and snapshot · server-simulated animals · 2 players, live counts · join/leave notifications · 10 Hz positions · structure broadcast · ownership blocks demolition by others · chat · duplicate account rejected · old version rejected · server-side playtime recorded and kept across sessions.

## Restart cycle + queue — `tests/restart.test.mjs` (9/9)
Server reports FULL at capacity · second player queued at #1 · automatically admitted when a slot frees · pre-restart warnings · players saved and kicked with `restart` · status RESTARTING during grace · back ONLINE with fresh uptime · next restart scheduled a full cycle later.

## Launcher — `tests/launcher.test.mjs` (11/11) + update test
Connects and reads the manifest (1.62 MB, 32 files) · real progress, speed, ETA and current file · speed limit respected · pause holds the download · resume → download complete · files on disk · verify OK · 1 corrupted + 1 missing file detected · repair re-downloads only those 2 files · verify OK after repair.
**Incremental update:** version 1.0.0 → 1.0.1 with one changed file. The launcher reported an update size of 33 518 bytes (1 file of 1.7 MB), downloaded only that file, and installed 1.0.1.

## Known limits (honest)
- Software-WebGL frame rates in CI are low, so frame-rate numbers here are not representative. Use the in-game FPS overlay on real hardware.
- In multiplayer, player inventories are client-held and persisted on the server every 15 s; the server does not simulate them. Hits on animals and players are validated by distance and capped damage.
- On Render's free plan the disk is ephemeral. Persistent worlds and playtime need a Render Disk (`DATA_DIR`).
- "Regions" are labels. All shards run in Frankfurt until more Render services are deployed (`SERVERS_JSON` + `PUBLIC_URL`).
- The mobile versions are a PWA (Safari/Chrome install), not App Store / Play Store builds.
