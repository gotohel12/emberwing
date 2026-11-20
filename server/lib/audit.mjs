// ARVEX audit log: append-only JSON lines, each entry carries the hash of the previous one (tamper-evident chain).
// There is deliberately no update or delete API. verify() re-walks the chain and reports the first broken link.
import fs from 'fs';
import path from 'path';
import { sha256, redact } from './core.mjs';

const GENESIS = '0'.repeat(64);
export class AuditLog {
  constructor(dir) {
    this.file = path.join(dir, 'audit.log'); this.entries = []; this.last = GENESIS; this.seq = 0;
    try { for (const line of fs.readFileSync(this.file, 'utf8').split('\n')) if (line) { const e = JSON.parse(line); this.entries.push(e); this.last = e.hash; this.seq = e.seq; } } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  static digest(e) { return sha256(JSON.stringify([e.seq, e.ts, e.actor, e.role, e.action, e.target, e.result, e.reason, e.ip, e.sid, e.meta, e.prev])); }
  /** record one sensitive action. Never pass secrets; meta is redacted defensively anyway. */
  write({ actor, role, action, target = '', result = 'ok', reason = '', ip = '', sid = '', meta }) {
    const e = { seq: ++this.seq, ts: new Date().toISOString(), actor, role, action, target: String(target), result, reason: String(reason || ''), ip, sid, meta: meta ? redact(meta) : undefined, prev: this.last };
    e.hash = AuditLog.digest(e); this.last = e.hash; this.entries.push(e);
    fs.appendFileSync(this.file, JSON.stringify(e) + '\n'); return e;
  }
  verify() {
    let prev = GENESIS;
    for (const e of this.entries) { if (e.prev !== prev || AuditLog.digest(e) !== e.hash) return { ok: false, brokenAt: e.seq, entries: this.entries.length }; prev = e.hash; }
    return { ok: true, entries: this.entries.length, head: prev };
  }
  query({ actor, action, target, result, from, to, q } = {}) {
    const ql = q && q.toLowerCase();
    return this.entries.filter(e => (!actor || e.actor === actor) && (!action || e.action.startsWith(action)) && (!target || e.target === target) && (!result || e.result === result)
      && (!from || e.ts >= from) && (!to || e.ts <= to) && (!ql || `${e.actor} ${e.action} ${e.target} ${e.reason}`.toLowerCase().includes(ql))).reverse();
  }
}
