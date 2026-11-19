// EMBERWING — interface: title, worlds, Aerie, settings, story, pause, results, HUD, touch controls, notifications
import { WORLDS, DIFF, UPGRADES } from '../world/worlds.js';
import { SKINS } from '../gfx/models.js';
import { ACTION_NAMES } from '../input/input.js';
import { project } from '../core/math.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = t => { t = Math.max(0, t); const m = Math.floor(t / 60), s = Math.floor(t % 60); return `${m}:${String(s).padStart(2, '0')}`; };
const MEDAL = { gold: ['🥇', 'ذهبية'], silver: ['🥈', 'فضية'], bronze: ['🥉', 'برونزية'] };

const CREST = `<svg class="crest" viewBox="0 0 200 200" aria-hidden="true"><defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff3c4"/><stop offset=".45" stop-color="#ffb347"/><stop offset="1" stop-color="#e2461b"/></linearGradient><radialGradient id="cr" cx=".5" cy=".55" r=".5"><stop offset="0" stop-color="#ffcf6b" stop-opacity=".55"/><stop offset="1" stop-color="#ff5a1f" stop-opacity="0"/></radialGradient></defs>
<circle cx="100" cy="104" r="96" fill="url(#cr)"/>
<path fill="url(#cg)" d="M100 34c9 16 10 30 4 44 15-14 34-19 58-14-18 6-30 16-37 30 18-6 34-4 48 6-22 0-37 7-46 20 10 2 18 8 22 18-12-6-24-6-33 0l-7 30-7-30c-9-6-21-6-33 0 4-10 12-16 22-18-9-13-24-20-46-20 14-10 30-12 48-6-7-14-19-24-37-30 24-5 43 0 58 14-6-14-5-28 4-44z"/>
<circle cx="100" cy="84" r="6" fill="#fff8e0"/></svg>`;
const LOGO = `<div class="logo">${CREST}<div class="wm"><span class="w1">EMBER</span><span class="w2">WING</span></div><div class="tag">آخر جناح يحمل النار</div></div>`;

export class UI {
  constructor(app) {
    this.app = app; this.root = $('#ui'); this.hudEl = $('#hud'); this.screen = null; this.focus = 0; this.stack = [];
    this.toastBox = $('#toasts'); this.bannerEl = $('#banner');
    this.root.addEventListener('click', e => { const b = e.target.closest('[data-a]'); if (!b || b.disabled) return; this.app.audio.init(); this.app.audio.play(b.dataset.a === 'back' ? 'uiback' : 'ui'); this.act(b.dataset.a, b.dataset.v, b); });
    this.root.addEventListener('input', e => { const s = e.target.closest('[data-s]'); if (s) this.setSetting(s.dataset.s, s.type === 'checkbox' ? s.checked : s.type === 'range' ? +s.value : s.value, s); });
    this.root.addEventListener('mouseover', e => { const b = e.target.closest('.f'); if (b) { const list = this.focusables(); const i = list.indexOf(b); if (i >= 0 && i !== this.focus) { this.focus = i; this.paintFocus(false); } } });
    this.buildTouch();
  }
  // ------------------------------------------------------------ helpers
  show(name, html, cls = '') {
    this.screen = name; this.root.className = 'on ' + cls; this.root.innerHTML = `<div class="scr scr-${name}">${html}</div>`;
    this.focus = 0; this.paintFocus(false); this.root.scrollTop = 0;
  }
  hide() { this.screen = null; this.root.className = ''; this.root.innerHTML = ''; }
  focusables() { return [...this.root.querySelectorAll('.f:not([disabled])')]; }
  paintFocus(scroll = true) { const L = this.focusables(); L.forEach((b, i) => b.classList.toggle('foc', i === this.focus && this.app.input.device === 'pad')); if (scroll && L[this.focus]) L[this.focus].scrollIntoView({ block: 'nearest' }); }
  nav(n) {
    if (!this.screen) return;
    const L = this.focusables(); if (!L.length) return;
    if (n.up || n.down) { this.focus = (this.focus + (n.down ? 1 : -1) + L.length) % L.length; this.app.audio.play('ui'); this.paintFocus(); }
    const cur = L[this.focus];
    if ((n.left || n.right) && cur) {
      if (cur.type === 'range') { const st = +cur.step || 1; cur.value = +cur.value + (n.right ? st : -st); cur.dispatchEvent(new Event('input', { bubbles: true })); }
      else if (cur.tagName === 'SELECT') { cur.selectedIndex = Math.max(0, Math.min(cur.options.length - 1, cur.selectedIndex + (n.right ? 1 : -1))); cur.dispatchEvent(new Event('input', { bubbles: true })); }
      else if (cur.dataset.lr) { this.act(cur.dataset.lr, n.right ? '1' : '-1', cur); }
    }
    if (n.ok && cur) { if (cur.type === 'checkbox') { cur.checked = !cur.checked; cur.dispatchEvent(new Event('input', { bubbles: true })); } else cur.click(); }
    if (n.back) { const b = this.root.querySelector('[data-a=back]'); if (b) b.click(); }
  }
  btn(a, label, sub = '', v = '', cls = '') { return `<button class="b f ${cls}" data-a="${a}" data-v="${esc(v)}"><span class="bl">${label}</span>${sub ? `<span class="bs">${sub}</span>` : ''}</button>`; }
  back() { return `<button class="b f back" data-a="back">→ رجوع</button>`; }
  toast(text, kind = '') {
    const t = document.createElement('div'); t.className = 'toast ' + kind; t.textContent = text; this.toastBox.appendChild(t);
    while (this.toastBox.children.length > 3) this.toastBox.firstChild.remove();
    setTimeout(() => t.classList.add('out'), 2600); setTimeout(() => t.remove(), 3100);
  }
  banner(en, ar) { const b = this.bannerEl; b.innerHTML = `<div class="be">${esc(en)}</div><div class="ba">${esc(ar)}</div>`; b.className = 'show'; clearTimeout(this._bt); this._bt = setTimeout(() => b.className = '', 3200); }
  confirm(title, text, yes, no = () => {}) {
    const prev = this.root.innerHTML, prevScreen = this.screen, prevCls = this.root.className;
    this.show('confirm', `<div class="panel narrow"><h2>${title}</h2><p class="mut">${text}</p><div class="row">${this.btn('cy', 'نعم', '', '', 'pri')}${this.btn('cn', 'لا')}</div></div>`, prevCls.replace('on', ''));
    this._confirm = ok => { this.root.innerHTML = prev; this.screen = prevScreen; this.root.className = prevCls; this.focus = 0; this.paintFocus(false); (ok ? yes : no)(); };
  }
  // ------------------------------------------------------------ screens
  loading(p, tip) {
    if (this.screen !== 'loading') this.show('loading', `${LOGO}<div class="loadbar"><i></i></div><div class="tip mut"></div>`, 'dark');
    $('.loadbar i', this.root).style.width = Math.round(p * 100) + '%'; if (tip) $('.tip', this.root).textContent = tip;
  }
  title() {
    const S = this.app.save, cont = S.worlds.some(w => w && w.done) || S.seenIntro;
    const next = this.app.nextWorld();
    this.show('title', `<div class="titlewrap">${LOGO}<nav class="menu">
      ${cont ? this.btn('continue', 'متابعة', `${WORLDS[next].name} • ${WORLDS[next].en}`, '', 'pri') : ''}
      ${this.btn('new', cont ? 'لعبة جديدة' : 'ابدأ الرحلة', cont ? 'يمسح التقدم الحالي' : 'العالم الأول: ضفاف الفجر', '', cont ? '' : 'pri')}
      ${this.btn('worlds', 'العوالم', 'اختر أي عالم فتحته')}
      ${this.btn('aerie', 'العُش', `ترقيات وريش • 🔥 ${S.wallet}`)}
      ${this.btn('settings', 'الإعدادات')}
      ${this.btn('credits', 'الصنّاع')}
      ${this.app.isDesktop ? this.btn('quit', 'خروج') : ''}
    </nav><div class="foot"><span>© 2026 <b>Mohsen ~ Danial</b></span><span class="ver">v${this.app.VERSION}</span></div>
    <div class="padinfo">${this.padText()}</div></div>`, 'title');
  }
  padText() { const I = this.app.input; return I.padSeen ? `🎮 ${I.padSony ? 'PlayStation' : 'Xbox / يد تحكم'} متصلة` : (I.isTouch() ? '' : '🎮 وصّل يد تحكم واضغط أي زر'); }
  worlds() {
    const S = this.app.save;
    const cards = WORLDS.map((W, i) => {
      const r = S.worlds[i] || {}, locked = i > 0 && !(S.worlds[i - 1] && S.worlds[i - 1].done);
      const fe = (r.feathers || [false, false, false]).map(x => x ? '🪶' : '<i class="dim">🪶</i>').join('');
      return `<button class="wcard f ${locked ? 'locked' : ''} w-${W.id}" data-a="${locked ? 'lockedw' : 'pickw'}" data-v="${i}">
        <div class="wn">${i + 1}</div><div class="wt"><b>${W.name}</b><span>${W.en}</span></div>
        <div class="wm">${locked ? '🔒 خلّص العالم اللي قبله' : `${r.done ? '✓ مكتمل' : 'جديد'} • ${fe} • ${r.medal ? MEDAL[r.medal][0] : '—'} • ${r.best ? fmt(r.best) : '--:--'}`}</div></button>`;
    }).join('');
    this.show('worlds', `<div class="panel wide"><div class="hd"><h2>العوالم <small>WORLDS</small></h2>${this.back()}</div>
      <div class="diffrow"><span>الصعوبة:</span>${Object.entries(DIFF).map(([k, d]) => `<button class="chip f ${S.diff === k ? 'on' : ''}" data-a="diff" data-v="${k}">${d.name}</button>`).join('')}</div>
      <div class="wgrid">${cards}</div></div>`);
  }
  aerie() {
    const S = this.app.save;
    const ups = UPGRADES.map(u => { const lv = S.up[u.id], max = lv >= u.cost.length, c = u.cost[lv]; return `<div class="up"><div class="ui">${u.icon}</div><div class="ut"><b>${u.name}</b><span class="mut">${u.desc}</span><div class="pips">${u.cost.map((_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('')}</div></div>
      <button class="b f sm ${!max && S.wallet >= c ? 'pri' : ''}" data-a="buy" data-v="${u.id}" ${max ? 'disabled' : ''}>${max ? 'كامل' : `🔥 ${c}`}</button></div>`; }).join('');
    const skins = SKINS.map(k => { const own = S.skins.includes(k.id), on = S.skin === k.id; const col = `linear-gradient(135deg, rgb(${k.tip.map(x => x * 255 | 0)}), rgb(${k.body.map(x => x * 255 | 0)}))`;
      return `<button class="skin f ${on ? 'on' : ''}" data-a="skin" data-v="${k.id}"><i style="background:${col}"></i><b>${k.name}</b><span>${on ? 'مختار' : own ? 'اختر' : `🔥 ${k.cost}`}</span></button>`; }).join('');
    this.show('aerie', `<div class="panel wide"><div class="hd"><h2>العُش <small>THE AERIE</small></h2><div class="wallet">🔥 ${S.wallet}</div>${this.back()}</div>
      <p class="mut">الجمر اللي تجمعه بالعوالم يصير رصيدك هنا. قوّ إمبر قبل العوالم الصعبة.</p>
      <div class="ups">${ups}</div><h3>ريش إمبر</h3><div class="skins">${skins}</div></div>`);
  }
  credits() {
    this.show('credits', `<div class="panel narrow center">${LOGO}<div class="credits">
      <div><span>تطوير وتصميم</span><b class="big">Mohsen ~ Danial</b></div>
      <div><span>المحرك</span><b>EMBER Engine — WebGL مكتوب من الصفر</b></div>
      <div><span>الموسيقى والأصوات</span><b>مولّدة إجرائيًا بـ WebAudio</b></div>
      <div><span>الخطوط</span><b>Cardo & Fira Sans (SIL OFL)</b></div>
      <div><span>شكر خاص</span><b>لكل من يلعب ويشارك اللعبة</b></div></div>${this.back()}</div>`, 'dark');
  }
  story(idx, done) {
    const W = WORLDS[idx]; let i = 0;
    const draw = () => {
      this.show('story', `<div class="story w-${W.id}"><div class="sw">${idx + 1} / ${WORLDS.length} — ${W.en}</div><h1>${W.name}</h1>
        <p class="line">${esc(W.story[i])}</p><div class="dots">${W.story.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</div>
        <div class="row">${this.btn('storynext', i < W.story.length - 1 ? 'التالي' : 'انطلق!', '', '', 'pri')}${this.btn('storyskip', 'تخطي')}</div></div>`, 'dark');
    };
    this._story = { next: () => { i++; if (i >= W.story.length) done(); else draw(); }, skip: done };
    draw();
  }
  pause() {
    this.show('pause', `<div class="panel narrow"><h2>متوقف مؤقتًا <small>PAUSED</small></h2><nav class="menu">
      ${this.btn('resume', 'كمّل', '', '', 'pri')}${this.btn('restart', 'أعد العالم من البداية')}${this.btn('settings', 'الإعدادات')}${this.btn('controls', 'طريقة التحكم')}${this.btn('quitlevel', 'القائمة الرئيسية')}</nav></div>`, 'dim');
  }
  controlsHelp() {
    const I = this.app.input, k = a => I.binds[a].map(c => `<kbd>${I.keyName(c)}</kbd>`).join(' ');
    this.show('help', `<div class="panel"><div class="hd"><h2>التحكم <small>CONTROLS</small></h2>${this.back()}</div>
      <table class="ctl"><tr><th></th><th>كيبورد وماوس</th><th>يد تحكم</th><th>جوال</th></tr>
      <tr><td>التوجيه</td><td>الماوس أو ${k('left')} ${k('right')} ${k('up')} ${k('down')}</td><td>العصا اليسرى</td><td>العصا</td></tr>
      <tr><td>رفرفة / طيران لفوق</td><td>${k('flap')}</td><td>A / ✕</td><td>رفرفة</td></tr>
      <tr><td>غطس سريع</td><td>${k('dive')}</td><td>LT / L2</td><td>غطس</td></tr>
      <tr><td>اندفاع ناري</td><td>${k('dash')}</td><td>RB / R1 أو X / ▢</td><td>اندفاع</td></tr>
      <tr><td>وهج النور (5 جمرات)</td><td>${k('flare')}</td><td>B / ◯ أو LB / L1</td><td>وهج</td></tr>
      <tr><td>إيقاف</td><td>${k('pause')}</td><td>Start / Options</td><td>❚❚</td></tr></table>
      <p class="mut">نصيحة: اغطس عشان تجمع سرعة، وبعدين ارفع خشمك تطلع فوق بدون ما تصرف قدرة تحمّل. إذا نزلت على جزيرة تستريح وترجع قدرة التحمل بسرعة.</p></div>`);
  }
  results(r, W, isLast) {
    const m = r.medal ? MEDAL[r.medal] : null;
    this.show('results', `<div class="panel narrow center res"><div class="sw">${W.en}</div><h1>المنارة اشتعلت</h1>
      <div class="medal ${r.medal || 'none'}">${m ? m[0] : '🔥'}<span>${m ? 'ميدالية ' + m[1] : 'أسرع عشان تاخذ ميدالية'}</span></div>
      <div class="stats"><div><b>${fmt(r.time)}</b><span>الوقت</span></div><div><b>${r.collected}</b><span>جمر</span></div><div><b>${r.feathers.filter(Boolean).length}/3</b><span>ريش</span></div><div><b>${r.kills}</b><span>أعداء</span></div></div>
      <div class="reward">+🔥 ${r.reward} <small>للعُش${r.bonus ? ` (منها ${r.bonus} مكافأة ميدالية)` : ''}</small></div>
      <p class="mut">ذهبي: ${fmt(W.medal[0])} • فضي: ${fmt(W.medal[1])} • برونزي: ${fmt(W.medal[2])}</p>
      <nav class="menu">${isLast ? this.btn('ending', 'النهاية', '', '', 'pri') : this.btn('nextw', 'العالم التالي', WORLDS[r.idx + 1].name, '', 'pri')}${this.btn('retry', 'أعد المحاولة')}${this.btn('aerie', 'العُش')}${this.btn('menu', 'القائمة')}</nav></div>`, 'dim');
  }
  ending() {
    this.show('ending', `<div class="story"><div class="sw">EPILOGUE</div><h1>الفجر</h1><p class="line">المنارات الخمس تضوي من جديد. الفراغ رجع للظلام اللي جا منه.</p>
      <p class="line">والسماء… صار فيها نار من جديد.</p><p class="mut">شكرًا إنك لعبت EMBERWING — من Mohsen ~ Danial</p>
      <div class="row">${this.btn('credits', 'الصنّاع', '', '', 'pri')}${this.btn('menu', 'القائمة')}</div></div>`, 'dark');
  }
  settings(tab = 'gfx') {
    const S = this.app.S, I = this.app.input;
    const sl = (k, l, min, max, st, o = S, hint = '') => `<label class="set"><span>${l}${hint ? `<small>${hint}</small>` : ''}</span><input class="f" type="range" min="${min}" max="${max}" step="${st}" value="${o[k]}" data-s="${o === I.set ? 'I.' : ''}${k}"><em>${(+o[k]).toFixed(st < 1 ? 2 : 0)}</em></label>`;
    const tg = (k, l, o = S, hint = '') => `<label class="set"><span>${l}${hint ? `<small>${hint}</small>` : ''}</span><input class="f" type="checkbox" ${o[k] ? 'checked' : ''} data-s="${o === I.set ? 'I.' : ''}${k}"></label>`;
    const sel = (k, l, opts) => `<label class="set"><span>${l}</span><select class="f" data-s="${k}">${opts.map(([v, t]) => `<option value="${v}" ${S[k] === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>`;
    let body = '';
    if (tab === 'gfx') body = sel('preset', 'جودة الرسوم', [['low', 'منخفضة'], ['medium', 'متوسطة'], ['high', 'عالية'], ['ultra', 'فائقة'], ['custom', 'مخصّصة']])
      + sl('scale', 'دقة العرض', 0.5, 1, 0.05, S, '1 = كامل الدقة') + sl('maxDpr', 'حد كثافة البكسل', 1, 2, 0.25, S, '2 = شاشات 2K/4K حادة') + tg('bloom', 'التوهج (Bloom)') + sl('particles', 'كمية الجزيئات', 0.25, 1.5, 0.05) + tg('showFps', 'عرض FPS');
    else if (tab === 'audio') body = sl('master', 'الصوت العام', 0, 1, 0.05) + sl('music', 'الموسيقى', 0, 1, 0.05) + sl('sfx', 'المؤثرات', 0, 1, 0.05) + sl('amb', 'الأجواء والرياح', 0, 1, 0.05);
    else if (tab === 'controls') {
      const pads = I.pads();
      body = `<div class="padbox">${pads.length ? pads.map(p => `🎮 <b>${p.sony ? 'PlayStation' : 'Xbox / Generic'}</b> <span class="mut">${esc(p.id.slice(0, 48))}</span>`).join('<br>') : '🎮 ما فيه يد متصلة — وصّلها واضغط أي زر فيها (لازم تفتح اللعبة من الرابط أو البرنامج، مو من ملف)'}</div>`
        + sl('sens', 'الحساسية', 0.4, 2, 0.05, I.set) + tg('invertY', 'عكس المحور العمودي', I.set) + sl('deadzone', 'المنطقة الميتة لليد', 0.05, 0.4, 0.01, I.set) + tg('mouseSteer', 'التوجيه بالماوس', I.set, 'يقفل المؤشر داخل اللعبة') + tg('vib', 'الاهتزاز', I.set)
        + `<h3>أزرار الكيبورد <small>اضغط على الزر وبعدين المفتاح الجديد</small></h3><div class="binds">${Object.keys(ACTION_NAMES).map(a => `<div class="bind"><span>${ACTION_NAMES[a]}</span><button class="b f sm" data-a="rebind" data-v="${a}">${I.binds[a].map(c => I.keyName(c)).join(' / ')}</button></div>`).join('')}</div>${this.btn('resetbinds', 'رجّع الأزرار الافتراضية')}`
        + sl('touchSize', 'حجم أزرار الجوال', 0.7, 1.4, 0.05);
    } else if (tab === 'game') body = `<label class="set"><span>الصعوبة</span><select class="f" data-s="diff">${Object.entries(DIFF).map(([k, d]) => `<option value="${k}" ${this.app.save.diff === k ? 'selected' : ''}>${d.name}</option>`).join('')}</select></label>` + tg('hints', 'تلميحات التعليم') + tg('shake', 'اهتزاز الكاميرا') + `${this.btn('wipe', 'امسح كل التقدم', 'ما يمكن التراجع')}`;
    else body = tg('flashes', 'ومضات الشاشة', S, 'طفّها لو الضوء القوي يزعجك') + sl('uiScale', 'حجم الواجهة والنصوص', 0.85, 1.35, 0.05) + tg('hiContrast', 'واجهة عالية التباين') + tg('subtitles', 'إظهار رسائل الأحداث');
    const tabs = [['gfx', 'الرسوم'], ['audio', 'الصوت'], ['controls', 'التحكم'], ['game', 'اللعب'], ['access', 'سهولة الوصول']];
    this.show('settings', `<div class="panel wide"><div class="hd"><h2>الإعدادات <small>SETTINGS</small></h2>${this.back()}</div>
      <div class="tabs">${tabs.map(([k, l]) => `<button class="chip f ${tab === k ? 'on' : ''}" data-a="tab" data-v="${k}">${l}</button>`).join('')}</div><div class="setbody">${body}</div></div>`, this.app.level ? 'dim' : '');
    this.tab = tab;
  }
  setSetting(k, v, el) {
    const app = this.app;
    if (k.startsWith('I.')) { app.input.set[k.slice(2)] = v; }
    else if (k === 'diff') { app.save.diff = v; app.persist(); }
    else { app.S[k] = v; if (['scale', 'maxDpr', 'bloom', 'particles'].includes(k)) app.S.preset = 'custom'; if (k === 'preset') app.applyPreset(v); }
    if (el && el.nextElementSibling && el.nextElementSibling.tagName === 'EM') el.nextElementSibling.textContent = (+v).toFixed(+el.step < 1 ? 2 : 0);
    app.applySettings(); app.persist();
    if (k === 'preset') this.settings('gfx');
  }
  // ------------------------------------------------------------ actions
  act(a, v, el) {
    const app = this.app;
    switch (a) {
      case 'back': app.back(); break;
      case 'continue': app.playWorld(app.nextWorld()); break;
      case 'new': if (app.save.worlds.some(w => w && w.done)) this.confirm('لعبة جديدة؟', 'بيمسح العوالم والترقيات والريش اللي جمعتها.', () => { app.newGame(); }, () => {}); else app.newGame(); break;
      case 'cy': this._confirm && this._confirm(true); break;
      case 'cn': this._confirm && this._confirm(false); break;
      case 'worlds': app.go('worlds'); break;
      case 'aerie': app.go('aerie'); break;
      case 'settings': app.go('settings'); break;
      case 'credits': app.go('credits'); break;
      case 'controls': app.go('help'); break;
      case 'quit': app.quit(); break;
      case 'pickw': app.playWorld(+v); break;
      case 'lockedw': app.audio.play('fail'); this.toast('خلّص العالم اللي قبله أول', 'warn'); break;
      case 'diff': app.save.diff = v; app.persist(); this.worlds(); break;
      case 'buy': app.buy(v); break;
      case 'skin': app.skin(v); break;
      case 'tab': this.settings(v); break;
      case 'rebind': el.textContent = 'اضغط مفتاح…'; app.input.capture = code => { if (code !== 'Escape') app.input.binds[v] = [code]; app.persist(); this.settings('controls'); }; break;
      case 'resetbinds': app.input.resetBinds(); app.persist(); this.settings('controls'); break;
      case 'wipe': this.confirm('متأكد؟', 'بيمسح كل شي: العوالم، الريش، الترقيات والرصيد.', () => { app.wipe(); }); break;
      case 'storynext': this._story && this._story.next(); break;
      case 'storyskip': this._story && this._story.skip(); break;
      case 'resume': app.resume(); break;
      case 'restart': this.confirm('تعيد العالم؟', 'بتخسر الجمر اللي معك بهالمحاولة.', () => app.playWorld(app.level.idx, true)); break;
      case 'quitlevel': this.confirm('ترجع للقائمة؟', 'التقدم بهالعالم ما بينحفظ.', () => app.toMenu()); break;
      case 'nextw': app.playWorld(app.result.idx + 1); break;
      case 'retry': app.playWorld(app.result.idx, true); break;
      case 'menu': app.toMenu(); break;
      case 'ending': this.ending(); break;
      case 'update': app.applyUpdate(); break;
    }
  }
  // ------------------------------------------------------------ HUD
  hudOn(on) { this.hudEl.classList.toggle('on', on); $('#touch').classList.toggle('on', on && this.app.input.isTouch()); }
  buildHUD() {
    this.hudEl.innerHTML = `<div class="hl"><div class="flame"><i class="ico">🔥</i><div class="bar"><b></b></div></div><div class="sta"><div class="bar"><b></b></div></div></div>
      <div class="hc"><div class="obj"></div><div class="timer"><span class="t"></span><span class="st"></span></div></div>
      <div class="hr"><div class="emb"><b>0</b><span>/ 0</span></div><div class="fea"></div></div>
      <div class="cds"><div class="cd dash"><svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15"/><circle class="p" cx="18" cy="18" r="15"/></svg><span>اندفاع</span></div><div class="cd flare"><svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15"/><circle class="p" cx="18" cy="18" r="15"/></svg><span>وهج</span></div></div>
      <div class="charge"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52"/><circle class="p" cx="60" cy="60" r="52"/></svg><div><b>0%</b><span>المنارة</span></div></div>
      <div class="arrow">▲<span></span></div><div class="boss"><span>HOLLOW MAW</span><div class="bar"><b></b></div></div>
      <div class="hint"></div><div class="vig"></div><div class="fps"></div><button class="pz" data-p="1" aria-label="pause">❚❚</button>`;
    this.hudEl.querySelector('.pz').onclick = () => this.app.pause();
    this.h = { flame: $('.flame b', this.hudEl), sta: $('.sta b', this.hudEl), staW: $('.sta', this.hudEl), obj: $('.obj', this.hudEl), t: $('.timer .t', this.hudEl), st: $('.timer .st', this.hudEl), emb: $('.emb b', this.hudEl), need: $('.emb span', this.hudEl), embW: $('.emb', this.hudEl), fea: $('.fea', this.hudEl),
      dash: $('.cd.dash .p', this.hudEl), dashW: $('.cd.dash', this.hudEl), flare: $('.cd.flare .p', this.hudEl), flareW: $('.cd.flare', this.hudEl), charge: $('.charge', this.hudEl), chargeP: $('.charge .p', this.hudEl), chargeT: $('.charge b', this.hudEl),
      arrow: $('.arrow', this.hudEl), arrowT: $('.arrow span', this.hudEl), boss: $('.boss', this.hudEl), bossB: $('.boss b', this.hudEl), hint: $('.hint', this.hudEl), vig: $('.vig', this.hudEl), fps: $('.fps', this.hudEl) };
  }
  hud(d, R, fps) {
    const h = this.h; if (!h) return;
    h.flame.style.width = (Math.max(0, d.flame) * 100).toFixed(1) + '%'; h.flame.parentNode.parentNode.classList.toggle('low', d.flame < 0.3);
    h.sta.style.width = (d.sta * 100).toFixed(1) + '%'; h.staW.classList.toggle('full', d.sta > 0.99);
    h.emb.textContent = d.carried; h.need.textContent = d.lit ? '' : `/ ${d.need}`; h.embW.classList.toggle('ok', d.carried >= d.need);
    h.fea.innerHTML = [0, 1, 2].map(i => `<i class="${i < d.feathers ? 'on' : ''}">🪶</i>`).join('');
    h.t.textContent = fmt(d.time); h.st.textContent = d.lit ? '' : d.stormLeft > 0 ? `العاصفة تضيق • ${fmt(d.stormLeft)}` : 'العاصفة في أضيق حد!'; h.st.classList.toggle('warn', d.stormLeft < 45);
    const C = 94.2; h.dash.style.strokeDashoffset = (C * (1 - d.dash)).toFixed(1); h.dashW.classList.toggle('ready', d.dash >= 1);
    h.flare.style.strokeDashoffset = (C * (1 - d.flare)).toFixed(1); h.flareW.classList.toggle('ready', d.flare >= 1 && d.carried >= 5);
    const showCharge = d.inZone || (d.charge > 0 && !d.lit); h.charge.classList.toggle('on', showCharge);
    if (showCharge) { h.chargeP.style.strokeDashoffset = (326.7 * (1 - d.charge)).toFixed(1); h.chargeT.textContent = Math.floor(d.charge * 100) + '%'; }
    let obj = '';
    if (d.lit) obj = 'المنارة اشتعلت ✦';
    else if (d.boss != null) obj = 'اندفع في النواة لما تتوهج';
    else if (d.carried < d.need) obj = `اجمع الجمر (${d.carried}/${d.need}) ووصله للمنارة`;
    else if (!d.inZone) obj = 'روح للمنارة ولف حولها';
    else obj = 'لف حول المنارة لين تشتعل — دافع عنها!';
    if (d.outside && !d.lit) obj = '⚠ أنت داخل العاصفة — ارجع للداخل!';
    if (d.leeched) obj = '⚠ علقة تسرق جمرك — اندفع!';
    if (h.obj.textContent !== obj) h.obj.textContent = obj;
    h.obj.classList.toggle('warn', d.outside || d.leeched);
    // beacon arrow
    const W = this.app.R; const p = project(W.vp, d.beaconP, innerWidth, innerHeight);
    const off = p.behind || p.x < 40 || p.x > innerWidth - 40 || p.y < 40 || p.y > innerHeight - 40;
    h.arrow.classList.toggle('on', off && !d.lit && !d.inZone);
    if (off) { let x = p.x - innerWidth / 2, y = p.y - innerHeight / 2; if (p.behind) { x = -x; y = -y; } const a = Math.atan2(y, x), r = Math.min(innerWidth, innerHeight) * 0.38; h.arrow.style.transform = `translate(${innerWidth / 2 + Math.cos(a) * r}px, ${innerHeight / 2 + Math.sin(a) * r}px) rotate(${a + Math.PI / 2}rad)`; h.arrowT.style.transform = `rotate(${-(a + Math.PI / 2)}rad)`; h.arrowT.textContent = 'المنارة'; }
    h.boss.classList.toggle('on', d.boss != null); if (d.boss != null) h.bossB.style.width = (d.boss * 100) + '%';
    h.vig.style.opacity = d.outside ? 1 : d.flame < 0.3 ? 0.55 : 0; h.vig.classList.toggle('storm', d.outside);
    h.fps.textContent = this.app.S.showFps ? `${fps.toFixed(0)} FPS • ${R.w}×${R.h}` : '';
  }
  hint(key) {
    const h = this.h; if (!h) return;
    if (!key || this.app.S.hints === false) { h.hint.classList.remove('on'); return; }
    const pad = this.app.input.device === 'pad', touch = this.app.input.isTouch() && !pad;
    const T = {
      steer: pad ? 'حرّك <kbd>العصا اليسرى</kbd> للتوجيه' : touch ? 'اسحب العصا على اليسار للتوجيه' : 'حرّك <kbd>الماوس</kbd> أو <kbd>WASD</kbd> للتوجيه',
      flap: pad ? 'اضغط <kbd>A / ✕</kbd> مطوّل عشان ترفرف وتطلع فوق' : touch ? 'اضغط <kbd>رفرفة</kbd> مطوّل عشان تطير لفوق' : 'اضغط <kbd>SPACE</kbd> مطوّل عشان ترفرف وتطلع فوق',
      embers: 'اجمع الجمر المتوهج 🔥 — هو وقودك ونقاطك',
      rings: 'مرّ من الحلقات المضيئة عشان تاخذ دفعة سرعة',
      dash: pad ? 'اضغط <kbd>RB / R1</kbd> للاندفاع الناري — يكسر الأعداء' : touch ? 'اضغط <kbd>اندفاع</kbd> — يكسر الأعداء' : 'اضغط <kbd>SHIFT</kbd> أو <kbd>كليك يسار</kbd> للاندفاع الناري',
      flare: pad ? 'اضغط <kbd>B / ◯</kbd> للوهج — يطرد الفراغ حولك (5 جمرات)' : touch ? 'اضغط <kbd>وهج</kbd> — يطرد الأعداء حولك' : 'اضغط <kbd>E</kbd> أو <kbd>كليك يمين</kbd> للوهج (5 جمرات)',
      beacon: 'لما يصير معك جمر كافي، اتبع السهم للمنارة ولف حولها'
    };
    h.hint.innerHTML = T[key] || ''; h.hint.classList.add('on');
  }
  // ------------------------------------------------------------ touch controls
  buildTouch() {
    const T = $('#touch'), I = this.app.input;
    T.innerHTML = `<div class="stick"><div class="knob"></div></div><div class="tb flap">رفرفة</div><div class="tb dash">اندفاع</div><div class="tb flare">وهج</div><div class="tb dive">غطس</div>`;
    const stick = $('.stick', T), knob = $('.knob', T); let sid = null, c0 = null;
    const R = 60;
    stick.addEventListener('pointerdown', e => { sid = e.pointerId; c0 = [e.clientX, e.clientY]; stick.setPointerCapture(sid); I.touch.active = true; e.preventDefault(); });
    stick.addEventListener('pointermove', e => { if (e.pointerId !== sid) return; let dx = e.clientX - c0[0], dy = e.clientY - c0[1]; const l = Math.hypot(dx, dy); if (l > R) { dx *= R / l; dy *= R / l; } knob.style.transform = `translate(${dx}px,${dy}px)`; I.touch.x = dx / R; I.touch.y = -dy / R; });
    const end = e => { if (e.pointerId !== sid) return; sid = null; knob.style.transform = ''; I.touch.x = 0; I.touch.y = 0; };
    stick.addEventListener('pointerup', end); stick.addEventListener('pointercancel', end);
    for (const k of ['flap', 'dash', 'flare', 'dive']) {
      const b = $('.tb.' + k, T);
      b.addEventListener('pointerdown', e => { I.touch[k] = 1; I.touch.active = true; b.classList.add('on'); b.setPointerCapture(e.pointerId); e.preventDefault(); this.app.audio.init(); });
      const up = () => { I.touch[k] = 0; b.classList.remove('on'); };
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
    }
  }
  updatePrompt() {
    const el = $('#update'); el.innerHTML = `<span>✨ فيه تحديث جديد للعبة</span><button data-u="1">حدّث الحين</button>`; el.classList.add('on');
    el.querySelector('button').onclick = () => this.app.applyUpdate();
  }
}
export { fmt };
