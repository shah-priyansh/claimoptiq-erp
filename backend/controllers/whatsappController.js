const path = require('path');
const QRCode = require('qrcode');
const whatsapp = require('../services/whatsapp');

const UPLOADS_DIR = path.resolve(__dirname, '..', 'uploads');

const resolveSafeUploadPath = (relativeOrName) => {
  if (typeof relativeOrName !== 'string' || !relativeOrName.length) return null;
  const resolved = path.resolve(UPLOADS_DIR, relativeOrName);
  if (!resolved.startsWith(UPLOADS_DIR + path.sep) && resolved !== UPLOADS_DIR) {
    return null;
  }
  return resolved;
};

exports.getStatus = async (req, res) => {
  try {
    const { connected, qr, phoneNumber } = whatsapp.getStatus();
    const qrDataUrl = qr ? await QRCode.toDataURL(qr) : null;
    res.json({ connected, qr: qrDataUrl, phoneNumber });
  } catch (error) {
    res.status(500).json({ message: 'Failed to get status', error: error.message });
  }
};

exports.connect = async (req, res) => {
  try {
    await whatsapp.connect();
    const { connected, qr, phoneNumber } = whatsapp.getStatus();
    const qrDataUrl = qr ? await QRCode.toDataURL(qr) : null;
    res.json({ connected, qr: qrDataUrl, phoneNumber });
  } catch (error) {
    res.status(500).json({ message: 'Failed to connect', error: error.message });
  }
};

exports.disconnect = async (req, res) => {
  try {
    await whatsapp.disconnect();
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ message: 'Failed to disconnect', error: error.message });
  }
};

exports.send = async (req, res) => {
  try {
    const { number, text, filePath, fileName, caption } = req.body || {};
    if (!number) return res.status(400).json({ message: 'number is required' });
    if (!text && !filePath) {
      return res.status(400).json({ message: 'text or filePath is required' });
    }

    if (!whatsapp.getStatus().connected) {
      return res.status(503).json({ message: 'WhatsApp not connected' });
    }

    const onWa = await whatsapp.isOnWhatsApp(number).catch(() => false);
    if (!onWa) {
      return res.status(400).json({ code: 'NOT_ON_WHATSAPP', message: 'Number is not on WhatsApp' });
    }

    const results = [];

    if (filePath) {
      const abs = resolveSafeUploadPath(filePath);
      if (!abs) {
        return res.status(400).json({ code: 'INVALID_FILE_PATH', message: 'filePath must be under backend/uploads' });
      }
      const docCaption = caption ?? (filePath && text ? '' : text || '');
      const docResult = await whatsapp.sendDocument(number, abs, fileName, docCaption);
      results.push({ kind: 'document', id: docResult?.key?.id });
      if (text && caption !== undefined) {
        const textResult = await whatsapp.sendText(number, text);
        results.push({ kind: 'text', id: textResult?.key?.id });
      }
    } else {
      const textResult = await whatsapp.sendText(number, text);
      results.push({ kind: 'text', id: textResult?.key?.id });
    }

    res.json({ ok: true, results });
  } catch (error) {
    res.status(500).json({ message: 'Failed to send', error: error.message });
  }
};

exports.check = async (req, res) => {
  try {
    const { number } = req.body || {};
    if (!number) return res.status(400).json({ message: 'number is required' });
    if (!whatsapp.getStatus().connected) {
      return res.status(503).json({ message: 'WhatsApp not connected' });
    }
    const exists = await whatsapp.isOnWhatsApp(number);
    res.json({ exists });
  } catch (error) {
    res.status(500).json({ message: 'Failed to check number', error: error.message });
  }
};
