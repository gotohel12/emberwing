# EMBERWING 2.0 — QA report

**Test environment:**
- **Local tests:** headless Chrome (SwiftShader, software rendering) through Playwright, against the real build (`public/game.js`) and the real server (`server/server.js`).
- **Live test:** two tabs on the deployed server, https://emberwing.onrender.com.

## New in 2.0
- **Every model was built in Blender 5.2** on the developer's PC using `blender/ew_build.py`. That covers the phoenix (body, ruff, crest, back feathers, wings with separate primaries, secondaries and coverts, and a tail with long plumes), 3 floating-island templates (grass cap, draped edge, strata cliffs, stalactites, roots, crystals), 5 tree types plus rocks and grass, Drifter, Lancer, Leech, orb, the Hollow Maw boss and its cores, ring gates, the feather pickup, the beacon tower, shrines and ruins. Total: 28 meshes, ~204k triangles. Colours follow each world palette, the phoenix skin and the enemy type.
- **Online for 2 players:** co-op and versus, using a room code or quick match.

## Online tests (two real browsers + real WebSocket server) — `tests/mp.js`
| Test | Co-op | Versus |
|---|---|---|
| Create room → join by code → ready → start | ✅ | ✅ |
| Each player sees the other phoenix (position error ~15–20 units at 20 Hz) | ✅ | ✅ |
| Guest sees the host's enemies (snapshots at 10 Hz) | ✅ | ✅ |
| Guest picks up embers → removed for both, shared team counter | ✅ (10/10) | — |
| Guest dash breaks an enemy → host confirms the kill | ✅ | ✅ |
| Host enemy hits the guest → guest loses flame | ✅ (100→82) | — |
| Beacon lit → lights for both → results screen for both | ✅ | — |
| Dash into rival steals half their embers | — | ✅ (20→10, attacker +10) |
| Delivering embers to the beacon scores points → winner decided → both see the result | — | ✅ (60–0) |
| Back to the room after the match | ✅ | ✅ |
| Console errors | none | none |

**Live server test (Render, Frankfurt):**
- Two tabs created and joined room `UQNA` and started co-op.
- Each tab saw the other player, the guest saw 5 enemies, and 8 embers picked up by the guest reached the shared counter on both.
- **Ping ~90–100 ms** from the developer's machine.

## Single-player regression tests
| Test | Result |
|---|---|
| `tests/smoke.js`: menus, settings, flight, rings, embers, flare, pause, beacon, results, worlds 2–5, boss | ✅ no errors |
| `tests/gamepad.js`: Xbox (standard) and PlayStation (raw), including menus and online screen | ✅ |
| `tests/mobile.js`: phone 844×390 touch | ✅ |

## Bugs found and fixed in 2.0
1. The phoenix was blown out by bloom (too much emission). Emission was lowered.
2. The guest's storm kept expanding (wrong `else` branch). The guest now takes the storm from the host.
3. The results screen was replaced by the room screen as soon as the server sent a room update.
4. Typing a room code moved menu focus. Text fields now ignore menu keys, and Enter submits.
5. Too many triangles (~700k). Fixed with per-island culling (frustum + fog distance) and lighter foliage; now ~540k drawn at the busiest view on High, less on Medium/Low via the new "detail" setting.

## Not verified
- **Real GPU / real phone frame rate:** the ~20 FPS figure is software rendering. The Blender models are heavier than 1.0, so older phones should use Low/Medium (chosen automatically on touch devices).
- **Two different devices over the internet:** the live test used two tabs on one machine (the same server and the same network path). Ping from other countries was not measured.
- **Physical controllers, real audio, and running the .exe on Windows** were not checked in this environment.

## Known limitations
- **Max 2 players per room.**
- **Free Render plan:** the server sleeps after ~15 minutes idle. The first connection then takes up to ~60 s, and the game shows a "waking up" message.
- **No pause in online mode:** the menu opens while the world keeps running.
- **Host leaves = match ends:** if the room creator leaves, the match ends (there is no host migration).
- **Late join:** a player who joins after the match starts must wait for the next one.
- **No voice acting.**
