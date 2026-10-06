// Google OAuth for Drive backup servers.
//
// One Google Cloud OAuth client for the whole app (GOOGLE_CLIENT_ID /
// GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI); each Drive BackupServer stores
// its own encrypted refresh token from the "Connect Google Drive" consent.
//
// Scope is drive.file (the app only sees files/folders it created) plus
// openid/email (to show which Gmail is connected). Both are non-sensitive, so
// the consent screen can be published to "In production" without a Google
// security review — which also stops refresh tokens expiring after 7 days.
//
// The OAuth callback can't use the normal Bearer-token auth (it's a browser
// redirect from Google), so the `state` param is a short-lived JWT naming the
// server being connected and the user who started the flow.

const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');

const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const SCOPES = [DRIVE_FILE_SCOPE, 'openid', 'email'];
const STATE_PURPOSE = 'gdrive-connect';
const STATE_TTL = '10m';

const isConfigured = () =>
  !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI);

const makeClient = () => {
  if (!isConfigured()) {
    const err = new Error('Google Drive is not configured (set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI)');
    err.status = 503;
    throw err;
  }
  return new OAuth2Client({
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI,
  });
};

const signState = ({ serverId, userId }) =>
  jwt.sign({ p: STATE_PURPOSE, sid: serverId, uid: userId || null }, process.env.JWT_SECRET, { expiresIn: STATE_TTL });

// Returns { serverId, userId } or throws on a forged / expired / foreign token.
const verifyState = (state) => {
  const decoded = jwt.verify(String(state || ''), process.env.JWT_SECRET);
  if (!decoded || decoded.p !== STATE_PURPOSE || !decoded.sid) {
    throw new Error('invalid state');
  }
  return { serverId: decoded.sid, userId: decoded.uid || null };
};

// prompt=consent forces Google to issue a refresh token every time, not only
// on the very first consent for this client.
const buildAuthUrl = (state) =>
  makeClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    state,
  });

// Trade the callback `code` for tokens. Returns { refreshToken, email }.
// Throws with `code` set so the callback can redirect with a short reason.
const exchangeCode = async (code) => {
  const client = makeClient();
  const { tokens } = await client.getToken(String(code || ''));
  // Google's granular consent lets the user untick the Drive box.
  const granted = String(tokens.scope || '').split(/\s+/);
  if (!granted.includes(DRIVE_FILE_SCOPE)) {
    const err = new Error('Drive permission was not granted');
    err.code = 'scope';
    throw err;
  }
  if (!tokens.refresh_token) {
    const err = new Error('Google did not return a refresh token');
    err.code = 'no_refresh';
    throw err;
  }
  let email = null;
  if (tokens.id_token) {
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID });
    email = ticket.getPayload()?.email || null;
  }
  return { refreshToken: tokens.refresh_token, email };
};

// Best-effort revoke at Google (Disconnect). Never throws.
const revoke = async (refreshToken) => {
  if (!refreshToken) return;
  try { await makeClient().revokeToken(refreshToken); } catch { /* already revoked / offline */ }
};

module.exports = {
  SCOPES,
  DRIVE_FILE_SCOPE,
  isConfigured,
  makeClient,
  signState,
  verifyState,
  buildAuthUrl,
  exchangeCode,
  revoke,
};
