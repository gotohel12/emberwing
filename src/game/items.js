// ARVEX SURVIVAL — item database, recipes, gather tables, loot tables (pure data, shared with the server)
// name/desc are [arabic, english]
export const CATS = ['resource', 'tool', 'weapon', 'ammo', 'build', 'deploy', 'cloth', 'medical', 'food', 'comp'];
export const CAT_NAMES = {
  all: ['الكل', 'All'], resource: ['موارد', 'Resources'], tool: ['أدوات', 'Tools'], weapon: ['أسلحة', 'Weapons'], ammo: ['ذخيرة', 'Ammo'], build: ['بناء', 'Construction'],
  deploy: ['معدّات', 'Items'], cloth: ['ملابس', 'Clothing'], medical: ['طبي', 'Medical'], food: ['أكل', 'Food'], comp: ['قطع', 'Components']
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
def('campfire', 'deploy', ['نار مخيم', 'Campfire'], ['اطبخ اللحم وتدفّى. حط فيها خشب كوقود.', 'Cook meat and warm up. Add wood as fuel.'], { deploy: { kind: 'campfire', slots: 5, r: 0.7 } });
def('furnace', 'deploy', ['فرن', 'Furnace'], ['يذوّب خام الحديد. يحتاج خشب.', 'Smelts metal ore. Needs wood.'], { deploy: { kind: 'furnace', slots: 6, r: 0.8 } });
def('storage_box', 'deploy', ['صندوق تخزين', 'Storage Box'], ['خزّن أغراضك (12 خانة).', 'Store your items (12 slots).'], { deploy: { kind: 'box', slots: 12, r: 0.6 } });
def('large_box', 'deploy', ['صندوق كبير', 'Large Box'], ['تخزين كبير (30 خانة).', 'Large storage (30 slots).'], { deploy: { kind: 'box', slots: 30, r: 0.9, big: true } });
def('workbench1', 'deploy', ['طاولة عمل 1', 'Workbench Lv.1'], ['تفتح وصفات متقدمة لما تكون قريب منها.', 'Unlocks advanced recipes while you stand near it.'], { deploy: { kind: 'bench', level: 1, r: 1 } });
def('workbench2', 'deploy', ['طاولة عمل 2', 'Workbench Lv.2'], ['أعلى مستوى صناعة.', 'The highest crafting tier.'], { deploy: { kind: 'bench', level: 2, r: 1.1 } });
def('sleeping_bag', 'deploy', ['كيس نوم', 'Sleeping Bag'], ['نقطة رجوع بعد الموت.', 'A respawn point after death.'], { deploy: { kind: 'bag', r: 0.5 } });
def('wooden_door', 'deploy', ['باب خشبي', 'Wooden Door'], ['ركّبه في فتحة باب.', 'Fits into a doorway.'], { deploy: { kind: 'door', tier: 1 } });
def('metal_door', 'deploy', ['باب حديد', 'Metal Door'], ['باب قوي.', 'A strong door.'], { deploy: { kind: 'door', tier: 3 } });

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
  ['metal_door', 1, { metal_frag: 150 }, 12, 1], ['workbench2', 1, { wood: 500, metal_frag: 300, scrap: 150 }, 25, 1]
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
  crate2: [['scrap', 14, 30, 1], ['metal_frag', 40, 90, 0.6], ['rope', 1, 3, 0.5], ['spring', 1, 1, 0.2], ['medkit', 1, 1, 0.2], ['canned', 1, 3, 0.4], ['arrow', 8, 16, 0.4], ['machete', 1, 1, 0.06], ['crossbow', 1, 1, 0.03], ['metal_pickaxe', 1, 1, 0.04]],
  barrel: [['scrap', 3, 8, 1], ['metal_frag', 8, 22, 0.5], ['cloth', 5, 15, 0.35], ['canned', 1, 1, 0.15], ['rope', 1, 1, 0.12], ['arrow', 2, 6, 0.2]]
};
export const ANIMAL_LOOT = { deer: [['raw_meat', 6], ['hide', 10], ['bone', 12]], boar: [['raw_meat', 8], ['hide', 6], ['bone', 10]], wolf: [['raw_meat', 4], ['hide', 8], ['bone', 10]], bear: [['raw_meat', 14], ['hide', 20], ['bone', 30]] };

export function rollLoot(table, rnd = Math.random) {
  const out = [];
  for (const [id, a, b, p] of LOOT[table]) if (rnd() < p) out.push({ id, n: a + Math.floor(rnd() * (b - a + 1)) });
  return out;
}
export const nameOf = (id, lang) => { const it = I[id]; return it ? it.name[lang === 'en' ? 1 : 0] : id; };
