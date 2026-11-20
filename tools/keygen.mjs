// ARVEX — generate a new Ed25519 key pair for signing update manifests.
//   node tools/keygen.mjs <file-for-private-key>
// The public key is written to launcher/signing.pub (embedded into the launcher at build time).
// The private key goes to the file you name. Keep it OUT of the repository and set it on the server as ARVEX_SIGN_KEY.
// Rotating the key means shipping a new launcher: launchers only trust manifests signed by the key they were built with.
import crypto from 'crypto';
import fs from 'fs';
const out = process.argv[2];
if (!out) { console.error('usage: node tools/keygen.mjs <private-key-file>'); process.exit(1); }
if (fs.existsSync(out)) { console.error('refusing to overwrite ' + out); process.exit(1); }
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const pub = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
fs.writeFileSync('launcher/signing.pub', pub.toString('base64') + '\n');
fs.writeFileSync(out, privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64') + '\n', { mode: 0o600 });
console.log('public key  → launcher/signing.pub  (key id ' + crypto.createHash('sha256').update(pub).digest('hex').slice(0, 16) + ')');
console.log('private key → ' + out + '  (set its content as the ARVEX_SIGN_KEY environment variable on the server)');
