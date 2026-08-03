const crypto = require('crypto');

// How long a password-reset link stays valid.
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

// SHA-256 of the raw token. We only ever persist this hash, so a DB leak can't
// be replayed to reset an account — the raw token lives only in the emailed link.
function hashResetToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken)).digest('hex');
}

// Mint a fresh reset token: `rawToken` goes in the email link, `tokenHash` +
// `expiresAt` get stored on the user row.
function generateResetToken() {
  const rawToken = crypto.randomBytes(32).toString('hex');
  return {
    rawToken,
    tokenHash: hashResetToken(rawToken),
    expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
  };
}

module.exports = { generateResetToken, hashResetToken, RESET_TOKEN_TTL_MS };
