# EMBERWING
**آخر جناح يحمل النار** — لعبة طيران وأكشن ثلاثية الأبعاد من تطوير **Mohsen ~ Danial**.

أنت "إمبر"، آخر طائر عنقاء في أرخبيل سماوي. الفراغ (Hollow) يبلع الجزر، والمنارات الخمس انطفت. تطير، تغطس، وتندفع بالنار عشان تجمع الجمر وتولّع كل منارة وتهزم الفم الأجوف.

- 5 عوالم بأجواء مختلفة: فجر، زجاج، رعد، رماد، فراغ، وزعيم نهائي.
- فيزياء طيران فيها رفرفة وغطس وانزلاق، واندفاع ناري، ووهج نور.
- أعداء بسلوك مختلف: Drifter يطاردك، Lancer يصوّب وينطلق، Leech يسرق جمرك.
- ترقيات وريش للعنقاء، ميداليات زمنية، ريش مخفي، و3 صعوبات.
- **أونلاين للاعبين اثنين:** وضع تعاوني (تولّعون المنارة وتهزمون الزعيم سوا) ووضع ضد بعض (سباق جمر وسرقة بالاندفاع). تدخلون بكود غرفة أو لعب سريع.
- **كل الموديلات مبنية في Blender** بتفاصيل عالية: العنقاء بريش حقيقي، الجزر، الأشجار، الأعداء، الزعيم، المنارة والمزارات.
- يشتغل على الكمبيوتر والآيفون والأندرويد، ومع يد Xbox وPlayStation.
- موسيقى وأصوات مولّدة لحظيًا، وتحفظ تقدمك تلقائيًا.

## الرابط
**https://emberwing.onrender.com** (اللعبة + السيرفر الأونلاين) — ونسخة احتياطية: https://gotohel12.github.io/emberwing/

## التشغيل
| المنصة | الطريقة |
|---|---|
| الكمبيوتر (ويندوز) | `EMBERWING.exe` (من `dist/EMBERWING-PC.zip`) أو الرابط |
| آيفون | افتح الرابط في **Safari** ← مشاركة ← **إضافة إلى الشاشة الرئيسية** |
| أندرويد | افتح الرابط في **Chrome** ← ⋮ ← **تثبيت التطبيق** |

> يد التحكم تشتغل بس لما تفتح اللعبة من الرابط (https) أو من البرنامج (exe). ما تشتغل لو فتحت ملف html مباشرة، لأن المتصفح يمنعها في ملف محلي.

## التحكم
| | كيبورد + ماوس | يد تحكم | جوال |
|---|---|---|---|
| توجيه | الماوس أو WASD / الأسهم | العصا اليسرى | العصا |
| رفرفة / صعود | Space | A / ✕ | رفرفة |
| غطس | Ctrl / C | LT / L2 | غطس |
| اندفاع ناري | Shift / كليك يسار | RB / R1 أو X / ▢ | اندفاع |
| وهج (5 جمرات) | E / كليك يمين | B / ◯ أو LB / L1 | وهج |
| إيقاف | Esc / P | Start | ❚❚ |

## البنية التقنية (English)
- **Engine:** custom WebGL 1 renderer, no third-party engine. It includes a procedural sky with clouds and stars, a cloud sea, height and distance fog, emissive bloom (bright pass plus separable blur), color grading, vignette, chromatic dash effect, and particles.
- **Code layout:**
  - `src/core` (math)
  - `src/gfx` (renderer, mesh builder, models, particles)
  - `src/world` (world definitions, procedural islands)
  - `src/game` (player flight, enemies and boss, level and objectives, save)
  - `src/ui` (all screens and HUD)
  - `src/audio` (procedural music and SFX)
  - `src/input` (keyboard, mouse, gamepad, touch)
- **Build:** `node tools/build.mjs` bundles everything into `public/game.js` (esbuild). `tools/release.sh` also builds the Windows launcher (Go) and the `docs/` folder for GitHub Pages.
- **Tests (Playwright):**
  - `tests/mp.js`: two real browsers through the real server, in co-op (`MODE=coop`) and versus (`MODE=pvp`).
  - `tests/smoke.js`: menus, settings, flight, rings, embers, flare, pause, beacon, results, all worlds, boss.
  - `tests/gamepad.js`: Xbox standard and raw PlayStation mappings.
  - `tests/mobile.js`: touch.
  - `tests/playthrough.js`: a bot plays all 5 worlds without cheats.
- **Models:** `blender/ew_build.py` runs inside Blender 5.x. It builds every model (phoenix, islands, flora, enemies, boss, architecture) and writes `public/assets/ew_models.bin` (quantised, indexed meshes with per-face roles and per-vertex shade/blend/emissive). Colours are resolved at load time from the world palette, the phoenix skin or the enemy palette (`src/gfx/assets.js`).
- **Online:** `server/server.js` (Node + `ws`) serves the game and runs two-player rooms (`create`, `join`, `quick`, `ready`, `start`, relay of `st`/`ev`/`snap`). The room creator's client is authoritative for the shared world (enemies, boss, waves, storm, beacon, team embers). Each player flies its own phoenix locally. There are no accounts and no secrets. Code is in `src/net/net.js` and `src/game/mp.js`.
- **Hosting:** Render (web service, `render.yaml`, free plan, Frankfurt) runs both the game and the WebSocket server. GitHub Pages (`/docs`) is a mirror that connects to the Render server. The PWA notifies players when a new version is available.

## النشر
1. لو عدّلت الموديلات: افتح Blender وشغّل `blender/ew_build.py`، وانسخ `ew_models.bin` إلى `public/assets/`.
2. `./tools/release.sh`
3. ارفع على GitHub، وبعدها من Render اضغط **Manual Deploy ← Deploy latest commit**. نسخة Pages تتحدث لحالها من `/docs`.
3. بعد كل تحديث غيّر `VERSION` في `public/sw.js`. اللاعبين بيطلع لهم إشعار "فيه تحديث جديد" مع زر "حدّث الحين".

© 2026 Mohsen ~ Danial. الخطوط Cardo وFira Sans تحت رخصة SIL OFL.
