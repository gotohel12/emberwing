# ARVEX SURVIVAL 1.0.0 — Test report

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
