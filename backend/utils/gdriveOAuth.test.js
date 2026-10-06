// Standalone test for the Google Drive OAuth helpers (state token + consent URL).
// Run: node backend/utils/gdriveOAuth.test.js
process.env.JWT_SECRET = 'test-secret';
process.env.GOOGLE_CLIENT_ID = 'cid.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'csecret';
process.env.GOOGLE_REDIRECT_URI = 'https://erp.example.com/api/backup/gdrive/callback';
const jwt = require('jsonwebtoken');
const o = require('./gdriveOAuth');

let failures = 0;
const check = (name, cond) => {
  if (!cond) failures++;
  console.log(`${cond ? '✔' : '✘ FAIL'}  ${name}`);
};
const throws = (fn) => { try { fn(); return false; } catch { return true; } };

// ── state round-trip ─────────────────────────────────────────────────────────
const state = o.signState({ serverId: 'srv1', userId: 'u1' });
const back = o.verifyState(state);
check('state round-trips serverId + userId', back.serverId === 'srv1' && back.userId === 'u1');
check('tampered state is rejected', throws(() => o.verifyState(state.slice(0, -2) + 'xx')));
check('state signed with another secret is rejected',
  throws(() => o.verifyState(jwt.sign({ p: 'gdrive-connect', sid: 'srv1' }, 'other-secret'))));
check('expired state is rejected',
  throws(() => o.verifyState(jwt.sign({ p: 'gdrive-connect', sid: 'srv1', exp: Math.floor(Date.now() / 1000) - 10 }, 'test-secret'))));
check('a normal login JWT is not accepted as state',
  throws(() => o.verifyState(jwt.sign({ id: 'u1' }, 'test-secret'))));
check('empty state is rejected', throws(() => o.verifyState(undefined)));

// ── consent URL ──────────────────────────────────────────────────────────────
const url = new URL(o.buildAuthUrl(state));
const scope = url.searchParams.get('scope') || '';
check('consent URL asks for offline access', url.searchParams.get('access_type') === 'offline');
check('consent URL forces the consent prompt', url.searchParams.get('prompt') === 'consent');
check('consent URL requests only drive.file + openid + email',
  scope.split(' ').sort().join(' ') === ['email', 'openid', 'https://www.googleapis.com/auth/drive.file'].sort().join(' '));
check('consent URL carries the state', url.searchParams.get('state') === state);
check('consent URL uses the configured redirect', url.searchParams.get('redirect_uri') === process.env.GOOGLE_REDIRECT_URI);

// ── configuration check ──────────────────────────────────────────────────────
check('isConfigured true with all three env vars', o.isConfigured());
delete process.env.GOOGLE_REDIRECT_URI;
check('isConfigured false when one is missing', !o.isConfigured());
check('makeClient throws 503 when not configured', (() => {
  try { o.makeClient(); return false; } catch (err) { return err.status === 503; }
})());

console.log(`\n${failures === 0 ? 'ALL PASSED' : failures + ' FAILURE(S)'}`);
process.exit(failures === 0 ? 0 : 1);
