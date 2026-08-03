// Standalone test for password-reset token generation + hashing.
// Run: node backend/utils/passwordReset.test.js
const { generateResetToken, hashResetToken, RESET_TOKEN_TTL_MS } = require('./passwordReset');

let failures = 0;
const check = (name, cond) => {
  if (!cond) failures++;
  console.log(`${cond ? '✔' : '✘ FAIL'}  ${name}`);
};

// A fresh token: raw is a 64-char hex (32 bytes), hash matches, expiry ~1h out.
const t = generateResetToken();
check('rawToken is 64 hex chars', /^[a-f0-9]{64}$/.test(t.rawToken));
check('tokenHash matches hashResetToken(rawToken)', t.tokenHash === hashResetToken(t.rawToken));
check('tokenHash is 64 hex chars (sha256)', /^[a-f0-9]{64}$/.test(t.tokenHash));
check('expiresAt is a Date in the future', t.expiresAt instanceof Date && t.expiresAt.getTime() > Date.now());

// Expiry window is ~1 hour (allow small clock slack for test runtime).
const ttl = t.expiresAt.getTime() - Date.now();
check('expiry ~= 1 hour', Math.abs(ttl - RESET_TOKEN_TTL_MS) < 5000);

// Hash is deterministic for the same input, different for different input.
check('hash is deterministic', hashResetToken('abc') === hashResetToken('abc'));
check('different raw tokens hash differently', hashResetToken('abc') !== hashResetToken('abd'));

// Two generated tokens are unique.
check('two tokens are distinct', generateResetToken().rawToken !== generateResetToken().rawToken);

// The stored hash must NOT equal the raw token (we never store the raw token).
check('hash differs from raw token', t.tokenHash !== t.rawToken);

console.log(failures ? `\n${failures} test(s) failed` : '\nAll tests passed');
process.exit(failures ? 1 : 0);
