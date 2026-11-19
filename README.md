# EMBERWING
**آخر جناح يحمل النار** — لعبة طيران وأكشن ثلاثية الأبعاد من تطوير **Mohsen ~ Danial**.

أنت "إمبر"، آخر طائر عنقاء في أرخبيل سماوي. الفراغ (Hollow) يبلع الجزر، والمنارات الخمس انطفت. تطير، تغطس، وتندفع بالنار عشان تجمع الجمر وتولّع كل منارة وتهزم الفم الأجوف.

- 5 عوالم بأجواء مختلفة: فجر، زجاج، رعد، رماد، فراغ، وزعيم نهائي.
- فيزياء طيران فيها رفرفة وغطس وانزلاق، واندفاع ناري، ووهج نور.
- أعداء بسلوك مختلف: Drifter يطاردك، Lancer يصوّب وينطلق، Leech يسرق جمرك.
- ترقيات وريش للعنقاء، ميداليات زمنية، ريش مخفي، و3 صعوبات.
- يشتغل على الكمبيوتر والآيفون والأندرويد، ومع يد Xbox وPlayStation.
- موسيقى وأصوات مولّدة لحظيًا، وتحفظ تقدمك تلقائيًا.

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
  - `tests/smoke.js`: menus, settings, flight, rings, embers, flare, pause, beacon, results, all worlds, boss.
  - `tests/gamepad.js`: Xbox standard and raw PlayStation mappings.
  - `tests/mobile.js`: touch.
  - `tests/playthrough.js`: a bot plays all 5 worlds without cheats.
- **Hosting:** static files only (GitHub Pages). It is a single-player game, so no game server is needed. The PWA notifies players when a new version is available.

## النشر
1. `./tools/release.sh`
2. ارفع على GitHub، وفعّل **Settings ← Pages ← Branch: main / folder: /docs**.
3. بعد كل تحديث غيّر `VERSION` في `public/sw.js`. اللاعبين بيطلع لهم إشعار "فيه تحديث جديد" مع زر "حدّث الحين".

© 2026 Mohsen ~ Danial. الخطوط Cardo وFira Sans تحت رخصة SIL OFL.
