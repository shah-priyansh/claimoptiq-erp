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

  try {
    if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }),
      browser: Browsers.macOS('ClaimOptiq'),
      syncFullHistory: false,
      markOnlineOnConnect: true,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        latestQr = qr;
      }

      if (connection === 'open') {
        isConnected = true;
        latestQr = null;
        phoneNumber = extractPhoneNumber(sock?.user?.id);
        console.log('[whatsapp] connected as', phoneNumber);
      }

      if (connection === 'close') {
        isConnected = false;
        const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;

        if (loggedOut) {
          console.log('[whatsapp] logged out remotely; clearing auth dir');
          sock = null;
          phoneNumber = null;
          latestQr = null;
          wipeAuthDir();
        } else {
          console.log('[whatsapp] connection closed, reconnecting...');
          sock = null;
          connecting = false;
          connect().catch((err) => console.error('[whatsapp] reconnect failed', err));
        }
      }
    });
  } finally {
    connecting = false;
  }
}

async function disconnect() {
  try {
    if (sock) {
      await sock.logout().catch(() => {});
    }
  } finally {
    sock = null;
    isConnected = false;
    latestQr = null;
    phoneNumber = null;
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
