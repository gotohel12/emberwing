# EMBERWING — Game Design Document
*Mohsen ~ Danial — 2026*

## Vision
You are **Ember**, the last fire-bird of a sky archipelago. The five Sky Beacons have gone dark and the **Hollow**, a living void storm, is swallowing the islands one by one. You fly, dive and burn through the sky to gather scattered embers, relight each Beacon and push the dark back.

**Pillars:** (1) flight that feels great: weight, speed, wind; (2) light vs. dark: everything you do spreads light; (3) short, intense runs against a closing storm.

## Core loop (each world, about 4–8 minutes)
1. Fly across the floating islands and collect **embers** (they are both score and fuel).
2. Fly through **wind rings** for speed and find **3 hidden feathers**.
3. Avoid or destroy the **Hollow wraiths**.
4. Bring enough embers to the **Beacon** and circle it to light it, while waves of wraiths attack.
5. The **storm** keeps shrinking the playable area, so you can't take too long.
6. The Beacon lights up, a wave of light clears the sky, and you get a time medal, embers to spend and progress saved.

## Controls
| Action | Keyboard + mouse | Controller (Xbox / PlayStation) | Touch |
|---|---|---|---|
| Steer | Mouse (pointer lock) or WASD / arrows | Left stick | Left stick |
| Flap / climb | Space (hold) | A / ✕ | FLAP button |
| Dive / fold wings | Ctrl or C | LT / L2 | DIVE button |
| Fire dash | Shift / left click | RB / R1, or X / ▢ | DASH button |
| Flare (light pulse) | E / right click | B / ◯ or LB / L1 | FLARE button |
| Pause | Esc / P | Start / Options | ❚❚ |

## Mechanics
- **Flight:** gravity plus lift that depends on speed. Diving builds speed and climbing spends it. Flapping uses stamina. The wings rotate with each banking turn.
- **Flame (health):** lost when a wraith hits you, when you crash hard into an island, or while you are outside the storm boundary. Shrines along the way restore it and act as checkpoints.
- **Fire dash:** a short burst of speed with a cooldown. It destroys any wraith you pass through.
- **Flare:** a light pulse that costs 5 embers. It knocks wraiths back and destroys the weak ones.
- **Beacon:** circle it inside its ring to charge it. Embers flow into it and enemy waves get harder as it charges.
- **Enemies:**
  - **Drifter:** slow, patrols, and chases you when you get close.
  - **Lancer:** telegraphs a straight-line charge.
  - **Leech:** clings to you and steals embers until you dash or flare.
  - **Boss (world 5) — Hollow Maw:** exposes 3 cores in turn, which you hit with the dash.
- **Upgrades (Aerie):** wings (stamina), heart (max flame), dash (cooldown), flare (radius), magnet (ember pickup range).

## Worlds
| # | Name | Mood | New element |
|---|---|---|---|
| 1 | Dawnmere | gold dawn | tutorial, rings |
| 2 | Glass Canyons | blue noon, crystals | Lancer |
| 3 | Thunder Reach | storm, lightning | lightning hazards, Leech |
| 4 | Ashwood | red dusk, burning forest | dense waves |
| 5 | Hollow Crown | night and void | Hollow Maw boss |

## Progression and replay
Each world has 3 feathers, a gold/silver/bronze time medal, and an ember total. Upgrades are bought with embers. There are 3 difficulties (Story / Normal / Hard). Progress saves automatically and can be continued later.

## Presentation
- **Rendering:** custom WebGL with a dynamic sky, height fog, emissive bloom, per-world color grading, vignette, particles and procedural geometry.
- **Audio:** procedural WebAudio music (ambient layer plus combat layer), wind that follows your speed, and full sound effects. There is no voice acting; the story is told through short text cards.

## Technical
- Runs in the browser (PC / iPhone / Android) as an installable PWA. A Windows launcher exe is also built.
- Single player: there is no fake multiplayer.
- Quality presets Low / Medium / High / Ultra / Custom, with render scale up to 2× DPR on capable screens.
