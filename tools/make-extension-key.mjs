/**
 * Pin the extension's identity.
 *
 * Chrome derives an unpacked extension's id from its absolute folder path, so
 * the id — and therefore the `chrome.identity` OAuth redirect URL built from it
 * — changes if the folder is ever moved or renamed. NetSuite's integration
 * record stores exactly one redirect URI, so a changed id means a broken OAuth
 * flow with a confusing error.
 *
 * Embedding a public key in the manifest fixes the id for good: the same key
 * yields the same id on any machine, from any path, and after publishing to the
 * Web Store.
 *
 * Usage: `npm run key` (writes once; refuses to overwrite an existing key)
 */

import { createHash, generateKeyPairSync } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(ROOT, 'src', 'manifest.json');
const PRIVATE_KEY = join(ROOT, 'extension-private-key.pem');

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));

if (manifest.key) {
  console.log('manifest already has a key — refusing to overwrite.');
  console.log(`extension id: ${idFromPublicKey(Buffer.from(manifest.key, 'base64'))}`);
  console.log(`redirect URL: ${redirectUrl(idFromPublicKey(Buffer.from(manifest.key, 'base64')))}`);
  process.exit(0);
}

if (existsSync(PRIVATE_KEY)) {
  console.error(`${PRIVATE_KEY} exists but the manifest has no key — refusing to generate a second identity.`);
  process.exit(1);
}

// 2048-bit RSA is what Chrome's own packaging uses for extension identity.
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

const der = publicKey.export({ type: 'spki', format: 'der' });
const id = idFromPublicKey(der);

writeFileSync(PRIVATE_KEY, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });

// `key` goes near the top of the manifest, where Chrome's docs show it.
const rebuilt = { manifest_version: manifest.manifest_version, name: manifest.name, key: der.toString('base64'), ...manifest };
writeFileSync(MANIFEST, `${JSON.stringify(rebuilt, null, 2)}\n`);

console.log(`extension id: ${id}`);
console.log(`redirect URL: ${redirectUrl(id)}`);
console.log(`private key:  ${PRIVATE_KEY}  (git-ignored — back it up somewhere safe)`);

/**
 * Chrome's id derivation: SHA-256 the DER public key, take the first 16 bytes,
 * and map each hex digit 0-f onto a-p.
 *
 * @param {Buffer} der
 * @returns {string}
 */
function idFromPublicKey(der) {
  const hash = createHash('sha256').update(der).digest('hex').slice(0, 32);
  return [...hash].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

/**
 * What `chrome.identity.getRedirectURL()` will return for this id — the exact
 * string NetSuite's integration record needs.
 *
 * @param {string} id
 * @returns {string}
 */
function redirectUrl(id) {
  return `https://${id}.chromiumapp.org/`;
}
