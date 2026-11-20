// ARVEX launcher UI — talks to the local launcher service (Go) over /api/* and a server-sent event stream.
// Everything shown here comes from that service: versions, build ids, sizes, progress, errors. Nothing is simulated.
(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const g = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" aria-hidden="true">${d}</svg>`;
  const IC = {
    home: g('<path d="M3 11l9-7 9 7v9H3z"/><path d="M10 20v-6h4v6"/>'), download: g('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'), news: g('<rect x="4" y="4" width="16" height="16"/><path d="M8 9h8M8 13h8M8 17h5"/>'),
    about: g('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>'), credits: g('<path d="M12 3l2.5 6 6.5.5-5 4 1.5 6.5L12 16l-5.5 4 1.5-6.5-5-4 6.5-.5z"/>'), settings: g('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>'),
    play: g('<path d="M7 4l13 8-13 8z" fill="currentColor" stroke="none"/>'), pause: g('<path d="M8 5v14M16 5v14"/>'), x: g('<path d="M5 5l14 14M19 5L5 19"/>'), shield: g('<path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z"/><path d="M8 12l3 3 5-6"/>'),
    wrench: g('<path d="M14 6a4 4 0 0 0 5 5L11 19l-3-3 8-8a4 4 0 0 0-2-2z"/>'), ok: g('<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>'), err: g('<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>'), off: g('<path d="M2 8a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0M12 19h.01"/><path d="M3 3l18 18"/>'),
    discord: g('<path d="M8 7c2-1 6-1 8 0l2 1c1 3 2 6 2 9-1 1-3 2-4 2l-1-2M8 7L6 8c-1 3-2 6-2 9 1 1 3 2 4 2l1-2M8 17c3 1 5 1 8 0"/>'), folder: g('<path d="M3 6h7l2 2h9v11H3z"/>'), refresh: g('<path d="M20 6v5h-5M4 18v-5h5"/><path d="M6 9a7 7 0 0 1 13-1M18 15a7 7 0 0 1-13 1"/>'),
    notes: g('<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 12h7M9 16h7"/>'), support: g('<path d="M4 13v-1a8 8 0 0 1 16 0v1"/><path d="M4 13h3v6H4zM17 13h3v6h-3zM20 19c0 2-3 2-6 2"/>')
  };
  let S = null, page = 'home', L = 'ar', supportTickets = null, supportBusy = false;
  const T = (ar, en) => L === 'en' ? en : ar;
  const tr = v => Array.isArray(v) ? (v[L === 'en' ? 1 : 0] || v[1] || v[0] || '') : (v || '');
  const fmtB = n => { if (n == null) return '—'; const u = ['B', 'KB', 'MB', 'GB']; let i = 0; n = +n; while (n >= 1024 && i < 3) { n /= 1024; i++; } return (i > 1 ? n.toFixed(i > 2 ? 2 : 1) : Math.round(n)) + ' ' + u[i]; };
  const fmtS = s => { if (!isFinite(s) || s <= 0) return '00:00'; s = Math.ceil(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? (h + ':').padStart(3, '0') : '') + String(m).padStart(2, '0') + ':' + String(x).padStart(2, '0'); };
  const fmtD = t => { if (!t) return '—'; const d = new Date(typeof t === 'number' && t < 1e12 ? t * 1000 : t); return isNaN(d) ? '—' : d.toLocaleDateString(L === 'en' ? 'en-GB' : 'ar', { year: 'numeric', month: 'short', day: 'numeric' }); };
  const fmtT = t => { const d = new Date(typeof t === 'number' && t < 1e12 ? t * 1000 : t); return isNaN(d) ? '—' : d.toLocaleString(L === 'en' ? 'en-GB' : 'ar', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); };
  const shortBuild = b => b ? String(b).replace(/^\d+\.\d+(\.\d+)?-/, '') : '—';
  const GET = ['state', 'files', 'tickets'];
  const api = async (p, body) => { const get = body === undefined && GET.includes(p); const r = await fetch('/api/' + p, { method: get ? 'GET' : 'POST', headers: { 'content-type': 'application/json' }, body: get ? undefined : JSON.stringify(body || {}) }); const j = await r.json(); if (!r.ok) throw Object.assign(new Error('launcher'), { coded: j.error || { code: 'ARVEX-L000' } }); return j; };
  const toast = (m, k = 'info', ms = 3600) => { const d = document.createElement('div'); d.className = 'ax-toast ' + k; d.textContent = m; $('#toasts').appendChild(d); setTimeout(() => { d.classList.add('out'); setTimeout(() => d.remove(), 300); }, ms); };
  // ------------------------------------------------------------------ error catalogue: code → what happened, and what the player can do
  const ERR = {
    'ARVEX-L000': ['صار خطأ غير متوقع في اللانشر', 'The launcher hit an unexpected error', 'جرّب مرة ثانية. لو تكرر، افتح مجلد السجلات وأرسله للدعم.', 'Try again. If it keeps happening, open the logs folder and send it to support.'],
    'ARVEX-L002': ['اللعبة مو مثبتة', 'The game is not installed', 'اضغط تثبيت.', 'Press Install.'],
    'ARVEX-L003': ['ما لقينا متصفح يشغّل اللعبة', 'No browser engine found', 'ثبّت Microsoft Edge أو Google Chrome ثم جرّب.', 'Install Microsoft Edge or Google Chrome, then try again.'],
    'ARVEX-L004': ['اللعبة شغالة من قبل', 'The game is already running', 'سكّر نافذة اللعبة المفتوحة ثم جرّب.', 'Close the open game window and try again.'],
    'ARVEX-L005': ['الطلب مو مفهوم', 'That request was not understood', 'راجع القيم اللي كتبتها.', 'Check the values you entered.'],
    'ARVEX-N001': ['ما قدرنا نوصل لسيرفر ARVEX', 'We could not reach the ARVEX server', 'تأكد من الإنترنت أو الجدار الناري ثم اضغط حاول.', 'Check your internet connection or firewall, then press Retry.'],
    'ARVEX-N002': ['السيرفر تأخر بالرد', 'The server took too long to answer', 'السيرفر ممكن يكون يصحى من النوم. استنى دقيقة وحاول.', 'The server may be waking up. Wait a minute and retry.'],
    'ARVEX-N003': ['السيرفر فيه مشكلة حالياً', 'The server has a problem right now', 'المشكلة مو من جهازك. حاول بعد شوي.', 'This is not your computer. Try again shortly.'],
    'ARVEX-N004': ['طلبات كثيرة', 'Too many requests', 'استنى دقيقة ثم حاول.', 'Wait a minute, then retry.'],
    'ARVEX-U001': ['معلومات التحديث من السيرفر مو صالحة', 'The update information from the server is not valid', 'ما ثبّتنا شي. حاول بعدين أو بلّغ الدعم.', 'Nothing was installed. Try later or tell support.'],
    'ARVEX-U002': ['ملف من التحديث مو متوفر', 'A file of the update is not available', 'حاول مرة ثانية. لو تكرر بلّغ الدعم بالكود.', 'Try again. If it repeats, send this code to support.'],
    'ARVEX-U003': ['ملف وصل تالف', 'A downloaded file arrived damaged', 'حاولنا أكثر من مرة. تأكد من اتصالك ثم اضغط حاول.', 'We retried several times. Check your connection, then press Retry.'],
    'ARVEX-U004': ['فيه عملية ثانية شغالة', 'Another operation is running', 'استنى لين تخلص.', 'Wait for it to finish.'],
    'ARVEX-U005': ['توقيع التحديث غير صحيح', 'The update signature is not valid', 'رفضنا التحديث عشان نحمي جهازك. بلّغ الدعم.', 'The update was refused to protect your computer. Tell support.'],
    'ARVEX-U006': ['التحديث مو موقّع', 'The update is not signed', 'هالسيرفر كان يوقّع تحديثاته. رفضنا هذا التحديث.', 'This server used to sign its updates. This one was refused.'],
    'ARVEX-U007': ['اللعبة مفتوحة', 'The game is open', 'سكّر اللعبة أول عشان نقدر نحدّث ملفاتها.', 'Close the game first so its files can be updated.'],
    'ARVEX-U008': ['نزل إصدار جديد وأنت تحمّل', 'A new release was published while downloading', 'اضغط حاول عشان نكمل على الإصدار الجديد.', 'Press Retry to continue with the new release.'],
    'ARVEX-U009': ['السيرفر عرض إصدار أقدم', 'The server offered an older release', 'رفضناه. بلّغ الدعم.', 'It was refused. Tell support.'],
    'ARVEX-F001': ['ملفات اللعبة ناقصة أو تالفة', 'Game files are missing or damaged', 'اضغط إصلاح. بنحمّل الملفات المتضررة بس.', 'Press Repair. Only the damaged files are downloaded.'],
    'ARVEX-F002': ['المساحة ما تكفي', 'Not enough disk space', 'فضّي مساحة أو غيّر مكان التثبيت من الإعدادات.', 'Free some space or change the install location in Settings.'],
    'ARVEX-F003': ['ما قدرنا نكتب في المجلد', 'We could not write to the folder', 'تأكد إن المجلد مو للقراءة فقط وإن برنامج ثاني ما قافل الملفات.', 'Make sure the folder is not read-only and no other program is locking the files.'],
    'ARVEX-F004': ['التثبيت ما تحقق', 'The install did not verify', 'رجّعنا النسخة السابقة كاملة. حاول مرة ثانية.', 'The previous version was fully restored. Try again.'],
    'ARVEX-A001': ['صيانة', 'Maintenance mode', 'السيرفرات تحت الصيانة حالياً.', 'The servers are under maintenance right now.'],
    'ARVEX-A002': ['تحديث إجباري', 'Update required', 'لازم تحدّث قبل ما تلعب.', 'You need to update before you can play.'],
    'ARVEX-A003': ['نسختك ما عادت مدعومة', 'Your version is no longer supported', 'حدّث عشان تقدر تدخل السيرفرات.', 'Update to keep playing.'],
    'ARVEX-S001': ['ما قدرنا نرسل للدعم', 'The support request could not be sent', 'حاول بعدين أو استخدم الديسكورد.', 'Try later or use the Discord.']
  };
  const errText = e => { const c = (e && e.code) || 'ARVEX-L000', r = ERR[c] || ERR['ARVEX-L000']; return { code: c, title: T(r[0], r[1]), hint: T(r[2], r[3]), detail: (e && e.detail) || '', data: (e && e.data) || {} }; };
  const errBox = (e, actions) => { const x = errText(e), d = x.data; return `<div class="ax-panel state-box err" role="alert">${IC.err}<div><h3 class="ax-h3">${esc(x.title)}</h3><p>${esc(x.hint)}</p>${d.required ? `<p class="ax-meta">${T('المطلوب', 'Required')}: <b class="ax-data">${fmtB(d.required)}</b> · ${T('المتوفر', 'Available')}: <b class="ax-data">${fmtB(d.available)}</b></p>` : ''}${x.detail ? `<p class="ax-meta err-detail">${esc(x.detail)}</p>` : ''}<div class="dl-actions">${actions || ''}<span class="ax-chip err code">${esc(x.code)}</span></div></div></div>`; };
  const act = async (name, body, msg) => { try { const r = await api(name, body); if (r && r.settings) S = r; render(); if (msg) toast(msg, 'ok'); return r; } catch (e) { const x = errText(e.coded); toast(`${x.title} · ${x.code}`, 'err', 5200); if (x.code === 'ARVEX-F001' || x.code === 'ARVEX-A002' || x.code === 'ARVEX-A003') { page = 'download'; render(); } return null; } };
  // ------------------------------------------------------------------ status model (derived only from the service state)
  const BUSY = ['downloading', 'paused', 'checking', 'verifying', 'installing'];
  function status() {
    const p = S.progress || {};
    if (BUSY.includes(p.phase)) return 'busy';
    if (!S.installed) return S.latest ? 'install' : 'offline';
    if (S.block && S.block.code === 'ARVEX-A001') return 'maintenance';
    if (S.block && S.block.action === 'update') return 'required';
    if (S.updateAvailable) return 'update';
    return S.online ? 'play' : 'offline-installed';
  }
  const PH = { checking: ['نتحقق من الملفات', 'Checking files'], downloading: ['جاري التحميل…', 'Downloading…'], paused: ['متوقف مؤقتاً', 'Paused'], verifying: ['نفحص الملفات', 'Verifying files'], installing: ['نثبّت', 'Installing'], done: ['اكتمل', 'Complete'], error: ['خطأ', 'Error'], offline: ['غير متصل', 'Offline'], idle: ['جاهز', 'Ready'] };
  const RES = { download_complete: ['اكتمل التثبيت', 'Install complete'], update_complete: ['اكتمل التحديث', 'Update complete'], repair_complete: ['اكتمل الإصلاح', 'Repair complete'], verify_ok: ['كل الملفات سليمة', 'All files verified'], verify_bad: ['فيه ملفات تالفة أو ناقصة', 'Some files are missing or corrupted'] };
  const stateLabel = () => ({ busy: T(...(PH[(S.progress || {}).phase] || PH.idle)), install: T('غير مثبتة', 'Not installed'), offline: T('غير متصل', 'Offline'), maintenance: T('صيانة', 'Maintenance'), required: T('تحديث مطلوب', 'Update required'), update: T('تحديث متاح', 'Update available'), play: T('محدّثة', 'Up to date'), 'offline-installed': T('بدون اتصال', 'Offline') }[status()]);
  const readNews = () => { try { return JSON.parse(localStorage.getItem('arvex.news.read') || '[]'); } catch (e) { return []; } };
  const markRead = id => { const r = readNews(); if (!r.includes(id)) { r.push(id); try { localStorage.setItem('arvex.news.read', JSON.stringify(r.slice(-200))); } catch (e) {} } };
  const newsList = () => (S.news && S.news.news) || [];
  const unread = () => { const r = readNews(); return newsList().filter(n => !r.includes(n.id)).length; };
  const versions = () => (S.versions && S.versions.versions) || [];
  // ------------------------------------------------------------------ chrome
  function nav() {
    const st = status(), u = unread();
    const items = [['home', IC.home, T('الرئيسية', 'Home')], ['download', IC.download, T('التحميل', 'Download')], ['news', IC.news, T('الأخبار', 'News')], ['notes', IC.notes, T('ملاحظات الإصدار', 'Patch notes')], ['support', IC.support, T('الدعم', 'Support')], ['about', IC.about, T('من نحن', 'About')], ['credits', IC.credits, T('الشكر', 'Credits')], ['settings', IC.settings, T('الإعدادات', 'Settings')]];
    $('#nav').innerHTML = items.map(([k, ic, n]) => `<button class="${page === k ? 'on' : ''}" data-go="${k}" ${page === k ? 'aria-current="page"' : ''}>${ic}<span>${n}</span>${(k === 'download' && ['busy', 'update', 'required'].includes(st)) || (k === 'news' && u) ? '<i class="badge"></i>' : ''}</button>`).join('');
    const srv = S.servers && S.servers.servers ? S.servers.servers : null, online = srv ? srv.reduce((a, s) => a + s.players, 0) : null;
    $('#sidenet').innerHTML = `<span class="ax-chip dot ${S.online ? 'ok pulse' : 'warn'}">${S.online ? T('متصل', 'Online') : T('غير متصل', 'Offline')}</span><span class="ax-meta">${T('لاعبين متصلين', 'Players online')}</span><b>${online == null ? '—' : online}</b><span class="ax-meta">${srv ? srv.filter(s => s.status === 'online' || s.status === 'full').length + '/' + srv.length + ' ' + T('سيرفر', 'servers') : '—'}</span>`;
    $('#foot-v').textContent = `ARVEX ${S.installed || S.latest || '—'}${S.installedBuild ? ' · build ' + shortBuild(S.installedBuild) : ''}`; $('#foot-l').textContent = 'Launcher ' + S.launcher;
  }
  /** one banner at most, the most important first */
  function banner() {
    const st = status(), r = S.remote || {}, p = S.progress || {};
    if (r.maintenance && r.maintenance.on) return `<div class="banner warn" role="status">${IC.wrench}<div><b>${T('وضع الصيانة', 'Maintenance mode')}</b><span>${esc(tr(r.maintenance.message))}${r.maintenance.until ? ` · ${T('المتوقع ينتهي', 'Expected back')} ${fmtT(r.maintenance.until)}` : ''}</span></div>${S.installed && !(S.block && S.block.code === 'ARVEX-A001') ? `<span class="ax-meta">${T('اللعب الفردي شغال', 'Solo play still works')}</span>` : ''}</div>`;
    if (st === 'required') return `<div class="banner err" role="alert">${IC.download}<div><b>${T('تحديث إجباري', 'Update required')} · ${esc(S.latest)}</b><span>${esc((r.forceUpdate && r.forceUpdate.on && tr(r.forceUpdate.reason)) || errText({ code: S.block.code }).hint)}</span></div><button class="ax-btn primary" data-act="update">${T('حدّث الحين', 'Update now')}</button></div>`;
    if (p.phase === 'error' && p.error && p.error.code === 'ARVEX-F001' || (p.phase === 'done' && p.result === 'verify_bad')) return `<div class="banner err" role="alert">${IC.wrench}<div><b>${T('ملفات اللعبة تحتاج إصلاح', 'The installation needs repair')}</b><span>${T('بنحمّل الملفات المتضررة بس.', 'Only the damaged files are downloaded.')}</span></div><button class="ax-btn primary" data-act="repair">${T('أصلح التثبيت', 'Repair installation')}</button></div>`;
    if (S.recovered) return `<div class="banner info" role="status">${IC.shield}<div><b>${T('رجّعنا النسخة السابقة', 'Previous version restored')}</b><span>${T('آخر تحديث انقطع قبل ما يكتمل، فرجّعنا ملفات اللعبة مثل ما كانت. تقدر تحدّث مرة ثانية.', 'The last update was interrupted before it finished, so the game files were put back as they were. You can update again.')}</span></div><button class="ax-btn ghost sm" data-act="dismiss">${T('تمام', 'OK')}</button></div>`;
    if (S.error && !S.online) { const x = errText(S.error); return `<div class="banner off" role="status">${IC.off}<div><b>${esc(x.title)}</b><span>${esc(x.hint)}${S.installed ? ' ' + T('تقدر تلعب فردي بدون اتصال.', 'You can still play solo offline.') : ''}</span></div><button class="ax-btn ghost sm" data-act="check">${IC.refresh}${T('حاول', 'Retry')}</button></div>`; }
    if (S.error && S.online) return `<div class="banner err" role="alert">${IC.err}<div><b>${esc(errText(S.error).title)}</b><span>${esc(errText(S.error).hint)}</span></div><span class="ax-chip err code">${esc(S.error.code)}</span></div>`;
    return '';
  }
  function primaryButton(big) {
    const st = status(), p = S.progress || {}, cls = big ? 'xl' : 'lg';
    if (st === 'install') return `<button class="ax-btn primary ${cls}" data-act="install">${IC.download}${T('تثبيت', 'Install')}</button>`;
    if (st === 'required') return `<button class="ax-btn primary ${cls}" data-act="update">${IC.download}${T('حدّث الحين', 'Update now')}</button>`;
    if (st === 'update') return `<button class="ax-btn primary ${cls}" data-act="update">${IC.download}${T('تحديث', 'Update')}</button>`;
    if (st === 'busy') return p.phase === 'paused' ? `<button class="ax-btn primary ${cls}" data-act="resume">${IC.play}${T('كمّل', 'Resume')}</button>` : `<button class="ax-btn ${cls} is-loading" data-go="download">${esc(T(...(PH[p.phase] || PH.idle)))}</button>`;
    if (st === 'offline') return `<button class="ax-btn ${cls}" data-act="check">${IC.refresh}${T('حاول مرة ثانية', 'Retry')}</button>`;
    if (st === 'maintenance') return `<button class="ax-btn ${cls}" disabled>${IC.wrench}${T('صيانة', 'Maintenance')}</button>`;
    return `<button class="ax-btn primary ${cls}" data-act="play" ${S.gameRunning ? 'disabled' : ''}>${IC.play}${S.gameRunning ? T('اللعبة شغالة', 'Game running') : st === 'offline-installed' ? T('العب بدون اتصال', 'Play offline') : T('العب', 'Play')}</button>`;
  }
  const retryLabel = m => { const r = /^retry:(\d+):(\d+)$/.exec(m || ''); return r ? T(`نعيد المحاولة (${r[1]}) بعد ${r[2]} ث`, `Reconnecting (attempt ${r[1]}) in ${r[2]} s`) : (m === 'cancelled' ? T('انلغت', 'Cancelled') : ''); };
  const pctOf = p => p.phase === 'verifying' ? (p.filesTotal ? p.filesDone / p.filesTotal : 0) : p.phase === 'installing' ? 1 : (p.total ? Math.min(1, p.downloaded / p.total) : (p.phase === 'done' ? 1 : 0));
  function miniProgress() {
    const p = S.progress || {}; if (!BUSY.includes(p.phase)) return '';
    const pct = pctOf(p);
    return `<div class="mini-prog"><div class="row"><span class="ax-meta">${esc(T(...PH[p.phase]))}</span><span class="ax-data">${Math.floor(pct * 100)}%</span></div><div class="ax-progress ${p.phase === 'paused' ? 'is-paused' : ''} ${p.phase === 'checking' ? 'indet' : ''}"><i style="--v:${(pct * 100).toFixed(1)}%"></i></div><div class="row"><span class="ax-meta">${fmtB(p.downloaded)} / ${fmtB(p.total)}</span><span class="ax-meta">${p.phase === 'downloading' && p.speed ? fmtB(p.speed) + '/s · ' + fmtS(p.eta) : ''}</span></div></div>`;
  }
  // ------------------------------------------------------------------ pages
  function home() {
    const st = status(), srv = (S.servers && S.servers.servers) || [], news = newsList(), rd = readNews(), log = versions()[0];
    const line = st === 'update' || st === 'required' ? `<span class="ax-chip ${st === 'required' ? 'err' : 'signal'}">${stateLabel()}</span><span class="ax-meta">${T('التحميل', 'Download')}: <b class="ax-data">${fmtB(S.updateSize)}</b> · ${S.updateFiles} ${T('ملف', 'files')}</span>` : st === 'install' ? `<span class="ax-chip info">${stateLabel()}</span><span class="ax-meta">${T('حجم التحميل', 'Download size')}: <b class="ax-data">${fmtB(S.updateSize)}</b></span>` : st === 'play' ? `<span class="ax-chip ok">${stateLabel()}</span>` : `<span class="ax-chip ${st === 'busy' ? 'signal' : 'warn'}">${esc(stateLabel())}</span>`;
    const disk = S.disk ? `<div><span class="ax-meta">${T('المساحة الفاضية', 'Free disk space')}</span><b class="${S.updateSizeOnDisk && S.disk.free < S.updateSizeOnDisk * 3 ? 'low' : ''}">${fmtB(S.disk.free)}</b></div>` : '';
    return `<div class="page">${banner()}
      <section class="hero" style="background-image:url(brand/arvex-hero.svg)"><div class="hero-row">
        <div class="hero-info"><img class="hero-logo" src="brand/arvex-logo-stacked.svg" alt="ARVEX SURVIVAL"><span class="ax-eyebrow">${T('اللانشر الرسمي', 'Official launcher')}</span><div class="status-line">${line}</div>
          <div class="ver-row"><div><span class="ax-meta">${T('المثبّت', 'Installed')}</span><b>${esc(S.installed || '—')}</b><span class="ax-meta mono">${S.installedBuild ? 'build ' + esc(shortBuild(S.installedBuild)) : ''}</span></div><div><span class="ax-meta">${T('آخر إصدار', 'Latest')}</span><b>${esc(S.latest || '—')}</b><span class="ax-meta mono">${S.latestBuild ? 'build ' + esc(shortBuild(S.latestBuild)) : ''}</span></div><div><span class="ax-meta">${T('الحالة', 'Status')}</span><b>${esc(stateLabel())}</b><span class="ax-meta">${S.channel && S.channel !== 'stable' ? esc(S.channel.toUpperCase()) : ''}</span></div>${disk}</div></div>
        <div class="cta">${primaryButton(true)}${miniProgress()}<div class="cta-sub">${st === 'required' && S.installed ? '' : ''}<button class="ax-btn ghost sm" data-go="notes">${IC.notes}${T('ملاحظات الإصدار', 'Patch notes')}</button><button class="ax-btn ghost sm" data-go="settings">${IC.settings}${T('الإعدادات', 'Settings')}</button><a class="ax-btn ghost sm" href="https://discord.gg/arvex" target="_blank" rel="noopener">${IC.discord}Discord</a></div></div>
      </div></section>
      <div class="home-grid">
        <section class="ax-panel card-pad"><div class="head-row"><span class="ax-eyebrow">${T('آخر الأخبار', 'Latest news')}</span><button class="ax-btn ghost sm" data-go="news">${T('كل الأخبار', 'All news')}${unread() ? ` · ${unread()}` : ''}</button></div>
          <div class="news-grid two">${news.slice(0, 2).map(n => newsCard(n, rd)).join('') || `<p class="ax-muted">${T('ما فيه أخبار حالياً', 'No news right now')}</p>`}</div></section>
        <section class="ax-panel card-pad"><div class="head-row"><span class="ax-eyebrow">${T('حالة السيرفرات', 'Server status')}</span><span class="ax-meta">${S.lastCheck ? T('آخر فحص', 'Checked') + ' ' + fmtT(S.lastCheck) : ''}</span></div><div class="srv-mini">${srv.map(s => `<div class="srv-row"><span>${esc(s.name)}</span><span class="ax-data">${s.players}/${s.max}</span><span class="ax-chip dot ${s.status === 'online' ? 'ok' : ['full', 'restarting', 'maintenance'].includes(s.status) ? 'warn' : s.status === 'starting' ? 'info' : 'err'}">${esc(s.status.toUpperCase())}</span></div>`).join('') || `<p class="ax-muted">${T('حالة السيرفرات مو متوفرة بدون اتصال', 'Server status is not available offline')}</p>`}</div>
          ${log ? `<div class="ax-line"></div><div class="head-row"><span class="ax-eyebrow">${T('آخر تحديث', 'Latest update')} · ${esc(log.version)}</span><span class="ax-meta">${esc(log.date || '')}</span></div><p class="ax-muted clamp">${esc(log.summary || (log.notes || [])[0] || '')}</p>` : ''}</section>
      </div></div>`;
  }
  const noteBlocks = v => [['features', T('جديد', 'New')], ['improvements', T('تحسينات', 'Improvements')], ['fixes', T('إصلاحات', 'Fixes')], ['performance', T('الأداء', 'Performance')], ['knownIssues', T('مشاكل معروفة', 'Known issues')]].filter(([k]) => (v[k] || []).length).map(([k, t]) => `<h4 class="notes-h ${k}">${t}</h4><ul class="notes">${v[k].map(n => `<li>${esc(n)}</li>`).join('')}</ul>`).join('');
  function download() {
    const p = S.progress || {}, st = status(), pct = pctOf(p), busy = st === 'busy', remaining = Math.max(0, (p.total || 0) - (p.downloaded || 0));
    let state = '';
    if (p.phase === 'done') { const bad = p.result === 'verify_bad'; state = `<div class="ax-panel state-box ${bad ? 'err' : 'ok'}">${bad ? IC.err : IC.ok}<div><h3 class="ax-h3">${esc(T(...(RES[p.result] || PH.done)))}</h3>${bad ? `<p class="ax-muted">${p.bad.length} ${T('ملف يحتاج إصلاح', 'file(s) need repair')}</p><ul class="bad-list">${p.bad.slice(0, 40).map(b => `<li>${esc(b)}</li>`).join('')}</ul><div class="dl-actions"><button class="ax-btn primary" data-act="repair">${IC.wrench}${T('أصلح التثبيت', 'Repair installation')}</button></div>` : `<p class="ax-muted">${p.result === 'verify_ok' ? `${p.filesDone} ${T('ملف تم فحصه', 'files checked')}` : `ARVEX ${esc(S.installed || '')} · build ${esc(shortBuild(S.installedBuild))}`}</p><div class="dl-actions">${p.result !== 'verify_ok' && !S.block ? `<button class="ax-btn primary" data-act="play">${IC.play}${T('العب', 'Play')}</button>` : ''}<button class="ax-btn ghost" data-act="dismiss">${T('تمام', 'OK')}</button></div>`}</div></div>`; }
    if (p.phase === 'error') { const c = p.error && p.error.code; state = errBox(p.error, `${c === 'ARVEX-U007' || c === 'ARVEX-U004' ? '' : `<button class="ax-btn primary" data-act="${c === 'ARVEX-F001' ? 'repair' : p.op === 'repair' ? 'repair' : S.installed ? 'update' : 'install'}">${IC.refresh}${T('حاول مرة ثانية', 'Retry')}</button>`}${S.installed && c !== 'ARVEX-F002' ? `<button class="ax-btn" data-act="repair">${IC.wrench}${T('إصلاح', 'Repair')}</button>` : ''}${c === 'ARVEX-F002' || c === 'ARVEX-F003' ? `<button class="ax-btn" data-go="settings">${IC.folder}${T('غيّر المجلد', 'Change folder')}</button>` : ''}<button class="ax-btn ghost" data-go="support">${T('اطلب مساعدة', 'Get help')}</button><button class="ax-btn ghost" data-act="dismiss">${T('إغلاق', 'Dismiss')}</button>`); }
    if (p.phase === 'offline' || st === 'offline') state = errBox((p.error) || S.error || { code: 'ARVEX-N001' }, `<button class="ax-btn primary" data-act="check">${IC.refresh}${T('حاول مرة ثانية', 'Retry')}</button>`);
    const title = busy ? T(...PH[p.phase]) : stateLabel();
    const notes = S.releaseNotes || versions().find(v => v.version === S.latest) || null;
    const sub = busy && retryLabel(p.message) ? retryLabel(p.message) : (st === 'update' || st === 'required') ? `${esc(S.installed)} (${esc(shortBuild(S.installedBuild))}) → ${esc(S.latest)} (${esc(shortBuild(S.latestBuild))})` : st === 'install' ? `ARVEX ${esc(S.latest || '')}` : S.installed ? `ARVEX ${esc(S.installed)} · build ${esc(shortBuild(S.installedBuild))}` : '';
    return `<div class="page">${banner()}<div class="page-h"><span class="ax-eyebrow">${T('التحميل والتحديثات', 'Downloads & updates')}</span><h1 class="ax-h1">${T('التحميل', 'Download')}</h1></div>
      ${state}
      <section class="ax-panel dl">
        <div class="dl-head"><div><span class="ax-eyebrow">ARVEX SURVIVAL${S.channel ? ' · ' + esc(S.channel.toUpperCase()) : ''}</span><p class="dl-state">${esc(title)}</p><span class="ax-meta">${sub}</span></div><span class="dl-pct ax-data">${busy || p.phase === 'done' ? Math.floor(pct * 100) + '%' : ''}</span></div>
        <div class="ax-progress ${p.phase === 'paused' ? 'is-paused' : ''} ${p.phase === 'done' ? 'is-ok' : ''} ${p.phase === 'error' ? 'is-err' : ''} ${p.phase === 'checking' ? 'indet' : ''}" role="progressbar" aria-valuenow="${Math.floor(pct * 100)}" aria-valuemin="0" aria-valuemax="100"><i style="--v:${(pct * 100).toFixed(2)}%"></i></div>
        <div class="dl-stats">
          <div><span class="ax-meta">${T('المحمّل', 'Downloaded')}</span><b>${busy || p.phase === 'done' ? fmtB(p.downloaded) + ' / ' + fmtB(p.total) : '—'}</b></div>
          <div><span class="ax-meta">${T('المتبقي', 'Remaining')}</span><b>${busy ? fmtB(remaining) : ['update', 'required', 'install'].includes(st) ? fmtB(S.updateSize) : '0 B'}</b></div>
          <div><span class="ax-meta">${T('السرعة', 'Speed')}</span><b>${p.phase === 'downloading' && p.speed ? fmtB(p.speed) + '/s' : '—'}</b></div>
          <div><span class="ax-meta">${T('الوقت المتبقي', 'Time remaining')}</span><b>${p.phase === 'downloading' && p.speed ? fmtS(p.eta) : '—'}</b></div>
          <div><span class="ax-meta">${T('الملفات', 'Files')}</span><b>${p.filesTotal ? p.filesDone + ' / ' + p.filesTotal : (['update', 'required', 'install'].includes(st) ? S.updateFiles : '—')}</b></div>
        </div>
        <div class="dl-file"><span class="ax-meta">${T('الملف الحالي', 'Current file')}</span><span class="ax-data">${esc(p.file || '—')}</span></div>
        <div class="dl-actions">${busy ? (p.phase === 'paused' ? `<button class="ax-btn primary lg" data-act="resume">${IC.play}${T('كمّل', 'Resume')}</button>` : `<button class="ax-btn lg" data-act="pause" ${p.phase !== 'downloading' ? 'disabled' : ''}>${IC.pause}${T('إيقاف مؤقت', 'Pause')}</button>`) + `<button class="ax-btn ghost lg" data-act="cancel" ${p.phase === 'installing' ? 'disabled' : ''}>${IC.x}${T('إلغاء', 'Cancel')}</button>` : primaryButton(false)}</div>
      </section>
      <div class="dl-tools">
        <section class="ax-panel card-pad"><span class="ax-eyebrow">${T('ملفات اللعبة', 'Game files')}</span><p class="ax-muted">${T('الفحص يقارن كل ملف بالـ SHA-256 حقه. الإصلاح يحمّل الملفات الناقصة أو التالفة بس.', 'Verify compares every file with its SHA-256. Repair downloads only the missing or damaged files.')}</p>
          <dl class="kv"><dt>${T('حجم اللعبة', 'Game size')}</dt><dd>${fmtB(S.gameSize)}</dd><dt>${T('تاريخ الإصدار', 'Released')}</dt><dd>${fmtD(S.releaseDate)}</dd><dt>${T('أقل إصدار مدعوم', 'Minimum version')}</dt><dd>${esc(S.minVersion || '—')}</dd><dt>${T('التوقيع', 'Signature')}</dt><dd>${S.signature === 'verified' ? `<span class="ax-chip ok">${T('موثّق', 'Verified')}</span>` : S.latest ? `<span class="ax-chip warn">${T('غير موقّع', 'Unsigned')}</span>` : '—'}</dd></dl>
          <div class="dl-actions"><button class="ax-btn" data-act="verify" ${busy || !S.installed ? 'disabled' : ''}>${IC.shield}${T('افحص الملفات', 'Verify files')}</button><button class="ax-btn" data-act="repair" ${busy || !S.installed ? 'disabled' : ''}>${IC.wrench}${T('إصلاح', 'Repair')}</button><button class="ax-btn ghost" data-act="open-folder">${IC.folder}${T('افتح المجلد', 'Open folder')}</button></div></section>
        <section class="ax-panel card-pad"><div class="head-row"><span class="ax-eyebrow">${T('ملاحظات الإصدار', 'Patch notes')} · ${esc(S.latest || '')}</span>${S.mandatory ? `<span class="ax-chip err">${T('إجباري', 'Mandatory')}</span>` : `<span class="ax-chip info">${T('اختياري', 'Optional')}</span>`}</div>${notes ? `${notes.summary ? `<p>${esc(notes.summary)}</p>` : ''}<div class="notes-scroll">${noteBlocks(notes)}</div>` : `<p class="ax-muted">${T('ما فيه ملاحظات لهذا الإصدار', 'No notes for this release')}</p>`}<button class="ax-btn ghost sm" data-go="notes">${T('كل الإصدارات', 'All releases')}</button></section>
      </div></div>`;
  }
  function newsCard(n, rd) { const isNew = rd && !rd.includes(n.id); return `<article class="news ax-card is-interactive ${isNew ? 'unread' : ''}" data-news="${esc(n.id)}" tabindex="0"><div class="news-th" style="background-image:url(${esc(/^brand\/[\w.@-]+$/.test(n.image || '') ? n.image : 'brand/arvex-main-banner.svg')})"></div><div class="news-b"><div class="row"><span class="ax-chip ${n.tag === 'update' ? 'signal' : n.tag === 'maintenance' ? 'warn' : 'info'}">${esc(String(n.tag || 'news').toUpperCase())}</span>${isNew ? `<span class="ax-chip ok">${T('جديد', 'NEW')}</span>` : ''}<span class="ax-meta">${esc(n.date || '')}</span></div><h3 class="ax-h3">${esc(tr(n.title))}</h3><p class="ax-muted">${esc(tr(n.short))}</p></div></article>`; }
  function news() { const list = newsList(), rd = readNews(); return `<div class="page">${banner()}<div class="page-h"><span class="ax-eyebrow">ARVEX</span><h1 class="ax-h1">${T('الأخبار', 'News')}</h1></div><div class="news-grid">${list.map(n => newsCard(n, rd)).join('') || `<div class="ax-panel state-box off">${IC.news}<div><h3 class="ax-h3">${T('ما فيه أخبار', 'No news yet')}</h3><p class="ax-muted">${S.online ? T('أول ما ننشر شي بيطلع هنا.', 'Announcements will show up here as soon as they are published.') : T('الأخبار تحتاج اتصال.', 'News needs a connection.')}</p></div></div>`}</div></div>`; }
  function modal(html, wide) { const b = document.createElement('div'); b.className = 'ax-modal-back'; b.innerHTML = `<div class="ax-modal ax-panel" role="dialog" aria-modal="true" style="width:min(${wide ? 44 : 30}rem,100%)">${html}</div>`; b.addEventListener('click', e => { if (e.target === b || e.target.closest('[data-close]')) b.remove(); }); document.body.appendChild(b); const f = b.querySelector('button,input,textarea'); if (f) f.focus(); return b; }
  function openNews(id) { const n = newsList().find(x => x.id === id); if (!n) return; markRead(id); modal(`<span class="ax-eyebrow">${esc(n.date || '')}</span><h3 class="ax-h2">${esc(tr(n.title))}</h3><p class="news-body">${esc(tr(n.body) || tr(n.short))}</p><div class="dl-actions"><button class="ax-btn primary" data-close>${T('إغلاق', 'Close')}</button></div>`, true); render(); }
  function notes() {
    const list = versions();
    return `<div class="page"><div class="page-h"><span class="ax-eyebrow">ARVEX SURVIVAL</span><h1 class="ax-h1">${T('ملاحظات الإصدار', 'Patch notes')}</h1></div>${list.map(v => `<section class="ax-panel card-pad rel"><div class="head-row"><h2 class="ax-h2">${esc(v.version)}</h2><div class="row-chips">${v.version === S.installed ? `<span class="ax-chip ok">${T('المثبّت', 'Installed')}</span>` : ''}${v.version === S.latest ? `<span class="ax-chip signal">${T('الأحدث', 'Latest')}</span>` : ''}<span class="ax-chip info">${esc(String(v.type || '').toUpperCase())}</span><span class="ax-meta">${esc(v.date || '')}</span></div></div>${v.summary ? `<p>${esc(v.summary)}</p>` : ''}${noteBlocks(v)}</section>`).join('') || `<div class="ax-panel state-box off">${IC.notes}<div><h3 class="ax-h3">${T('ما فيه ملاحظات', 'No patch notes available')}</h3><p class="ax-muted">${T('تحتاج اتصال أول مرة.', 'A connection is needed the first time.')}</p></div></div>`}</div>`;
  }
  function support() {
    const flagsOff = S.remote && S.remote.flags && S.remote.flags.tickets === false, e = (S.progress && S.progress.error) || S.error;
    const list = supportTickets === null ? `<p class="ax-muted">${T('نحمّل طلباتك…', 'Loading your requests…')}</p>` : supportTickets.length ? supportTickets.map(t => `<article class="ax-card ticket"><div class="head-row"><b>${esc(t.subject)}</b><div class="row-chips"><span class="ax-chip ${t.status === 'open' ? 'signal' : t.status === 'pending' ? 'ok' : 'info'}">${esc({ open: T('مفتوح', 'OPEN'), pending: T('وصل رد', 'ANSWERED'), closed: T('مغلق', 'CLOSED'), archived: T('مؤرشف', 'ARCHIVED') }[t.status] || t.status)}</span><span class="ax-meta mono">${esc(t.id)}</span></div></div><div class="thread">${t.messages.map(m => `<div class="msg ${m.from}"><span class="ax-meta">${esc(m.from === 'staff' ? 'ARVEX Support' : T('أنت', 'You'))} · ${fmtT(m.at)}</span><p>${esc(m.text)}</p></div>`).join('')}</div>${t.status !== 'archived' ? `<form class="reply" data-ticket="${esc(t.id)}"><input class="ax-input" name="m" maxlength="2000" placeholder="${T('اكتب رد…', 'Write a reply…')}" required><button class="ax-btn sm">${T('إرسال', 'Send')}</button></form>` : ''}</article>`).join('') : `<p class="ax-muted">${T('ما عندك طلبات دعم من هذا الجهاز.', 'No support requests from this computer yet.')}</p>`;
    return `<div class="page"><div class="page-h"><span class="ax-eyebrow">ARVEX</span><h1 class="ax-h1">${T('الدعم', 'Support')}</h1></div><div class="dl-tools">
      <section class="ax-panel card-pad"><span class="ax-eyebrow">${T('بلّغ عن مشكلة', 'Report a problem')}</span>${flagsOff ? `<p class="ax-muted">${T('طلبات الدعم موقفة حالياً. استخدم الديسكورد.', 'Support requests are turned off right now. Please use the Discord.')}</p>` : `<form id="ticket-form" class="form">
          <label class="ax-label" for="t-sub">${T('العنوان', 'Subject')}</label><input class="ax-input" id="t-sub" maxlength="120" minlength="4" required>
          <label class="ax-label" for="t-cat">${T('النوع', 'Category')}</label><select class="ax-input" id="t-cat"><option value="launcher">${T('اللانشر', 'Launcher')}</option><option value="update">${T('التحديث', 'Update')}</option><option value="game">${T('اللعبة', 'Game')}</option><option value="server">${T('السيرفرات', 'Servers')}</option><option value="other">${T('غيره', 'Other')}</option></select>
          <label class="ax-label" for="t-msg">${T('وش صار؟', 'What happened?')}</label><textarea class="ax-input" id="t-msg" rows="5" maxlength="4000" minlength="10" required></textarea>
          <label class="ax-label" for="t-con">${T('وسيلة تواصل (اختياري)', 'Contact (optional)')}<span class="help">${T('يوزر ديسكورد مثلاً', 'For example your Discord name')}</span></label><input class="ax-input" id="t-con" maxlength="80">
          <p class="ax-meta">${T('نرسل مع الطلب: إصدار اللانشر، إصدار اللعبة، النظام', 'Sent with the request: launcher version, game version, OS')}${e ? `, ${T('وآخر كود خطأ', 'and the last error code')} (${esc(e.code)})` : ''}.</p>
          <div class="dl-actions"><button class="ax-btn primary" ${supportBusy || !S.online ? 'disabled' : ''}>${T('أرسل', 'Send request')}</button><a class="ax-btn ghost" href="https://discord.gg/arvex" target="_blank" rel="noopener">${IC.discord}Discord</a><button type="button" class="ax-btn ghost" data-act="open-logs">${IC.folder}${T('مجلد السجلات', 'Logs folder')}</button></div></form>`}</section>
      <section class="ax-panel card-pad"><div class="head-row"><span class="ax-eyebrow">${T('طلباتك', 'Your requests')}</span><button class="ax-btn ghost sm" data-act="load-tickets">${IC.refresh}${T('حدّث', 'Refresh')}</button></div>${list}</section></div></div>`;
  }
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
    const s = S.settings, busy = status() === 'busy', ch = (S.remote && S.remote.channels) || ['stable'];
    const row = (label, help, control) => `<div class="set-row"><label class="ax-label">${label}${help ? `<span class="help">${help}</span>` : ''}</label>${control}</div>`;
    const tog = (id, on, dis) => `<input type="checkbox" class="ax-toggle tog" id="${id}" ${on ? 'checked' : ''} ${dis ? 'disabled' : ''}>`;
    return `<div class="page"><div class="page-h"><span class="ax-eyebrow">ARVEX LAUNCHER ${esc(S.launcher)}</span><h1 class="ax-h1">${T('الإعدادات', 'Settings')}</h1></div><div class="ax-panel set">
      <div class="set-sec"><span class="ax-eyebrow">${T('المجلدات', 'Locations')}</span>
        ${row(T('مكان التثبيت', 'Install location'), `${T('اللعبة تنحفظ هنا', 'The game is installed here')}${S.disk ? ` · ${T('فاضي', 'free')} ${fmtB(S.disk.free)}` : ''}`, `<div class="path-row"><input class="ax-input mono" id="s-inst" value="${esc(s.installDir)}" ${busy ? 'disabled' : ''}><button class="ax-btn ghost sm" data-act="open-folder">${IC.folder}${T('افتح', 'Open')}</button></div>`)}
        ${row(T('مكان التحميل المؤقت', 'Download location'), T('فاضي = داخل مجلد اللعبة', 'Empty = inside the game folder'), `<input class="ax-input mono" id="s-dl" value="${esc(s.downloadDir || '')}" ${busy ? 'disabled' : ''}>`)}</div>
      <div class="set-sec"><span class="ax-eyebrow">${T('التحديثات', 'Updates')}</span>
        ${row(T('تحديث تلقائي', 'Auto update'), T('يحمّل التحديثات أول ما تنزل', 'Download updates as soon as they are published'), tog('s-auto', s.autoUpdate))}
        ${row(T('إصلاح تلقائي', 'Auto repair'), T('لو ملف ناقص وقت التشغيل، نصلحه على طول', 'If a file is missing at launch, repair it right away'), tog('s-rep', s.autoRepair))}
        ${row(T('القناة', 'Release channel'), T('Beta فيها تحديثات أبدر وأقل ثبات', 'Beta gets updates earlier and is less stable'), `<select class="ax-input" id="s-ch" ${busy ? 'disabled' : ''}>${ch.map(c => `<option value="${esc(c)}" ${s.channel === c ? 'selected' : ''}>${esc(c[0].toUpperCase() + c.slice(1))}</option>`).join('')}</select>`)}
        ${row(T('حد السرعة (KB/s)', 'Speed limit (KB/s)'), T('0 = بدون حد', '0 = unlimited'), `<input class="ax-input mono" id="s-lim" type="number" min="0" step="64" value="${s.speedLimitKB || 0}">`)}
        ${row(T('تحميلات بنفس الوقت', 'Parallel downloads'), T('1 إلى 6', '1 to 6'), `<input class="ax-input mono" id="s-con" type="number" min="1" max="6" step="1" value="${s.concurrent || 3}">`)}</div>
      <div class="set-sec"><span class="ax-eyebrow">${T('النظام', 'System')}</span>
        ${row(T('يشتغل مع ويندوز', 'Start with Windows'), '', tog('s-win', s.startWithWindows, S.os !== 'windows'))}
        ${row(T('الإشعارات', 'Notifications'), T('ينبهك لما يخلص تحديث أو ينزل خبر', 'Tell me when an update finishes or news arrives'), tog('s-not', s.notifications))}
        ${row(T('أرسل تقارير الأخطاء', 'Send error reports'), T('كود الخطأ والإصدار والنظام فقط. بدون بيانات شخصية.', 'Error code, version and OS only. No personal data.'), tog('s-tel', s.sendReports))}
        ${row(T('اللغة', 'Language'), '', `<select class="ax-input" id="s-lang"><option value="ar" ${s.language !== 'en' ? 'selected' : ''}>العربية</option><option value="en" ${s.language === 'en' ? 'selected' : ''}>English</option></select>`)}
        ${row(T('سيرفر التحديثات', 'Update server'), T('للمتقدمين. HTTPS فقط.', 'Advanced. HTTPS only.'), `<input class="ax-input mono" id="s-srv" value="${esc(s.server)}" ${busy ? 'disabled' : ''}>`)}</div>
      <div class="set-actions"><button class="ax-btn primary" data-act="saveSettings">${T('حفظ', 'Save')}</button><button class="ax-btn" data-act="verify" ${busy || !S.installed ? 'disabled' : ''}>${IC.shield}${T('افحص', 'Verify')}</button><button class="ax-btn" data-act="repair" ${busy || !S.installed ? 'disabled' : ''}>${IC.wrench}${T('إصلاح', 'Repair')}</button><button class="ax-btn ghost" data-act="check">${IC.refresh}${T('شيّك على تحديث', 'Check for updates')}</button><button class="ax-btn ghost" data-act="open-logs">${IC.folder}${T('مجلد السجلات', 'Logs folder')}</button></div>
      <div class="set-sec danger"><span class="ax-eyebrow">${T('صيانة اللانشر', 'Maintenance')}</span><div class="set-actions"><button class="ax-btn ghost" data-act="clear-cache" ${busy ? 'disabled' : ''}>${T('امسح الكاش', 'Clear cache')}</button><button class="ax-btn ghost" data-ask="reset" ${busy ? 'disabled' : ''}>${T('رجّع إعدادات اللانشر', 'Reset launcher')}</button><button class="ax-btn ghost danger" data-ask="uninstall" ${busy || !S.installed ? 'disabled' : ''}>${T('احذف اللعبة', 'Uninstall game')}</button></div></div>
    </div></div>`;
  }
  function ask(kind) {
    if (kind === 'reset') { const m = modal(`<h3 class="ax-h3">${T('ترجّع إعدادات اللانشر؟', 'Reset the launcher?')}</h3><p class="ax-muted">${T('الإعدادات ترجع للوضع الافتراضي. اللعبة المثبتة وحفظك ما ينلمسون.', 'Settings go back to defaults. The installed game and your saves are not touched.')}</p><div class="dl-actions"><button class="ax-btn primary" data-ok>${T('رجّع', 'Reset')}</button><button class="ax-btn ghost" data-close>${T('إلغاء', 'Cancel')}</button></div>`); m.querySelector('[data-ok]').onclick = () => { m.remove(); act('reset', {}, T('رجعت الإعدادات', 'Launcher reset')); }; }
    if (kind === 'uninstall') { const m = modal(`<h3 class="ax-h3">${T('تحذف ARVEX من هذا الجهاز؟', 'Uninstall ARVEX from this computer?')}</h3><p class="ax-muted">${T('بنحذف ملفات اللعبة من', 'Game files will be removed from')} <span class="ax-data">${esc(S.settings.installDir)}</span></p><label class="check"><input type="checkbox" id="u-wipe"> ${T('احذف كمان عوالمي المحفوظة وإعدادات اللعبة (ما ترجع)', 'Also delete my saved worlds and game settings (cannot be undone)')}</label><div class="dl-actions"><button class="ax-btn primary danger" data-ok>${T('احذف', 'Uninstall')}</button><button class="ax-btn ghost" data-close>${T('إلغاء', 'Cancel')}</button></div>`); m.querySelector('[data-ok]').onclick = () => { const wipe = m.querySelector('#u-wipe').checked; m.remove(); act('uninstall', { confirm: true, wipeUserData: wipe }, T('انحذفت اللعبة', 'Game uninstalled')); }; }
  }
  const PAGES = { home, download, news, notes, support, about, credits, settings };
  function render() {
    if (!S) return; L = S.settings.language === 'en' ? 'en' : 'ar';
    document.documentElement.lang = L; document.documentElement.dir = L === 'en' ? 'ltr' : 'rtl';
    nav(); const ae = document.activeElement, id = ae && ae.id;
    if ((page === 'settings' && id && id.startsWith('s-')) || (page === 'support' && ae && (ae.closest('#ticket-form') || ae.closest('.reply')))) return; // never clobber what the user is typing
    $('#main').innerHTML = PAGES[page]();
  }
  async function loadTickets() { try { supportTickets = await api('tickets'); } catch (e) { supportTickets = []; } if (page === 'support') render(); }
  document.addEventListener('click', async e => {
    const go = e.target.closest('[data-go]'); if (go) { page = go.dataset.go; if (document.activeElement) document.activeElement.blur(); render(); $('#main').scrollTop = 0; if (page === 'support') loadTickets(); return; }
    const nw = e.target.closest('[data-news]'); if (nw) return openNews(nw.dataset.news);
    const q = e.target.closest('[data-ask]'); if (q) return ask(q.dataset.ask);
    const a = e.target.closest('[data-act]'); if (!a || a.disabled) return; const k = a.dataset.act;
    if (k === 'load-tickets') { supportTickets = null; render(); return loadTickets(); }
    if (k === 'saveSettings') { const v = id => $('#' + id); if (v('s-not').checked && window.Notification && Notification.permission === 'default') Notification.requestPermission(); if (document.activeElement) document.activeElement.blur(); return act('settings', { installDir: v('s-inst').value.trim(), downloadDir: v('s-dl').value.trim(), speedLimitKB: Math.max(0, +v('s-lim').value || 0), concurrent: Math.min(6, Math.max(1, +v('s-con').value || 3)), autoUpdate: v('s-auto').checked, autoRepair: v('s-rep').checked, channel: v('s-ch').value, startWithWindows: v('s-win').checked, notifications: v('s-not').checked, sendReports: v('s-tel').checked, language: v('s-lang').value, server: v('s-srv').value.trim() }, T('انحفظت الإعدادات', 'Settings saved')); }
    if (['install', 'update', 'repair', 'verify'].includes(k)) page = 'download';
    act(k, {}, k === 'clear-cache' ? T('انمسح الكاش', 'Cache cleared') : k === 'play' ? T('نشغّل ARVEX…', 'Launching ARVEX…') : null);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('[data-news]')) openNews(e.target.dataset.news); if (e.key === 'Escape') { const m = document.querySelector('.ax-modal-back'); if (m) m.remove(); } });
  document.addEventListener('submit', async e => {
    e.preventDefault(); const f = e.target;
    if (f.id === 'ticket-form') { supportBusy = true; const body = { subject: $('#t-sub').value.trim(), category: $('#t-cat').value, message: $('#t-msg').value.trim(), contact: $('#t-con').value.trim() }; try { const r = await api('ticket', body); toast(`${T('وصل طلبك', 'Request sent')} · ${r.id}`, 'ok', 5000); f.reset(); document.activeElement && document.activeElement.blur(); supportTickets = null; loadTickets(); } catch (er) { const x = errText(er.coded); toast(`${x.title} · ${x.detail || x.code}`, 'err', 6000); } supportBusy = false; render(); }
    if (f.classList.contains('reply')) { const inp = f.querySelector('input'); try { await api('ticket-reply', { id: f.dataset.ticket, message: inp.value.trim() }); inp.value = ''; inp.blur(); loadTickets(); } catch (er) { toast(errText(er.coded).title, 'err'); } }
  });
  // ------------------------------------------------------------------ live state
  const notify = (title, body) => { if (S.settings.notifications && window.Notification && Notification.permission === 'granted' && document.hidden) try { new Notification(title, { body, icon: 'brand/arvex-mark.svg' }); } catch (e) {} };
  async function boot() {
    $('#splash-t').textContent = 'ARVEX LAUNCHER';
    try { S = await api('state'); } catch (e) { $('#splash-t').textContent = 'Launcher service not reachable'; return setTimeout(boot, 1500); }
    render(); $('#app').hidden = false; $('#splash').classList.add('out'); setTimeout(() => $('#splash').remove(), 500);
    const es = new EventSource('/api/events'); let lastPhase = (S.progress || {}).phase, lastNews = newsList().length, lastLatest = S.latestBuild;
    es.onmessage = ev => {
      const n = JSON.parse(ev.data), ph = n.progress && n.progress.phase; S = n;
      if (ph !== lastPhase && ph === 'done' && n.progress.result) { const m = T(...RES[n.progress.result]); toast(m, n.progress.result === 'verify_bad' ? 'warn' : 'ok'); notify('ARVEX', m); }
      if (ph !== lastPhase && ph === 'error' && n.progress.error) { const x = errText(n.progress.error); toast(`${x.title} · ${x.code}`, 'err', 6000); notify('ARVEX', x.title); }
      if (newsList().length > lastNews) notify('ARVEX', tr(newsList()[0].title));
      if (n.latestBuild && lastLatest && n.latestBuild !== lastLatest && n.updateAvailable) { toast(`${T('نزل تحديث', 'Update available')} · ${n.latest}`, 'signal', 5000); notify('ARVEX', `${T('نزل تحديث', 'Update available')} ${n.latest}`); }
      lastPhase = ph; lastNews = newsList().length; lastLatest = n.latestBuild || lastLatest; render();
    };
    es.onerror = () => {};
  }
  boot();
})();
