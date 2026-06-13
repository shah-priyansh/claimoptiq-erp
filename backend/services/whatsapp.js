const path = require('path');
const fs = require('fs');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
} = require('baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');

const AUTH_DIR = path.join(__dirname, '..', '.wa-auth');

let sock = null;
let connecting = false;
let latestQr = null;
let phoneNumber = null;
let isConnected = false;
let justRestartedAfterPair = false; // true between a 515 and the next connection.open

const extractPhoneNumber = (jid) => {
  if (!jid) return null;
  const m = String(jid).match(/^(\d+)/);
  return m ? m[1] : null;
};

const wipeAuthDir = () => {
  if (fs.existsSync(AUTH_DIR)) {
    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
  }
};

async function connect() {
  if (isConnected || connecting) return;
  connecting = true;
  console.log('[whatsapp] connect: starting');

  try {
    if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    console.log('[whatsapp] connect: auth state loaded');

    // Fetch latest WA Web protocol version with a 5s timeout — fall back to Baileys' built-in default.
    let version;
    try {
      const result = await Promise.race([
        fetchLatestBaileysVersion(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('version-fetch-timeout')), 5000)),
      ]);
      version = result.version;
      console.log('[whatsapp] connect: using WA version', version);
    } catch (err) {
      console.log('[whatsapp] connect: version fetch failed, using Baileys default:', err.message);
    }

    sock = makeWASocket({
      ...(version ? { version } : {}),
      auth: state,
      logger: pino({ level: 'silent' }),
      browser: Browsers.macOS('Chrome'),
      markOnlineOnConnect: true,
    });
    console.log('[whatsapp] connect: socket created, awaiting events');

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;
      console.log('[whatsapp] connection.update:', { connection, hasQr: !!qr, err: lastDisconnect?.error?.message });

      if (qr) {
        latestQr = qr;
      }

      if (connection === 'open') {
        isConnected = true;
        latestQr = null;
        justRestartedAfterPair = false;
        phoneNumber = extractPhoneNumber(sock?.user?.id);
        console.log('[whatsapp] connected as', phoneNumber);
      }

      if (connection === 'close') {
        isConnected = false;
        const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;
        const restartRequired = code === DisconnectReason.restartRequired;
        console.log('[whatsapp] connection closed, code:', code, 'loggedOut:', loggedOut, 'restartRequired:', restartRequired);

        // A 401 right after a 515 is almost always a race with creds-flush, not a real logout.
        // Retry once instead of wiping creds.
        if (loggedOut && justRestartedAfterPair) {
          console.log('[whatsapp] 401 right after pairing — likely a creds race, retrying in 2s');
          justRestartedAfterPair = false;
          sock = null;
          connecting = false;
          setTimeout(() => {
            connect().catch((err) => console.error('[whatsapp] post-pair retry failed', err));
          }, 2000);
        } else if (loggedOut) {
          console.log('[whatsapp] logged out remotely; clearing auth dir');
          sock = null;
          phoneNumber = null;
          latestQr = null;
          wipeAuthDir();
        } else {
          // For 515 (restart required) wait 1.5s so saveCreds can flush before re-reading auth.
          const delayMs = restartRequired ? 1500 : 1000;
          if (restartRequired) justRestartedAfterPair = true;
          console.log(`[whatsapp] reconnecting in ${delayMs}ms...`);
          sock = null;
          connecting = false;
          setTimeout(() => {
            connect().catch((err) => console.error('[whatsapp] reconnect failed', err));
          }, delayMs);
        }
      }
    });
  } catch (err) {
    console.error('[whatsapp] connect threw:', err);
    sock = null;
    throw err;
  } finally {
    connecting = false;
  }
}

async function disconnect() {
  const currentSock = sock;
  // Reset state first so /status flips immediately even if cleanup takes a moment.
  sock = null;
  isConnected = false;
  latestQr = null;
  phoneNumber = null;

  try {
    if (currentSock) {
      // Race logout against a 3s timeout — a half-paired socket can hang here.
      await Promise.race([
        currentSock.logout().catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);
      try { currentSock.end(undefined); } catch {}
    }
  } finally {
    wipeAuthDir();
  }
}

function getStatus() {
  return {
    connected: isConnected,
    qr: latestQr,
    phoneNumber,
  };
}

function toJid(number) {
  const clean = String(number).replace(/\D/g, '');
  if (!clean) throw new Error('Invalid number');
  return `${clean}@s.whatsapp.net`;
}

async function isOnWhatsApp(number) {
  if (!sock || !isConnected) throw new Error('Not connected');
  const results = await sock.onWhatsApp(toJid(number));
  return results?.[0]?.exists === true;
}

async function sendText(number, text) {
  if (!sock || !isConnected) throw new Error('Not connected');
  return sock.sendMessage(toJid(number), { text });
}

const MIME_BY_EXT = {
  '.pdf':  'application/pdf',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.doc':  'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls':  'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

async function sendDocument(number, absoluteFilePath, fileName, caption = '') {
  if (!sock || !isConnected) throw new Error('Not connected');
  if (!fs.existsSync(absoluteFilePath)) throw new Error('File not found');
  const ext = path.extname(absoluteFilePath).toLowerCase();
  const mimetype = MIME_BY_EXT[ext] || 'application/octet-stream';
  return sock.sendMessage(toJid(number), {
    document: fs.readFileSync(absoluteFilePath),
    mimetype,
    fileName: fileName || path.basename(absoluteFilePath),
    caption,
  });
}

function hasStoredCreds() {
  try {
    return fs.existsSync(path.join(AUTH_DIR, 'creds.json'));
  } catch {
    return false;
  }
}

module.exports = {
  connect,
  disconnect,
  getStatus,
  sendText,
  sendDocument,
  isOnWhatsApp,
  hasStoredCreds,
  AUTH_DIR,
};
