// ARVEX launcher UI — talks to the local launcher service (Go) over /api/* and a server-sent event stream
(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const g = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" aria-hidden="true">${d}</svg>`;
  const IC = {
    home: g('<path d="M3 11l9-7 9 7v9H3z"/><path d="M10 20v-6h4v6"/>'), download: g('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'), news: g('<rect x="4" y="4" width="16" height="16"/><path d="M8 9h8M8 13h8M8 17h5"/>'),
    about: g('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>'), credits: g('<path d="M12 3l2.5 6 6.5.5-5 4 1.5 6.5L12 16l-5.5 4 1.5-6.5-5-4 6.5-.5z"/>'), settings: g('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>'),
    play: g('<path d="M7 4l13 8-13 8z" fill="currentColor" stroke="none"/>'), pause: g('<path d="M8 5v14M16 5v14"/>'), x: g('<path d="M5 5l14 14M19 5L5 19"/>'), shield: g('<path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z"/><path d="M8 12l3 3 5-6"/>'),
    wrench: g('<path d="M14 6a4 4 0 0 0 5 5L11 19l-3-3 8-8a4 4 0 0 0-2-2z"/>'), ok: g('<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>'), err: g('<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>'), off: g('<path d="M2 8a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0M12 19h.01"/><path d="M3 3l18 18"/>'),
    discord: g('<path d="M8 7c2-1 6-1 8 0l2 1c1 3 2 6 2 9-1 1-3 2-4 2l-1-2M8 7L6 8c-1 3-2 6-2 9 1 1 3 2 4 2l1-2M8 17c3 1 5 1 8 0"/>'), folder: g('<path d="M3 6h7l2 2h9v11H3z"/>'), refresh: g('<path d="M20 6v5h-5M4 18v-5h5"/><path d="M6 9a7 7 0 0 1 13-1M18 15a7 7 0 0 1-13 1"/>')
  };
  let S = null, page = 'home', L = 'ar';
  const T = (ar, en) => L === 'en' ? en : ar;
  const fmtB = n => { if (n == null) return '—'; const u = ['B', 'KB', 'MB', 'GB']; let i = 0; n = +n; while (n >= 1024 && i < 3) { n /= 1024; i++; } return (i > 1 ? n.toFixed(i > 2 ? 2 : 1) : Math.round(n)) + ' ' + u[i]; };
  const fmtS = s => { if (!isFinite(s) || s <= 0) return '00:00'; s = Math.ceil(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? (h + ':').padStart(3, '0') : '') + String(m).padStart(2, '0') + ':' + String(x).padStart(2, '0'); };
  const api = async (p, body) => { const r = await fetch('/api/' + p, { method: body === undefined && ['state', 'files'].includes(p) ? 'GET' : 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined || ['state', 'files'].includes(p) ? undefined : JSON.stringify(body) }); const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status); return j; };
  const toast = (m, k = 'info') => { const d = document.createElement('div'); d.className = 'ax-toast ' + k; d.textContent = m; $('#toasts').appendChild(d); setTimeout(() => { d.classList.add('out'); setTimeout(() => d.remove(), 300); }, 3200); };
  const act = async (name, body, msg) => { try { S = await api(name, body); render(); if (msg) toast(msg, 'ok'); } catch (e) { toast(e.message === 'busy' ? T('فيه عملية شغالة', 'An operation is already running') : e.message, 'err'); } };
  // ------------------------------------------------------------------ status model
  function status() {
    const p = S.progress || {}, inst = S.installed, lat = S.latest;
    if (['downloading', 'paused', 'checking', 'verifying', 'installing'].includes(p.phase)) return 'busy';
    if (p.phase === 'offline' || (!S.online && !lat)) return inst ? 'offline-installed' : 'offline';
    if (!inst) return 'install';
    if (lat && inst !== lat) return 'update';
    return 'play';
  }
  const PH = { checking: ['نتحقق من الملفات', 'Checking files'], downloading: ['جاري التحميل…', 'Downloading…'], paused: ['متوقف مؤقتاً', 'Paused'], verifying: ['نفحص الملفات', 'Verifying files'], installing: ['نثبّت', 'Installing'], done: ['اكتمل', 'Complete'], error: ['خطأ', 'Error'], offline: ['غير متصل', 'Offline'], idle: ['جاهز', 'Ready'] };
  const RES = { download_complete: ['اكتمل التحميل', 'Download complete'], update_complete: ['اكتمل التحديث', 'Update complete'], repair_complete: ['اكتمل الإصلاح', 'Repair complete'], verify_ok: ['كل الملفات سليمة', 'All files verified'], verify_bad: ['فيه ملفات تالفة أو ناقصة', 'Some files are missing or corrupted'] };
  // ------------------------------------------------------------------ chrome
  function nav() {
    const items = [['home', IC.home, T('الرئيسية', 'Home')], ['download', IC.download, T('التحميل', 'Download')], ['news', IC.news, T('الأخبار', 'News')], ['about', IC.about, T('من نحن', 'About')], ['credits', IC.credits, T('الشكر', 'Credits')], ['settings', IC.settings, T('الإعدادات', 'Settings')]];
    const st = status();
    $('#nav').innerHTML = items.map(([k, ic, n]) => `<button class="${page === k ? 'on' : ''}" data-go="${k}">${ic}<span>${n}</span>${k === 'download' && (st === 'busy' || st === 'update') ? '<i class="badge"></i>' : ''}</button>`).join('');
    const srv = S.servers && S.servers.servers ? S.servers.servers : null, online = srv ? srv.reduce((a, s) => a + s.players, 0) : null;
    $('#sidenet').innerHTML = `<span class="ax-chip dot ${S.online ? 'ok pulse' : 'warn'}">${S.online ? T('متصل', 'Online') : T('غير متصل', 'Offline')}</span><span class="ax-meta">${T('لاعبين متصلين', 'Players online')}</span><b>${online == null ? '—' : online}</b><span class="ax-meta">${srv ? srv.filter(s => s.status === 'online' || s.status === 'full').length + '/' + srv.length + ' ' + T('سيرفرات', 'servers') : ''}</span>`;
    $('#foot-v').textContent = 'Version ' + (S.installed || S.latest || '—'); $('#foot-l').textContent = 'Launcher ' + S.launcher;
  }
  function primaryButton(big) {
    const st = status(), p = S.progress || {}, cls = big ? 'xl' : 'lg';
    if (st === 'install') return `<button class="ax-btn primary ${cls}" data-act="install">${IC.download}${T('تثبيت', 'Install')}</button>`;
    if (st === 'update') return `<button class="ax-btn primary ${cls}" data-act="update">${IC.download}${T('تحديث', 'Update')}</button>`;
    if (st === 'busy') return p.phase === 'paused' ? `<button class="ax-btn primary ${cls}" data-act="resume">${IC.play}${T('كمّل', 'Resume')}</button>` : `<button class="ax-btn ${cls} is-loading" data-go="download">${esc(T(...PH[p.phase] || PH.idle))}</button>`;
    if (st === 'offline') return `<button class="ax-btn ${cls}" data-act="check">${IC.refresh}${T('حاول مرة ثانية', 'Retry')}</button>`;
    return `<button class="ax-btn primary ${cls}" data-act="play">${IC.play}${T('العب', 'Play')}</button>`;
  }
  function miniProgress() {
    const p = S.progress || {}; if (!['downloading', 'paused', 'verifying', 'installing', 'checking'].includes(p.phase)) return '';
    const pct = p.phase === 'verifying' ? (p.filesTotal ? p.filesDone / p.filesTotal : 0) : (p.total ? p.downloaded / p.total : 0);
    return `<div class="mini-prog"><div class="row"><span class="ax-meta">${esc(T(...PH[p.phase]))}</span><span class="ax-data">${Math.floor(pct * 100)}%</span></div><div class="ax-progress ${p.phase === 'paused' ? 'is-paused' : ''} ${p.phase === 'checking' ? 'indet' : ''}"><i style="--v:${(pct * 100).toFixed(1)}%"></i></div><div class="row"><span class="ax-meta">${fmtB(p.downloaded)} / ${fmtB(p.total)}</span><span class="ax-meta">${p.speed ? fmtB(p.speed) + '/s' : ''}</span></div></div>`;
  }
  // ------------------------------------------------------------------ pages
  function home() {
    const st = status(), srv = S.servers && S.servers.servers || [], news = (S.news && S.news.news) || [];
    const statusLine = st === 'update' ? `<span class="ax-chip signal">${T('تحديث متاح', 'Update available')}</span><span class="ax-meta">${T('التحميل', 'Download')}: <b class="ax-data">${fmtB(S.updateSize)}</b> · ${S.updateFiles} ${T('ملف', 'files')}</span>` : st === 'install' ? `<span class="ax-chip info">${T('غير مثبتة', 'Not installed')}</span><span class="ax-meta">${T('حجم اللعبة', 'Game size')}: <b class="ax-data">${fmtB(S.gameSize)}</b></span>` : st.startsWith('offline') ? `<span class="ax-chip warn">${T('انقطع الاتصال', 'Connection lost')}</span>` : st === 'play' ? `<span class="ax-chip ok dot">${T('جاهزة للعب', 'Ready to play')}</span>` : '';
    return `<div class="page">
      <section class="hero" style="background-image:url(brand/arvex-hero.svg)"><div class="hero-row">
        <div class="hero-info"><img class="hero-logo" src="brand/arvex-logo-stacked.svg" alt="ARVEX SURVIVAL"><span class="ax-eyebrow">${T('اللانشر الرسمي', 'Official launcher')}</span><div style="display:flex;gap:.6rem;align-items:center;flex-wrap:wrap">${statusLine}</div>
          <div class="ver-row"><div><span class="ax-meta">${T('الإصدار الحالي', 'Current version')}</span><b>${esc(S.installed || '—')}</b></div><div><span class="ax-meta">${T('آخر إصدار', 'Latest version')}</span><b>${esc(S.latest || '—')}</b></div><div><span class="ax-meta">${T('الحالة', 'Status')}</span><b>${esc(T(...PH[(S.progress || {}).phase] || PH.idle))}</b></div></div></div>
        <div class="cta">${primaryButton(true)}${miniProgress()}<div class="cta-sub">${st === 'offline-installed' ? `<button class="ax-btn ghost sm" data-act="play">${T('كمّل بدون اتصال', 'Continue offline')}</button><button class="ax-btn ghost sm" data-act="check">${IC.refresh}${T('حاول', 'Retry')}</button>` : ''}<a class="ax-btn ghost sm" href="https://discord.gg/arvex" target="_blank" rel="noopener">${IC.discord}${T('انضم للديسكورد', 'Join Discord')}</a></div></div>
      </div></section>
      <div class="home-grid">
        <section class="ax-panel card-pad"><div style="display:flex;justify-content:space-between;align-items:center"><span class="ax-eyebrow">${T('آخر الأخبار', 'Latest news')}</span><button class="ax-btn ghost sm" data-go="news">${T('كل الأخبار', 'All news')}</button></div>
          <div class="news-grid" style="margin-top:.8rem;grid-template-columns:repeat(auto-fill,minmax(14rem,1fr))">${news.slice(0, 2).map(newsCard).join('') || `<p class="ax-muted">${T('ما فيه أخبار', 'No news')}</p>`}</div></section>
        <section class="ax-panel card-pad"><span class="ax-eyebrow">${T('حالة السيرفرات', 'Server status')}</span><div class="srv-mini">${srv.map(s => `<div class="srv-row"><span>${esc(s.name)}</span><span class="ax-chip dot ${s.status === 'online' ? 'ok' : s.status === 'full' || s.status === 'restarting' || s.status === 'maintenance' ? 'warn' : s.status === 'starting' ? 'info' : 'err'}">${esc(s.status.toUpperCase())}</span><span class="ax-data">${s.players}/${s.max}</span></div>`).join('') || `<p class="ax-muted">${T('ما قدرنا نجيب حالة السيرفرات', 'Server status unavailable')}</p>`}</div></section>
      </div></div>`;
  }
  function download() {
    const p = S.progress || {}, st = status(), pct = p.phase === 'verifying' ? (p.filesTotal ? p.filesDone / p.filesTotal : 0) : (p.total ? p.downloaded / p.total : (p.phase === 'done' ? 1 : 0));
    const busy = st === 'busy', remaining = Math.max(0, (p.total || 0) - (p.downloaded || 0));
    let state = '';
    if (p.phase === 'done') { const bad = p.result === 'verify_bad'; state = `<div class="ax-panel state-box ${bad ? 'err' : 'ok'}">${bad ? IC.err : IC.ok}<div><h3 class="ax-h3">${esc(T(...RES[p.result] || PH.done))}</h3>${bad ? `<p class="ax-muted">${p.bad.length} ${T('ملف يحتاج إصلاح', 'files need repair')}</p><ul class="bad-list">${p.bad.slice(0, 40).map(b => `<li>${esc(b)}</li>`).join('')}</ul><div class="dl-actions" style="margin-top:.8rem"><button class="ax-btn primary" data-act="repair">${IC.wrench}${T('أصلح اللعبة', 'Repair game')}</button></div>` : `<div class="dl-actions" style="margin-top:.8rem"><button class="ax-btn primary" data-act="play">${IC.play}${T('العب', 'Play')}</button><button class="ax-btn ghost" data-act="dismiss">${T('تمام', 'OK')}</button></div>`}</div></div>`; }
    if (p.phase === 'error') state = `<div class="ax-panel state-box err">${IC.err}<div><h3 class="ax-h3">${T('صار خطأ', 'Something went wrong')}</h3><p class="ax-muted">${esc(p.error)}</p><div class="dl-actions"><button class="ax-btn primary" data-act="${S.installed ? 'update' : 'install'}">${IC.refresh}${T('حاول مرة ثانية', 'Retry')}</button><button class="ax-btn" data-act="repair">${IC.wrench}${T('إصلاح', 'Repair')}</button><a class="ax-btn ghost" href="https://discord.gg/arvex" target="_blank" rel="noopener">${T('الدعم', 'Support')}</a></div></div></div>`;
    if (p.phase === 'offline' || st === 'offline') state = `<div class="ax-panel state-box off">${IC.off}<div><h3 class="ax-h3">${T('انقطع الاتصال', 'Connection lost')}</h3><p class="ax-muted">${T('ما قدرنا نوصل لسيرفر ARVEX. تأكد من الإنترنت.', 'We could not reach the ARVEX server. Check your internet connection.')}</p><div class="dl-actions"><button class="ax-btn primary" data-act="check">${IC.refresh}${T('حاول مرة ثانية', 'Retry')}</button>${S.installed ? `<button class="ax-btn" data-act="play">${T('كمّل بدون اتصال', 'Continue offline')}</button>` : ''}</div></div></div>`;
    const title = busy ? T(...PH[p.phase]) : st === 'update' ? T('تحديث متاح', 'Update available') : st === 'install' ? T('جاهز للتثبيت', 'Ready to install') : T('اللعبة محدّثة', 'Up to date');
    const notes = S.latestNotes || [];
    return `<div class="page"><div class="page-h"><span class="ax-eyebrow">${T('التحميل والتحديثات', 'Downloads & updates')}</span><h1 class="ax-h1">${T('التحميل', 'Download')}</h1></div>
      ${state}
      <section class="ax-panel dl">
        <div class="dl-head"><div><span class="ax-eyebrow">ARVEX SURVIVAL</span><p class="dl-state">${esc(title)}</p><span class="ax-meta">${p.message ? esc(p.message) : st === 'update' ? `${T('الإصدار الحالي', 'Current version')}: ${esc(S.installed)} → ${T('الإصدار الجديد', 'New version')}: ${esc(S.latest)}` : ''}</span></div><div class="dl-pct">${Math.floor(pct * 100)}<small>%</small></div></div>
        <div class="ax-progress ${p.phase === 'paused' ? 'is-paused' : ''} ${p.phase === 'done' ? 'is-ok' : ''} ${p.phase === 'error' ? 'is-err' : ''} ${p.phase === 'checking' ? 'indet' : ''}"><i style="--v:${(pct * 100).toFixed(2)}%"></i></div>
        <div class="dl-stats">
          <div><span class="ax-meta">${T('المحمّل', 'Downloaded')}</span><b>${busy || p.phase === 'done' ? fmtB(p.downloaded) + ' / ' + fmtB(p.total) : '—'}</b></div>
          <div><span class="ax-meta">${T('المتبقي', 'Remaining')}</span><b>${busy ? fmtB(remaining) : st === 'update' ? fmtB(S.updateSize) : st === 'install' ? fmtB(S.gameSize) : '0 B'}</b></div>
          <div><span class="ax-meta">${T('السرعة', 'Speed')}</span><b>${p.phase === 'downloading' && p.speed ? fmtB(p.speed) + '/s' : '—'}</b></div>
          <div><span class="ax-meta">${T('الوقت المتبقي', 'Time remaining')}</span><b>${p.phase === 'downloading' && p.speed ? fmtS(p.eta) : '—'}</b></div>
          <div><span class="ax-meta">${T('الملفات', 'Files')}</span><b>${p.filesTotal ? p.filesDone + ' / ' + p.filesTotal : (st === 'update' ? S.updateFiles : '—')}</b></div>
        </div>
        <div class="dl-file"><span class="ax-meta">${T('الملف الحالي', 'Current file')}</span><span class="ax-data">${esc(p.file || '—')}</span></div>
        <div class="dl-actions">${busy ? (p.phase === 'paused' ? `<button class="ax-btn primary lg" data-act="resume">${IC.play}${T('كمّل', 'Resume')}</button>` : `<button class="ax-btn lg" data-act="pause" ${p.phase !== 'downloading' ? 'disabled' : ''}>${IC.pause}${T('إيقاف مؤقت', 'Pause')}</button>`) + `<button class="ax-btn ghost lg" data-act="cancel">${IC.x}${T('إلغاء', 'Cancel')}</button>` : primaryButton(false)}</div>
      </section>
      <div class="dl-tools" style="margin-top:1.2rem">
        <section class="ax-panel card-pad"><span class="ax-eyebrow">${T('ملفات اللعبة', 'Game files')}</span><p class="ax-muted">${T('افحص الملفات لو اللعبة ما تشتغل صح. الإصلاح يحمّل الملفات الناقصة أو التالفة بس.', 'Verify if the game misbehaves. Repair re-downloads only missing or corrupted files.')}</p><div class="dl-actions"><button class="ax-btn" data-act="verify" ${busy || !S.installed ? 'disabled' : ''}>${IC.shield}${T('افحص ملفات اللعبة', 'Verify game files')}</button><button class="ax-btn" data-act="repair" ${busy || !S.latest ? 'disabled' : ''}>${IC.wrench}${T('أصلح اللعبة', 'Repair game')}</button><button class="ax-btn ghost" data-act="open-folder">${IC.folder}${T('افتح المجلد', 'Open folder')}</button></div></section>
        <section class="ax-panel card-pad"><span class="ax-eyebrow">${T('ملاحظات الإصدار', 'Patch notes')} · ${esc(S.latest || '')}</span>${notes.length ? `<ul class="notes">${notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : `<p class="ax-muted">—</p>`}<p class="ax-meta">${S.required ? T('تحديث إجباري', 'Required update') : T('تحديث اختياري', 'Optional update')} · ${T('حجم اللعبة', 'Game size')} ${fmtB(S.gameSize)}</p></section>
      </div></div>`;
  }
  function newsCard(n) { return `<article class="news ax-card is-interactive" data-news="${esc(n.id)}"><div class="news-th" style="background-image:url(${esc((n.image || 'brand/arvex-main-banner.svg').replace(/^brand\//, 'brand/'))})"></div><div class="news-b"><div class="row"><span class="ax-chip ${n.tag === 'update' ? 'signal' : n.tag === 'maintenance' ? 'warn' : 'info'}">${esc(n.tag)}</span><span class="ax-meta">${esc(n.date)}</span></div><h3>${esc(L === 'en' ? n.title[1] : n.title[0])}</h3><p>${esc(L === 'en' ? n.short[1] : n.short[0])}</p><span class="link">${T('اقرأ المزيد', 'Read more')}</span></div></article>`; }
  function news() { const list = (S.news && S.news.news) || []; return `<div class="page"><div class="page-h"><span class="ax-eyebrow">ARVEX</span><h1 class="ax-h1">${T('الأخبار', 'News')}</h1></div><div class="news-grid">${list.map(newsCard).join('') || `<div class="ax-panel state-box off">${IC.off}<div><h3 class="ax-h3">${T('ما فيه أخبار', 'No news')}</h3><p class="ax-muted">${T('تأكد من الاتصال.', 'Check your connection.')}</p></div></div>`}</div></div>`; }
  function openNews(id) { const n = ((S.news && S.news.news) || []).find(x => x.id === id); if (!n) return; const b = document.createElement('div'); b.className = 'ax-modal-back'; b.innerHTML = `<div class="ax-modal ax-panel" style="width:min(44rem,100%)"><span class="ax-eyebrow">${esc(n.date)}</span><h3 class="ax-h2">${esc(L === 'en' ? n.title[1] : n.title[0])}</h3><p style="color:#cfc9bd;line-height:1.8">${esc(L === 'en' ? (n.body || n.short)[1] : (n.body || n.short)[0])}</p><div class="actions"><button class="ax-btn primary">${T('تمام', 'OK')}</button></div></div>`; document.body.appendChild(b); b.addEventListener('click', e => { if (e.target === b || e.target.closest('button')) b.remove(); }); }
  const team = () => `<section><span class="ax-eyebrow">${T('الفريق', 'Team')}</span><h2 class="ax-h2">ARVEX TEAM</h2><div class="team"><div class="tm ax-card"><span class="ax-meta">OWNER / DEV</span><b>Mohsen</b></div><div class="tm ax-card"><span class="ax-meta">CO OWNER</span><b>Danial</b></div><div class="tm ax-card"><span class="ax-meta">STAFF / COMMUNITY</span><b class="ax-data">discord.gg/arvex</b></div></div></section>`;
  function about() {
    const sec = (eb, h, p) => `<section><span class="ax-eyebrow">${eb}</span><h2 class="ax-h2">${h}</h2>${p.map(x => `<p>${x}</p>`).join('')}</section>`;
    return `<div class="page"><div class="page-h"><span class="ax-eyebrow">ARVEX</span><h1 class="ax-h1">${T('من نحن', 'About Us')}</h1></div><div class="prose">
      ${sec(T('القصة', 'Story'), T('جزيرة نسيها العالم', 'An island the world forgot'), [T('ARVEX جزيرة مهجورة في نص المحيط. اللي كانوا فيها تركوا أنقاض ومخيمات وأبراج صدّت، والطبيعة تستردها شوي شوي. توصل للشاطئ ومعك حجر وشعلة بس.', 'ARVEX is an abandoned island in the middle of the ocean. Its people left ruins, camps and rusted towers behind, and nature is taking them back. You wash up with a rock and a torch.')])}
      <div class="ax-line"></div>
      ${sec(T('الرؤية', 'Vision'), T('بقاء له وزن', 'Survival with weight'), [T('كل قرار له ثمن، والليل يخوّف، والقاعدة اللي تبنيها لها قيمة لأنك تعبت عليها.', 'Every decision costs something, the night is dangerous, and your base matters because you earned it.')])}
      ${sec(T('اللعب', 'Gameplay'), T('اجمع · اصنع · ابنِ · انجُ', 'Gather · Craft · Build · Survive'), [T('اقطع واكسر واصطد. اصنع أدوات وأسلحة وملابس. ابنِ من القش للحديد. انتبه للجوع والعطش والبرد والذيابة.', 'Chop, mine and hunt. Craft tools, weapons and clothing. Build from twig to metal. Watch hunger, thirst, cold — and wolves.')])}
      ${sec(T('التطوير', 'Development'), T('محرك خاص فينا', 'Our own engine'), [T('محرك WebGL مكتوب من الصفر، وموديلات وأصوات تتولّد داخل اللعبة. هذا اللانشر يحمّل الملفات اللي تغيّرت بس ويتحقق منها بـ SHA-256.', 'A WebGL engine written from scratch, with models and sounds generated in-game. This launcher downloads only changed files and verifies each one with SHA-256.')])}
      ${sec(T('المجتمع', 'Community'), 'discord.gg/arvex', [T('الأخبار والتحديثات والدعم والأحداث كلها في الديسكورد.', 'News, updates, support and events all live on the Discord.')])}
      <a class="ax-btn primary" href="https://discord.gg/arvex" target="_blank" rel="noopener">${IC.discord}${T('انضم للديسكورد', 'Join Discord')}</a>
      ${sec(T('المستقبل', 'Future'), T('هذي البداية', 'This is the beginning'), [T('مناطق جديدة، أسلحة، أحداث سيرفرات، وعشائر.', 'New regions, weapons, server events and clans.')])}
      ${team()}</div></div>`;
  }
  function credits() {
    return `<div class="page"><div class="page-h"><span class="ax-eyebrow">ARVEX SURVIVAL</span><h1 class="ax-h1">${T('الشكر والحقوق', 'Credits & Rights')}</h1></div><div class="prose">${team()}<div class="ax-line"></div>
      <section><span class="ax-eyebrow">${T('الخطوط', 'Typefaces')}</span><ul class="cr-list"><li>Barlow Condensed · SIL OFL 1.1</li><li>IBM Plex Sans Arabic · SIL OFL 1.1</li><li>Noto Kufi Arabic · SIL OFL 1.1</li><li>JetBrains Mono · SIL OFL 1.1</li></ul></section>
      <section><span class="ax-eyebrow">${T('الحقوق', 'Rights')}</span><h3 class="ax-h3">ARVEX SURVIVAL</h3><p>${T('© 2026 ARVEX. جميع الحقوق محفوظة لأصحابها.', '© 2026 ARVEX. All rights reserved by their respective owners.')}</p><p>${T('الهوية البصرية والشعار والكود والأصول ومحتوى المشروع الأصلي محمية لأصحابها: Mohsen وDanial. ممنوع إعادة النشر أو البيع أو التعديل التجاري بدون إذن مكتوب.', 'Original branding, logo, code, assets and project content are protected by their respective owners, Mohsen and Danial. Redistribution, resale or commercial modification without written permission is not allowed.')}</p></section></div></div>`;
  }
  function settings() {
    const s = S.settings;
    return `<div class="page"><div class="page-h"><span class="ax-eyebrow">ARVEX LAUNCHER</span><h1 class="ax-h1">${T('الإعدادات', 'Settings')}</h1></div><div class="ax-panel set">
      <div class="set-sec"><span class="ax-eyebrow">${T('المجلدات', 'Locations')}</span>
        <div class="set-row"><label class="ax-label">${T('مكان التثبيت', 'Install location')}<span class="help">${T('اللعبة تنحفظ هنا', 'The game is installed here')}</span></label><div class="path-row"><input class="ax-input mono" id="s-inst" value="${esc(s.installDir)}"><button class="ax-btn ghost sm" data-act="open-folder">${IC.folder}</button></div></div>
        <div class="set-row"><label class="ax-label">${T('مكان التحميل المؤقت', 'Download location')}<span class="help">${T('فاضي = داخل مجلد اللعبة', 'Empty = inside the game folder')}</span></label><input class="ax-input mono" id="s-dl" value="${esc(s.downloadDir || '')}"></div></div>
      <div class="set-sec"><span class="ax-eyebrow">${T('التحميل', 'Downloads')}</span>
        <div class="set-row"><label class="ax-label">${T('حد السرعة (KB/s)', 'Speed limit (KB/s)')}<span class="help">${T('0 = بدون حد', '0 = unlimited')}</span></label><input class="ax-input mono" id="s-lim" type="number" min="0" step="64" value="${s.speedLimitKB || 0}"></div>
        <div class="set-row"><label class="ax-label">${T('تحديث تلقائي', 'Auto update')}<span class="help">${T('يحمّل التحديثات لما تفتح اللانشر', 'Download updates when the launcher opens')}</span></label><input type="checkbox" class="ax-toggle tog" id="s-auto" ${s.autoUpdate ? 'checked' : ''}></div></div>
      <div class="set-sec"><span class="ax-eyebrow">${T('النظام', 'System')}</span>
        <div class="set-row"><label class="ax-label">${T('يشتغل مع ويندوز', 'Start with Windows')}</label><input type="checkbox" class="ax-toggle tog" id="s-win" ${s.startWithWindows ? 'checked' : ''} ${S.os !== 'windows' ? 'disabled' : ''}></div>
        <div class="set-row"><label class="ax-label">${T('اللغة', 'Language')}</label><select class="ax-input" id="s-lang"><option value="ar" ${s.language !== 'en' ? 'selected' : ''}>العربية</option><option value="en" ${s.language === 'en' ? 'selected' : ''}>English</option></select></div>
        <div class="set-row"><label class="ax-label">${T('سيرفر التحديثات', 'Update server')}<span class="help">${T('للمتقدمين فقط', 'Advanced')}</span></label><input class="ax-input mono" id="s-srv" value="${esc(s.server)}"></div></div>
      <div class="set-actions"><button class="ax-btn primary" data-act="saveSettings">${T('حفظ', 'Save')}</button><button class="ax-btn" data-act="verify" ${status() === 'busy' || !S.installed ? 'disabled' : ''}>${IC.shield}${T('افحص', 'Verify')}</button><button class="ax-btn" data-act="repair" ${status() === 'busy' ? 'disabled' : ''}>${IC.wrench}${T('إصلاح', 'Repair')}</button><button class="ax-btn ghost" data-act="clear-cache">${T('امسح الكاش', 'Clear cache')}</button><a class="ax-btn ghost" href="https://discord.gg/arvex" target="_blank" rel="noopener">${IC.discord}discord.gg/arvex</a></div>
    </div></div>`;
  }
  const PAGES = { home, download, news, about, credits, settings };
  function render() {
    if (!S) return; L = S.settings.language === 'en' ? 'en' : 'ar';
    document.documentElement.lang = L; document.documentElement.dir = L === 'en' ? 'ltr' : 'rtl';
    nav(); const focus = document.activeElement && document.activeElement.id;
    if (page === 'settings' && focus && focus.startsWith('s-')) return; // don't clobber form edits
    $('#main').innerHTML = PAGES[page]();
  }
  document.addEventListener('click', async e => {
    const go = e.target.closest('[data-go]'); if (go) { page = go.dataset.go; render(); $('#main').scrollTop = 0; return; }
    const nw = e.target.closest('[data-news]'); if (nw) return openNews(nw.dataset.news);
    const a = e.target.closest('[data-act]'); if (!a) return; const k = a.dataset.act;
    if (k === 'saveSettings') { const v = id => $('#' + id); return act('settings', { installDir: v('s-inst').value.trim(), downloadDir: v('s-dl').value.trim(), speedLimitKB: +v('s-lim').value || 0, autoUpdate: v('s-auto').checked, startWithWindows: v('s-win').checked, language: v('s-lang').value, server: v('s-srv').value.trim(), closeOnPlay: S.settings.closeOnPlay }, T('انحفظت الإعدادات', 'Settings saved')); }
    if (['install', 'update', 'repair', 'verify'].includes(k)) page = 'download';
    act(k, {}, k === 'clear-cache' ? T('انمسح الكاش', 'Cache cleared') : k === 'play' ? T('نشغّل ARVEX…', 'Launching ARVEX…') : null);
  });
  // ------------------------------------------------------------------ live state
  async function boot() {
    $('#splash-t').textContent = 'ARVEX LAUNCHER';
    try { S = await api('state'); } catch (e) { $('#splash-t').textContent = 'Launcher service not reachable'; return setTimeout(boot, 1500); }
    try { const v = await fetch((S.settings.server || '') + '/api/versions').then(r => r.json()); const cur = (v.versions || []).find(x => x.version === v.current); S.latestNotes = cur ? cur.notes : []; window._notes = S.latestNotes; } catch (e) {}
    render(); $('#app').hidden = false; $('#splash').classList.add('out'); setTimeout(() => $('#splash').remove(), 500);
    const es = new EventSource('/api/events'); let lastPhase = null;
    es.onmessage = ev => { const n = JSON.parse(ev.data); n.latestNotes = window._notes || []; const ph = n.progress && n.progress.phase; if (ph !== lastPhase && ph === 'done' && n.progress.result) toast(T(...RES[n.progress.result]), n.progress.result === 'verify_bad' ? 'warn' : 'ok'); if (ph !== lastPhase && ph === 'error') toast(n.progress.error, 'err'); lastPhase = ph; S = n; render(); };
    es.onerror = () => {};
  }
  boot();
})();
