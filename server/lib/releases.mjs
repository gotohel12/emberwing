// ARVEX release registry: builds, channels, signed update manifests, file-level delta patches, publish / rollback.
// A release is a directory of game files plus metadata. The build that ships inside the deployed repository
// (public/) is registered automatically as the "bundled" release; further releases can be uploaded from the admin panel.
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import crypto from 'crypto';
import { sha256, HttpError, bad, isVersion, cmpVersion, cleanText } from './core.mjs';

export const CHANNELS = ['stable', 'beta', 'development'];
export const STATUSES = ['draft', 'testing', 'qa', 'approved', 'published', 'archived', 'failed'];
const FLOW = { draft: ['testing', 'failed'], testing: ['qa', 'draft', 'failed'], qa: ['approved', 'testing', 'failed'], approved: ['published', 'qa', 'failed'], published: ['archived'], failed: ['draft'], archived: [] };
const EDITABLE = new Set(['draft', 'testing', 'failed']);
const SKIP_TOP = new Set(['download']);                                   // the launcher binary is not part of the game install
const COMPRESSIBLE = new Set(['.js', '.css', '.html', '.json', '.svg', '.bin', '.txt', '.webmanifest']);
const MAX_FILE = 256 * 1024 * 1024, MAX_FILES = 4000, MONITOR_MS = 72 * 3600e3;
const PRODUCT = 'ARVEX SURVIVAL', ENTRY = 'index.html';
const SAFE_PATH = /^[A-Za-z0-9._@-]+(\/[A-Za-z0-9._@-]+)*$/;

export function safeRelPath(p) {
  p = String(p || '').replace(/\\/g, '/');
  if (p.length > 200 || !SAFE_PATH.test(p) || p.split('/').some(s => s === '..' || s === '.' || s.startsWith('.arvex'))) throw bad('bad_path', 'File path is not allowed');
  return p;
}
function walk(dir, skipTop) {
  const out = [];
  const rec = (d, rel) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (!rel && skipTop && skipTop.has(e.name)) continue; const r = rel ? rel + '/' + e.name : e.name, p = path.join(d, e.name); if (e.isDirectory()) rec(p, r); else if (e.isFile()) out.push([r, p]); } };
  rec(dir, ''); out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)); return out;
}
/** digest that both the server (Node) and the launcher (Go) can recompute byte-for-byte */
export const filesDigest = files => sha256(files.map(f => `${f.path}\t${f.size}\t${f.sha256}\n`).join(''));
export const signedPayload = m => ['ARVEX-MANIFEST-1', m.product, m.version, m.buildId, m.channel, m.minVersion, m.mandatory ? 1 : 0, m.releaseDate, m.sha256].join('\n');

export class Releases {
  constructor({ dataDir, pubDir, build, col, log, notesFor, signKey }) {
    Object.assign(this, { pubDir, build, col, log, notesFor });
    this.dir = path.join(dataDir, 'releases'); this.gzDir = path.join(dataDir, 'cache', 'gz');
    fs.mkdirSync(this.dir, { recursive: true }); fs.mkdirSync(this.gzDir, { recursive: true });
    const d = this.col.data; d.releases = d.releases || {}; d.active = d.active || {}; d.history = d.history || {};
    this.manifestCache = new Map(); this.cacheEpoch = 0;
    this.loadKey(signKey); this.registerBundled();
  }
  // ---------------------------------------------------------------- signing
  loadKey(raw) {
    this.key = null; this.keyId = null; this.pubKey = null;
    if (!raw) return;
    try {
      this.key = raw.includes('BEGIN') ? crypto.createPrivateKey(raw) : crypto.createPrivateKey({ key: Buffer.from(raw, 'base64'), format: 'der', type: 'pkcs8' });
      if (this.key.asymmetricKeyType !== 'ed25519') throw new Error('not an Ed25519 key');
      const pub = crypto.createPublicKey(this.key).export({ format: 'der', type: 'spki' }).subarray(-32);
      this.pubKey = pub.toString('base64'); this.keyId = sha256(pub).slice(0, 16);
    } catch (e) { this.key = null; this.log.error('manifest signing key rejected: ' + e.message); }
  }
  get signing() { return { enabled: !!this.key, keyId: this.keyId, publicKey: this.pubKey }; }
  // ---------------------------------------------------------------- registry
  registerBundled() {
    const d = this.col.data, b = this.build;
    let r = d.releases[b.id];
    if (!r) {
      r = d.releases[b.id] = { id: b.id, version: b.version, channel: 'stable', status: 'approved', source: 'bundled', platform: 'windows+web', createdAt: Date.parse(b.date) || Date.now(), createdBy: 'deploy', minVersion: null, mandatory: false, summary: 'Build shipped with this deployment' };
    }
    r.source = 'bundled'; this.scan(r);
    // deploying a newer build is the existing release path: it becomes the active stable release unless that is turned off
    const active = d.releases[d.active.stable], auto = process.env.AUTO_PUBLISH_BUNDLED !== '0';
    if (r.status !== 'published' && r.status !== 'archived' && auto && (!active || cmpVersion(r.version, active.version) > 0 || (cmpVersion(r.version, active.version) === 0 && active.source === 'bundled'))) {
      if (r.status !== 'approved') r.status = 'approved';
      this.activate(r, 'deploy');
    } else if (!d.active.stable) this.activate(r, 'deploy');
    // bundled releases of earlier deployments no longer have files on disk
    for (const o of Object.values(d.releases)) if (o.source === 'bundled' && o.id !== b.id) { o.filesGone = true; if (o.status === 'published') o.status = 'archived'; for (const ch of CHANNELS) if (d.active[ch] === o.id) delete d.active[ch]; }
    for (const ch of CHANNELS) d.history[ch] = (d.history[ch] || []).filter(id => d.releases[id] && !d.releases[id].filesGone);
    if (!d.active.stable) this.activate(r, 'deploy');
    this.col.save();
  }
  rootOf(r) { return r.source === 'bundled' ? this.pubDir : path.join(this.dir, r.id, 'files'); }
  get(id) { const r = this.col.data.releases[id]; if (!r) throw new HttpError(404, 'no_release', 'Release not found'); return r; }
  list() { return Object.values(this.col.data.releases).sort((a, b) => b.createdAt - a.createdAt).map(r => this.view(r)); }
  view(r) {
    const d = this.col.data, activeOn = CHANNELS.filter(ch => d.active[ch] === r.id);
    return { id: r.id, version: r.version, channel: r.channel, status: r.status, source: r.source, platform: r.platform, size: r.size || 0, files: r.fileCount || 0, hash: r.sha256 || null, createdAt: r.createdAt, createdBy: r.createdBy, publishedAt: r.publishedAt || null,
      verifiedAt: r.verifiedAt || null, minVersion: r.minVersion, mandatory: !!r.mandatory, summary: r.summary || '', activeOn, monitoring: !!(r.publishedAt && activeOn.length && Date.now() - r.publishedAt < MONITOR_MS), filesGone: !!r.filesGone, next: FLOW[r.status] || [] };
  }
  active(channel) { const d = this.col.data, id = d.active[channel] || (channel !== 'stable' ? d.active.stable : null); return id ? d.releases[id] : null; }
  createDraft({ version, channel, summary, minVersion, mandatory, base }, actor) {
    if (!isVersion(version)) throw bad('bad_version', 'Version must look like 10.0.0');
    if (!CHANNELS.includes(channel)) throw bad('bad_channel', 'Unknown channel');
    if (minVersion && (!isVersion(minVersion) || cmpVersion(minVersion, version) > 0)) throw bad('bad_min_version', 'Minimum version must be a version no newer than the release');
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12), id = `${version}-${channel[0]}${stamp}`;
    if (this.col.data.releases[id]) throw new HttpError(409, 'exists', 'A release with this build id already exists');
    const r = { id, version, channel, status: 'draft', source: 'upload', platform: 'windows+web', createdAt: Date.now(), createdBy: actor, minVersion: minVersion || null, mandatory: !!mandatory, summary: cleanText(summary, 400) };
    const root = path.join(this.dir, id, 'files'); fs.mkdirSync(root, { recursive: true });
    if (base) { const src = this.get(base); if (src.filesGone) throw bad('base_gone', 'The base release has no files on this server'); for (const [rel, abs] of walk(this.rootOf(src), src.source === 'bundled' ? SKIP_TOP : null)) { const dst = path.join(root, rel); fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(abs, dst); } r.base = src.id; }
    this.col.data.releases[id] = r; this.scan(r); this.col.save(); return r;
  }
  assertEditable(r) { if (r.source === 'bundled') throw new HttpError(409, 'bundled', 'The bundled build is read-only. Create a draft based on it.'); if (!EDITABLE.has(r.status)) throw new HttpError(409, 'locked', `Files are locked while the release is ${r.status}`); }
  putFile(id, rel, buf) {
    const r = this.get(id); this.assertEditable(r); rel = safeRelPath(rel);
    if (buf.length > MAX_FILE) throw new HttpError(413, 'too_large', 'File is larger than the upload limit');
    if ((r.fileCount || 0) >= MAX_FILES) throw bad('too_many_files', 'Release has too many files');
    const dst = path.join(this.rootOf(r), rel); fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst + '.upload', buf); fs.renameSync(dst + '.upload', dst);
    r.verifiedAt = null; this.scan(r); this.col.save(); return { path: rel, size: buf.length, sha256: sha256(buf) };
  }
  deleteFile(id, rel) { const r = this.get(id); this.assertEditable(r); rel = safeRelPath(rel); const p = path.join(this.rootOf(r), rel); if (!fs.existsSync(p)) throw new HttpError(404, 'no_file', 'File not found'); fs.unlinkSync(p); r.verifiedAt = null; this.scan(r); this.col.save(); }
  /** hash every file of the release and store the file table */
  scan(r) {
    const root = this.rootOf(r), files = [];
    if (fs.existsSync(root)) for (const [rel, abs] of walk(root, r.source === 'bundled' ? SKIP_TOP : null)) { const b = fs.readFileSync(abs); files.push({ path: rel, size: b.length, sha256: sha256(b), mtime: Math.round(fs.statSync(abs).mtimeMs) }); }
    r.fileTable = files; r.fileCount = files.length; r.size = files.reduce((a, f) => a + f.size, 0); r.sha256 = filesDigest(files);
    this.invalidate(); return files;
  }
  /** validation gate: a release cannot move past "testing" or be published without passing this */
  verify(id) {
    const r = this.get(id); if (r.filesGone) throw bad('files_gone', 'This release has no files on this server');
    const files = this.scan(r), problems = [];
    if (!files.length) problems.push('The release has no files');
    if (!files.some(f => f.path === ENTRY)) problems.push(`Missing entry file ${ENTRY}`);
    if (!files.some(f => f.path === 'game.js')) problems.push('Missing game.js');
    for (const f of files) { if (!f.size) problems.push(`Empty file: ${f.path}`); try { safeRelPath(f.path); } catch (e) { problems.push(`Illegal path: ${f.path}`); } }
    const bj = files.find(f => f.path === 'build.json');
    if (bj) { try { const b = JSON.parse(fs.readFileSync(path.join(this.rootOf(r), 'build.json'), 'utf8')); if (b.version !== r.version) problems.push(`build.json says ${b.version} but the release is ${r.version}`); } catch (e) { problems.push('build.json is not valid JSON'); } }
    else problems.push('Missing build.json (run the build before uploading)');
    r.problems = problems; r.verifiedAt = problems.length ? null : Date.now(); this.col.save();
    return { ok: !problems.length, problems, files: files.length, size: r.size, sha256: r.sha256 };
  }
  transition(id, to) {
    const r = this.get(id);
    if (!STATUSES.includes(to) || !(FLOW[r.status] || []).includes(to)) throw new HttpError(409, 'bad_transition', `A ${r.status} release cannot move to ${to}`);
    if (to === 'published') throw bad('use_publish', 'Use the publish action');
    if (['qa', 'approved'].includes(to) && !r.verifiedAt) throw new HttpError(409, 'not_verified', 'Verify the files before moving the release forward');
    if (to === 'archived' && CHANNELS.some(ch => this.col.data.active[ch] === r.id)) throw new HttpError(409, 'active', 'Roll back or publish another release before archiving the active one');
    r.status = to; this.col.save(); this.invalidate(); return r;
  }
  activate(r, actor) {
    const d = this.col.data, ch = r.channel, prev = d.active[ch];
    if (prev && prev !== r.id) { d.history[ch] = (d.history[ch] || []).filter(x => x !== r.id); d.history[ch].push(prev); if (d.history[ch].length > 10) d.history[ch].shift(); }
    d.active[ch] = r.id; r.status = 'published'; r.publishedAt = Date.now(); r.publishedBy = actor; this.invalidate();
  }
  publish(id, { mandatory, minVersion } = {}, actor) {
    const r = this.get(id);
    if (r.status !== 'approved') throw new HttpError(409, 'not_approved', 'Only an approved release can be published');
    if (r.filesGone) throw bad('files_gone', 'This release has no files on this server');
    const v = this.verify(id); if (!v.ok) throw new HttpError(409, 'not_verified', 'Verification failed: ' + v.problems[0]);
    if (minVersion !== undefined) { if (minVersion && (!isVersion(minVersion) || cmpVersion(minVersion, r.version) > 0)) throw bad('bad_min_version', 'Minimum version must be a version no newer than the release'); r.minVersion = minVersion || null; }
    if (mandatory !== undefined) r.mandatory = !!mandatory;
    this.activate(r, actor); this.col.save(); return r;
  }
  /** make the previously published release of a channel active again */
  rollback(channel, actor) {
    const d = this.col.data; if (!CHANNELS.includes(channel)) throw bad('bad_channel', 'Unknown channel');
    const hist = d.history[channel] || []; let prevId;
    while (hist.length) { const id = hist.pop(); const r = d.releases[id]; if (r && !r.filesGone) { prevId = id; break; } }
    if (!prevId) throw new HttpError(409, 'no_previous', 'There is no earlier release on this channel to roll back to');
    const cur = d.releases[d.active[channel]], prev = d.releases[prevId];
    if (cur) { cur.status = 'archived'; cur.rolledBackAt = Date.now(); }
    d.active[channel] = prevId; prev.status = 'published'; prev.publishedAt = Date.now(); prev.publishedBy = actor; prev.restored = true;
    this.col.save(); this.invalidate(); return { from: cur ? cur.id : null, to: prev.id };
  }
  remove(id) { const r = this.get(id); if (r.source === 'bundled') throw new HttpError(409, 'bundled', 'The bundled build cannot be deleted'); if (!['draft', 'failed', 'archived'].includes(r.status)) throw new HttpError(409, 'locked', `A ${r.status} release cannot be deleted`); fs.rmSync(path.join(this.dir, r.id), { recursive: true, force: true }); delete this.col.data.releases[id]; for (const ch of CHANNELS) this.col.data.history[ch] = (this.col.data.history[ch] || []).filter(x => x !== id); this.col.save(); }
  // ---------------------------------------------------------------- manifest + files
  invalidate() { this.manifestCache.clear(); this.cacheEpoch++; }
  gzBlob(r, f) {
    if (!COMPRESSIBLE.has(path.extname(f.path).toLowerCase()) || f.size < 2048) return null;
    const p = path.join(this.gzDir, f.sha256 + '.gz');
    try { const st = fs.statSync(p); return st.size < f.size * 0.9 ? { path: p, size: st.size } : null; } catch (e) {}
    const gz = zlib.gzipSync(fs.readFileSync(path.join(this.rootOf(r), f.path)), { level: 9 });
    fs.writeFileSync(p + '.tmp', gz); fs.renameSync(p + '.tmp', p);
    return gz.length < f.size * 0.9 ? { path: p, size: gz.length } : null;
  }
  manifestFor(channel, config) {
    if (!CHANNELS.includes(channel)) channel = 'stable';
    const key = channel + ':' + (config.minVersion || '') + ':' + (config.forceUpdate ? 1 : 0);
    if (this.manifestCache.has(key)) return this.manifestCache.get(key);
    const r = this.active(channel); if (!r) return null;
    if (!r.fileTable) this.scan(r);
    const base = `/launcher/files/${encodeURIComponent(r.id)}/`;
    let total = 0, compressedTotal = 0;
    const files = r.fileTable.map(f => { const gz = this.gzBlob(r, f), o = { path: f.path, size: f.size, sha256: f.sha256, url: base + f.path, required: true }; total += f.size; compressedTotal += gz ? gz.size : f.size; if (gz) { o.compressedSize = gz.size; o.gzUrl = `/launcher/gz/${f.sha256}`; } return o; });
    // effective floor = the stricter of the release's own floor and the remotely managed one
    const floors = [r.minVersion, config.minVersion].filter(isVersion).sort(cmpVersion), minVersion = floors.length ? floors[floors.length - 1] : '0.0.0';
    const m = { product: PRODUCT, version: r.version, buildId: r.id, channel: r.channel, releaseDate: new Date(r.publishedAt || r.createdAt).toISOString(), minVersion, mandatory: !!(r.mandatory || config.forceUpdate), required: !!(r.mandatory || config.forceUpdate),
      total, compressedTotal, patchType: 'file-delta', entry: ENTRY, dependencies: [{ id: 'chromium', name: 'Microsoft Edge or Google Chrome', required: true }], files, sha256: filesDigest(r.fileTable), releaseNotes: this.notesFor ? this.notesFor(r.version) : null, generated: new Date().toISOString() };
    if (this.key) m.signature = { alg: 'ed25519', keyId: this.keyId, sig: crypto.sign(null, Buffer.from(signedPayload(m)), this.key).toString('base64') };
    this.manifestCache.set(key, m); return m;
  }
  filePath(buildId, rel) {
    const r = this.col.data.releases[buildId]; if (!r || r.filesGone) return null;
    let safe; try { safe = safeRelPath(rel); } catch (e) { return null; }
    if (!(r.fileTable || []).some(f => f.path === safe)) return null;
    return path.join(this.rootOf(r), safe);
  }
  /** precompressed copy of a file of the bundled build, for browsers that accept gzip */
  /** cache info for a file of the bundled build as served to browsers: content hash (ETag) and, when it helps, a gzip copy.
   *  Returns null when the file on disk is not the one that was hashed (edited after start-up), so stale bytes are never served. */
  webFile(rel) {
    const r = this.col.data.releases[this.build.id]; if (!r || !r.fileTable) return null; const f = r.fileTable.find(x => x.path === rel); if (!f) return null;
    try { const st = fs.statSync(path.join(this.pubDir, rel)); if (st.size !== f.size || Math.round(st.mtimeMs) !== f.mtime) return null; return { etag: '"' + f.sha256.slice(0, 32) + '"', gz: this.gzBlob(r, f) }; } catch (e) { return null; }
  }
  gzPath(hash) { return /^[a-f0-9]{64}$/.test(hash) ? path.join(this.gzDir, hash + '.gz') : null; }
  /** file-level delta between two releases: what a client on `from` must download to reach `to` */
  patch(fromId, toId) {
    const a = this.get(fromId), b = this.get(toId); if (a.id === b.id) throw bad('same_release', 'Pick two different releases');
    if (cmpVersion(a.version, b.version) > 0) throw bad('wrong_base', `Base ${a.version} is newer than target ${b.version}`);
    const have = new Map((a.fileTable || []).map(f => [f.path, f.sha256])), want = new Set((b.fileTable || []).map(f => f.path));
    const changed = (b.fileTable || []).filter(f => have.get(f.path) !== f.sha256), removed = (a.fileTable || []).filter(f => !want.has(f.path)).map(f => f.path);
    const size = changed.reduce((s, f) => s + f.size, 0);
    return { base: { id: a.id, version: a.version }, target: { id: b.id, version: b.version }, patchType: 'file-delta', files: changed.map(f => ({ path: f.path, size: f.size, sha256: f.sha256, change: have.has(f.path) ? 'modified' : 'added' })), removed, size, fullSize: b.size || 0,
      hash: sha256(changed.map(f => f.path + f.sha256).join('|') + '|' + removed.join('|')), valid: !a.filesGone || true, installable: !b.filesGone };
  }
  usage() { let bytes = 0; for (const r of Object.values(this.col.data.releases)) if (r.source !== 'bundled') bytes += r.size || 0; return bytes; }
}
