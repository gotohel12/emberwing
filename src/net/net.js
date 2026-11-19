// EMBERWING — WebSocket client for online rooms (co-op / versus)
export const ONLINE_URL = 'https://emberwing.onrender.com';

export class Net {
  constructor(app) {
    this.app = app; this.ws = null; this.id = 0; this.room = null; this.h = {}; this.status = 'off'; this.rtt = 0; this.version = '';
    this._pingT = null;
  }
  base() {
    // same origin when the game is served by the online server; otherwise use the public server
    const h = location.hostname;
    if (/onrender\.com$/.test(h) || (location.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(h) && location.port !== '47331')) return location.origin;
    return ONLINE_URL;
  }
  wsUrl() { return this.base().replace(/^http/, 'ws') + '/ws'; }
  on(t, fn) { (this.h[t] = this.h[t] || []).push(fn); return () => { this.h[t] = this.h[t].filter(f => f !== fn); }; }
  off(t) { delete this.h[t]; }
  emit(t, m) { for (const f of (this.h[t] || []).slice()) try { f(m); } catch (e) { console.error(e); } }
  get connected() { return this.ws && this.ws.readyState === 1 && this.id; }
  /** connect (the free server may need up to ~60 s to wake up) */
  connect(onWait) {
    if (this.connected) return Promise.resolve();
    if (this._p) return this._p;
    this.status = 'connecting';
    this._p = new Promise((res, rej) => {
      let tries = 0, done = false;
      const t0 = Date.now();
      const fail = msg => { if (done) return; done = true; this._p = null; this.status = 'off'; rej(new Error(msg)); };
      const attempt = () => {
        if (done) return;
        tries++;
        // wake the server over HTTP first (Render free instances sleep)
        if (tries === 1) fetch(this.base() + '/health', { cache: 'no-store', mode: 'no-cors' }).catch(() => {});
        let ws;
        try { ws = new WebSocket(this.wsUrl()); } catch (e) { return fail('ws'); }
        this.ws = ws;
        const to = setTimeout(() => { try { ws.close(); } catch (e) {} }, 9000);
        ws.onmessage = ev => {
          let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
          if (m.t === 'welcome') { clearTimeout(to); this.id = m.id; this.version = m.version; this.status = 'on'; if (!done) { done = true; this._p = null; res(); } this.startPing(); this.send({ t: 'hello', name: this.app.save.name || 'لاعب', skin: this.app.save.skin }); }
          else if (m.t === 'pong') { this.rtt = performance.now() - m.k; }
          else { if (m.t === 'room') this.room = m; if (m.t === 'lobby') this.room = null; this.emit(m.t, m); }
        };
        ws.onclose = () => {
          clearTimeout(to);
          const was = this.id; this.id = 0; this.stopPing();
          if (!done) { if (Date.now() - t0 < 75000) { onWait && onWait(Math.round((Date.now() - t0) / 1000)); setTimeout(attempt, 2500); } else fail('timeout'); }
          else if (was) { this.status = 'off'; this.room = null; this.emit('disconnect', {}); }
        };
        ws.onerror = () => {};
      };
      attempt();
    });
    return this._p;
  }
  startPing() { this.stopPing(); this._pingT = setInterval(() => this.send({ t: 'ping', k: performance.now() }), 3000); }
  stopPing() { if (this._pingT) clearInterval(this._pingT); this._pingT = null; }
  send(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  close() { this.stopPing(); if (this.ws) { try { this.ws.close(); } catch (e) {} } this.ws = null; this.id = 0; this.room = null; this.status = 'off'; }
}
