// AES-256-GCM encryption for backup-server credentials.
//
// The master key comes from BACKUP_ENCRYPTION_KEY (64 hex chars = 32 bytes).
// Ciphertext is stored in the DB as "ivB64:tagB64:ctB64". Plaintext secrets
// are never returned to the client — controllers expose only hasX booleans.
//
// IMPORTANT: losing or changing this key makes every stored credential
// undecryptable, which makes every offloaded file unreachable. Back it up,
// and rotate via decrypt-old → re-encrypt-new (see docs).

const crypto = require('crypto');
 
const RAW_KEY = process.env.BACKUP_ENCRYPTION_KEY || '';

// Validate eagerly but lazily-fatal: we only hard-require the key when an
// encrypt/decrypt actually happens, so the rest of the app still boots in
// environments where backup isn't configured. We do warn loudly on load.
let KEY = null;
let keyError = null;
try {
  if (!RAW_KEY) {
    keyError = 'BACKUP_ENCRYPTION_KEY is not set';
  } else {
    const buf = Buffer.from(RAW_KEY, 'hex');
    if (buf.length !== 32) {
      keyError = `BACKUP_ENCRYPTION_KEY must be 64 hex chars (32 bytes); got ${buf.length} bytes`;
    } else {
      KEY = buf;
    }
  }
} catch (err) {
  keyError = `BACKUP_ENCRYPTION_KEY is not valid hex: ${err.message}`;
}

if (keyError) {
  // Loud, but non-fatal at module load so unrelated features keep working.
  // Any encrypt/decrypt call throws with this message.
  console.warn(`[backup] ${keyError} — backup credential encryption is unavailable until this is fixed.`);
}

const requireKey = () => {
  if (!KEY) {
    const err = new Error(keyError || 'BACKUP_ENCRYPTION_KEY unavailable');
    err.status = 500;
    throw err;
  }
  return KEY;
};

// Returns "ivB64:tagB64:ctB64" or null for empty/nullish input.
const encrypt = (plain) => {
  if (plain === undefined || plain === null || plain === '') return null;
  const key = requireKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ct].map((b) => b.toString('base64')).join(':');
};

// Parses the 3-part blob, verifies the auth tag, returns utf8 plaintext.
const decrypt = (blob) => {
  if (!blob) return null;
  const key = requireKey();
  const parts = String(blob).split(':');
  if (parts.length !== 3) {
    throw new Error('malformed ciphertext blob');
  }
  const [iv, tag, ct] = parts.map((p) => Buffer.from(p, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
};

const isAvailable = () => !!KEY;

module.exports = { encrypt, decrypt, isAvailable, keyError: () => keyError };
