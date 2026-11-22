// ARVEX SURVIVAL — item database, recipes, gather tables, loot tables (pure data, shared with the server)
// name/desc are [arabic, english]
export const CATS = ['resource', 'tool', 'weapon', 'ammo', 'build', 'deploy', 'base', 'raid', 'cloth', 'medical', 'food', 'comp', 'attach'];
export const CAT_NAMES = {
  all: ['الكل', 'All'], resource: ['موارد', 'Resources'], tool: ['أدوات', 'Tools'], weapon: ['أسلحة', 'Weapons'], ammo: ['ذخيرة', 'Ammo'], build: ['بناء', 'Construction'],
  deploy: ['معدّات', 'Items'], base: ['القاعدة', 'Base'], raid: ['رايد', 'Raiding'], cloth: ['ملابس', 'Clothing'], medical: ['طبي', 'Medical'], food: ['أكل', 'Food'], comp: ['قطع', 'Components'], attach: ['ملحقات', 'Attachments']
};

const I = {};
const def = (id, cat, name, desc, o = {}) => { I[id] = Object.assign({ id, cat, name, desc, stack: 1 }, o); };

// ---------- resources
def('wood', 'resource', ['خشب', 'Wood'], ['أساس البناء والصناعة. تجمعه من الأشجار.', 'The base of building and crafting. Chop trees to get it.'], { stack: 1000 });
def('stone', 'resource', ['حجر', 'Stone'], ['من الصخور. للأدوات والبناء الحجري.', 'From rocks. Used for tools and stone building.'], { stack: 1000 });
def('metal_ore', 'resource', ['خام حديد', 'Metal Ore'], ['يذوّب في الفرن ويصير حديد.', 'Smelt it in a furnace to get metal fragments.'], { stack: 1000 });
def('metal_frag', 'resource', ['حديد', 'Metal Fragments'], ['للأدوات المتقدمة والبناء الحديدي.', 'For advanced tools and metal building.'], { stack: 1000 });
def('cloth', 'resource', ['قماش', 'Cloth'], ['من نبات القنب وجلود الحيوانات الصغيرة.', 'From hemp plants. Used for clothes and medicine.'], { stack: 500 });
def('hide', 'resource', ['جلد', 'Animal Hide'], ['من الحيوانات. للملابس القوية.', 'From animals. Used for tougher clothing.'], { stack: 500 });
def('bone', 'resource', ['عظم', 'Bone Fragments'], ['من الحيوانات. لأدوات العظم.', 'From animals. Used for bone tools.'], { stack: 500 });
def('scrap', 'comp', ['خردة', 'Scrap'], ['تلقاها في الصناديق والبراميل. ضرورية للمعدات المتقدمة.', 'Found in crates and barrels. Needed for advanced gear.'], { stack: 1000 });
def('rope', 'comp', ['حبل', 'Rope'], ['قطعة تصنيع نادرة من الصناديق.', 'A rare crafting component from crates.'], { stack: 50 });
def('spring', 'comp', ['زنبرك', 'Spring'], ['قطعة نادرة للأسلحة.', 'A rare weapon component.'], { stack: 20 });
// ---------- food & water
def('berries', 'food', ['توت', 'Berries'], ['يعطي شوية أكل وموية.', 'Restores a little food and water.'], { stack: 20, eat: { food: 7, water: 5 } });
def('raw_meat', 'food', ['لحم نيء', 'Raw Meat'], ['اطبخه على النار. أكله نيء ممكن يمرضك.', 'Cook it on a campfire. Eating it raw can make you sick.'], { stack: 20, eat: { food: 8, poison: 0.45 }, cook: 'cooked_meat' });
def('cooked_meat', 'food', ['لحم مطبوخ', 'Cooked Meat'], ['أكل مشبع ويرجع شوية صحة.', 'Filling, and restores some health.'], { stack: 20, eat: { food: 32, hp: 5 }, cook: 'burnt_meat', cookT: 40 });
def('burnt_meat', 'food', ['لحم محروق', 'Burnt Meat'], ['تركته على النار زيادة.', 'Left on the fire too long.'], { stack: 20, eat: { food: 6 } });
def('canned', 'food', ['معلبات', 'Canned Food'], ['أكل محفوظ من الأنقاض.', 'Preserved food found in ruins.'], { stack: 10, eat: { food: 40, water: 6 } });
def('water_jug', 'food', ['قارورة موية', 'Water Jug'], ['اعبيها من بحيرة أو نهر واشرب منها وقت ما تبي.', 'Fill it at a lake or river and drink any time.'], { stack: 1, jug: 100 });
// ---------- medical
def('bandage', 'medical', ['ضماد', 'Bandage'], ['يوقف النزيف ويرجع شوية صحة.', 'Stops bleeding and restores a little health.'], { stack: 5, heal: { hp: 8, stopBleed: true }, useT: 1.2 });
def('medkit', 'medical', ['حقيبة إسعاف', 'Medical Kit'], ['يعالج مع الوقت ويوقف النزيف والتسمم.', 'Heals over time and cures bleeding and poison.'], { stack: 3, heal: { hp: 15, regen: 35, stopBleed: true, cure: true }, useT: 2.5 });
// ---------- tools (gather: damage to node, mult: yield multiplier)
def('rock', 'tool', ['حجر يدوي', 'Rock'], ['أول أداة. يجمع خشب وحجر ببطء.', 'Your first tool. Gathers wood and stone slowly.'], { model: 'rock', melee: { dmg: 10, range: 1.6, rate: 0.85, stam: 4 }, gather: { tree: [18, 0.5], rock: [18, 0.5], flesh: [12, 0.5] }, cond: 50 });
def('torch', 'tool', ['شعلة', 'Torch'], ['تنوّر الليل وتدفّيك.', 'Lights the night and keeps you warm.'], { model: 'torch', melee: { dmg: 12, range: 1.6, rate: 0.8, stam: 4 }, light: 9, warm: 6, cond: 120, burn: true });
def('stone_hatchet', 'tool', ['فأس حجري', 'Stone Hatchet'], ['يقطع الأشجار.', 'Chops trees.'], { model: 'hatchet_s', melee: { dmg: 16, range: 1.8, rate: 0.75, stam: 5 }, gather: { tree: [30, 1], rock: [12, 0.3], flesh: [18, 0.8] }, cond: 120 });
def('stone_pickaxe', 'tool', ['معول حجري', 'Stone Pickaxe'], ['يكسر الصخور ويطلع الخام.', 'Breaks rocks and ore nodes.'], { model: 'pick_s', melee: { dmg: 16, range: 1.8, rate: 0.85, stam: 5 }, gather: { tree: [10, 0.3], rock: [30, 1], flesh: [14, 0.5] }, cond: 120 });
def('metal_hatchet', 'tool', ['فأس حديد', 'Metal Hatchet'], ['أسرع وأقوى من الحجري.', 'Faster and stronger than stone.'], { model: 'hatchet_m', melee: { dmg: 22, range: 1.9, rate: 0.62, stam: 5 }, gather: { tree: [44, 1.7], rock: [16, 0.4], flesh: [24, 1] }, cond: 300 });
def('metal_pickaxe', 'tool', ['معول حديد', 'Metal Pickaxe'], ['يطلع خام كثير.', 'Mines much more ore.'], { model: 'pick_m', melee: { dmg: 22, range: 1.9, rate: 0.72, stam: 5 }, gather: { tree: [12, 0.4], rock: [44, 1.7], flesh: [18, 0.6] }, cond: 300 });
def('bone_knife', 'tool', ['سكين عظم', 'Bone Knife'], ['أفضل أداة لسلخ الحيوانات.', 'The best tool for harvesting animals.'], { model: 'knife', melee: { dmg: 18, range: 1.5, rate: 0.45, stam: 3 }, gather: { tree: [6, 0.2], rock: [4, 0.1], flesh: [40, 2] }, cond: 150 });
def('hammer', 'tool', ['مطرقة', 'Hammer'], ['تطوير وإصلاح وهدم المباني. كليك يمين للقائمة.', 'Upgrade, repair and demolish buildings. Right-click for the menu.'], { model: 'hammer', melee: { dmg: 8, range: 2.2, rate: 0.7, stam: 2 }, hammer: true });
def('plan', 'tool', ['مخطط بناء', 'Building Plan'], ['ابنِ قاعدتك. كليك يمين لاختيار القطعة، R للتدوير.', 'Build your base. Right-click to pick a piece, R to rotate.'], { model: 'plan', plan: true });
// ---------- weapons
def('wooden_spear', 'weapon', ['رمح خشبي', 'Wooden Spear'], ['مدى طويل. ممتاز ضد الحيوانات.', 'Long reach. Good against animals.'], { model: 'spear_w', melee: { dmg: 28, range: 2.6, rate: 1.0, stam: 8 }, gather: { flesh: [16, 0.6] }, cond: 80 });
def('stone_spear', 'weapon', ['رمح حجري', 'Stone Spear'], ['رمح برأس حجري حاد.', 'A spear with a sharp stone head.'], { model: 'spear_s', melee: { dmg: 38, range: 2.7, rate: 1.0, stam: 8 }, gather: { flesh: [20, 0.7] }, cond: 120 });
def('machete', 'weapon', ['ساطور', 'Machete'], ['ضربات سريعة وقوية.', 'Fast, strong strikes.'], { model: 'machete', melee: { dmg: 34, range: 1.9, rate: 0.6, stam: 6 }, gather: { tree: [14, 0.4], flesh: [26, 1.1] }, cond: 260 });
def('bow', 'weapon', ['قوس صيد', 'Hunting Bow'], ['اسحب كليك يسار وفلّت للرمي. كليك يمين للتصويب.', 'Hold left click to draw, release to fire. Right-click to aim.'], { model: 'bow', ranged: { dmg: 42, speed: 62, draw: 0.85, spread: 1.6, ammo: 'arrow', cap: 1, reload: 0.6, recoil: 0.5 }, cond: 200 });
def('crossbow', 'weapon', ['قوس نشاب', 'Crossbow'], ['قوي ودقيق، بطيء التلقيم (R).', 'Powerful and accurate, slow to reload (R).'], { model: 'crossbow', ranged: { dmg: 70, speed: 90, draw: 0, spread: 0.6, ammo: 'arrow', cap: 1, reload: 2.6, recoil: 1.6 }, cond: 220 });
def('sword', 'weapon', ['سيف', 'Salvaged Sword'], ['سيف ثقيل من حديد الأنقاض.', 'A heavy blade forged from salvaged metal.'], { model: 'sword', melee: { dmg: 48, range: 2.1, rate: 0.85, stam: 9 }, gather: { flesh: [28, 1.2] }, cond: 320 });
def('revolver', 'weapon', ['مسدس دوّار', 'Revolver'], ['ست طلقات. كليك يسار للرمي، R للتلقيم.', 'Six shots. Left click to fire, R to reload.'], { model: 'revolver', ranged: { gun: 'pistol', vel: 300, pat: 'revolver', dmg: 34, rate: 0.28, spread: 1.4, ammo: 'pistol_ammo', cap: 6, reload: 2.4, recoil: 1.2, range: 120 }, cond: 300 });
def('semi_rifle', 'weapon', ['رشاش نصف آلي', 'Semi-Auto Rifle'], ['دقيق وقوي من بعيد. 16 طلقة.', 'Accurate and strong at range. 16 rounds.'], { model: 'rifle', ranged: { gun: 'rifle', vel: 375, pat: 'semi', dmg: 42, rate: 0.17, spread: 0.7, ammo: 'rifle_ammo', cap: 16, reload: 3, recoil: 1.6, range: 250 }, cond: 400 });
def('pump_shotgun', 'weapon', ['شوزن', 'Pump Shotgun'], ['مدمّر من قريب. 4 خراطيش.', 'Devastating up close. 4 shells.'], { model: 'shotgun', ranged: { gun: 'shotgun', vel: 225, pat: 'shotgun', dmg: 14, pellets: 9, rate: 0.9, spread: 5.5, ammo: 'shotgun_shell', cap: 4, reload: 3.6, recoil: 2.6, range: 45 }, cond: 300 });
def('smg', 'weapon', ['رشاش صغير MP', 'MP Submachine Gun'], ['آلي، سريع وخفيف، 30 طلقة مسدس. اضغط واستمر للرمي.', 'Automatic, fast and light, 30 pistol rounds. Hold to fire.'], { model: 'smg', ranged: { gun: 'pistol', vel: 240, pat: 'smg', auto: true, dmg: 30, rate: 0.1, spread: 0.9, ammo: 'pistol_ammo', cap: 30, reload: 3.6, recoil: 0.9, range: 150 }, cond: 450 });
def('assault_rifle', 'weapon', ['رشاش AK', 'AK Assault Rifle'], ['آلي وقوي، 30 طلقة. ارتداده له نمط ثابت تتعلمه وتسحب عكسه.', 'Automatic and hard-hitting, 30 rounds. Its recoil follows a fixed pattern you learn and pull against.'], { model: 'ak', ranged: { gun: 'rifle', vel: 375, pat: 'ak', auto: true, dmg: 50, rate: 0.133, spread: 0.5, ammo: 'rifle_ammo', cap: 30, reload: 4.4, recoil: 1.7, range: 300 }, cond: 500 });
def('bolt_rifle', 'weapon', ['قناص بمنظار', 'Bolt-Action Rifle'], ['طلقة وحدة تكفي. منظار 8x، والرصاصة تنزل مع المسافة فارفع شوي.', 'One shot is enough. 8x scope; the bullet drops with distance, so aim a little high.'], { model: 'bolt', ranged: { gun: 'rifle', vel: 656, pat: 'bolt', zoom: 8, dmg: 80, rate: 1.6, spread: 0.08, hip: 3.5, ammo: 'rifle_ammo', cap: 4, reload: 5, recoil: 3.4, range: 500 }, cond: 350 });
def('pistol', 'weapon', ['مسدس نصف آلي', 'Semi-Auto Pistol'], ['عشر طلقات، سريع وخفيف.', 'Ten rounds, quick and light.'], { model: 'pistol', ranged: { gun: 'pistol', vel: 300, pat: 'pistol', dmg: 28, rate: 0.15, spread: 1.0, ammo: 'pistol_ammo', cap: 10, reload: 2.2, recoil: 0.9, range: 110 }, cond: 300 });
def('python', 'weapon', ['مسدس دوّار ثقيل', 'Heavy Revolver'], ['ست طلقات، كل وحدة تضرب بقوة.', 'Six rounds, each one hits hard.'], { model: 'python', ranged: { gun: 'pistol', vel: 300, pat: 'revolver', dmg: 55, rate: 0.36, spread: 0.9, ammo: 'pistol_ammo', cap: 6, reload: 3.2, recoil: 2.0, range: 140 }, cond: 350 });
def('custom_smg', 'weapon', ['رشاش صغير مصنوع', 'Custom SMG'], ['آلي ورخيص، 24 طلقة.', 'Automatic and cheap, 24 rounds.'], { model: 'smg2', ranged: { gun: 'pistol', vel: 240, pat: 'smg', auto: true, dmg: 24, rate: 0.1, spread: 1.2, ammo: 'pistol_ammo', cap: 24, reload: 3.4, recoil: 1.0, range: 120 }, cond: 350 });
def('lr_rifle', 'weapon', ['رشاش LR', 'LR Assault Rifle'], ['آلي، ارتداده أهدى من AK ودقته أعلى.', 'Automatic, calmer recoil than the AK and more accurate.'], { model: 'm4', ranged: { gun: 'rifle', vel: 375, pat: 'lr', auto: true, dmg: 40, rate: 0.12, spread: 0.4, ammo: 'rifle_ammo', cap: 30, reload: 4, recoil: 1.3, range: 300 }, cond: 500 });
def('l96_rifle', 'weapon', ['قناص ثقيل', 'Heavy Sniper Rifle'], ['أبعد وأقوى سلاح. منظار 8x.', 'The longest reach and the hardest hit. 8x scope.'], { model: 'l96', ranged: { gun: 'rifle', vel: 1125, pat: 'bolt', zoom: 8, dmg: 95, rate: 2.2, spread: 0.05, hip: 4, ammo: 'rifle_ammo', cap: 5, reload: 5.5, recoil: 3.8, range: 700 }, cond: 350 });
def('double_barrel', 'weapon', ['شوزن مزدوج', 'Double-Barrel Shotgun'], ['طلقتين ورا بعض من قريب.', 'Two quick shots at close range.'], { model: 'dbarrel', ranged: { gun: 'shotgun', vel: 225, pat: 'shotgun', dmg: 15, pellets: 10, rate: 0.28, spread: 7, ammo: 'shotgun_shell', cap: 2, reload: 3.2, recoil: 2.8, range: 35 }, cond: 250 });
def('combat_knife', 'weapon', ['سكين قتال', 'Combat Knife'], ['سريعة وهادية، وتسلخ زين.', 'Fast and quiet, and good for skinning.'], { model: 'cknife', melee: { dmg: 38, range: 1.7, rate: 0.4, stam: 4 }, gather: { flesh: [34, 1.3] }, cond: 260 });
def('silencer', 'attach', ['كاتم صوت', 'Silencer'], ['اسحبه على السلاح في الحقيبة. الطلقة ما تنسمع من بعيد وبدون وميض، والضرر أقل شوي.', 'Drag it onto a gun in the inventory. Shots are not heard from far and show no flash; slightly less damage.'], { stack: 1, attach: 'muzzle' });
def('scope_8x', 'attach', ['منظار 8x', '8x Scope'], ['اسحبه على سلاح طويل: تصويب بتكبير 8x.', 'Drag it onto a long gun: aiming zooms 8x.'], { stack: 1, attach: 'sight' });
def('weapon_light', 'attach', ['كشاف سلاح', 'Weapon Light'], ['اسحبه على السلاح: ينوّر قدامك وأنت ماسكه.', 'Drag it onto a gun: lights the way while you hold it.'], { stack: 1, attach: 'side' });
def('pistol_ammo', 'ammo', ['طلقات مسدس', 'Pistol Ammo'], ['ذخيرة للمسدس الدوّار.', 'Ammo for the revolver.'], { stack: 128 });
def('rifle_ammo', 'ammo', ['طلقات رشاش', 'Rifle Ammo'], ['ذخيرة للرشاش.', 'Ammo for the rifle.'], { stack: 128 });
def('shotgun_shell', 'ammo', ['خراطيش شوزن', 'Shotgun Shells'], ['ذخيرة للشوزن.', 'Ammo for the shotgun.'], { stack: 64 });
def('arrow', 'ammo', ['سهم', 'Arrow'], ['ذخيرة للقوس والنشاب.', 'Ammo for bows and crossbows.'], { stack: 64 });
// ---------- clothing (slot, armor fraction, insulation °C)
def('cloth_hood', 'cloth', ['غطاء قماش', 'Cloth Hood'], ['يدفّي الراس.', 'Keeps your head warm.'], { wear: { slot: 'head', armor: 0.06, ins: 3 } });
def('cloth_shirt', 'cloth', ['قميص قماش', 'Cloth Shirt'], ['ملابس بسيطة تدفّي.', 'Simple, warm clothing.'], { wear: { slot: 'chest', armor: 0.07, ins: 4 } });
def('cloth_pants', 'cloth', ['بنطلون قماش', 'Cloth Pants'], ['ملابس بسيطة تدفّي.', 'Simple, warm clothing.'], { wear: { slot: 'legs', armor: 0.07, ins: 4 } });
def('hide_boots', 'cloth', ['جزمة جلد', 'Hide Boots'], ['تحمي رجولك.', 'Protects your feet.'], { wear: { slot: 'feet', armor: 0.06, ins: 3 } });
def('hide_vest', 'cloth', ['صدرية جلد', 'Hide Vest'], ['حماية أقوى من القماش.', 'Better protection than cloth.'], { wear: { slot: 'chest', armor: 0.14, ins: 6 } });
def('hide_pants', 'cloth', ['بنطلون جلد', 'Hide Pants'], ['حماية أقوى من القماش.', 'Better protection than cloth.'], { wear: { slot: 'legs', armor: 0.13, ins: 5 } });
def('bone_helmet', 'cloth', ['خوذة عظم', 'Bone Helmet'], ['تحمي الراس من الضربات.', 'Protects your head from hits.'], { wear: { slot: 'head', armor: 0.2, ins: 1 } });
def('wood_armor', 'cloth', ['درع خشبي', 'Wooden Armor'], ['حماية عالية للصدر، ما يدفّي.', 'High chest protection, no warmth.'], { wear: { slot: 'chest', armor: 0.25, ins: 0 } });
// ---------- deployables
def('campfire', 'deploy', ['نار مخيم', 'Campfire'], ['اطبخ اللحم وتدفّى. حط فيها خشب كوقود.', 'Cook meat and warm up. Add wood as fuel.'], { deploy: { kind: 'campfire', slots: 5, r: 0.7, hp: 80, mat: 2 } });
def('furnace', 'deploy', ['فرن', 'Furnace'], ['يذوّب خام الحديد. يحتاج خشب.', 'Smelts metal ore. Needs wood.'], { deploy: { kind: 'furnace', slots: 6, r: 0.8, hp: 350, mat: 2 } });
def('storage_box', 'deploy', ['صندوق تخزين', 'Storage Box'], ['خزّن أغراضك (12 خانة).', 'Store your items (12 slots).'], { deploy: { kind: 'box', slots: 12, r: 0.6, hp: 150, mat: 1 } });
def('large_box', 'deploy', ['صندوق كبير', 'Large Box'], ['تخزين كبير (30 خانة).', 'Large storage (30 slots).'], { deploy: { kind: 'box', slots: 30, r: 0.9, big: true, hp: 300, mat: 1 } });
def('workbench1', 'deploy', ['طاولة عمل 1', 'Workbench Lv.1'], ['تفتح وصفات متقدمة لما تكون قريب منها.', 'Unlocks advanced recipes while you stand near it.'], { deploy: { kind: 'bench', level: 1, r: 1, hp: 250, mat: 1 } });
def('workbench2', 'deploy', ['طاولة عمل 2', 'Workbench Lv.2'], ['أعلى مستوى صناعة.', 'The highest crafting tier.'], { deploy: { kind: 'bench', level: 2, r: 1.1, hp: 400, mat: 3 } });
def('sleeping_bag', 'deploy', ['كيس نوم', 'Sleeping Bag'], ['نقطة رجوع بعد الموت.', 'A respawn point after death.'], { deploy: { kind: 'bag', r: 0.5, hp: 40, mat: 0 } });
def('wooden_door', 'deploy', ['باب خشبي', 'Wooden Door'], ['ركّبه في فتحة باب.', 'Fits into a doorway.'], { deploy: { kind: 'door', tier: 1, hp: 200, mat: 1 } });
def('metal_door', 'deploy', ['باب حديد', 'Metal Door'], ['باب قوي.', 'A strong door.'], { deploy: { kind: 'door', tier: 3, hp: 800, mat: 3 } });

// ---------- base: locks, the base core, outer walls, gate and watchtower (25.0)
def('key_lock', 'base', ['قفل بمفتاح', 'Key Lock'], ['ركّبه على باب أو صندوق أو بوابة. يفتحه صاحبه واللي معه بالقاعدة بس.', 'Fit it to a door, box or gate. Only the owner and base members can open it.'], { stack: 5, model: 'lock_key', lock: 'key' });
def('code_lock', 'base', ['قفل رقمي', 'Code Lock'], ['قفل برقم سري من 4 أرقام. اللي يعرف الرقم يدخل.', 'A lock with a 4-digit code. Anyone who knows the code gets in.'], { stack: 5, model: 'lock_code', lock: 'code' });
def('base_core', 'base', ['قلب القاعدة', 'Base Core'], ['يحمي قاعدتك: ما أحد يبني حولها غير المصرّح لهم، ويوقف تحلل المباني طول ما فيه موارد صيانة.', 'Protects your base: only authorised players can build around it, and it stops decay while it holds upkeep resources.'], { deploy: { kind: 'core', slots: 12, r: 0.6, hp: 400, mat: 1 } });
def('high_wall_wood', 'base', ['سور خشبي عالي', 'High Wooden Wall'], ['سور من جذوع مدببة يحمي ساحة القاعدة.', 'A wall of sharpened logs to fence in your compound.'], { stack: 10, deploy: { kind: 'hwall', tier: 1, hp: 500, mat: 1 } });
def('high_wall_stone', 'base', ['سور حجري عالي', 'High Stone Wall'], ['سور حجري سميك. يبيله متفجرات كثيرة.', 'A thick stone wall. It takes a lot of explosives.'], { stack: 10, deploy: { kind: 'hwall', tier: 2, hp: 900, mat: 2 } });
def('wooden_gate', 'base', ['بوابة خشبية', 'Wooden Gate'], ['بوابة كبيرة للسور. تنقفل بقفل.', 'A large gate for your wall. Takes a lock.'], { stack: 2, deploy: { kind: 'gate', hp: 450, mat: 1 } });
def('watchtower', 'base', ['برج مراقبة', 'Watchtower'], ['برج خشبي بدرج ومنصة تشوف منها اللي جاي.', 'A wooden tower with stairs and a platform to see who is coming.'], { stack: 2, deploy: { kind: 'tower', hp: 500, mat: 1 } });
// ---------- raiding: black powder and explosives (dmg = damage to twig / wood / stone / metal)
def('powder', 'comp', ['بارود', 'Black Powder'], ['أساس المتفجرات. يتصنع على طاولة العمل.', 'The base of every explosive. Made at a workbench.'], { stack: 1000 });
def('powder_bomb', 'raid', ['قنبلة بارود', 'Powder Bomb'], ['صوّب على جدار أو باب وحطها. تنفجر بعد 5 ثواني. قوية على الخشب.', 'Aim at a wall or door and plant it. Explodes after 5 seconds. Strong against wood.'], { stack: 10, model: 'bomb', explosive: { fuse: 5, radius: 3.2, dmg: [220, 135, 55, 22], hurt: 75 } });
def('breach_charge', 'raid', ['عبوة اختراق', 'Breach Charge'], ['عبوة قوية تفتح الحجر والحديد. تنفجر بعد 7 ثواني.', 'A heavy charge that opens stone and metal. Explodes after 7 seconds.'], { stack: 5, model: 'charge', explosive: { fuse: 7, radius: 4.2, dmg: [900, 520, 270, 175], hurt: 140 } });

export const ITEMS = I;
export const item = id => I[id];

// ---------- recipes  bench: 0 none, 1, 2
export const RECIPES = [
  ['campfire', 1, { wood: 100 }, 3, 0], ['torch', 1, { wood: 20, cloth: 10 }, 2, 0], ['stone_hatchet', 1, { wood: 200, stone: 100 }, 6, 0], ['stone_pickaxe', 1, { wood: 200, stone: 100 }, 6, 0],
  ['bone_knife', 1, { bone: 30 }, 4, 0], ['hammer', 1, { wood: 100 }, 3, 0], ['plan', 1, { wood: 20 }, 2, 0], ['wooden_spear', 1, { wood: 300 }, 6, 0], ['stone_spear', 1, { wooden_spear: 1, stone: 40 }, 4, 0],
  ['bow', 1, { wood: 200, cloth: 50 }, 10, 0], ['arrow', 2, { wood: 25, stone: 10 }, 2, 0], ['bandage', 1, { cloth: 4 }, 2, 0], ['water_jug', 1, { hide: 10, cloth: 10 }, 4, 0],
  ['storage_box', 1, { wood: 100 }, 4, 0], ['sleeping_bag', 1, { cloth: 30 }, 4, 0], ['furnace', 1, { stone: 200, wood: 50 }, 8, 0], ['wooden_door', 1, { wood: 300 }, 6, 0],
  ['cloth_hood', 1, { cloth: 10 }, 3, 0], ['cloth_shirt', 1, { cloth: 20 }, 4, 0], ['cloth_pants', 1, { cloth: 20 }, 4, 0], ['hide_boots', 1, { hide: 10 }, 4, 0], ['hide_vest', 1, { hide: 20 }, 6, 0], ['hide_pants', 1, { hide: 15 }, 6, 0], ['bone_helmet', 1, { bone: 40, cloth: 10 }, 6, 0],
  ['workbench1', 1, { wood: 500, metal_frag: 100, scrap: 50 }, 15, 0],
  ['metal_hatchet', 1, { wood: 100, metal_frag: 75 }, 10, 1], ['metal_pickaxe', 1, { wood: 100, metal_frag: 125 }, 10, 1], ['machete', 1, { wood: 40, metal_frag: 80 }, 10, 1],
  ['crossbow', 1, { wood: 200, metal_frag: 75, rope: 2 }, 15, 1], ['medkit', 1, { cloth: 25, scrap: 15 }, 8, 1], ['large_box', 1, { wood: 250, metal_frag: 50 }, 10, 1], ['wood_armor', 1, { wood: 250, cloth: 20 }, 10, 1],
  ['metal_door', 1, { metal_frag: 150 }, 12, 1], ['sword', 1, { metal_frag: 120, rope: 1, wood: 30 }, 12, 1], ['revolver', 1, { metal_frag: 125, spring: 1, wood: 50 }, 15, 1],
  ['pistol_ammo', 6, { metal_frag: 10, scrap: 4 }, 3, 1], ['shotgun_shell', 4, { metal_frag: 12, scrap: 6 }, 3, 1], ['rifle_ammo', 6, { metal_frag: 15, scrap: 6 }, 3, 2],
  ['key_lock', 1, { metal_frag: 50, wood: 20 }, 5, 0], ['code_lock', 1, { metal_frag: 100, scrap: 10 }, 8, 1], ['base_core', 1, { wood: 600, stone: 100 }, 10, 0],
  ['high_wall_wood', 1, { wood: 800 }, 12, 0], ['high_wall_stone', 1, { stone: 900, wood: 100 }, 15, 1], ['wooden_gate', 1, { wood: 900, metal_frag: 50 }, 15, 1], ['watchtower', 1, { wood: 1200, rope: 2 }, 20, 1],
  ['powder', 10, { stone: 30, wood: 50 }, 3, 1], ['powder_bomb', 1, { powder: 60, cloth: 10, rope: 1 }, 8, 1], ['breach_charge', 1, { powder: 220, metal_frag: 100, scrap: 30 }, 20, 2],
  ['pump_shotgun', 1, { metal_frag: 300, spring: 1, wood: 75 }, 20, 2], ['semi_rifle', 1, { metal_frag: 450, spring: 2, scrap: 100 }, 25, 2], ['smg', 1, { metal_frag: 350, spring: 2, scrap: 80 }, 25, 2], ['assault_rifle', 1, { metal_frag: 600, spring: 4, scrap: 250, wood: 100 }, 40, 2], ['bolt_rifle', 1, { metal_frag: 500, spring: 3, scrap: 200, wood: 150 }, 40, 2], ['pistol', 1, { metal_frag: 200, spring: 1, scrap: 40 }, 18, 1], ['python', 1, { metal_frag: 380, spring: 2, scrap: 120 }, 28, 2], ['custom_smg', 1, { metal_frag: 220, spring: 1, scrap: 50 }, 20, 1], ['lr_rifle', 1, { metal_frag: 650, spring: 4, scrap: 300 }, 40, 2], ['l96_rifle', 1, { metal_frag: 700, spring: 4, scrap: 400 }, 50, 2], ['double_barrel', 1, { metal_frag: 180, wood: 100, scrap: 30 }, 18, 1], ['combat_knife', 1, { metal_frag: 60, cloth: 5 }, 10, 1], ['silencer', 1, { metal_frag: 120, scrap: 40 }, 15, 1], ['scope_8x', 1, { metal_frag: 150, scrap: 120 }, 25, 2], ['weapon_light', 1, { metal_frag: 60, scrap: 25 }, 12, 1], ['workbench2', 1, { wood: 500, metal_frag: 300, scrap: 150 }, 25, 1]
].map(([out, n, req, time, bench]) => ({ id: out, out, n, req, time, bench, cat: I[out].cat }));

// ---------- building pieces & tiers
export const TIERS = [
  { id: 0, name: ['قش', 'Twig'], hp: 10, cost: { wood: 50 }, col: [0.55, 0.42, 0.28] },
  { id: 1, name: ['خشب', 'Wood'], hp: 250, cost: { wood: 200 }, col: [0.52, 0.36, 0.22] },
  { id: 2, name: ['حجر', 'Stone'], hp: 500, cost: { stone: 300 }, col: [0.52, 0.51, 0.48] },
  { id: 3, name: ['حديد', 'Metal'], hp: 1000, cost: { metal_frag: 200 }, col: [0.42, 0.44, 0.46] }
];
export const PIECES = {
  foundation: { name: ['أساس', 'Foundation'], mult: 1, kind: 'cell' }, floor: { name: ['أرضية', 'Floor'], mult: 0.5, kind: 'cell' },
  wall: { name: ['جدار', 'Wall'], mult: 1, kind: 'edge' }, doorway: { name: ['فتحة باب', 'Doorway'], mult: 0.7, kind: 'edge' }, window: { name: ['جدار بشباك', 'Window Wall'], mult: 0.7, kind: 'edge' },
  roof: { name: ['سقف', 'Roof'], mult: 1, kind: 'cell' }, stairs: { name: ['درج', 'Stairs'], mult: 1, kind: 'cell' }, pillar: { name: ['عمود', 'Pillar'], mult: 0.3, kind: 'corner' }
};
export const PIECE_ORDER = ['foundation', 'wall', 'doorway', 'window', 'floor', 'stairs', 'roof', 'pillar'];
export const pieceCost = (piece, tier) => { const c = {}, T = TIERS[tier]; for (const k in T.cost) c[k] = Math.ceil(T.cost[k] * PIECES[piece].mult); return c; };
export const pieceHP = (piece, tier) => Math.ceil(TIERS[tier].hp * (PIECES[piece].kind === 'cell' ? 1.2 : 1) * (piece === 'pillar' ? 0.6 : 1));

// ---------- gathering
export const GATHER = {
  tree: { item: 'wood', per: 10, bonus: 40 }, rock: { item: 'stone', per: 14, bonus: 60 }, metal: { item: 'metal_ore', per: 9, bonus: 40, extra: ['stone', 6] }
};
export const PICKUP = { hemp: [['cloth', 10, 14]], berry: [['berries', 2, 4]], stump: [['wood', 25, 50]], stones: [['stone', 30, 50]] };
export const LOOT = {
  crate1: [['scrap', 6, 14, 1], ['cloth', 10, 30, 0.6], ['rope', 1, 2, 0.3], ['canned', 1, 2, 0.35], ['arrow', 4, 10, 0.3], ['bandage', 1, 2, 0.3], ['metal_frag', 20, 45, 0.35], ['stone_hatchet', 1, 1, 0.07], ['bow', 1, 1, 0.04]],
  crate2: [['scrap', 14, 30, 1], ['metal_frag', 40, 90, 0.6], ['rope', 1, 3, 0.5], ['spring', 1, 1, 0.2], ['medkit', 1, 1, 0.2], ['canned', 1, 3, 0.4], ['arrow', 8, 16, 0.4], ['machete', 1, 1, 0.06], ['crossbow', 1, 1, 0.03], ['metal_pickaxe', 1, 1, 0.04], ['revolver', 1, 1, 0.04], ['pistol_ammo', 6, 14, 0.25], ['shotgun_shell', 3, 8, 0.15], ['rifle_ammo', 4, 10, 0.1], ['spring', 1, 1, 0.15]],
  barrel: [['scrap', 3, 8, 1], ['metal_frag', 8, 22, 0.5], ['cloth', 5, 15, 0.35], ['canned', 1, 1, 0.15], ['rope', 1, 1, 0.12], ['arrow', 2, 6, 0.2], ['pistol_ammo', 2, 6, 0.1], ['spring', 1, 1, 0.04]]
};
export const ANIMAL_LOOT = { deer: [['raw_meat', 6], ['hide', 10], ['bone', 12]], boar: [['raw_meat', 8], ['hide', 6], ['bone', 10]], wolf: [['raw_meat', 4], ['hide', 8], ['bone', 10]], bear: [['raw_meat', 14], ['hide', 20], ['bone', 30]] };

export function rollLoot(table, rnd = Math.random) {
  const out = [];
  for (const [id, a, b, p] of LOOT[table]) if (rnd() < p) out.push({ id, n: a + Math.floor(rnd() * (b - a + 1)) });
  return out;
}
export const nameOf = (id, lang) => { const it = I[id]; return it ? it.name[lang === 'en' ? 1 : 0] : id; };

// ---------- base rules (shared by the client, the server and the survivors' AI)
/** core: building privilege radius · upkeep: every `every` s the core pays `frac` of the build cost of what it protects ·
 *  decay: unprotected pieces lose their whole health over `time[tier]` s once nobody has touched them for `grace` s */
export const BASE = { coreRadius: 30, upkeepEvery: 1200, upkeepFrac: 0.012, decayGrace: 1800, decayTime: [3600, 10800, 18000, 28800], deployDecay: 21600 };
export const deployHP = id => (I[id] && I[id].deploy && I[id].deploy.hp) || 100;
/** damage one explosive does to a target of material class `mat` (0..3) at `d` metres from the blast */
export function blastDamage(ex, mat, d) { if (d >= ex.radius) return 0; const k = d < 1 ? 1 : 1 - (d - 1) / (ex.radius - 1) * 0.75; return ex.dmg[Math.max(0, Math.min(3, mat | 0))] * k; }
/** what one upkeep period costs for a list of structures [{piece, tier}] */
export function upkeepCost(list) { const c = {}; for (const s of list) { const pc = pieceCost(s.piece, s.tier); for (const k in pc) c[k] = (c[k] || 0) + pc[k] * BASE.upkeepFrac; } for (const k in c) c[k] = Math.max(1, Math.ceil(c[k])); return c; }

// ------------------------------------------------------------------ ballistics (25 → 30: bullets fly, drop and take time to arrive)
/** recoil patterns: degrees [up, right] added by each shot of a burst, always the same for a weapon, so it can be learned. The last rows repeat. */
export const RECOIL = {
  revolver: [[3.0, 0.3], [3.2, -0.4], [3.1, 0.5]],
  pistol: [[1.5, 0.2], [1.6, -0.25], [1.5, 0.3], [1.6, -0.2]],
  lr: [[1.7, 0.1], [1.6, 0.3], [1.5, 0.5], [1.4, 0.6], [1.3, 0.4], [1.2, 0.0], [1.1, -0.4], [1.0, -0.7], [0.9, -0.7], [0.9, -0.4], [0.8, 0.1], [0.8, 0.5], [0.7, 0.6], [0.7, 0.3], [0.7, -0.2], [0.7, -0.5]],
  semi: [[1.7, 0.25], [1.6, -0.3], [1.7, 0.35], [1.6, -0.25]],
  shotgun: [[5.5, 0.6], [5.5, -0.6]],
  bolt: [[4.2, 0.4]],
  smg: [[1.1, 0.1], [1.0, 0.2], [0.95, 0.3], [0.9, 0.35], [0.85, 0.3], [0.8, 0.15], [0.8, -0.1], [0.75, -0.3], [0.7, -0.4], [0.7, -0.35], [0.65, -0.15], [0.65, 0.1], [0.6, 0.3], [0.6, 0.35], [0.6, 0.1], [0.6, -0.2]],
  ak: [[2.4, 0.2], [2.3, 0.5], [2.1, 0.8], [2.0, 1.0], [1.8, 1.1], [1.6, 0.8], [1.5, 0.2], [1.4, -0.6], [1.3, -1.2], [1.2, -1.5], [1.1, -1.4], [1.0, -1.0], [1.0, -0.3], [0.9, 0.5], [0.9, 1.1], [0.9, 1.3], [0.8, 1.0], [0.8, 0.3], [0.8, -0.5], [0.8, -1.1]]
};
/** where a hit landed, from its height on the body (0 feet … 1 top of the head): [zone, damage multiplier] */
export const hitZone = rel => rel > 0.865 ? ['head', 2] : rel > 0.5 ? ['chest', 1] : rel > 0.4 ? ['stomach', 0.9] : ['legs', 0.6];
export const BULLET_G = 9.8;

/** which attachments a gun takes, and what they change */
export const canAttach = (gunId, attId) => { const G = ITEMS[gunId], A = ITEMS[attId]; if (!G || !A || !A.attach || !G.ranged || !G.ranged.gun) return false; const Rg = G.ranged, long = !['pistol', 'python', 'revolver', 'double_barrel'].includes(gunId);
  if (A.attach === 'muzzle') return Rg.gun !== 'shotgun' && gunId !== 'revolver' && gunId !== 'python'; if (A.attach === 'sight') return long && !Rg.zoom && Rg.gun !== 'shotgun'; return true; };
export const hasMod = (it, id) => !!(it && it.mods && it.mods.includes(id));
