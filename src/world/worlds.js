// EMBERWING — the five worlds: mood, palette, layout, threats, story
import { hex } from '../core/math.js';
const H = hex;
export const WORLDS = [
  {
    id: 'dawn', name: 'ضفاف الفجر', en: 'DAWNMERE', seed: 1107, music: 'dawn',
    story: ['آخر جذوة في السماء… هذا أنت.', 'المنارات الخمس انطفت، والفراغ يأكل الجزر وحدة ورا وحدة.', 'اجمع الجمر، ودّه للمنارة، ولفّ حولها لين تشتعل.'],
    env: { skyTop: H('#3d6fb8'), skyHor: H('#ffc98f'), skyBot: H('#f2a873'), sun: [0.55, 0.32, -0.77], sunC: H('#ffd9a8'), amb: H('#8fb4e8'), gnd: H('#6b5a4a'), fogC: H('#f6c9a0'), fogN: 1800, fogF: 9000, seaY: -900, seaA: H('#e9b48c'), seaB: H('#fff1de'), grade: [1.06, 1.0, 0.94], sat: 1.12, con: 1.06, vig: 0.85, cloud: 0.45, bloom: 1.0 },
    pal: { grass: H('#7fb24a'), grass2: H('#a6c75a'), rock: H('#9c7b62'), rock2: H('#5e4a3d'), leaf: H('#5f9a3c'), leaf2: H('#e8a948'), trunk: H('#6a4a35'), accent: H('#ffd27a'), flower: H('#ff8f6b') },
    flora: 'round', islands: 15, spread: 3800, rings: 10, embers: 150, need: 60, stormT: 420, stormR0: 6200, stormR1: 1400,
    enemies: { drifter: 4, lancer: 0, leech: 0 }, waves: [['drifter', 2], ['drifter', 3]], medal: [160, 230, 320], tutorial: true
  },
  {
    id: 'glass', name: 'وديان الزجاج', en: 'GLASS CANYONS', seed: 2291, music: 'glass',
    story: ['المنارة الأولى ولّعت… والفراغ حس فيك.', 'في وديان الزجاج تسكن الرماح: تتوهج، تسدّد… ثم تنطلق.', 'لا توقف بخط مستقيم.'],
    env: { skyTop: H('#2a5fd0'), skyHor: H('#a8e3ff'), skyBot: H('#7cc4ee'), sun: [-0.4, 0.6, -0.69], sunC: H('#fff6e6'), amb: H('#9ad0ff'), gnd: H('#4b5e79'), fogC: H('#bfe7ff'), fogN: 2200, fogF: 10000, seaY: -1000, seaA: H('#9fd0f0'), seaB: H('#f2fbff'), grade: [0.97, 1.01, 1.07], sat: 1.15, con: 1.08, vig: 0.8, cloud: 0.35, bloom: 0.85 },
    pal: { grass: H('#6fb7a8'), grass2: H('#9ad6c6'), rock: H('#8b9bb5'), rock2: H('#4b5874'), leaf: H('#7fe0ff'), leaf2: H('#c9a7ff'), trunk: H('#5d6b88'), accent: H('#9ef0ff'), flower: H('#b6f3ff') },
    flora: 'crystal', islands: 17, spread: 4200, rings: 12, embers: 170, need: 80, stormT: 380, stormR0: 6600, stormR1: 1400,
    enemies: { drifter: 5, lancer: 4, leech: 0 }, waves: [['drifter', 2], ['lancer', 2], ['drifter', 3]], medal: [190, 270, 360]
  },
  {
    id: 'thunder', name: 'مدى الرعد', en: 'THUNDER REACH', seed: 3517, music: 'thunder',
    story: ['السماء هنا غضبانة.', 'الصواعق تنزل وين ما تشوف دايرة ضوء — ابعد عنها.', 'والعلق… يتعلق فيك ويسرق جمرك. انفض عنك بالاندفاع أو بالوهج.'],
    env: { skyTop: H('#1b2236'), skyHor: H('#5d6a86'), skyBot: H('#3a4258'), sun: [0.2, 0.5, -0.84], sunC: H('#c7d4ff'), amb: H('#6b7ba8'), gnd: H('#2e3242'), fogC: H('#59647e'), fogN: 1200, fogF: 7000, seaY: -1000, seaA: H('#3c4560'), seaB: H('#7b88a6'), grade: [0.95, 0.98, 1.08], sat: 0.95, con: 1.12, vig: 1.1, cloud: 0.8, bloom: 1.25 },
    pal: { grass: H('#4f6b5c'), grass2: H('#64806e'), rock: H('#5b6070'), rock2: H('#2c2f3a'), leaf: H('#3f5048'), leaf2: H('#7cf0ff'), trunk: H('#2e2a2a'), accent: H('#9fd7ff'), flower: H('#d6f4ff') },
    flora: 'dead', islands: 17, spread: 4300, rings: 12, embers: 180, need: 100, stormT: 360, stormR0: 6600, stormR1: 1300,
    enemies: { drifter: 6, lancer: 3, leech: 4 }, waves: [['leech', 2], ['drifter', 3], ['lancer', 2]], lightning: true, medal: [210, 300, 400]
  },
  {
    id: 'ash', name: 'غابة الرماد', en: 'ASHWOOD', seed: 4733, music: 'ash',
    story: ['الغابة تحترق… بس هذي مو نارك.', 'الفراغ يحاول يطفّي آخر شجر حي.', 'أسرع — الأمواج هنا أكثف.'],
    env: { skyTop: H('#3a1d3d'), skyHor: H('#ff7a45'), skyBot: H('#a8442c'), sun: [0.75, 0.12, -0.65], sunC: H('#ff9a5c'), amb: H('#b06a7a'), gnd: H('#3a2420'), fogC: H('#d0623d'), fogN: 1300, fogF: 7600, seaY: -950, seaA: H('#7a2e26'), seaB: H('#ff9b62'), grade: [1.1, 0.96, 0.9], sat: 1.15, con: 1.1, vig: 1.0, cloud: 0.55, bloom: 1.3 },
    pal: { grass: H('#5c4a35'), grass2: H('#7a5a3a'), rock: H('#6a4b42'), rock2: H('#2e1f1d'), leaf: H('#ff7a2e'), leaf2: H('#ffcf5a'), trunk: H('#2a1c18'), accent: H('#ffb15a'), flower: H('#ff6a3a') },
    flora: 'burning', islands: 18, spread: 4400, rings: 12, embers: 200, need: 120, stormT: 340, stormR0: 6800, stormR1: 1300,
    enemies: { drifter: 8, lancer: 4, leech: 3 }, waves: [['drifter', 4], ['lancer', 3], ['leech', 2], ['drifter', 4]], medal: [230, 320, 430]
  },
  {
    id: 'hollow', name: 'تاج الفراغ', en: 'HOLLOW CROWN', seed: 5939, music: 'hollow',
    story: ['هنا قلب الفراغ.', 'الفم الأجوف يحرس آخر منارة.', 'لما تتوهج نواته… اخترقها بالاندفاع. ثلاث مرات. وبعدها… الفجر.'],
    env: { skyTop: H('#05040d'), skyHor: H('#2a1446'), skyBot: H('#120a20'), sun: [-0.3, 0.45, -0.84], sunC: H('#b79cff'), amb: H('#5a4a8f'), gnd: H('#1a1426'), fogC: H('#1e1236'), fogN: 1500, fogF: 8200, seaY: -1100, seaA: H('#0b0716'), seaB: H('#3a2066'), grade: [0.98, 0.95, 1.1], sat: 1.1, con: 1.12, vig: 1.15, cloud: 0.3, bloom: 1.4, stars: 1 },
    pal: { grass: H('#2e2848'), grass2: H('#3d3560'), rock: H('#3a3350'), rock2: H('#120e1c'), leaf: H('#7a4dff'), leaf2: H('#ff5ad1'), trunk: H('#1a1426'), accent: H('#b28cff'), flower: H('#8af0ff') },
    flora: 'void', islands: 16, spread: 4200, rings: 10, embers: 200, need: 120, stormT: 400, stormR0: 6400, stormR1: 1500,
    enemies: { drifter: 8, lancer: 5, leech: 4 }, waves: [['drifter', 3], ['lancer', 3], ['leech', 3]], boss: true, medal: [300, 420, 560]
  }
];
export const DIFF = {
  story: { name: 'قصة', dmg: 0.5, enemy: 0.7, storm: 1.35, needK: 0.8 },
  normal: { name: 'عادي', dmg: 1, enemy: 1, storm: 1, needK: 1 },
  hard: { name: 'صعب', dmg: 1.5, enemy: 1.3, storm: 0.85, needK: 1.15 }
};
export const UPGRADES = [
  { id: 'wing', name: 'أجنحة', desc: 'قدرة تحمّل أكثر للرفرفة', cost: [60, 120, 220, 360], icon: '🪶' },
  { id: 'heart', name: 'قلب النار', desc: 'لهب (صحة) أكثر', cost: [80, 160, 280, 420], icon: '❤️‍🔥' },
  { id: 'dash', name: 'الاندفاع', desc: 'الاندفاع يرجع أسرع', cost: [70, 140, 250, 380], icon: '⚡' },
  { id: 'flare', name: 'الوهج', desc: 'دائرة الوهج أكبر وأقوى', cost: [70, 150, 260, 400], icon: '☀️' },
  { id: 'magnet', name: 'المغناطيس', desc: 'تجذب الجمر من مسافة أبعد', cost: [50, 110, 200, 320], icon: '🧲' }
];
