import { SKINS } from '../gfx/models.js';
// ARVEX SURVIVAL — interface: screens, HUD, inventory/crafting, radial menus, map, touch controls
import { ITEMS, RECIPES, CAT_NAMES, PIECES, PIECE_ORDER, TIERS, pieceCost, nameOf } from '../game/items.js';
import { PlayerInventory, WEAR_SLOTS } from '../game/inventory.js';
import { ITEM_ICONS, UI_ICONS, iconFor } from './icons.js';
import { ACTIONS, ACTION_NAMES } from '../input/input.js';
import { WEATHER } from '../game/env.js';
import { LEVEL_XP, ANIMAL_NAMES, OBJECTIVES } from '../game/session.js';
import { pieceHP } from '../game/items.js';
import { REASONS as BUILD_REASONS } from '../game/building.js';

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const LOGO = `<img class="logo-img" src="brand/arvex-logo-dark.svg" alt="ARVEX">`, LOGO_ST = `<img class="logo-stack" src="brand/arvex-logo-stacked.svg" alt="ARVEX SURVIVAL">`, MARK = `<img class="mark" src="brand/arvex-mark.svg" alt="">`;
export const fmtTime = s => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m + ':' + (x < 10 ? '0' : '') + x; };
export const fmtHours = (s, L) => { const h = s / 3600; return h >= 1 ? (h >= 10 ? Math.round(h) : h.toFixed(1)) + (L === 'en' ? ' HOURS' : ' ساعة') : Math.round(s / 60) + (L === 'en' ? ' MIN' : ' دقيقة'); };
const fmtDur = (ms, L) => { const s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); const U = L === 'en' ? ['D', 'H', 'M'] : ['ي', 'س', 'د']; return d ? `${d}${U[0]} ${h}${U[1]}` : h ? `${h}${U[1]} ${m}${U[2]}` : `${m}${U[2]}`; };
const fmtDate = (t, L) => t ? new Date(t).toLocaleDateString(L === 'en' ? 'en-GB' : 'ar', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

export class UI {
  constructor(app) {
    this.app = app; this.el = $('#ui'); this.hud = $('#hud'); this.ov = $('#overlay'); this.toasts = $('#toasts'); this.tipEl = $('#tip');
    this.screen = null; this.invTab = 'inv'; this.craftCat = 'all'; this.craftSel = null; this.craftN = 1; this.srvFilter = { q: '', region: 'all', mode: 'all', avail: false, tab: 'all' };
    document.addEventListener('click', e => this.onClick(e));
    document.addEventListener('input', e => this.onInput(e));
    document.addEventListener('change', e => this.onInput(e, true));
    document.addEventListener('pointerover', e => { const s = e.target.closest('[data-tip]'); if (s) this.showTip(s, e); }, true);
    document.addEventListener('pointerout', e => { if (e.target.closest('[data-tip]')) this.hideTip(); }, true);
    document.addEventListener('mouseover', e => { const b = e.target.closest('button.ax-btn,.ax-tab,.mm-item'); if (b && b !== this._hov) { this._hov = b; this.app.audio.play('ui'); } });
  }
  get L() { return this.app.lang; }
  T(p) { return Array.isArray(p) ? p[this.L === 'en' ? 1 : 0] : p; }
  // ------------------------------------------------------------------ generic
  show(html, cls = '') { document.body.classList.add('ui-open'); this.el.className = 'on ' + cls; this.el.innerHTML = html; this.screen = cls.split(' ')[0] || 'x'; this.el.scrollTop = 0; this.hideTip(); }
  hide() { document.body.classList.remove('ui-open'); this.el.className = ''; this.el.innerHTML = ''; this.screen = null; }
  modalOpen() { return this.ov.classList.contains('on') || !!this.wheelState || this.el.classList.contains('on') || this.chatOpen || this.mapOpen; }
  toast(msg, kind = 'info', ms = 3200) {
    const d = document.createElement('div'); d.className = 'ax-toast ' + kind; d.innerHTML = esc(msg); this.toasts.appendChild(d);
    while (this.toasts.children.length > 5) this.toasts.firstChild.remove();
    setTimeout(() => { d.classList.add('out'); setTimeout(() => d.remove(), 260); }, ms);
  }
  notice(msg, kind = 'info') { const n = $('#notices'); if (!n) return this.toast(msg, kind); const d = document.createElement('div'); d.className = 'notice ' + kind; d.innerHTML = msg; n.prepend(d); while (n.children.length > 6) n.lastChild.remove(); setTimeout(() => { d.classList.add('out'); setTimeout(() => d.remove(), 400); }, 6000); }
  confirm(title, text, okLabel, onOk, danger) {
    const back = document.createElement('div'); back.className = 'ax-modal-back';
    back.innerHTML = `<div class="ax-modal ax-panel"><h3 class="ax-h3">${esc(title)}</h3><p class="ax-muted">${esc(text)}</p><div class="actions"><button class="ax-btn ghost" data-x="no">${this.T(['إلغاء', 'Cancel'])}</button><button class="ax-btn ${danger ? 'danger' : 'primary'}" data-x="ok">${esc(okLabel)}</button></div></div>`;
    document.body.appendChild(back);
    back.addEventListener('click', e => { const x = e.target.closest('[data-x]'); if (!x && e.target !== back) return; back.remove(); if (x && x.dataset.x === 'ok') onOk(); });
  }
  showTip(el, e) { const t = el.dataset.tip; if (!t) return; this.tipEl.innerHTML = t; this.tipEl.classList.add('on'); const r = el.getBoundingClientRect(), tw = this.tipEl.offsetWidth, th = this.tipEl.offsetHeight; let x = r.right + 10, y = r.top; if (x + tw > innerWidth - 8) x = r.left - tw - 10; if (y + th > innerHeight - 8) y = innerHeight - th - 8; this.tipEl.style.left = Math.max(8, x) + 'px'; this.tipEl.style.top = Math.max(8, y) + 'px'; }
  hideTip() { this.tipEl.classList.remove('on'); }
  footer() { return `<footer class="mm-foot"><span class="ax-meta" title="build ${this.app.BUILD_ID}">ARVEX SURVIVAL · ${this.app.versionLabel}</span><a class="ax-meta link" href="https://discord.gg/arvex" target="_blank" rel="noopener">discord.gg/arvex</a><span class="ax-meta">© 2026 ARVEX · Mohsen ~ Danial</span></footer>`; }
  head(title, sub, back = 'back') { return `<header class="scr-head"><button class="ax-btn ghost sm icon-btn" data-act="${back}" aria-label="back">${UI_ICONS.back}<span>${this.T(['رجوع', 'Back'])}</span></button><div><div class="ax-eyebrow">${esc(sub || 'ARVEX SURVIVAL')}</div><h1 class="ax-h1">${esc(title)}</h1></div></header>`; }
  // ------------------------------------------------------------------ loading
  loading(p, tip, phase) {
    if (this.screen !== 'loading') this.show(`<div class="load"><div class="load-in">${LOGO_ST}<div class="ax-line"></div><div class="load-phase" id="lphase"></div><div class="ax-progress load-bar"><i id="lbar"></i></div><div class="load-row"><span class="ax-meta" id="lpct">0%</span><span class="ax-meta">ARVEX ${this.app.versionLabel} · build ${esc(this.app.BUILD_ID.replace(/^[\d.]+-/, ''))}</span></div><p class="load-tip" id="ltip"></p></div>${this.footer()}</div>`, 'loading');
    $('#lbar').style.setProperty('--v', Math.round(p * 100) + '%'); $('#lpct').textContent = Math.round(p * 100) + '%';
    if (tip) $('#ltip').textContent = tip; if (phase) $('#lphase').textContent = phase;
  }
  // ------------------------------------------------------------------ main menu
  /** shop: weapon and tool finishes, bought with coins earned by playing */
  shop() {
    const A = this.app, S = A.shop;
    const cards = Object.entries(SKINS).map(([id, sk]) => { const own = S.owned.includes(id), on = S.skin === id, sw = k => `<i style="background:${sk[k] || (k.startsWith('wood') ? '#8a6440' : '#6d7378')}"></i>`;
      return `<div class="shop-card ax-card ${on ? 'on' : ''}"><div class="shop-sw">${sw('metalL')}${sw('metal')}${sw('metalD')}${sw('wood')}</div><b>${esc(this.T(sk.name))}</b><span class="ax-meta">${own ? this.T(['عندك', 'Owned']) : sk.price + ' ' + this.T(['عملة', 'coins'])}</span>`
        + (on ? `<button class="ax-btn sm" disabled>${this.T(['مستخدم', 'In use'])}</button>` : own ? `<button class="ax-btn sm primary" data-act="skinUse" data-id="${id}">${this.T(['استخدم', 'Use'])}</button>` : `<button class="ax-btn sm ${S.coins >= sk.price ? 'primary' : ''}" data-act="skinBuy" data-id="${id}" ${S.coins >= sk.price ? '' : 'disabled'}>${this.T(['اشترِ', 'Buy'])}</button>`) + '</div>'; }).join('');
    this.show(`<div class="scr center"><div class="ax-panel shop"><span class="ax-eyebrow">ARVEX</span><h2 class="ax-h2">${this.T(['المتجر', 'Shop'])}</h2>
      <p class="ax-muted">${this.T(['أشكال للأسلحة والأدوات. العملات تجمعها باللعب: عملتين كل دقيقة، وزيادة مع كل شي تسويه. ما فيه شراء بفلوس حقيقية.', 'Finishes for your weapons and tools. Coins come from playing: two a minute, plus more for everything you do. Nothing here is sold for real money.'])}</p>
      <div class="shop-coins"><b class="ax-data">${Math.floor(S.coins)}</b> ${this.T(['عملة', 'coins'])}</div><div class="shop-grid">${cards}</div>
      <button class="ax-btn ghost block" data-act="back">${this.T(['رجوع', 'Back'])}</button></div></div>`, 'shop');
  }
  title() {
    this.app.state = 'menu'; const save = this.app.hasSave(), A = this.app, st = A.serverSummary;
    const item = (act, ic, label, sub, cls = '') => `<button class="mm-item ${cls}" data-act="${act}"><span class="mm-ic">${ic}</span><span class="mm-tx"><b>${esc(label)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span></button>`;
    const news = (A.news || []).slice(0, 3).map(n => `<article class="news-it ax-card is-interactive" data-act="newsOpen" data-id="${esc(n.id)}"><div class="news-th" style="background-image:url(${esc(n.image || 'brand/arvex-main-banner.svg')})"></div><div class="news-tx"><span class="ax-chip ${n.tag === 'update' ? 'signal' : n.tag === 'maintenance' ? 'warn' : 'info'}">${esc(this.T(TAGS[n.tag] || [n.tag, n.tag]))}</span><h4>${esc(this.T(n.title))}</h4><p>${esc(this.T(n.short))}</p><span class="ax-meta">${esc(fmtDate(n.date, this.L))}</span></div></article>`).join('') || `<p class="ax-muted">${this.T(['ما فيه أخبار حالياً', 'No news right now'])}</p>`;
    this.show(`<div class="mm">
      <section class="mm-left">
        ${LOGO_ST}
        <nav class="mm-nav">
          ${save ? item('continue', UI_ICONS.play, this.T(['كمّل عالمك', 'Continue']), this.T(['لعب فردي', 'Singleplayer']) + ' · ' + fmtDate(save.saved, this.L), 'primary') : ''}
          ${item('newWorld', save ? UI_ICONS.plus : UI_ICONS.play, this.T(['عالم جديد', 'New World']), this.T(['لعب فردي', 'Singleplayer']), save ? '' : 'primary')}
          ${item('servers', UI_ICONS.server, this.T(['السيرفرات', 'Servers']), st ? `${st.online} ${this.T(['متصل', 'online'])} · ${st.servers} ${this.T(['سيرفر', 'servers'])}` : this.T(['العب أونلاين', 'Play online']))}
          ${item('profile', UI_ICONS.user, this.T(['الملف الشخصي', 'Profile']), fmtHours(A.profileTotal(), this.L))}
          ${item('guide', UI_ICONS.build, this.T(['الدليل', 'Guide']), this.T(['كيف تبني وتصنع وتنجو', 'How to build, craft and survive']))}
          ${item('shop', UI_ICONS.plus, this.T(['المتجر', 'Shop']), Math.floor(A.shop.coins) + ' ' + this.T(['عملة', 'coins']))}
          ${item('settings', UI_ICONS.settings, this.T(['الإعدادات', 'Settings']))}
          ${item('about', UI_ICONS.info, this.T(['من نحن', 'About Us']))}
          ${item('credits', UI_ICONS.credits, this.T(['الشكر والحقوق', 'Credits']))}
          ${A.isDesktop ? item('quit', UI_ICONS.exit, this.T(['خروج', 'Quit'])) : ''}
        </nav>
      </section>
      <aside class="mm-right">
        <div class="mm-status ax-panel"><div class="row-sb"><span class="ax-eyebrow">${this.T(['حالة الشبكة', 'Network status'])}</span><span class="ax-chip dot ${st ? 'ok' : 'warn'} pulse">${st ? this.T(['متصل', 'Online']) : this.T(['غير متصل', 'Offline'])}</span></div>
          <div class="stat-grid"><div><span class="ax-meta">${this.T(['لاعبين متصلين', 'Players online'])}</span><b class="ax-data">${st ? st.online : '—'}</b></div><div><span class="ax-meta">${this.T(['السيرفرات', 'Servers'])}</span><b class="ax-data">${st ? st.up + '/' + st.servers : '—'}</b></div><div><span class="ax-meta">${this.T(['الإصدار', 'Version'])}</span><b class="ax-data">${A.VERSION}</b></div></div></div>
        <div class="mm-news ax-panel"><div class="row-sb"><span class="ax-eyebrow">${this.T(['آخر الأخبار', 'Latest news'])}</span><a class="ax-meta link" href="https://discord.gg/arvex" target="_blank" rel="noopener">discord.gg/arvex</a></div>${news}</div>
        <a class="ax-btn block discord-btn" href="https://discord.gg/arvex" target="_blank" rel="noopener">${UI_ICONS.discord}${this.T(['انضم للديسكورد', 'Join Discord'])}</a>
      </aside>${this.footer()}</div>`, 'title');
  }
  newsOpen(id) { const n = (this.app.news || []).find(x => x.id === id); if (!n) return; this.confirm(this.T(n.title), this.T(n.body || n.short), this.T(['تمام', 'OK']), () => {}); }
  // ------------------------------------------------------------------ servers
  servers(list, err) {
    const F = this.srvFilter, L = this.L, favs = this.app.favs(), recent = this.app.recent();
    let rows = (list || []).slice();
    if (F.tab === 'fav') rows = rows.filter(s => favs.includes(s.id)); if (F.tab === 'recent') rows = rows.filter(s => recent.includes(s.id)).sort((a, b) => recent.indexOf(a.id) - recent.indexOf(b.id));
    if (F.q) rows = rows.filter(s => (s.name + ' ' + s.id).toLowerCase().includes(F.q.toLowerCase()));
    if (F.region !== 'all') rows = rows.filter(s => s.region === F.region); if (F.mode !== 'all') rows = rows.filter(s => s.mode === F.mode);
    if (F.avail) rows = rows.filter(s => s.status === 'online' && s.players < s.max);
    const regions = [...new Set((list || []).map(s => s.region))], modes = [...new Set((list || []).map(s => s.mode))];
    const total = (list || []).reduce((a, s) => a + s.players, 0);
    const card = s => {
      const st = STATUS[s.status] || STATUS.unavailable, full = s.players >= s.max, can = s.status === 'online' || (s.status === 'full');
      return `<article class="srv ax-card ${this.selSrv === s.id ? 'is-selected' : ''} is-interactive" data-act="srvSel" data-id="${esc(s.id)}">
        <div class="srv-main"><div class="srv-name"><button class="fav ${favs.includes(s.id) ? 'on' : ''}" data-act="fav" data-id="${esc(s.id)}" aria-label="favorite">${favs.includes(s.id) ? UI_ICONS.starF : UI_ICONS.star}</button><h3>${esc(s.name)}</h3><span class="ax-meta">#${esc(s.id)}</span></div>
          <div class="srv-tags"><span class="ax-chip dot ${st[2]}">${this.T(st)}</span><span class="ax-chip">${esc(this.T(MODES[s.mode] || [s.mode, s.mode]))}</span><span class="ax-chip">${esc(s.map)}</span><span class="ax-chip">${UI_ICONS.globe}${esc(this.T(REGIONS[s.region] || [s.region, s.region]))}</span></div></div>
        <div class="srv-cols">
          <div><span class="ax-meta">${this.T(['اللاعبين', 'Players'])}</span><b class="ax-data">${s.players} / ${s.max}</b><div class="cap"><i style="width:${Math.round(s.players / s.max * 100)}%"></i></div></div>
          <div><span class="ax-meta">${this.T(['البنق', 'Ping'])}</span><b class="ax-data ping ${s.ping == null ? '' : s.ping < 80 ? 'good' : s.ping < 160 ? 'mid' : 'bad'}">${s.ping == null ? '—' : s.ping + ' ms'}</b></div>
          <div><span class="ax-meta">${this.T(['مدة التشغيل', 'Uptime'])}</span><b class="ax-data">${s.status === 'online' || s.status === 'full' ? fmtDur(s.uptime, L) : '—'}</b></div>
          <div><span class="ax-meta">${this.T(['الريستارت القادم', 'Next restart'])}</span><b class="ax-data ${s.nextRestart < 3600e3 ? 'warn' : ''}">${fmtDur(s.nextRestart, L)}</b></div>
          <div><span class="ax-meta">${this.T(['الإصدار', 'Version'])}</span><b class="ax-data ${s.version !== this.app.VERSION ? 'bad' : ''}">${esc(s.version)}</b></div>
        </div>
        <button class="ax-btn ${can && !full ? 'primary' : ''}" data-act="join" data-id="${esc(s.id)}" ${s.status === 'online' || full ? '' : 'disabled'}>${full ? this.T(['انتظار بالطابور', 'Join queue']) : this.T(['دخول', 'Join'])}</button>
      </article>`;
    };
    this.show(`<div class="scr">${this.head(this.T(['سيرفرات ARVEX', 'ARVEX Servers']), this.T(['متصفح السيرفرات', 'Server browser']))}
      <div class="srv-bar">
        <div class="ax-tabs">${[['all', ['الكل', 'All']], ['fav', ['المفضلة', 'Favorites']], ['recent', ['لعبت مؤخراً', 'Recently played']]].map(([k, n]) => `<button class="ax-tab ${F.tab === k ? 'on' : ''}" data-act="srvTab" data-v="${k}">${this.T(n)}</button>`).join('')}</div>
        <div class="srv-filters"><label class="search">${UI_ICONS.search}<input class="ax-input" data-in="srvQ" value="${esc(F.q)}" placeholder="${this.T(['ابحث عن سيرفر', 'Search servers'])}"></label>
          <select class="ax-input" data-in="srvRegion"><option value="all">${this.T(['كل المناطق', 'All regions'])}</option>${regions.map(r => `<option value="${esc(r)}" ${F.region === r ? 'selected' : ''}>${esc(this.T(REGIONS[r] || [r, r]))}</option>`).join('')}</select>
          <select class="ax-input" data-in="srvMode"><option value="all">${this.T(['كل الأنماط', 'All modes'])}</option>${modes.map(r => `<option value="${esc(r)}" ${F.mode === r ? 'selected' : ''}>${esc(this.T(MODES[r] || [r, r]))}</option>`).join('')}</select>
          <label class="chk"><input type="checkbox" class="ax-toggle" data-in="srvAvail" ${F.avail ? 'checked' : ''}><span>${this.T(['المتاحة فقط', 'Available only'])}</span></label>
          <button class="ax-btn ghost sm" data-act="srvRefresh">${UI_ICONS.refresh}${this.T(['تحديث', 'Refresh'])}</button></div></div>
      <div class="srv-sum"><span class="ax-meta">${this.T(['متصلين الحين', 'Online now'])}: <b class="ax-data">${total}</b></span><span class="ax-meta">${this.T(['السيرفرات', 'Servers'])}: <b class="ax-data">${(list || []).length}</b></span><span class="ax-meta">${this.T(['اسمك', 'Your name'])}: <b>${esc(this.app.profile.name)}</b> <a class="link" data-act="profile">${this.T(['تغيير', 'change'])}</a></span></div>
      <div class="srv-list">${err ? `<div class="state err ax-panel">${UI_ICONS.warn}<div><h3 class="ax-h3">${this.T(['ما قدرنا نوصل للسيرفرات', 'Could not reach the servers'])}</h3><p class="ax-muted">${esc(err)}</p><button class="ax-btn primary" data-act="srvRefresh">${this.T(['حاول مرة ثانية', 'Retry'])}</button></div></div>` : !list ? `<div class="state"><div class="ax-spinner"></div><span class="ax-muted">${this.T(['نجيب السيرفرات…', 'Loading servers…'])}</span></div>` : rows.length ? rows.map(card).join('') : `<div class="state"><span class="ax-muted">${this.T(['ما فيه سيرفرات تطابق البحث', 'No servers match'])}</span></div>`}</div>
      ${this.footer()}</div>`, 'servers');
  }
  queue(info) { this.show(`<div class="scr center"><div class="ax-panel modal-card">${MARK}<span class="ax-eyebrow">${this.T(['السيرفر ممتلئ', 'Server full'])}</span><h2 class="ax-h2">${this.T(['أنت بالطابور', 'You are in queue'])}</h2><p class="big ax-data">#${info.pos}</p><p class="ax-muted">${esc(info.name)} · ${info.players}/${info.max}</p><div class="ax-progress indet"><i></i></div><button class="ax-btn ghost" data-act="leaveQueue">${this.T(['اطلع من الطابور', 'Leave queue'])}</button></div></div>`, 'queue'); }
  connecting(msg) { this.show(`<div class="scr center"><div class="ax-panel modal-card">${MARK}<span class="ax-eyebrow">ARVEX NETWORK</span><h2 class="ax-h2">${esc(msg || this.T(['نتصل…', 'Connecting…']))}</h2><div class="ax-progress indet"><i></i></div><button class="ax-btn ghost" data-act="servers">${this.T(['إلغاء', 'Cancel'])}</button></div></div>`, 'connecting'); }
  netError(title, msg, retry) { this.show(`<div class="scr center"><div class="ax-panel modal-card state-err">${UI_ICONS.warn}<span class="ax-eyebrow">${this.T(['خطأ بالاتصال', 'Connection error'])}</span><h2 class="ax-h2">${esc(title)}</h2><p class="ax-muted">${esc(msg)}</p><div class="row"><button class="ax-btn primary" data-act="${retry || 'servers'}">${this.T(['حاول مرة ثانية', 'Retry'])}</button><button class="ax-btn ghost" data-act="toTitle">${this.T(['القائمة الرئيسية', 'Main menu'])}</button><a class="ax-btn ghost" href="https://discord.gg/arvex" target="_blank" rel="noopener">${this.T(['الدعم', 'Support'])}</a></div></div></div>`, 'neterr'); }
  // ------------------------------------------------------------------ profile
  profile() {
    const A = this.app, P = A.profile, S = A.localStats(), sp = A.serverProfile, L = this.L;
    const lv = S.level || 1, next = LEVEL_XP(lv + 1), cur = LEVEL_XP(lv), pct = Math.round(((S.xp || 0) - cur) / Math.max(1, next - cur) * 100);
    const box = (k, v, sub) => `<div class="pf-stat ax-card"><span class="ax-meta">${esc(k)}</span><b class="ax-data">${esc(v)}</b>${sub ? `<small class="ax-muted">${esc(sub)}</small>` : ''}</div>`;
    this.show(`<div class="scr">${this.head(this.T(['الملف الشخصي', 'Player profile']), 'ARVEX ID')}
      <div class="pf">
        <section class="ax-panel pf-id"><div class="pf-av">${MARK}</div><div class="ax-field"><label class="ax-label">${this.T(['اسم اللاعب', 'Player name'])}</label><div class="row-in"><input class="ax-input" maxlength="16" data-in="pname" value="${esc(P.name)}"><button class="ax-btn primary sm" data-act="saveName">${this.T(['حفظ', 'Save'])}</button></div><span class="ax-meta">ID · ${esc(P.id.slice(0, 12))}</span></div>
          <div class="pf-lv"><div class="row-sb"><span class="ax-eyebrow">${this.T(['المستوى', 'Level'])} ${lv}</span><span class="ax-meta">${S.xp || 0} / ${next} XP</span></div><div class="ax-progress"><i style="--v:${pct}%"></i></div></div></section>
        <section><h3 class="ax-h3 sec-t">${this.T(['وقت اللعب (أونلاين — من السيرفر)', 'Playtime (online — server-verified)'])}</h3>
          <div class="pf-grid">${sp ? box(this.T(['إجمالي وقت اللعب', 'Total playtime']), fmtHours(sp.total, L)) + box(this.T(['عدد الجلسات', 'Total sessions']), sp.sessions) + box(this.T(['آخر لعب', 'Last played']), fmtDate(sp.last, L)) + box(this.T(['أول دخول', 'First joined']), fmtDate(sp.first, L)) : `<div class="ax-card pf-empty"><p class="ax-muted">${this.T(['ادخل أي سيرفر عشان يبدأ السيرفر يحسب وقتك. ما تقدر تعدّل الوقت — السيرفر هو المصدر.', 'Join any server to start server-side tracking. Playtime cannot be edited — the server is the source of truth.'])}</p></div>`}</div>
          <h3 class="ax-h3 sec-t">${this.T(['اللعب الفردي', 'Singleplayer'])}</h3>
          <div class="pf-grid">${box(this.T(['وقت اللعب', 'Playtime']), fmtHours(S.playTime || 0, L))}${box(this.T(['الجلسات', 'Sessions']), S.sessions || 0)}${box(this.T(['الصيد', 'Kills']), S.kills || 0)}${box(this.T(['الوفيات', 'Deaths']), S.deaths || 0)}${box(this.T(['صنعت', 'Crafted']), S.crafted || 0)}${box(this.T(['بنيت', 'Built']), S.built || 0)}${box(this.T(['جمعت', 'Gathered']), S.gathered || 0)}${box(this.T(['أول مرة', 'First played']), fmtDate(S.first, L))}</div></section>
      </div>${this.footer()}</div>`, 'profile');
  }
  // ------------------------------------------------------------------ settings
  settings(tab) {
    tab = tab || this.setTab || 'graphics'; this.setTab = tab; const S = this.app.S, I = this.app.input;
    const sel = (k, opts, label) => `<div class="set-row"><label class="ax-label">${esc(label)}</label><select class="ax-input" data-set="${k}">${opts.map(([v, n]) => `<option value="${v}" ${String(S[k]) === String(v) ? 'selected' : ''}>${esc(this.T(n))}</option>`).join('')}</select></div>`;
    const rng = (k, a, b, st, label, fmt = v => v, obj = S, attr = 'data-set') => `<div class="set-row"><label class="ax-label">${esc(label)} <span class="ax-data val">${fmt(obj[k])}</span></label><input type="range" class="ax-range" ${attr}="${k}" min="${a}" max="${b}" step="${st}" value="${obj[k]}" style="--p:${(obj[k] - a) / (b - a) * 100}%"></div>`;
    const tog = (k, label, obj = S, attr = 'data-set') => `<div class="set-row tog"><label class="ax-label">${esc(label)}</label><input type="checkbox" class="ax-toggle" ${attr}="${k}" ${obj[k] ? 'checked' : ''}></div>`;
    const pct = v => Math.round(v * 100) + '%';
    let body = '';
    if (tab === 'graphics') {
      const R = this.app.R, lvl = [['low', ['منخفض', 'Low']], ['medium', ['متوسط', 'Medium']], ['high', ['عالي', 'High']], ['extra', ['إكسترا', 'Extra']], ['max', ['أقصى', 'Max']]].concat(S.preset === 'custom' ? [['custom', ['مخصص', 'Custom']]] : []);
      const resName = { auto: ['تلقائي (حجم النافذة)', 'Auto (window size)'], 1080: ['1080p · Full HD', '1080p · Full HD'], 1440: ['1440p · 2K', '1440p · 2K'], 2160: ['2160p · 4K', '2160p · 4K'], 3240: ['3240p · 6K', '3240p · 6K'], 4320: ['4320p · 8K', '4320p · 8K'] };
      const fs = !!document.fullscreenElement, heavy = R.w * R.h > 3840 * 2160 * 1.05, hw = this.app.hardware();
      body = `<div class="set-note"><span class="ax-meta">${this.T(['كرت الشاشة', 'GPU'])}: ${esc(hw.gpu.slice(0, 70))}</span><span class="ax-meta">${this.T(['الرسم الفعلي', 'Rendering at'])} <b class="ax-data">${R.w}×${R.h}</b>${R.capped ? ` · ${this.T(['محدود بقدرة الكرت', 'limited by this GPU'])} (${R.maxDim}px)` : ''}${heavy ? ` · <span class="warn-t">${this.T(['تكلفة أداء عالية', 'High performance cost'])}</span>` : ''}</span></div>`
        + sel('preset', lvl, this.T(['جودة الرسوم', 'Graphics quality']))
        + sel('resolution', Object.entries(resName).map(([k, n]) => [k, n]), this.T(['دقة الرسم', 'Resolution']))
        + `<div class="set-row"><label class="ax-label">${this.T(['وضع العرض', 'Display mode'])}</label><button class="ax-btn sm" data-act="fullscreen">${fs ? this.T(['نافذة', 'Windowed']) : this.T(['ملء الشاشة', 'Fullscreen'])}</button></div>`
        + sel('fpsLimit', [[0, ['حسب الشاشة (VSync)', 'Display rate (VSync)']], [30, ['30', '30']], [60, ['60', '60']], [120, ['120', '120']], [144, ['144', '144']], [165, ['165', '165']], [240, ['240', '240']]], this.T(['حد الفريمات', 'FPS limit']))
        + sel('detail', [[0, ['منخفض', 'Low']], [1, ['متوسط', 'Medium']], [2, ['عالي', 'High']], [3, ['ألترا', 'Ultra']]], this.T(['جودة الموديلات والتفاصيل', 'Model & texture detail']))
        + sel('textures', [[0, ['بدون (ألوان فقط)', 'Off (flat colours)']], [1, ['1K', '1K']], [2, ['2K', '2K']], [3, ['4K (كرت 4GB أو أكثر)', '4K (4 GB video memory or more)']]], this.T(['خامات الأسطح', 'Surface textures']))
        + sel('shadows', [[0, ['بدون', 'Off']], [1024, ['متوسط', 'Medium']], [2048, ['عالي', 'High']], [4096, ['ألترا', 'Ultra']]], this.T(['جودة الظلال', 'Shadow quality']))
        + rng('shadowDist', 30, 120, 5, this.T(['مسافة الظلال', 'Shadow distance']), v => v + ' m')
        + tog('fxaa', this.T(['تنعيم الحواف (FXAA)', 'Anti-aliasing (FXAA)'])) + tog('bloom', this.T(['المعالجة: توهج الإضاءة', 'Post-processing: bloom']))
        + rng('scale', 0.5, 1, 0.05, this.T(['مقياس الدقة (مع التلقائي)', 'Render scale (Auto resolution)']), pct) + rng('viewDist', 260, 760, 20, this.T(['مسافة الرؤية', 'View distance']), v => v + ' m') + rng('propDist', 160, 520, 20, this.T(['مسافة الأشجار والأغراض', 'Object distance']), v => v + ' m')
        + rng('grass', 0, 1, 0.1, this.T(['كثافة النباتات', 'Vegetation density']), pct) + rng('particles', 0.3, 1.5, 0.1, this.T(['جودة المؤثرات', 'Effects quality']), pct) + rng('fov', 60, 120, 1, this.T(['مجال الرؤية', 'Field of view']), v => v + '°') + tog('showFps', this.T(['إظهار الأداء', 'Show performance']))
        + `<div class="set-row"><span class="ax-meta">${this.T(['الاقتراح حسب جهازك', 'Suggested for this device'])}: <b>${esc(this.T(lvl.find(l => l[0] === this.app.autoPreset().preset)[1]))}</b></span><div class="row-in"><button class="ax-btn sm" data-act="autoDetect">${this.T(['اكتشف تلقائياً', 'Auto detect'])}</button><button class="ax-btn ghost sm" data-act="resetSettings">${this.T(['رجّع الافتراضي', 'Reset to default'])}</button></div></div>`;
    }
    if (tab === 'audio') body = rng('master', 0, 1, 0.05, this.T(['الصوت العام', 'Master']), pct) + rng('music', 0, 1, 0.05, this.T(['الموسيقى', 'Music']), pct) + rng('sfx', 0, 1, 0.05, this.T(['المؤثرات', 'Effects']), pct) + rng('amb', 0, 1, 0.05, this.T(['الطبيعة', 'Ambience']), pct) + rng('ui', 0, 1, 0.05, this.T(['أصوات الواجهة', 'Interface']), pct);
    if (tab === 'controls') body = rng('sens', 0.2, 3, 0.05, this.T(['حساسية الماوس', 'Mouse sensitivity']), v => (+v).toFixed(2), I.set, 'data-inp') + rng('adsSens', 0.2, 1.5, 0.05, this.T(['حساسية التصويب', 'Aim (ADS) sensitivity']), v => (+v).toFixed(2), I.set, 'data-inp') + rng('padSens', 0.3, 2.5, 0.05, this.T(['حساسية اليد', 'Controller sensitivity']), v => (+v).toFixed(2), I.set, 'data-inp') + tog('invertY', this.T(['عكس المحور العمودي', 'Invert Y axis']), I.set, 'data-inp') + tog('toggleCrouch', this.T(['الانحناء بضغطة', 'Toggle crouch']), I.set, 'data-inp') + tog('vib', this.T(['الاهتزاز', 'Vibration']), I.set, 'data-inp') + rng('touchSize', 0.8, 1.4, 0.05, this.T(['حجم أزرار اللمس', 'Touch button size']), pct) + `<div class="set-row"><span>${this.T(['ترتيب أزرار الجوال', 'Touch button layout'])}</span><button class="btn" data-act="editTouch">${this.T(['عدّل المكان والحجم', 'Move & resize'])}</button></div>` +
      `<h3 class="ax-h3 sec-t">${this.T(['الأزرار', 'Key bindings'])}</h3><div class="binds">${ACTIONS.map(a => `<div class="bind"><span>${esc(this.T(ACTION_NAMES[a]))}</span><button class="ax-btn ghost sm" data-act="rebind" data-a="${a}">${(I.binds[a] || []).map(k => `<span class="ax-kbd">${esc(I.keyName(k))}</span>`).join(' ')}</button></div>`).join('')}</div><button class="ax-btn ghost sm" data-act="resetBinds">${this.T(['رجّع الافتراضي', 'Reset to default'])}</button>`;
    if (tab === 'gameplay') body = sel('lang', [['ar', ['العربية', 'العربية']], ['en', ['English', 'English']]], this.T(['اللغة', 'Language'])) + tog('hints', this.T(['التلميحات', 'Hints'])) + tog('shake', this.T(['اهتزاز الكاميرا', 'Camera shake'])) + tog('showClock', this.T(['إظهار الساعة', 'Show clock'])) + `<div class="set-row"><label class="ax-label">${this.T(['مفتاح الأدمن', 'Admin key'])} ${this.app.isAdmin ? '<span class="ax-chip ok">ADMIN</span>' : ''}</label><div class="row-in"><input class="ax-input mono" id="adm-key" type="password" autocomplete="off" value="${esc(this.app.profile.adminKey || '')}"><button class="ax-btn sm" data-act="saveAdminKey">${this.T(['حفظ', 'Save'])}</button></div></div>` + `<div class="set-row"><label class="ax-label">${this.T(['العالم الفردي', 'Singleplayer world'])}</label><button class="ax-btn danger sm" data-act="wipe">${this.T(['امسح العالم المحفوظ', 'Delete saved world'])}</button></div>`;
    if (tab === 'access') body = rng('uiScale', 0.85, 1.3, 0.05, this.T(['حجم الواجهة', 'UI scale']), pct) + tog('hiContrast', this.T(['تباين عالي', 'High contrast'])) + tog('reduceMotion', this.T(['تقليل الحركة', 'Reduce motion']));
    const tabs = [['graphics', ['الرسوم', 'Graphics']], ['audio', ['الصوت', 'Audio']], ['controls', ['التحكم', 'Controls']], ['gameplay', ['اللعب', 'Gameplay']], ['access', ['سهولة الوصول', 'Accessibility']]];
    this.show(`<div class="scr">${this.head(this.T(['الإعدادات', 'Settings']), 'ARVEX SURVIVAL')}<div class="set ax-panel"><div class="ax-tabs">${tabs.map(([k, n]) => `<button class="ax-tab ${tab === k ? 'on' : ''}" data-act="setTab" data-v="${k}">${this.T(n)}</button>`).join('')}</div><div class="set-body">${body}</div></div>${this.footer()}</div>`, 'settings ' + (this.app.state === 'play' ? 'dim' : ''));
  }
  /** "keep this resolution?" bar with a real countdown; when it runs out App.revertResolution() has already restored the old value */
  resConfirm(secs) {
    clearInterval(this._rcT); let bar = document.getElementById('res-confirm'); if (!secs) { if (bar) bar.remove(); return; }
    if (!bar) { bar = document.createElement('div'); bar.id = 'res-confirm'; bar.className = 'res-confirm ax-panel'; document.body.appendChild(bar); }
    bar.innerHTML = `<span>${this.T(['تبي تبقي هالدقة؟ نرجّع القديمة بعد', 'Keep this resolution? Reverting in'])} <b class="ax-data" id="res-left">${secs}</b> ${this.T(['ث', 's'])}</span><button class="ax-btn primary sm" data-act="resKeep">${this.T(['أبقها', 'Keep'])}</button><button class="ax-btn ghost sm" data-act="resRevert">${this.T(['رجّع', 'Revert'])}</button>`;
    this._rcT = setInterval(() => { if (--secs <= 0) { clearInterval(this._rcT); bar.remove(); } else document.getElementById('res-left').textContent = secs; }, 1000);   // only the number changes, the buttons stay clickable
  }
  // ------------------------------------------------------------------ about / credits
  about() {
    const sec = (eb, t, p) => `<section class="ab-sec"><span class="ax-eyebrow">${esc(eb)}</span><h2 class="ax-h2">${esc(t)}</h2>${p.map(x => `<p>${esc(x)}</p>`).join('')}</section>`;
    this.show(`<div class="scr about">${this.head(this.T(['من نحن', 'About Us']), 'ARVEX')}
      <div class="ab-hero" style="background-image:url(brand/arvex-main-banner.svg)"></div>
      <div class="ab-body">
      ${sec(this.T(['القصة', 'Story']), this.T(['جزيرة نسيها العالم', 'An island the world forgot']), this.T([['ARVEX جزيرة مهجورة في نص المحيط. اللي كانوا فيها تركوا وراهم أنقاض ومخيمات وأبراج صدّت، وصارت الطبيعة تستردها شوي شوي.', 'توصل للشاطئ ومعك حجر وشعلة بس. كل شي غيرها لازم تجمعه أو تصنعه أو تبنيه بيدك.'], ['ARVEX is an abandoned island in the middle of the ocean. The people who lived there left behind ruins, camps and rusted towers, and nature is slowly taking them back.', 'You wash up on the beach with a rock and a torch. Everything else you gather, craft and build yourself.']]))}
      <div class="ax-line"></div>
      ${sec(this.T(['الرؤية', 'Vision']), this.T(['بقاء له وزن', 'Survival with weight']), this.T([['نبي ARVEX تكون تجربة بقاء حقيقية: كل قرار له ثمن، والليل يخوّف، والقاعدة اللي تبنيها لها قيمة لأنك تعبت عليها.'], ['We want ARVEX to feel like real survival: every decision costs something, the night is dangerous, and the base you build matters because you earned it.']]))}
      ${sec(this.T(['اللعب', 'Gameplay']), this.T(['اجمع · اصنع · ابنِ · انجُ', 'Gather · Craft · Build · Survive']), this.T([['اقطع الأشجار واكسر الصخور وصِد الحيوانات. اصنع أدوات وأسلحة وملابس. ابنِ قاعدة من القش للخشب للحجر للحديد. انتبه للجوع والعطش والبرد والذيابة بالليل.'], ['Chop trees, mine rocks and hunt animals. Craft tools, weapons and clothing. Build a base from twig to wood to stone to metal. Watch your hunger, thirst and temperature — and the wolves at night.']]))}
      ${sec(this.T(['التطوير', 'Development']), this.T(['محرك خاص فينا', 'Our own engine']), this.T([['ARVEX مبنية على محرك WebGL مكتوب من الصفر. كل الموديلات والأصوات تتولّد داخل اللعبة، عشان كذا التحميل صغير والأداء ممتاز على الجوال والكمبيوتر.'], ['ARVEX runs on a WebGL engine written from scratch. Every model and sound is generated inside the game, so the download stays small and it runs well on phones and PCs.']]))}
      ${sec(this.T(['المجتمع', 'Community']), this.T(['ديسكورد ARVEX', 'The ARVEX Discord']), this.T([['المجتمع هو قلب ARVEX. فيه الأخبار والتحديثات والدعم والأحداث، وفيه تقدر تقترح أفكارك.'], ['The community is the heart of ARVEX. It has news, updates, support and events, and it\'s where your ideas get heard.']]))}
      <a class="ax-btn primary" href="https://discord.gg/arvex" target="_blank" rel="noopener">${UI_ICONS.discord} discord.gg/arvex</a>
      ${sec(this.T(['المستقبل', 'Future']), this.T(['هذي البداية', 'This is the beginning']), this.T([['قدامنا مناطق جديدة وأسلحة وأحداث سيرفرات وأنظمة عشائر. التحديثات تنزل عن طريق اللانشر وتحمّل الملفات اللي تغيّرت بس.'], ['New regions, weapons, server events and clan systems are on the way. Updates arrive through the launcher and only download the files that changed.']]))}
      ${this.teamBlock()}</div>${this.footer()}</div>`, 'about');
  }
  teamBlock() { return `<section class="ab-sec"><span class="ax-eyebrow">${this.T(['الفريق', 'Team'])}</span><h2 class="ax-h2">ARVEX TEAM</h2><div class="team">
    <div class="tm ax-card"><span class="ax-meta">OWNER / DEV</span><b>Mohsen</b></div><div class="tm ax-card"><span class="ax-meta">CO OWNER</span><b>Danial</b></div><div class="tm ax-card"><span class="ax-meta">STAFF / COMMUNITY</span><b class="ax-data">discord.gg/arvex</b></div></div></section>`; }
  credits() {
    this.show(`<div class="scr">${this.head(this.T(['الشكر والحقوق', 'Credits & Rights']), 'ARVEX SURVIVAL')}<div class="cr ax-panel">${LOGO}
      ${this.teamBlock()}
      <div class="ax-line"></div>
      <section class="ab-sec"><span class="ax-eyebrow">${this.T(['التقنية', 'Technology'])}</span><ul class="cr-list"><li>${this.T(['محرك ARVEX — WebGL مكتوب من الصفر', 'ARVEX engine — custom WebGL renderer'])}</li><li>${this.T(['موديلات وتضاريس وأصوات مولّدة إجرائياً', 'Procedural models, terrain and audio'])}</li><li>${this.T(['سيرفرات ARVEX — Node.js وWebSocket', 'ARVEX servers — Node.js + WebSocket'])}</li><li>${this.T(['لانشر ARVEX — Go', 'ARVEX launcher — Go'])}</li></ul></section>
      <section class="ab-sec"><span class="ax-eyebrow">${this.T(['الخطوط', 'Typefaces'])}</span><ul class="cr-list"><li>Barlow Condensed — Jeremy Tribby · SIL Open Font License 1.1</li><li>IBM Plex Sans Arabic — IBM · SIL Open Font License 1.1</li><li>Noto Kufi Arabic — Google · SIL Open Font License 1.1</li><li>JetBrains Mono — JetBrains · SIL Open Font License 1.1</li></ul></section>
      <section class="ab-sec rights"><span class="ax-eyebrow">${this.T(['الحقوق', 'Rights'])}</span><h3 class="ax-h3">ARVEX SURVIVAL</h3>
        <p>${this.T(['© 2026 ARVEX. جميع الحقوق محفوظة لأصحابها.', '© 2026 ARVEX. All rights reserved by their respective owners.'])}</p>
        <p>${this.T(['الهوية البصرية والشعار والكود والأصول ومحتوى المشروع الأصلي محمية لأصحابها: Mohsen وDanial. ممنوع إعادة النشر أو البيع أو التعديل التجاري بدون إذن مكتوب.', 'Original branding, logo, code, assets and project content are protected by their respective owners, Mohsen and Danial. Redistribution, resale or commercial modification without written permission is not allowed.'])}</p>
        <p>${this.T(['الخطوط المستخدمة تتبع رخصها المفتوحة (SIL OFL 1.1) والمرفقة مع ملفات اللعبة.', 'Bundled typefaces remain under their own open licences (SIL OFL 1.1), included with the game files.'])}</p></section>
    </div>${this.footer()}</div>`, 'credits');
  }
  adminPanel() {
    const A = this.app, s = A.sess; if (!A.isAdmin || !s) return; A.pause(); this.prevAdmin = true;
    const online = s.online, L = this.L, P = s.player;
    const players = [...s.remote.values()].map(r => `<div class="ad-pl"><b>${esc(r.name)}</b><span class="ax-meta">${Math.round(Math.hypot(r.pos[0] - P.pos[0], r.pos[2] - P.pos[2]))} m</span><div class="row-btn"><button class="ax-btn sm" data-act="adm" data-c="bring" data-t="${esc(r.id)}">${this.T(['جيبه عندي', 'Bring'])}</button><button class="ax-btn sm" data-act="adm" data-c="goto" data-t="${esc(r.id)}">${this.T(['روح له', 'Go to'])}</button><button class="ax-btn sm" data-act="adm" data-c="heal" data-t="${esc(r.id)}">${this.T(['عالجه', 'Heal'])}</button><button class="ax-btn danger sm" data-act="adm" data-c="kick" data-t="${esc(r.id)}">${this.T(['اطرده', 'Kick'])}</button></div></div>`).join('');
    const opts = Object.keys(ITEMS).map(id => `<option value="${id}">${esc(nameOf(id, L))}</option>`).join(''), tgts = `<option value="me">${this.T(['أنا', 'Me'])}</option>${online ? `<option value="all">${this.T(['الكل', 'Everyone'])}</option>` + [...s.remote.values()].map(r => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('') : ''}`;
    this.show(`<div class="scr">${this.head(this.T(['لوحة الأدمن', 'Admin panel']), 'ARVEX · OWNER', 'resume')}<div class="ad">
      <section class="ax-panel ad-sec"><span class="ax-eyebrow">${this.T(['اللاعبين', 'Players'])} · ${online ? s.remote.size : 0}</span>${online ? (players || `<p class="ax-muted">${this.T(['ما فيه أحد غيرك', 'Nobody else is here'])}</p>`) + `<button class="ax-btn sm" data-act="adm" data-c="bring" data-t="all">${this.T(['جيب الكل عندي', 'Bring everyone'])}</button>` : `<p class="ax-muted">${this.T(['اللاعبين يطلعون هنا لما تكون في سيرفر.', 'Players appear here when you are on a server.'])}</p>`}</section>
      <section class="ax-panel ad-sec"><span class="ax-eyebrow">${this.T(['انتقال', 'Teleport'])}</span><p class="ax-muted">${this.T(['افتح الخريطة واضغط على أي مكان عشان تنتقل له.', 'Open the map and click anywhere to teleport there.'])}</p><button class="ax-btn primary sm" data-act="admMap">${UI_ICONS.map}${this.T(['انتقل من الخريطة', 'Teleport via map'])}</button></section>
      <section class="ax-panel ad-sec"><span class="ax-eyebrow">${this.T(['إعطاء غرض', 'Give item'])}</span><div class="ad-give"><select class="ax-input" id="ad-item">${opts}</select><input class="ax-input mono" id="ad-n" type="number" min="1" value="100"><select class="ax-input" id="ad-t">${tgts}</select><button class="ax-btn primary sm" data-act="admGive">${this.T(['أعطِ', 'Give'])}</button></div></section>
      <section class="ax-panel ad-sec"><span class="ax-eyebrow">${this.T(['العالم', 'World'])}</span><div class="row-btn">${[[0.27, ['فجر', 'Dawn']], [0.5, ['ظهر', 'Noon']], [0.74, ['مغرب', 'Sunset']], [0.02, ['ليل', 'Night']]].map(([v, n]) => `<button class="ax-btn sm" data-act="adm" data-c="time" data-v="${v}">${this.T(n)}</button>`).join('')}</div><div class="row-btn">${Object.keys(WEATHER).map(w => `<button class="ax-btn ghost sm" data-act="adm" data-c="weather" data-w="${w}">${esc(this.T(WEATHER[w].name))}</button>`).join('')}</div></section>
      <section class="ax-panel ad-sec"><span class="ax-eyebrow">${this.T(['أنا', 'Me'])}</span><div class="row-btn"><button class="ax-btn sm" data-act="adm" data-c="heal" data-t="me">${this.T(['عالجني', 'Heal me'])}</button><button class="ax-btn sm ${P.god ? 'is-success' : ''}" data-act="admGod">${this.T(['لا أموت', 'God mode'])}: ${P.god ? 'ON' : 'OFF'}</button><button class="ax-btn sm ${s.creative ? 'is-success' : ''}" data-act="admCreative">${this.T(['بناء وصناعة مجاني', 'Free build & craft'])}: ${s.creative ? 'ON' : 'OFF'}</button></div></section>
      ${online ? `<section class="ax-panel ad-sec"><span class="ax-eyebrow">${this.T(['السيرفر', 'Server'])}</span><div class="ad-give"><input class="ax-input" id="ad-say" maxlength="160" placeholder="${this.T(['رسالة لكل اللاعبين', 'Message to all players'])}"><button class="ax-btn sm" data-act="admSay">${this.T(['أرسل', 'Send'])}</button></div><div class="row-btn">${[1, 5, 10].map(m => `<button class="ax-btn danger sm" data-act="adm" data-c="restart" data-in="${m * 60000}">${this.T(['ريستارت بعد', 'Restart in'])} ${m}m</button>`).join('')}</div></section>` : ''}
    </div>${this.footer()}</div>`, 'admin dim');
  }
  adm(cmd, d = {}) {
    const A = this.app, s = A.sess; if (!A.isAdmin || !s) return;
    if (s.online) { A.net.send(Object.assign({ t: 'admin', cmd }, d)); }
    else { // singleplayer: apply locally
      if (cmd === 'time') s.env.time = +d.v; if (cmd === 'weather') s.env.setWeather(d.w, true);
      if (cmd === 'give') s.give(d.item, d.n); if (cmd === 'heal') { const P = s.player; P.hp = 100; P.food = 100; P.water = 100; P.effects = {}; }
      if (cmd === 'tpxz') { const y = Math.max(s.world.height(d.x, d.z), 0) + 1; s.player.pos = [d.x, y, d.z]; s.player.vel = [0, 0, 0]; }
    }
    if (s.online && cmd === 'time') s.env.time = +d.v; if (s.online && cmd === 'weather') s.env.setWeather(d.w, true);
    if (s.online && cmd === 'give' && d.target === 'me') {} // the server sends it back
    this.toast(this.T(['تم', 'Done']) + ' · ' + cmd, 'ok', 1500);
  }
  guide(tab) {
    tab = tab || this.guideTab || 'build'; this.guideTab = tab; const I = this.app.input, k = a => (I.binds[a] || []).slice(0, 1).map(x => `<span class="ax-kbd">${esc(I.keyName(x))}</span>`).join('');
    const step = (n, ic, t, d) => `<li class="gd-step"><span class="gd-n ax-data">${n}</span><span class="gd-ic">${ic}</span><div><b>${esc(this.T(t))}</b><p>${d}</p></div></li>`;
    const S = {
      start: [step(1, UI_ICONS.hp, ['راقب عداداتك', 'Watch your vitals'], this.T(['الصحة والأكل والموية تحت يمين الشاشة. إذا خلص الأكل أو الموية تبدأ تخسر صحة.', 'Health, food and water sit in the bottom corner. Run out of food or water and you start losing health.'])),
        step(2, ITEM_ICONS.rock, ['ابدأ بالحجر', 'Start with the rock'], this.T(['اضرب الأشجار والصخور بالحجر عشان تجمع خشب وحجر.', 'Hit trees and rocks with the rock to gather wood and stone.']) + ' ' + k('attack')),
        step(3, ITEM_ICONS.water_jug, ['اشرب وكل', 'Drink and eat'], this.T(['قرّب من بحيرة أو نهر واضغط', 'Walk up to a lake or river and press']) + ' ' + k('interact') + ' ' + this.T(['تشرب. التوت يعطيك أكل وموية.', 'to drink. Berries give food and water.'])),
        step(4, UI_ICONS.temp, ['انتبه للبرد', 'Mind the cold'], this.T(['الليل والمطر والجبال باردة. البس ملابس وولّع نار.', 'Nights, rain and mountains are cold. Wear clothes and light a fire.']))],
      gather: [step(1, ITEM_ICONS.stone_hatchet, ['الأدوات الصح', 'Use the right tool'], this.T(['الفأس للأشجار، والمعول للصخور والخام. الأدوات الحديد أسرع بكثير.', 'Hatchets for trees, pickaxes for rocks and ore. Metal tools are much faster.'])),
        step(2, ITEM_ICONS.metal_ore, ['الخام', 'Ore'], this.T(['الصخور اللي فيها عروق برتقالية تعطي خام حديد. ذوّبه بالفرن.', 'Rocks with orange veins give metal ore. Smelt it in a furnace.'])),
        step(3, ITEM_ICONS.cloth, ['القنب والتوت', 'Hemp and berries'], this.T(['النباتات الطويلة الخضرا تعطي قماش. اضغط', 'Tall green plants give cloth. Press']) + ' ' + k('interact')),
        step(4, ITEM_ICONS.scrap, ['الخردة', 'Scrap'], this.T(['في الصناديق والبراميل عند الأنقاض. تحتاجها لطاولة العمل.', 'Found in crates and barrels at ruins. Needed for workbenches.']))],
      craft: [step(1, UI_ICONS.craft, ['افتح الصناعة', 'Open crafting'], k('craft') + ' ' + this.T(['أو', 'or']) + ' ' + k('inventory') + ' ' + this.T(['← الصناعة. اختر الغرض واضغط اصنع.', '→ Crafting. Pick an item and press Craft.'])),
        step(2, UI_ICONS.bench, ['طاولات العمل', 'Workbenches'], this.T(['الأدوات الحديد والأسلحة النارية تحتاج طاولة عمل 1 أو 2. لازم تكون قريب منها.', 'Metal tools and firearms need Workbench 1 or 2. Stand next to it.'])),
        step(3, UI_ICONS.clock, ['الطابور', 'The queue'], this.T(['تقدر تصنع أكثر من غرض. يطلعون واحد واحد حتى لو قفلت الحقيبة.', 'Queue several items; they keep crafting even with the menu closed.']))],
      build: [step(1, ITEM_ICONS.plan, ['اصنع مخطط بناء', 'Craft a Building Plan'], this.T(['الصناعة ← أدوات ← مخطط بناء (20 خشب). وبعدين امسكه من الحزام.', 'Crafting → Tools → Building Plan (20 wood). Then hold it from your belt.'])),
        step(2, PIECE_ICONS.foundation, ['حط الأساس', 'Place a foundation'], this.T(['كليك يمين يفتح قائمة القطع ← أساس. اللون الأخضر يعني تقدر تبني، الأحمر يعني لا (والسبب يطلع تحت). كليك يسار للوضع،', 'Right-click opens the piece wheel → Foundation. Green means OK, red means blocked (the reason shows below). Left-click to place,']) + ' ' + k('reload') + ' ' + this.T(['للتدوير.', 'to rotate.'])),
        step(3, PIECE_ICONS.foundation, ['كبّر القاعدة', 'Grow the base'], this.T(['صوّب جنب الأساس وحط أساس ثاني، بيلتصق لحاله.', 'Aim next to a foundation to place another; it snaps automatically.'])),
        step(4, PIECE_ICONS.wall, ['الجدران', 'Walls'], this.T(['اختر جدار وصوّب على حافة الأساس. فيه كمان فتحة باب وجدار بشباك.', 'Pick Wall and aim at a foundation edge. There are also Doorways and Window walls.'])),
        step(5, PIECE_ICONS.floor, ['السقف والأدوار', 'Roof and floors'], this.T(['فوق الجدران حط أرضية عشان تسوي دور ثاني، أو سقف. الدرج يركب على الأساس.', 'On top of walls place a Floor for a second storey, or a Roof. Stairs go on a foundation.'])),
        step(6, ITEM_ICONS.hammer, ['قوّي قاعدتك', 'Upgrade'], this.T(['امسك المطرقة وصوّب على أي قطعة، كليك يمين: خشب ← حجر ← حديد، أو إصلاح، أو هدم.', 'Hold the hammer, aim at a piece, right-click: wood → stone → metal, repair or demolish.'])),
        step(7, ITEM_ICONS.wooden_door, ['الباب والأغراض', 'Door and items'], this.T(['اصنع باب وصوّب على فتحة الباب. حط داخل القاعدة صندوق وكيس نوم ونار.', 'Craft a door and aim at the doorway. Inside, place a box, a sleeping bag and a campfire.']))],
      fire: [step(1, ITEM_ICONS.campfire, ['نار المخيم', 'Campfire'], this.T(['حطها واضغط', 'Place it and press']) + ' ' + k('interact') + ' ' + this.T(['← حط خشب ولحم نيء ← ولّعها.', '→ add wood and raw meat → light it.'])),
        step(2, ITEM_ICONS.furnace, ['الفرن', 'Furnace'], this.T(['حط خشب وخام حديد وولّعه. يطلع لك حديد.', 'Add wood and metal ore and light it to get metal fragments.'])),
        step(3, ITEM_ICONS.raw_meat, ['اللحم', 'Meat'], this.T(['اللحم النيء ممكن يسممك. اطبخه أول.', 'Raw meat can poison you. Cook it first.']))],
      combat: [step(1, ITEM_ICONS.wooden_spear, ['القتال القريب', 'Melee'], this.T(['الرماح مداها طويل، والسيف والساطور ضربهم قوي. كل ضربة تاخذ من الطاقة.', 'Spears reach far, swords and machetes hit hard. Every swing costs stamina.'])),
        step(2, ITEM_ICONS.bow, ['القوس', 'Bow'], this.T(['اسحب بكليك يسار وفلّت. كليك يمين للتصويب.', 'Hold left click to draw, release to shoot. Right-click to aim.'])),
        step(3, ITEM_ICONS.revolver, ['الأسلحة النارية', 'Firearms'], this.T(['المسدس والشوزن والرشاش تنصنع بطاولة العمل. الطلقات منفصلة،', 'Revolver, shotgun and rifle are crafted at workbenches. Ammo is separate,']) + ' ' + k('reload') + ' ' + this.T(['للتلقيم.', 'reloads.'])),
        step(4, ITEM_ICONS.bandage, ['العلاج', 'Healing'], this.T(['الضماد يوقف النزيف، وحقيبة الإسعاف تعالج مع الوقت.', 'Bandages stop bleeding, medkits heal over time.']))]
    };
    const tabs = [['start', ['البداية', 'Start']], ['gather', ['الجمع', 'Gathering']], ['craft', ['الصناعة', 'Crafting']], ['build', ['البناء', 'Building']], ['fire', ['النار والأكل', 'Fire & food']], ['combat', ['القتال', 'Combat']]];
    this.show(`<div class="scr">${this.head(this.T(['دليل ARVEX', 'ARVEX Guide']), this.T(['كيف تلعب', 'How to play']))}<div class="ax-panel gd"><div class="ax-tabs">${tabs.map(([k2, n]) => `<button class="ax-tab ${tab === k2 ? 'on' : ''}" data-act="guideTab" data-v="${k2}">${this.T(n)}</button>`).join('')}</div><ol class="gd-list">${S[tab].join('')}</ol></div>${this.footer()}</div>`, 'guide ' + (this.app.state === 'play' ? 'dim' : ''));
  }
  // ------------------------------------------------------------------ in-game screens
  pause() {
    const s = this.app.sess, online = s && s.online;
    this.show(`<div class="scr center"><div class="ax-panel pause">${LOGO}<span class="ax-eyebrow">${online ? esc(this.app.net.server && this.app.net.server.name || '') : this.T(['لعب فردي', 'Singleplayer'])}</span><h2 class="ax-h2">${this.T(['متوقف', 'Paused'])}</h2>
      <div class="col"><button class="ax-btn primary lg block" data-act="resume">${this.T(['كمّل', 'Resume'])}</button><button class="ax-btn block" data-act="settings">${this.T(['الإعدادات', 'Settings'])}</button>${this.app.isAdmin ? `<button class="ax-btn block" data-act="admin">${this.T(['لوحة الأدمن', 'Admin panel'])} <span class="ax-kbd">F8</span></button>` : ''}<button class="ax-btn block" data-act="shop">${this.T(['المتجر', 'Shop'])}</button><button class="ax-btn block" data-act="guide">${this.T(['الدليل', 'Guide'])}</button><div class="code-row"><input class="ax-input" id="code-in" maxlength="24" autocomplete="off" autocapitalize="characters" placeholder="${this.T(['كود', 'Code'])}"><button class="ax-btn" data-act="redeem">${this.T(['فعّل', 'Redeem'])}</button></div>${this.app.input.isTouch() ? `<button class="ax-btn block" data-act="editTouch">${this.T(['ترتيب أزرار الجوال', 'Edit touch buttons'])}</button>` : ''}<button class="ax-btn block" data-act="controlsHelp">${this.T(['التحكم', 'Controls'])}</button><button class="ax-btn block" data-act="profile">${this.T(['الملف الشخصي', 'Profile'])}</button>
      <button class="ax-btn ghost block" data-act="saveQuit">${online ? this.T(['اطلع من السيرفر', 'Leave server']) : this.T(['احفظ واطلع للقائمة', 'Save & quit to menu'])}</button></div>
      ${online ? '' : `<p class="ax-meta">${this.T(['آخر حفظ', 'Last save'])}: ${s && s.lastSave ? new Date(s.lastSave).toLocaleTimeString() : '—'}</p>`}</div></div>`, 'pause dim');
  }
  controlsHelp() {
    const I = this.app.input, k = a => (I.binds[a] || []).slice(0, 2).map(x => `<span class="ax-kbd">${esc(I.keyName(x))}</span>`).join(' ');
    const rows = [['forward', 'back', 'left', 'right'], ['jump'], ['crouch'], ['sprint'], ['attack'], ['aim'], ['interact'], ['reload'], ['inventory'], ['craft'], ['drop'], ['map']];
    this.show(`<div class="scr">${this.head(this.T(['التحكم', 'Controls']), 'ARVEX SURVIVAL')}<div class="ax-panel help"><div class="help-grid">${rows.map(r => `<div class="help-row"><span>${r.map(a => esc(this.T(ACTION_NAMES[a]))).join(' / ')}</span><span>${r.map(k).join(' ')}</span></div>`).join('')}<div class="help-row"><span>${this.T(['الحزام', 'Hotbar'])}</span><span><span class="ax-kbd">1</span>–<span class="ax-kbd">6</span> · ${this.T(['عجلة الماوس', 'Mouse wheel'])}</span></div></div>
      <h3 class="ax-h3 sec-t">${this.T(['يد التحكم', 'Controller'])}</h3><p class="ax-muted">${this.T(['العصا اليسرى حركة · اليمنى كاميرا · A قفز · B انحناء · ضغطة العصا اليسرى ركض · RT ضرب · LT تصويب · X تفاعل · Y الحقيبة · LB/RB الحزام', 'Left stick move · right stick look · A jump · B crouch · L3 sprint · RT attack · LT aim · X interact · Y inventory · LB/RB hotbar'])}</p></div>${this.footer()}</div>`, 'help dim');
  }
  death(info) {
    const s = this.app.sess, hasBag = [...s.world.deploys.values()].some(d => d.kind === 'bag' && d.owner === s.ownerId);
    const cause = CAUSES[info.type] || ['ماتت', 'You died'], src = info.src && ANIMAL_NAMES[info.src] ? this.T(ANIMAL_NAMES[info.src]) : info.src && s.remote.get(info.src) ? s.remote.get(info.src).name : '';
    this.hudOn(false);
    this.show(`<div class="death"><div class="death-in"><span class="ax-eyebrow">ARVEX SURVIVAL</span><h1 class="ax-hero">${this.T(['متّ', 'You died'])}</h1><p class="death-cause">${esc(this.T(cause))}${src ? ' · ' + esc(src) : ''}</p>
      <div class="death-stats"><div><span class="ax-meta">${this.T(['وقت الجلسة', 'Session time'])}</span><b class="ax-data">${fmtTime(this.app.sessionTime())}</b></div><div><span class="ax-meta">${this.T(['المستوى', 'Level'])}</span><b class="ax-data">${s.stats.level}</b></div></div>
      <p class="ax-muted">${this.T(['أغراضك بقت في حقيبة مكان موتك. ارجع خذها قبل لا يسبقك أحد.', 'Your items stayed in a backpack where you died. Go back for it before someone else does.'])}</p>
      <div class="row"><button class="ax-btn primary lg" data-act="respawn">${this.T(['ارجع للشاطئ', 'Respawn on beach'])}</button>${hasBag ? `<button class="ax-btn lg" data-act="respawnBag">${this.T(['ارجع لكيس النوم', 'Respawn at sleeping bag'])}</button>` : ''}</div></div></div>`, 'deathscr');
  }
  hideDeath() { this.hide(); this.hudOn(true); }
  // ------------------------------------------------------------------ inventory / crafting / container overlay
  openInventory(tab) {
    const s = this.app.sess; if (!s || s.player.dead) return;
    if (tab === 'container') this.invTab = 'container'; else if (tab) this.invTab = tab; else if (this.invTab === 'container' && !s.openCont) this.invTab = 'inv';
    this.ov.classList.add('on'); this.app.input.unlock(); this.renderInv(); this.app.audio.play('open');
  }
  closeInventory() { if (!this.ov.classList.contains('on')) return; const s = this.app.sess; this.ov.classList.remove('on'); this.ov.innerHTML = ''; this.hideTip(); if (s && s.openCont) s.closeContainer(); if (this.invTab === 'container') this.invTab = 'inv'; this.app.lockPointer(); this.app.audio.play('close'); }
  refreshContainer() { if (this.ov.classList.contains('on') && this.invTab === 'container') this.renderInv(); }
  slotHtml(cont, i, kind) {
    const it = cont.slots[i], s = this.app.sess, active = kind === 'belt' && s.inv.active === i;
    const ph = kind === 'wear' ? `<span class="ph">${this.T(WEAR_NAMES[WEAR_SLOTS[i]])}</span>` : kind === 'belt' ? `<span class="num">${i + 1}</span>` : '';
    if (!it) return `<div class="slot empty ${kind} ${active ? 'active' : ''}" data-c="${kind}" data-i="${i}">${ph}</div>`;
    const I = ITEMS[it.id], cond = it.cond != null ? `<i class="cond" style="--v:${Math.max(0, it.cond / I.cond * 100)}%"></i>` : '', jug = it.jug != null ? `<i class="cond water" style="--v:${it.jug}%"></i>` : '';
    return `<div class="slot ${kind} ${active ? 'active' : ''}" data-c="${kind}" data-i="${i}" data-tip="${esc(this.itemTip(it))}">${kind === 'belt' ? `<span class="num">${i + 1}</span>` : ''}<span class="ic">${iconFor(it.id)}</span>${it.n > 1 ? `<span class="n ax-data">${it.n > 999 ? Math.floor(it.n / 1000) + 'k' : it.n}</span>` : ''}${it.ammo != null ? `<span class="n ax-data ammo">${it.ammo}</span>` : ''}${cond}${jug}</div>`;
  }
  itemTip(it) {
    const I = ITEMS[it.id], L = this.L, lines = [];
    if (I.melee) lines.push(`${this.T(['ضرر', 'Damage'])}: ${I.melee.dmg}`); if (I.ranged) lines.push(`${this.T(['ضرر', 'Damage'])}: ${I.ranged.dmg} · ${this.T(['ذخيرة', 'Ammo'])}: ${nameOf(I.ranged.ammo, L)}`);
    if (I.gather && I.gather.tree && I.gather.tree[1] >= 1) lines.push(this.T(['ممتاز للأشجار', 'Great on trees'])); if (I.gather && I.gather.rock && I.gather.rock[1] >= 1) lines.push(this.T(['ممتاز للصخور', 'Great on rocks']));
    if (I.wear) lines.push(`${this.T(['حماية', 'Armour'])}: ${Math.round(I.wear.armor * 100)}% · ${this.T(['دفء', 'Warmth'])}: +${I.wear.ins}°`);
    if (I.eat) lines.push(Object.entries(I.eat).filter(([k]) => k !== 'poison').map(([k, v]) => `${this.T(STAT_NAMES[k] || [k, k])} +${v}`).join(' · '));
    if (I.heal) lines.push(`${this.T(['صحة', 'Health'])} +${I.heal.hp}${I.heal.regen ? ' (+' + I.heal.regen + ')' : ''}`);
    if (it.cond != null) lines.push(`${this.T(['الحالة', 'Condition'])}: ${Math.max(0, Math.round(it.cond / I.cond * 100))}%`);
    if (it.jug != null) lines.push(`${this.T(['الموية', 'Water'])}: ${it.jug}%`);
    return `<b>${esc(nameOf(it.id, L))}</b><span class="ax-eyebrow">${esc(this.T(CAT_NAMES[I.cat]))}</span><p>${esc(this.T(I.desc))}</p>${lines.length ? `<p class="ax-meta">${lines.map(esc).join('<br>')}</p>` : ''}<p class="ax-meta">${this.T(['كليك يمين: استخدام · Shift: نقل سريع · Ctrl: تقسيم', 'RMB: use · Shift: quick move · Ctrl: split'])}</p>`;
  }
  renderInv() {
    const s = this.app.sess, inv = s.inv, L = this.L, P = s.player, tab = this.invTab;
    const grid = (c, kind, cls = '') => `<div class="grid ${cls}">${c.slots.map((_, i) => this.slotHtml(c, i, kind)).join('')}</div>`;
    const arm = inv.armor();
    const left = `<section class="inv-col inv-eq"><span class="ax-eyebrow">${this.T(['الملابس', 'Clothing'])}</span>${grid(inv.wear, 'wear', 'wear-grid')}
      <div class="eq-stats"><div><span class="ax-meta">${this.T(['حماية', 'Armour'])}</span><b class="ax-data">${Math.round(arm.armor * 100)}%</b></div><div><span class="ax-meta">${this.T(['دفء', 'Warmth'])}</span><b class="ax-data">+${arm.ins}°</b></div><div><span class="ax-meta">${this.T(['حرارة الجسم', 'Body temp'])}</span><b class="ax-data">${P.temp.toFixed(0)}°</b></div></div>
      <div class="eq-stats"><div><span class="ax-meta">${this.T(['المستوى', 'Level'])}</span><b class="ax-data">${s.stats.level}</b></div><div><span class="ax-meta">${this.T(['الجلسة', 'Session'])}</span><b class="ax-data">${fmtTime(this.app.sessionTime())}</b></div></div></section>`;
    const mid = `<section class="inv-col inv-main"><div class="row-sb"><span class="ax-eyebrow">${this.T(['الحقيبة', 'Inventory'])}</span><span class="ax-meta">${inv.main.slots.filter(Boolean).length}/24</span></div>${grid(inv.main, 'main')}<span class="ax-eyebrow">${this.T(['الحزام', 'Belt'])}</span>${grid(inv.belt, 'belt', 'belt-grid')}<div class="drop-zone" data-c="drop">${UI_ICONS.drop}${this.T(['اسحب هنا للرمي', 'Drag here to drop'])}</div></section>`;
    let right = '';
    if (tab === 'container' && s.openCont) {
      const c = s.openCont, d = c.d, lit = d && (d.kind === 'campfire' || d.kind === 'furnace');
      right = `<section class="inv-col inv-ext"><div class="row-sb"><span class="ax-eyebrow">${esc(c.title)}</span>${lit ? `<span class="ax-chip dot ${d.lit ? 'signal pulse' : ''}">${d.lit ? this.T(['شغالة', 'Burning']) : this.T(['طافية', 'Off'])}</span>` : ''}</div>${grid(c.cont, 'ext')}
        ${lit ? `<button class="ax-btn ${d.lit ? '' : 'primary'} block" data-act="toggleLit">${UI_ICONS.flame}${d.lit ? this.T(['طفّها', 'Extinguish']) : this.T(['ولّعها', 'Light it'])}</button><p class="ax-meta">${d.kind === 'campfire' ? this.T(['حط خشب ولحم نيء. كل 10 ثواني تنطبخ قطعة.', 'Add wood and raw meat. One piece cooks every 10 seconds.']) : this.T(['حط خشب وخام حديد. كل ثانيتين يذوب خام.', 'Add wood and metal ore. One ore smelts every 2 seconds.'])}</p>` : ''}
        <button class="ax-btn ghost block sm" data-act="lootAll">${this.T(['خذ الكل', 'Take all'])}</button></section>`;
    } else right = this.craftHtml();
    this.ov.innerHTML = `<div class="inv"><header class="inv-head">${MARK}<div class="ax-tabs"><button class="ax-tab ${tab === 'inv' || tab === 'container' ? 'on' : ''}" data-act="invTab" data-v="${s.openCont ? 'container' : 'inv'}">${UI_ICONS.inv}${s.openCont ? esc(s.openCont.title) : this.T(['الحقيبة', 'Inventory'])}</button><button class="ax-tab ${tab === 'craft' ? 'on' : ''}" data-act="invTab" data-v="craft">${UI_ICONS.craft}${this.T(['الصناعة', 'Crafting'])}</button></div><span class="bench-lv ax-chip ${s.benchLevel() ? 'signal' : ''}">${UI_ICONS.bench}${this.T(['طاولة العمل', 'Workbench'])}: ${s.benchLevel() || '—'}</span><button class="ax-btn ghost sm icon-btn" data-act="closeInv">${UI_ICONS.close}<span class="ax-kbd">TAB</span></button></header>
      <div class="inv-body ${tab === 'craft' ? 'crafting' : ''}">${left}${mid}${right}</div></div>`;
    this.bindDrag();
  }
  craftHtml() {
    const s = this.app.sess, L = this.L, cats = ['all', 'tool', 'weapon', 'ammo', 'deploy', 'cloth', 'medical', 'food'];
    const list = RECIPES.filter(r => this.craftCat === 'all' || r.cat === this.craftCat);
    const sel = RECIPES.find(r => r.out === this.craftSel) || list[0]; this.craftSel = sel && sel.out;
    const bench = s.benchLevel();
    const rows = list.map(r => { const c = s.canCraft(r); return `<button class="rc ${r === sel ? 'on' : ''} ${c.ok ? 'can' : ''} ${bench < r.bench ? 'locked' : ''}" data-act="craftSel" data-id="${r.out}"><span class="ic">${iconFor(r.out)}</span><span class="rc-n">${esc(nameOf(r.out, L))}${r.n > 1 ? ' ×' + r.n : ''}</span>${r.bench ? `<span class="ax-chip ${bench >= r.bench ? '' : 'warn'}">WB${r.bench}</span>` : ''}</button>`; }).join('');
    let det = '';
    if (sel) {
      const n = this.craftN, c = s.canCraft(sel, n), I = ITEMS[sel.out];
      det = `<div class="rc-det"><div class="rc-top"><span class="ic big">${iconFor(sel.out)}</span><div><h3 class="ax-h3">${esc(nameOf(sel.out, L))}</h3><span class="ax-eyebrow">${esc(this.T(CAT_NAMES[I.cat]))}</span><p class="ax-muted">${esc(this.T(I.desc))}</p></div></div>
        <div class="req">${Object.entries(sel.req).map(([k, v]) => { const have = s.inv.count(k), need = v * n; return `<div class="rq ${have >= need ? 'ok' : 'no'}"><span class="ic sm">${iconFor(k)}</span><span>${esc(nameOf(k, L))}</span><span class="ax-data">${have} / ${need}</span></div>`; }).join('')}
          ${sel.bench ? `<div class="rq ${bench >= sel.bench ? 'ok' : 'no'}"><span class="ic sm">${UI_ICONS.bench}</span><span>${this.T(['طاولة عمل مستوى', 'Workbench level'])} ${sel.bench}</span><span class="ax-data">${bench}/${sel.bench}</span></div>` : ''}</div>
        <div class="rc-act"><div class="qty"><button class="ax-btn ghost sm" data-act="craftN" data-v="-1">${UI_ICONS.minus}</button><span class="ax-data">${n}</span><button class="ax-btn ghost sm" data-act="craftN" data-v="1">${UI_ICONS.plus}</button></div><span class="ax-meta">${UI_ICONS.clock}${(sel.time * n).toFixed(0)}s</span><button class="ax-btn primary" data-act="craft" ${c.ok ? '' : 'disabled'}>${this.T(['اصنع', 'Craft'])}</button></div></div>`;
    }
    const q = s.queue.map((x, i) => `<div class="q-it" data-tip="${esc(nameOf(x.r.out, L))}"><span class="ic sm">${iconFor(x.r.out)}</span><span class="ax-data">×${x.left}</span>${i === 0 ? `<i class="qbar" style="--v:${Math.round((1 - x.t / x.total) * 100)}%"></i>` : ''}<button class="x" data-act="cancelCraft" data-i="${i}">${UI_ICONS.close}</button></div>`).join('');
    return `<section class="inv-col inv-craft"><div class="cats">${cats.map(c => `<button class="cat ${this.craftCat === c ? 'on' : ''}" data-act="craftCat" data-v="${c}">${esc(this.T(CAT_NAMES[c]))}</button>`).join('')}</div><div class="rc-wrap"><div class="rc-list">${rows}</div>${det}</div><div class="queue"><span class="ax-eyebrow">${this.T(['طابور الصناعة', 'Craft queue'])}</span><div class="q-row">${q || `<span class="ax-meta">${this.T(['فاضي', 'Empty'])}</span>`}</div></div></section>`;
  }
  contOf(kind) { const s = this.app.sess; return kind === 'ext' ? s.openCont && s.openCont.cont : s.inv[kind]; }
  bindDrag() {
    const s = this.app.sess;
    $$('.slot', this.ov).forEach(el => {
      el.addEventListener('contextmenu', e => { e.preventDefault(); const c = this.contOf(el.dataset.c), i = +el.dataset.i; if (c && c.slots[i]) { if (!s.useItem(c, i)) { if (ITEMS[c.slots[i].id].wear && el.dataset.c === 'wear') { s.inv.quickMove(c, i, null); s.recalcWear(); } } this.afterInvChange(); } });
      el.addEventListener('pointerdown', e => {
        if (e.button === 2) return; const c = this.contOf(el.dataset.c), i = +el.dataset.i; if (!c || !c.slots[i]) return;
        if (e.shiftKey) { s.inv.quickMove(c, i, s.openCont && s.openCont.cont); s.recalcWear(); this.afterInvChange(); this.app.audio.play('ui'); return; }
        if (e.ctrlKey) { PlayerInventory.split(c, i); this.afterInvChange(); return; }
        e.preventDefault(); this.hideTip();
        const ghost = document.createElement('div'); ghost.className = 'drag-ghost'; ghost.innerHTML = el.innerHTML; document.body.appendChild(ghost);
        const half = e.button === 1 || (e.pointerType === 'touch' && false);
        let moved = false, longT = e.pointerType === 'touch' ? setTimeout(() => { if (!moved) { this.slotMenu(el, c, i); cleanup(); } }, 450) : null;
        const pos = ev => { ghost.style.left = ev.clientX + 'px'; ghost.style.top = ev.clientY + 'px'; }; pos(e);
        el.classList.add('dragging');
        const move = ev => { if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) > 6) moved = true; pos(ev); $$('.slot.over', this.ov).forEach(x => x.classList.remove('over')); const t = document.elementFromPoint(ev.clientX, ev.clientY); const ts = t && t.closest('.slot,.drop-zone'); if (ts) ts.classList.add('over'); };
        const cleanup = () => { clearTimeout(longT); removeEventListener('pointermove', move); removeEventListener('pointerup', up); ghost.remove(); el.classList.remove('dragging'); $$('.over', this.ov).forEach(x => x.classList.remove('over')); };
        const up = ev => {
          cleanup(); if (!moved) return;
          const t = document.elementFromPoint(ev.clientX, ev.clientY), ts = t && t.closest('.slot,.drop-zone');
          if (!ts) { s.dropItem(c, i, half ? Math.ceil(c.slots[i].n / 2) : 0); this.afterInvChange(); return; }
          if (ts.classList.contains('drop-zone')) { s.dropItem(c, i); this.afterInvChange(); return; }
          const dc = this.contOf(ts.dataset.c), di = +ts.dataset.i;
          if (dc && PlayerInventory.move(c, i, dc, di, half ? Math.ceil(c.slots[i].n / 2) : 0)) { this.app.audio.play('ui'); s.recalcWear(); this.afterInvChange(); } else this.app.audio.play('fail');
        };
        addEventListener('pointermove', move); addEventListener('pointerup', up);
      });
    });
  }
  slotMenu(el, c, i) {
    const s = this.app.sess, it = c.slots[i]; if (!it) return; const I = ITEMS[it.id];
    const m = document.createElement('div'); m.className = 'slot-menu ax-panel'; const r = el.getBoundingClientRect(); m.style.left = r.left + 'px'; m.style.top = r.bottom + 4 + 'px';
    const acts = []; if (I.eat || I.heal || I.jug != null) acts.push(['use', this.T(['استخدام', 'Use'])]); if (I.wear) acts.push(['use', this.T(['لبس', 'Equip'])]); if (it.n > 1) acts.push(['split', this.T(['تقسيم', 'Split'])]); acts.push(['move', this.T(['نقل سريع', 'Quick move'])]); acts.push(['drop', this.T(['رمي', 'Drop'])]);
    m.innerHTML = acts.map(([k, n]) => `<button class="ax-btn ghost sm block" data-m="${k}">${esc(n)}</button>`).join('');
    document.body.appendChild(m);
    const close = () => { m.remove(); removeEventListener('pointerdown', out, true); }, out = e => { if (!m.contains(e.target)) close(); };
    setTimeout(() => addEventListener('pointerdown', out, true), 10);
    m.addEventListener('click', e => { const b = e.target.closest('[data-m]'); if (!b) return; const k = b.dataset.m; if (k === 'use') s.useItem(c, i); if (k === 'split') PlayerInventory.split(c, i); if (k === 'move') s.inv.quickMove(c, i, s.openCont && s.openCont.cont); if (k === 'drop') s.dropItem(c, i); s.recalcWear(); close(); this.afterInvChange(); });
  }
  afterInvChange() { const s = this.app.sess; s.inv.changed('ui'); s.containerChanged(); this.renderInv(); }
  // ------------------------------------------------------------------ radial wheel (building plan / hammer)
  wheel(kind, st) {
    const s = this.app.sess, L = this.L; let items;
    if (kind === 'plan') items = PIECE_ORDER.map(p => ({ id: p, label: this.T(PIECES[p].name), cost: pieceCost(p, 0), icon: PIECE_ICONS[p], on: s.pieceSel === p }));
    else { items = s.builder.upgradeOptions(st).map(o => ({ id: 'up' + o.tier, label: this.T(TIERS[o.tier].name), cost: o.cost, icon: TIER_ICONS[o.tier] })); const rc = s.builder.repairCost(st); if (rc) items.push({ id: 'repair', label: this.T(['إصلاح', 'Repair']), cost: rc, icon: UI_ICONS.hammer }); items.push({ id: 'demolish', label: this.T(['هدم', 'Demolish']), icon: UI_ICONS.close, danger: true }); }
    this.wheelState = { kind, st, items, sel: -1 }; this.app.input.unlock();
    const n = items.length, w = document.createElement('div'); w.className = 'wheel'; w.id = 'wheel';
    w.innerHTML = `<div class="wheel-ring">${items.map((it, i) => { const a = i / n * Math.PI * 2 - Math.PI / 2, x = Math.cos(a) * 150, y = Math.sin(a) * 150; return `<button class="wh-it ${it.on ? 'on' : ''} ${it.danger ? 'danger' : ''}" data-wi="${i}" style="transform:translate(${x}px,${y}px)"><span class="wh-ic">${it.icon || ''}</span><b>${esc(it.label)}</b>${it.cost ? `<span class="ax-meta">${Object.entries(it.cost).map(([k, v]) => `${v} ${esc(nameOf(k, L))}`).join(' · ')}</span>` : ''}</button>`; }).join('')}<div class="wheel-c">${kind === 'plan' ? `<span class="ax-eyebrow">${this.T(['مخطط البناء', 'Building plan'])}</span><span class="ax-meta">R ${this.T(['تدوير', 'rotate'])}</span>` : `<span class="ax-eyebrow">${esc(this.T(PIECES[st.piece].name))}</span><span class="ax-meta">${esc(this.T(TIERS[st.tier].name))} · ${Math.round(st.hp)}/${pieceHP(st.piece, st.tier)}</span>`}</div></div>`;
    document.body.appendChild(w);
    w.addEventListener('click', e => { const b = e.target.closest('[data-wi]'); this.wheelPick(b ? +b.dataset.wi : -1); });
    this._wheelUp = e => { if (e.button === 2) { const b = document.elementFromPoint(e.clientX, e.clientY); const x = b && b.closest('[data-wi]'); this.wheelPick(x ? +x.dataset.wi : -1); } };
    setTimeout(() => addEventListener('mouseup', this._wheelUp), 120);
  }
  wheelPick(i) {
    const W = this.wheelState; if (!W) return; this.wheelState = null; const el = $('#wheel'); if (el) el.remove(); removeEventListener('mouseup', this._wheelUp); this.app.lockPointer();
    if (i < 0) return; const it = W.items[i], s = this.app.sess;
    if (W.kind === 'plan') { s.pieceSel = it.id; this.app.audio.play('uiok'); return; }
    if (it.id === 'repair') s.hammerRepair(W.st); else if (it.id === 'demolish') s.demolish(W.st); else s.upgrade(W.st, +it.id.slice(2));
  }
  // ------------------------------------------------------------------ map
  toggleMap() {
    if (this.mapOpen) { this.mapOpen = false; $('#map').remove(); this.app.lockPointer(); return; }
    const s = this.app.sess; this.mapOpen = true; this.app.input.unlock();
    const d = document.createElement('div'); d.id = 'map'; d.className = 'map-ov'; d.innerHTML = `<div class="map-box ax-panel"><div class="row-sb"><span class="ax-eyebrow">${this.T(['خريطة جزيرة ARVEX', 'ARVEX Island map'])}</span><button class="ax-btn ghost sm" data-act="map">${UI_ICONS.close}<span class="ax-kbd">M</span></button></div><canvas width="640" height="640"></canvas></div>`;
    document.body.appendChild(d);
    const cv = d.querySelector('canvas'), g = cv.getContext('2d');
    if (this.app.isAdmin) { cv.style.cursor = 'crosshair'; cv.addEventListener('click', e => { const r = cv.getBoundingClientRect(), x = -768 + (e.clientX - r.left) / r.width * 1536, z = -768 + (e.clientY - r.top) / r.height * 1536; this.adm('tpxz', { target: 'me', x, z }); this.toggleMap(); }); }
    if (!this._mapImg || this._mapSeed !== s.seed) { this._mapSeed = s.seed; const img = g.createImageData(640, 640), T = s.world.T; for (let j = 0; j < 640; j++) for (let i = 0; i < 640; i++) { const x = -768 + i * 2.4, z = -768 + j * 2.4, h = T.height(x, z), b = T.biome(x, z), C = [[24, 46, 62], [190, 175, 135], [92, 116, 58], [52, 76, 40], [110, 106, 98], [225, 228, 230]][b], k = b === 0 ? 0.7 + Math.max(-30, h) / 100 : 0.75 + Math.min(1, h / 140) * 0.4, o = (j * 640 + i) * 4; img.data[o] = Math.min(255, C[0] * k); img.data[o + 1] = Math.min(255, C[1] * k); img.data[o + 2] = Math.min(255, C[2] * k); img.data[o + 3] = 255; } this._mapImg = img; }
    const draw = () => {
      if (!this.mapOpen) return; g.putImageData(this._mapImg, 0, 0); const M = (x, z) => [(x + 768) / 2.4, (z + 768) / 2.4];
      g.font = '600 12px "Arvex Display", sans-serif'; g.textAlign = 'center';
      for (const p of s.world.pois) { const [x, y] = M(p.x, p.z); g.fillStyle = '#ECE6DA'; g.fillRect(x - 3, y - 3, 6, 6); g.fillStyle = 'rgba(13,15,18,.8)'; g.fillText(this.T(POI_NAMES[p.kind]).toUpperCase(), x + 1, y - 7); g.fillStyle = '#ECE6DA'; g.fillText(this.T(POI_NAMES[p.kind]).toUpperCase(), x, y - 8); }
      for (const b of s.world.buildings.values()) { const [x, y] = M(b.x, b.z); g.fillStyle = '#7FB7D9'; g.fillRect(x - 2.5, y - 2.5, 5, 5); }
      for (const dp of s.world.deploys.values()) if (dp.kind === 'bag' && dp.owner === s.ownerId) { const [x, y] = M(dp.x, dp.z); g.strokeStyle = '#9DBE5C'; g.lineWidth = 2; g.strokeRect(x - 4, y - 4, 8, 8); }
      for (const r of s.remote.values()) { const [x, y] = M(r.pos[0], r.pos[2]); g.fillStyle = '#F2B33D'; g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill(); }
      const P = s.player, [px, py] = M(P.pos[0], P.pos[2]); g.save(); g.translate(px, py); g.rotate(P.yaw); g.fillStyle = '#FF5A1F'; g.beginPath(); g.moveTo(0, -9); g.lineTo(6, 6); g.lineTo(0, 3); g.lineTo(-6, 6); g.closePath(); g.fill(); g.restore();
      requestAnimationFrame(draw);
    }; draw();
  }
  // ------------------------------------------------------------------ chat (online)
  openChat() { if (this.chatOpen || !this.app.sess || !this.app.sess.online) return; this.chatOpen = true; this.app.input.unlock(); const c = $('#chat'); c.classList.add('open'); const inp = c.querySelector('input'); inp.value = ''; inp.focus(); }
  closeChat(send) { const c = $('#chat'), inp = c.querySelector('input'); if (send && inp.value.trim()) this.app.net.send({ t: 'chat', msg: inp.value.trim().slice(0, 160) }); c.classList.remove('open'); inp.blur(); this.chatOpen = false; this.app.lockPointer(); }
  chatLine(name, msg, sys) { const c = $('#chat .lines'); if (!c) return; const d = document.createElement('div'); d.className = 'cl ' + (sys ? 'sys' : ''); d.innerHTML = sys ? esc(msg) : `<b>${esc(name)}</b> ${esc(msg)}`; c.appendChild(d); while (c.children.length > 8) c.firstChild.remove(); setTimeout(() => d.classList.add('old'), 9000); }
  // ------------------------------------------------------------------ HUD
  buildHUD() {
    this.hud.innerHTML = `
      <div class="hud-brand"><img src="brand/arvex-mark.svg" alt=""><div><b>ARVEX SURVIVAL</b><span class="ax-meta" id="h-ver"></span></div><div class="hud-net"><span class="ax-meta" id="h-srv"></span><span class="ax-meta" id="h-conn"></span><span class="ax-meta" id="h-pl"></span><span class="ax-meta" id="h-play"></span></div></div>
      <div class="hud-compass"><div class="cmp-strip" id="cmp"></div><i class="cmp-mark"></i><span class="ax-meta" id="h-clock"></span></div>
      <div class="hud-obj" id="obj"></div><div class="hud-feed" id="feed"></div><div id="notices" class="hud-notices"></div>
      <div class="cross" id="cross"><i></i></div><div class="hitm" id="hitm"></div>
      <div class="prompt" id="prompt"></div><div class="build-info" id="binfo"></div>
      <div class="hud-effects" id="fx"></div>
      <div class="vitals"><div class="vit" data-k="hp"><span class="vi">${UI_ICONS.hp}</span><i class="bar"><b id="v-hp"></b></i><span class="ax-data" id="t-hp"></span></div><div class="vit" data-k="food"><span class="vi">${UI_ICONS.food}</span><i class="bar"><b id="v-food"></b></i><span class="ax-data" id="t-food"></span></div><div class="vit" data-k="water"><span class="vi">${UI_ICONS.water}</span><i class="bar"><b id="v-water"></b></i><span class="ax-data" id="t-water"></span></div></div>
      <div class="stam"><i id="v-stam"></i></div>
      <div class="hotbar" id="hotbar"></div>
      <div class="fps ax-meta" id="fps"></div>
      <div id="chat" class="chat"><div class="lines"></div><input class="ax-input" maxlength="160" placeholder="${this.T(['اكتب رسالة…', 'Say something…'])}"></div>`;
    // hotbar: react to the press itself (the bar is redrawn while the finger is down, so a click never arrives on touch screens)
    addEventListener('pointerdown', e => { const h = e.target.closest && e.target.closest('#hotbar .hb'); if (h && this.app.sess && this.app.state === 'play' && !this.app.paused) { e.preventDefault(); e.stopPropagation(); this.app.sess.selectSlot(+h.dataset.i); } }, true);
    const ci = $('#chat input'); ci.addEventListener('keydown', e => { if (e.key === 'Enter') this.closeChat(true); if (e.key === 'Escape') this.closeChat(false); e.stopPropagation(); });
    this.cache = {};
  }
  hudOn(on) { this.hud.classList.toggle('on', on); $('#touch').classList.toggle('on', on && this.app.input.isTouch()); }
  set(id, v, prop = 'textContent') { if (this.cache[id + prop] === v) return; this.cache[id + prop] = v; const e = document.getElementById(id); if (e) { if (prop === 'w') e.style.width = v; else e[prop] = v; } }
  updateHUD(dt) {
    const s = this.app.sess; if (!s) return; const P = s.player, A = this.app, L = this.L, net = A.net;
    this.set('h-ver', 'v' + A.VERSION);
    if (s.online && net.server) { this.set('h-srv', net.server.name + ' · ' + this.T(REGIONS[net.server.region] || [net.server.region, net.server.region])); this.set('h-conn', (net.status === 'on' ? '● ' + this.T(['متصل', 'Connected']) : '○ ' + this.T(['انقطع', 'Reconnecting'])) + (net.ping != null ? ' · ' + net.ping + 'ms' : '')); this.set('h-pl', `${this.T(['السيرفر', 'Server'])} ${net.counts.server}/${net.server.max} · ${this.T(['أونلاين', 'Online'])} ${net.counts.total} · ${this.T(['سيرفرات', 'Servers'])} ${net.counts.servers}`); }
    else { this.set('h-srv', this.T(['لعب فردي', 'Singleplayer'])); this.set('h-conn', ''); this.set('h-pl', ''); }
    this.set('h-play', this.T(['وقت اللعب', 'Playing time']) + ' ' + fmtTime(A.sessionTime()) + (s.online && A.serverProfile ? ' · ' + this.T(['الإجمالي', 'Total']) + ' ' + fmtHours(A.serverProfile.total + A.sessionTime(), L) : ''));
    // vitals
    for (const k of ['hp', 'food', 'water']) { const v = Math.max(0, Math.min(100, P[k])); this.set('v-' + k, v.toFixed(1) + '%', 'w'); this.set('t-' + k, Math.ceil(v) + ''); }
    $('.vit[data-k="hp"]').classList.toggle('low', P.hp < 25); $('.vit[data-k="food"]').classList.toggle('low', P.food < 15); $('.vit[data-k="water"]').classList.toggle('low', P.water < 15);
    this.set('v-stam', P.stam.toFixed(0) + '%', 'w'); $('.stam').classList.toggle('show', P.stam < 99);
    // effects
    const fx = []; const E = P.effects;
    if (E.bleed > 0) fx.push(['bleed', this.T(['نزيف', 'Bleeding']), 'err']); if (E.poison > 0) fx.push(['poison', this.T(['تسمم', 'Poisoned']), 'err']); if (E.cold > 0) fx.push(['cold', this.T(['برد', 'Cold']) + ' ' + P.temp.toFixed(0) + '°', 'info']); if (E.wet > 3) fx.push(['wet', this.T(['مبلول', 'Wet']), 'info']);
    if (E.comfort) fx.push(['comfort', this.T(['دفء', 'Comfort']), 'ok']); if (E.wellfed) fx.push(['wellfed', this.T(['شبعان', 'Well fed']), 'ok']); if (E.regen > 0) fx.push(['regen', this.T(['يتعالج', 'Healing']), 'ok']); if (P.headUnder) fx.push(['water', this.T(['هواء', 'Air']) + ' ' + Math.ceil(P.air || 0), 'info']);
    const fxh = fx.map(([k, n, c]) => `<div class="ef ${c}">${UI_ICONS[k] || ''}<span>${esc(n)}</span></div>`).join(''); this.set('fx', fxh, 'innerHTML');
    // hotbar
    const hb = s.inv.belt.slots.map((it, i) => { const I = it && ITEMS[it.id]; return `<div class="hb ${i === s.inv.active ? 'on' : ''}" data-act="hot" data-i="${i}"><span class="num">${i + 1}</span>${it ? `<span class="ic">${iconFor(it.id)}</span>${it.n > 1 ? `<span class="n ax-data">${it.n}</span>` : ''}${it.ammo != null ? `<span class="n ax-data">${it.ammo}/${s.inv.count(I.ranged.ammo)}</span>` : ''}${it.cond != null ? `<i class="cond" style="--v:${Math.max(0, it.cond / I.cond * 100)}%"></i>` : ''}` : ''}</div>`; }).join('');
    const act = s.inv.activeItem(); this.set('hotbar', hb + (act ? `<div class="hb-name">${esc(nameOf(act.id, L))}</div>` : ''), 'innerHTML');
    // compass & clock
    const deg = ((s.player.yaw * 180 / Math.PI) % 360 + 360) % 360; const strip = $('#cmp'); if (strip) { if (!strip.dataset.b) { strip.dataset.b = 1; let h = ''; const marks = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' }; for (let k = -1; k <= 1; k++) for (let a = 0; a < 360; a += 15) h += `<span style="left:${(a + k * 360) * 3}px" class="${marks[a] ? 'big' : ''}">${marks[a] || '|'}</span>`; strip.innerHTML = h; } strip.style.transform = `translateX(${-deg * 3}px)`; }
    this.set('h-clock', A.S.showClock ? `${s.env.clock()} · ${this.T(WEATHER[s.env.next].name)}` : '');
    // prompt
    const fl = s.focusLabel(); this.set('prompt', fl ? `${fl[1] ? `<span class="ax-kbd">${fl[1] === 'LMB' ? (this.app.input.isTouch() ? '⚔' : 'LMB') : fl[1] === 'E' && this.app.input.isTouch() ? '✋' : fl[1]}</span>` : ''}<span>${esc(fl[0])}</span>` : '', 'innerHTML');
    // build info
    let bi = '';
    if (s.cand && s.mode === 'plan') bi = `<b>${esc(this.T(PIECES[s.pieceSel].name))}</b><span>${Object.entries(s.cand.cost).map(([k, v]) => `${v} ${esc(nameOf(k, L))}`).join(' · ')}</span>${!s.cand.ok && s.cand.reason ? `<span class="bad">${esc(this.T(BUILD_REASONS[s.cand.reason] || ['—', '—']))}</span>` : ''}<span class="ax-meta">${this.T(['كليك يمين: القطع · R: تدوير', 'RMB: pieces · R: rotate'])}</span>`;
    else if (s.cand && s.mode === 'deploy') bi = `<b>${esc(nameOf(s.cand.item, L))}</b><span class="ax-meta">${this.T(['كليك يسار: ضع · R: تدوير', 'LMB: place · R: rotate'])}</span>`;
    else if (s.mode === 'hammer') { const st = s.focus && s.focus.kind === 'structure' && s.focus.st; bi = st ? `<b>${esc(this.T(PIECES[st.piece].name))} · ${esc(this.T(TIERS[st.tier].name))}</b><i class="hpbar"><b style="width:${st.hp / pieceHP(st.piece, st.tier) * 100}%"></b></i><span class="ax-meta">${Math.round(st.hp)} / ${pieceHP(st.piece, st.tier)}</span>` : ''; }
    this.set('binfo', bi, 'innerHTML');
    // feed
    const feed = s.feed.map(f => `<div class="fd ${s.t - f.t > 3.5 ? 'out' : ''}"><span class="ic sm">${iconFor(f.id)}</span><b class="ax-data">+${f.n}</b><span>${esc(nameOf(f.id, L))}</span></div>`).join(''); this.set('feed', feed, 'innerHTML');
    // crosshair: hide with plan/deploy, widen with spread
    const ch = $('#cross'); ch.classList.toggle('aim', s.aim > 0.5); ch.classList.toggle('draw', s.held.draw > 0); ch.style.setProperty('--d', s.held.draw);
    const hm = $('#hitm'); const lastHit = s.hits[s.hits.length - 1]; hm.classList.toggle('on', !!lastHit && s.t - lastHit.t < 0.18);
    const ob = A.S.hints ? s.objectiveInfo() : null; this.set('obj', ob ? `<span class="ax-eyebrow">${this.T(['مهمة', 'Objective'])} ${ob.n}/${ob.total}</span><b>${esc(ob.t)}${ob.prog ? ` <span class="ax-data">${ob.prog}</span>` : ''}</b><span class="ax-meta">${esc(ob.h)}</span><span class="ax-meta k">${this.T(['H: الدليل', 'H: guide'])}</span>` : '', 'innerHTML');
    this.updateTouch();
    // fps
    if (A.S.showFps) { const f = A.frameStats(), R = A.R; this.set('fps', f ? `${f.fps.toFixed(0)} FPS · 1% ${f.low1.toFixed(0)} · ${f.ms.toFixed(1)} ms · ${R.w}×${R.h} · ${R.stats.draws} DC · ${(R.stats.tris / 1000).toFixed(0)}K TRI` : `${A.fps.toFixed(0)} FPS`); } else this.set('fps', '');
  }
  // ------------------------------------------------------------------ touch controls
  buildTouch() {
    const t = $('#touch'), I = this.app.input;
    t.innerHTML = `<div class="tz-move" id="tzm"><div class="joy rest"><i></i></div></div><div class="tz-look" id="tzl"></div>
      <div class="tb-wrap"><button class="tb big" data-t="attack" aria-label="attack"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 4l6 6-3 3-6-6zM11 7L3 15v6h6l8-8"/></svg></button>
        <button class="tb" data-t="jump" aria-label="jump"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 19V5M6 11l6-6 6 6"/></svg></button>
        <button class="tb" data-t="crouch" aria-label="crouch"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 5v14M6 13l6 6 6-6"/></svg></button>
        <button class="tb ctx" data-t="interact" id="tb-int" aria-label="interact">✋</button>
        <button class="tb ctx" data-t="aim" id="tb-aim" aria-label="aim">◎</button>
        <button class="tb ctx" data-t="reload" id="tb-rel" aria-label="reload">⟳</button></div>
      <div class="tb-top"><button class="tb sm" data-tt="inv">${UI_ICONS.inv}</button><button class="tb sm" data-tt="map">${UI_ICONS.map}</button><button class="tb sm" data-tt="pause">❚❚</button></div>`;
    const T = I.touch; let mid = null, lid = null, mo = null, lp = null;
    const zm = $('#tzm'), joy = zm.querySelector('.joy'), knob = joy.querySelector('i');
    zm.addEventListener('pointerdown', e => { mid = e.pointerId; mo = [e.clientX, e.clientY]; joy.style.left = e.clientX + 'px'; joy.style.top = e.clientY + 'px'; joy.classList.add('on'); joy.classList.remove('rest'); T.active = true; zm.setPointerCapture(e.pointerId); });
    zm.addEventListener('pointermove', e => { if (e.pointerId !== mid) return; const dx = e.clientX - mo[0], dy = e.clientY - mo[1], R = 60, l = Math.min(R, Math.hypot(dx, dy)), a = Math.atan2(dy, dx); knob.style.transform = `translate(${Math.cos(a) * l}px,${Math.sin(a) * l}px)`; const k = l < 8 ? 0 : (l - 8) / (R - 8); T.mx = Math.cos(a) * k; T.mz = -Math.sin(a) * k; T.sprint = T.mz > 0.92 ? 1 : 0; });
    const endM = e => { if (e.pointerId !== mid) return; mid = null; T.mx = 0; T.mz = 0; T.sprint = 0; knob.style.transform = ''; joy.classList.remove('on'); joy.classList.add('rest'); joy.style.left = ''; joy.style.top = ''; };
    zm.addEventListener('pointerup', endM); zm.addEventListener('pointercancel', endM);
    const zl = $('#tzl');
    zl.addEventListener('pointerdown', e => { lid = e.pointerId; lp = [e.clientX, e.clientY]; T.active = true; zl.setPointerCapture(e.pointerId); });
    zl.addEventListener('pointermove', e => { if (e.pointerId !== lid) return; T.ldx += e.clientX - lp[0]; T.ldy += e.clientY - lp[1]; lp = [e.clientX, e.clientY]; });
    const endL = e => { if (e.pointerId === lid) lid = null; }; zl.addEventListener('pointerup', endL); zl.addEventListener('pointercancel', endL);
    $$('.tb[data-t]', t).forEach(b => { const k = b.dataset.t; const on = e => { e.preventDefault(); T[k] = 1; T.active = true; b.classList.add('on'); this.app.input.rumble(0.2, 0.1, 15); }, off = () => { T[k] = 0; b.classList.remove('on'); }; b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('pointerleave', off); });
    $$('.tb[data-tt]', t).forEach(b => b.addEventListener('pointerdown', e => { e.preventDefault(); if (this.tEdit) return; const k = b.dataset.tt; if (k === 'inv') this.ov.classList.contains('on') ? this.closeInventory() : this.openInventory(); if (k === 'map') this.toggleMap(); if (k === 'pause') this.app.pause(); }));
    this.applyTouchLayout();
  }
  // ------------------------------------------------------------------ movable touch layout (saved per device)
  touchLayout() { try { return JSON.parse(localStorage.getItem('arvex.touchLayout') || '{}'); } catch (e) { return {}; } }
  applyTouchLayout() {
    const L = this.touchLayout();
    $$('#touch .tb').forEach(b => { const k = b.dataset.t || b.dataset.tt, v = L[k]; if (v) { b.classList.add('placed'); b.style.left = (v.x * 100) + 'vw'; b.style.top = (v.y * 100) + 'vh'; b.style.setProperty('--bs', v.s || 1); } else { b.classList.remove('placed'); b.style.left = b.style.top = ''; b.style.removeProperty('--bs'); } });
  }
  editTouch() {
    const A = this.app; if (!A.input.isTouch()) return this.toast(this.T(['هذي الميزة للجوال', 'Touch devices only']));
    if (!A.sess) { this.toast(this.T(['ادخل اللعب أول وبعدين عدل الأزرار من قائمة الإيقاف', 'Start playing first, then edit from the pause menu'])); return; }
    if (A.state !== 'play') A.resume(); this.tEdit = true; const t = $('#touch'); t.classList.add('editing'); document.body.classList.add('tedit'); let sel = null;
    const L = this.touchLayout(); const save = () => { try { localStorage.setItem('arvex.touchLayout', JSON.stringify(L)); } catch (e) {} this.applyTouchLayout(); };
    const bar = document.createElement('div'); bar.className = 'tedit-bar';
    bar.innerHTML = `<span>${this.T(['اسحب أي زر لمكانه · اختر زر وكبره أو صغره', 'Drag any button · select one to resize'])}</span><button data-e="minus">−</button><button data-e="plus">+</button><button data-e="reset">${this.T(['افتراضي', 'Reset'])}</button><button data-e="done" class="pri">${this.T(['تم', 'Done'])}</button>`;
    document.body.appendChild(bar);
    const btns = $$('#touch .tb'); const handlers = [];
    btns.forEach(b => { const k = b.dataset.t || b.dataset.tt; let id = null, off = null;
      const down = e => { e.preventDefault(); e.stopPropagation(); id = e.pointerId; const r = b.getBoundingClientRect(); off = [e.clientX - r.left, e.clientY - r.top]; sel = k; btns.forEach(x => x.classList.toggle('sel', x === b)); try { b.setPointerCapture(id); } catch (er) {} };
      const move = e => { if (e.pointerId !== id) return; const x = Math.max(0, Math.min(innerWidth - 40, e.clientX - off[0])) / innerWidth, y = Math.max(0, Math.min(innerHeight - 40, e.clientY - off[1])) / innerHeight; L[k] = Object.assign(L[k] || { s: 1 }, { x, y }); save(); };
      const up = e => { if (e.pointerId === id) id = null; };
      b.addEventListener('pointerdown', down, true); b.addEventListener('pointermove', move); b.addEventListener('pointerup', up);
      handlers.push(() => { b.removeEventListener('pointerdown', down, true); b.removeEventListener('pointermove', move); b.removeEventListener('pointerup', up); b.classList.remove('sel'); });
      if (!L[k]) { const r = b.getBoundingClientRect(); if (r.width) L[k] = { x: Math.max(0.01, Math.min(0.93, r.left / innerWidth)), y: Math.max(0.02, Math.min(0.88, r.top / innerHeight)), s: 1 }; } });
    save();
    bar.addEventListener('pointerdown', e => { const a = e.target.closest('[data-e]'); if (!a) return; e.preventDefault(); const c = a.dataset.e;
      if ((c === 'plus' || c === 'minus') && sel && L[sel]) { L[sel].s = Math.max(0.6, Math.min(1.8, (L[sel].s || 1) + (c === 'plus' ? 0.1 : -0.1))); save(); }
      if (c === 'reset') { for (const k in L) delete L[k]; try { localStorage.removeItem('arvex.touchLayout'); } catch (e) {} this.applyTouchLayout(); }
      if (c === 'done') { handlers.forEach(f => f()); bar.remove(); t.classList.remove('editing'); document.body.classList.remove('tedit'); this.tEdit = false; this.toast(this.T(['انحفظ ترتيب الأزرار', 'Button layout saved'])); } });
  }
  updateTouch() {
    const s = this.app.sess; if (!s || !this.app.input.isTouch()) return; const it = s.inv.activeItem(), I = it && ITEMS[it.id];
    const vis = (id, on) => { const e = document.getElementById(id); if (e) e.classList.toggle('show', !!on); };
    vis('tb-int', s.focus && ['pick', 'loot', 'drop', 'water', 'deploy'].includes(s.focus.kind));
    vis('tb-aim', I && (I.ranged || I.plan || I.hammer)); vis('tb-rel', I && ((I.ranged && I.ranged.draw === 0) || I.plan || I.deploy));
  }
  // ------------------------------------------------------------------ events
  onClick(e) {
    const a = e.target.closest('[data-act]'); if (!a) return; const act = a.dataset.act, A = this.app, s = A.sess;
    if (a.tagName === 'A' && a.getAttribute('href')) return;
    e.preventDefault(); if (!['srvSel', 'hot', 'craftSel'].includes(act)) A.audio.play('uiok');
    switch (act) {
      case 'back': A.back(); break; case 'toTitle': A.toTitle(); break;
      case 'continue': A.playSolo(false); break; case 'newWorld': A.hasSave() ? this.confirm(this.T(['عالم جديد', 'New world']), this.T(['بينمسح عالمك المحفوظ وتبدأ من جديد. متأكد؟', 'Your saved world will be deleted and you will start over. Sure?']), this.T(['ابدأ من جديد', 'Start over']), () => A.playSolo(true), true) : A.playSolo(true); break;
      case 'servers': A.openServers(); break; case 'srvRefresh': A.openServers(true); break;
      case 'srvTab': this.srvFilter.tab = a.dataset.v; this.servers(A.serverList); break;
      case 'srvSel': this.selSrv = a.dataset.id; $$('.srv').forEach(x => x.classList.toggle('is-selected', x.dataset.id === this.selSrv)); break;
      case 'fav': e.stopPropagation(); A.toggleFav(a.dataset.id); this.servers(A.serverList); break;
      case 'join': e.stopPropagation(); A.joinServer(a.dataset.id); break; case 'leaveQueue': A.leaveQueue(); break;
      case 'profile': A.go('profile'); break; case 'settings': A.go('settings'); break; case 'about': A.go('about'); break; case 'credits': A.go('credits'); break; case 'controlsHelp': A.go('controlsHelp'); break; case 'guide': A.go('guide'); break; case 'editTouch': this.editTouch(); break;
      case 'adm': this.adm(a.dataset.c, { target: a.dataset.t, v: a.dataset.v, w: a.dataset.w, in: a.dataset.in ? +a.dataset.in : undefined }); if (['kick', 'bring', 'goto'].includes(a.dataset.c)) setTimeout(() => this.adminPanel(), 400); break;
      case 'admMap': A.resume(); setTimeout(() => this.toggleMap(), 50); break;
      case 'admGive': { const t = $('#ad-t').value; this.adm('give', { target: t, item: $('#ad-item').value, n: Math.max(1, +$('#ad-n').value || 1) }); if (!s.online || t === 'me') { if (s.online) {} } break; }
      case 'admGod': s.player.god = !s.player.god; this.adminPanel(); break;
      case 'admCreative': s.creative = !s.creative; this.adminPanel(); break;
      case 'admSay': { const v = $('#ad-say').value; if (v.trim()) this.adm('say', { msg: v }); $('#ad-say').value = ''; break; }
      case 'admin': this.adminPanel(); break;
      case 'saveAdminKey': { const v = $('#adm-key').value.trim(); A.profile.adminKey = v; A.persist(); A.checkAdmin(v).then(ok => { this.toast(ok ? this.T(['تم تفعيل الأدمن', 'Admin enabled']) : v ? this.T(['المفتاح غلط', 'Wrong key']) : this.T(['انحذف المفتاح', 'Key removed']), ok ? 'ok' : 'warn'); this.settings('gameplay'); }); break; } case 'guideTab': this.guide(a.dataset.v); break;
      case 'quit': A.quit(); break; case 'newsOpen': this.newsOpen(a.dataset.id); break;
      case 'saveName': A.setName($('[data-in="pname"]').value); break;
      case 'setTab': this.settings(a.dataset.v); break;
      case 'rebind': { const k = a.dataset.a; a.innerHTML = `<span class="ax-meta">${this.T(['اضغط زر…', 'Press a key…'])}</span>`; A.input.capture = code => { if (code !== 'Escape') A.input.binds[k] = [code]; A.persist(); this.settings('controls'); }; break; }
      case 'resetBinds': A.input.resetBinds(); A.persist(); this.settings('controls'); break;
      case 'fullscreen': { const d = document; (d.fullscreenElement ? d.exitFullscreen() : d.documentElement.requestFullscreen()).catch(() => this.toast(this.T(['المتصفح رفض ملء الشاشة', 'The browser refused fullscreen']), 'warn')).finally(() => setTimeout(() => { A.R.resize(); if (this.screen === 'settings') this.settings('graphics'); }, 250)); break; }
      case 'autoDetect': { const p = A.autoPreset(); A.applyPreset(p.preset); A.applySettings(); A.persist(); this.settings('graphics'); this.toast(this.T(['اخترنا لك', 'Picked for this device']) + ': ' + p.preset.toUpperCase(), 'ok'); break; }
      case 'resetSettings': this.confirm(this.T(['ترجّع الإعدادات؟', 'Reset settings?']), this.T(['كل إعدادات الرسوم والصوت ترجع للوضع الافتراضي. الأزرار وحفظك ما ينلمسون.', 'Graphics and audio settings go back to their defaults. Key bindings and saves are not touched.']), this.T(['رجّع', 'Reset']), () => { A.resetSettings(); this.settings('graphics'); this.toast(this.T(['رجعت الإعدادات', 'Settings reset']), 'ok'); }); break;
      case 'resKeep': A.keepResolution(); this.resConfirm(0); this.toast(this.T(['انحفظت الدقة', 'Resolution kept']), 'ok'); break;
      case 'resRevert': A.revertResolution(); this.resConfirm(0); break;
      case 'wipe': this.confirm(this.T(['امسح العالم', 'Delete world']), this.T(['كل تقدمك الفردي بينمسح نهائياً.', 'All singleplayer progress will be permanently deleted.']), this.T(['امسح', 'Delete']), () => { A.wipe(); }, true); break;
      case 'shop': A.go('shop'); break;
      case 'skinBuy': if (A.buySkin(a.dataset.id)) { A.audio.play('uiok'); if (A.sess) A.sess.held.equipT = 0.35; } this.shop(); break;
      case 'skinUse': if (A.useSkin(a.dataset.id)) { A.audio.play('uiok'); if (A.sess) A.sess.held.equipT = 0.35; } this.shop(); break;
      case 'redeem': { const ci = $('#code-in'); if (ci && ci.value.trim()) { A.redeem(ci.value.trim()); ci.value = ''; } break; }
      case 'resume': A.resume(); break; case 'saveQuit': A.saveQuit(); break;
      case 'respawn': s.respawn(false); break; case 'respawnBag': s.respawn(true); break;
      case 'invTab': this.invTab = a.dataset.v; this.renderInv(); break; case 'closeInv': this.closeInventory(); break;
      case 'craftCat': this.craftCat = a.dataset.v; this.craftSel = null; this.craftN = 1; this.renderInv(); break;
      case 'craftSel': this.craftSel = a.dataset.id; this.craftN = 1; A.audio.play('ui'); this.renderInv(); break;
      case 'craftN': this.craftN = Math.max(1, Math.min(99, this.craftN + +a.dataset.v)); this.renderInv(); break;
      case 'craft': { const r = RECIPES.find(x => x.out === this.craftSel); if (r && s.craft(r, this.craftN)) this.renderInv(); break; }
      case 'cancelCraft': s.cancelCraft(+a.dataset.i); this.renderInv(); break;
      case 'toggleLit': s.toggleLit(s.openCont.d); setTimeout(() => this.renderInv(), 30); break;
      case 'lootAll': { const c = s.openCont.cont; for (let i = 0; i < c.slots.length; i++) if (c.slots[i]) { const left = s.inv.giveItem(c.slots[i]); if (left) { c.slots[i].n = left; } else c.slots[i] = null; } this.afterInvChange(); break; }
      case 'hot': if (s) s.selectSlot(+a.dataset.i); break; case 'map': this.toggleMap(); break;
    }
  }
  onInput(e, final) {
    const el = e.target, A = this.app;
    if (el.dataset.in === 'srvQ') { this.srvFilter.q = el.value; clearTimeout(this._q); this._q = setTimeout(() => { this.servers(A.serverList); const n = $('[data-in="srvQ"]'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 250); return; }
    if (el.dataset.in === 'srvRegion') { this.srvFilter.region = el.value; this.servers(A.serverList); return; }
    if (el.dataset.in === 'srvMode') { this.srvFilter.mode = el.value; this.servers(A.serverList); return; }
    if (el.dataset.in === 'srvAvail') { this.srvFilter.avail = el.checked; this.servers(A.serverList); return; }
    const k = el.dataset.set || el.dataset.inp; if (!k) return;
    const obj = el.dataset.set ? A.S : A.input.set;
    const v = el.type === 'checkbox' ? el.checked : el.type === 'range' || ['detail', 'textures', 'shadows', 'fpsLimit'].includes(k) ? +el.value : el.value;
    if (k === 'resolution') { const secs = A.tryResolution(v); this.settings('graphics'); if (secs) this.resConfirm(secs); return; }
    obj[k] = v;
    if (el.dataset.set && ['detail', 'textures', 'shadows', 'shadowDist', 'fxaa', 'bloom', 'scale', 'viewDist', 'propDist', 'grass', 'particles'].includes(k) && A.S.preset !== 'custom') { A.S.preset = 'custom'; const ps = document.querySelector('[data-set="preset"]'); if (ps && !ps.querySelector('[value="custom"]')) ps.insertAdjacentHTML('beforeend', `<option value="custom">${this.T(['مخصص', 'Custom'])}</option>`); if (ps) ps.value = 'custom'; }
    if (k === 'shadows' && v > 0 && !A.S.shadowDist) A.S.shadowDist = 60;
    if (el.type === 'range') { el.style.setProperty('--p', (v - el.min) / (el.max - el.min) * 100 + '%'); const lab = el.parentElement.querySelector('.val'); if (lab) lab.textContent = k === 'viewDist' || k === 'propDist' || k === 'shadowDist' ? v + ' m' : k === 'fov' ? v + '°' : ['sens', 'padSens', 'adsSens'].includes(k) ? (+v).toFixed(2) : Math.round(v * 100) + '%'; }
    if (k === 'preset') { if (v !== 'custom') A.applyPreset(v); A.applySettings(); A.persist(); this.settings('graphics'); return; }
    if (k === 'lang') { A.setLang(v); A.persist(); this.buildHUD(); this.settings('gameplay'); return; }
    A.applySettings(); if (final || el.type !== 'range') A.persist(); else { clearTimeout(this._p); this._p = setTimeout(() => A.persist(), 300); }
  }
}

const STATUS = { online: ['متاح', 'Online', 'ok'], offline: ['مطفي', 'Offline', 'err'], starting: ['يشتغل', 'Starting', 'info'], restarting: ['ريستارت', 'Restarting', 'warn'], maintenance: ['صيانة', 'Maintenance', 'warn'], full: ['ممتلئ', 'Full', 'warn'], unavailable: ['غير متاح', 'Unavailable', 'err'] };
const MODES = { pve: ['بقاء (PvE)', 'Survival (PvE)'], pvp: ['بقاء (PvP)', 'Survival (PvP)'], build: ['بناء', 'Builder'], hardcore: ['هاردكور', 'Hardcore'] };
const REGIONS = { eu: ['أوروبا', 'Europe'], me: ['الشرق الأوسط', 'Middle East'], na: ['أمريكا الشمالية', 'North America'], as: ['آسيا', 'Asia'] };
const TAGS = { update: ['تحديث', 'Update'], patch: ['ملاحظات التحديث', 'Patch notes'], announcement: ['إعلان', 'Announcement'], event: ['حدث', 'Event'], maintenance: ['صيانة', 'Maintenance'], community: ['المجتمع', 'Community'] };
const WEAR_NAMES = { head: ['راس', 'Head'], chest: ['صدر', 'Chest'], legs: ['رجول', 'Legs'], feet: ['أقدام', 'Feet'] };
const STAT_NAMES = { food: ['أكل', 'Food'], water: ['موية', 'Water'], hp: ['صحة', 'Health'] };
const CAUSES = { animal: ['قتلك حيوان', 'Killed by an animal'], melee: ['قتلك لاعب', 'Killed by a player'], arrow: ['سهم', 'Shot by an arrow'], bullet: ['رصاصة', 'Shot'], fall: ['سقطة قوية', 'Fell from height'], cold: ['مت من البرد', 'Froze to death'], starve: ['مت من الجوع', 'Starved to death'], thirst: ['مت من العطش', 'Died of thirst'], bleed: ['نزفت', 'Bled out'], poison: ['تسممت', 'Poisoned'], drown: ['غرقت', 'Drowned'] };
const POI_NAMES = { ruin: ['أنقاض', 'Ruins'], outpost: ['موقع مهجور', 'Outpost'], camp: ['مخيم', 'Camp'], tower: ['برج', 'Tower'] };
const pi = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">${d}</svg>`;
const PIECE_ICONS = { foundation: pi('<path d="M3 15h18v4H3zM5 15l3-4h8l3 4"/>'), wall: pi('<rect x="5" y="4" width="14" height="16"/><path d="M5 9h14M5 14h14"/>'), doorway: pi('<path d="M5 20V4h14v16M9 20v-9h6v9"/>'), window: pi('<rect x="5" y="4" width="14" height="16"/><rect x="9" y="8" width="6" height="5"/>'), floor: pi('<path d="M3 12l9-5 9 5-9 5z"/>'), stairs: pi('<path d="M4 20h4v-4h4v-4h4V8h4"/>'), roof: pi('<path d="M3 16l9-9 9 9z"/>'), pillar: pi('<rect x="10" y="3" width="4" height="18"/>') };
const TIER_ICONS = { 1: ITEM_ICONS.wood, 2: ITEM_ICONS.stone, 3: ITEM_ICONS.metal_frag };
