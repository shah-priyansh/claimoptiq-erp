// File retrieval — serves a ClaimDocument / DocumentSubmission to the browser
// whether it lives on local disk or on a remote SFTP server. Honors HTTP Range
// (PDF/image viewers issue ranged/seek requests that express.static handled for
// free) and tries every enabled server with a 'verified' copy before failing.

const fs = require('fs');
const prisma = require('../config/prisma');
const sftp = require('../utils/sftpProvider');
const { resolveLocalPath } = require('./backupService');

// Returns { stream, close, totalSize, source } for the given record + optional
// byte range. Throws (status 502) if a remote-only file is unreachable.
const resolveFileStream = async (record, sourceType, range) => {
  const rangeOpts = {};
  if (range && Number.isFinite(range.start)) rangeOpts.start = range.start;
  if (range && Number.isFinite(range.end)) rangeOpts.end = range.end;

  const localPath = resolveLocalPath(record.filePath, record.fileName);
  if (record.storageLocation !== 'remote' && fs.existsSync(localPath)) {
    const totalSize = fs.statSync(localPath).size;
    return {
      stream: fs.createReadStream(localPath, rangeOpts),
      close: () => {},
      totalSize,
      source: 'local',
    };
  }

  // Remote: gather verified copies on enabled servers, primary first.
  const locations = await prisma.fileBackupLocation.findMany({
    where: { sourceType, sourceId: record.id, status: 'verified', server: { isEnabled: true } },
    include: { server: true },
  });
  locations.sort((a, b) => {
    if (a.server.isPrimary !== b.server.isPrimary) return a.server.isPrimary ? -1 : 1;
    return (a.server.order || 0) - (b.server.order || 0);
  });

  let lastErr = null;
  for (const loc of locations) {
    try {
      const { stream, close } = await sftp.openReadStream(loc.server, loc.remoteKey, rangeOpts);
      return { stream, close, totalSize: record.fileSize || loc.remoteSize || null, source: 'remote' };
    } catch (err) {
      lastErr = err;
    }
  }
  const err = new Error(`file unreachable on all servers${lastErr ? ': ' + lastErr.message : ''}`);
  err.status = 502;
  throw err;
};

// Parse a single-range "bytes=start-end" header against a known total size.
// Returns { start, end } (inclusive) or null if absent/unsatisfiable-as-full.
const parseRange = (header, totalSize) => {
  if (!header || !totalSize) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  let start = m[1] === '' ? null : parseInt(m[1], 10);
  let end = m[2] === '' ? null : parseInt(m[2], 10);
  if (start === null && end === null) return null;
  if (start === null) { start = Math.max(0, totalSize - end); end = totalSize - 1; }
  else if (end === null || end >= totalSize) { end = totalSize - 1; }
  if (start > end || start >= totalSize) return { unsatisfiable: true };
  return { start, end };
};

// Stream a record to the Express response with Range + download support.
// opts: { record, sourceType, download }
const streamFileToResponse = async (req, res, { record, sourceType, download }) => {
  const fileName = record.originalName || record.fileName || 'file';
  const contentType = record.fileType || 'application/octet-stream';

  // Determine total size (DB first; for local we can stat).
  let totalSize = record.fileSize || null;
  if (!totalSize && record.storageLocation !== 'remote') {
    try { totalSize = fs.statSync(resolveLocalPath(record.filePath, record.fileName)).size; } catch { /* unknown */ }
  }

  const range = parseRange(req.headers.range, totalSize);
  if (range && range.unsatisfiable) {
    res.setHeader('Content-Range', `bytes */${totalSize}`);
    return res.status(416).end();
  }

  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', contentType);
  res.setHeader(
    'Content-Disposition',
    `${download ? 'attachment' : 'inline'}; filename="${fileName.replace(/"/g, '')}"`,
  );

  let resolved;
  try {
    resolved = await resolveFileStream(record, sourceType, range || undefined);
  } catch (err) {
    return res.status(err.status || 502).json({ message: err.message });
  }
  const { stream, close } = resolved;

  if (range) {
    res.status(206);
    res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${totalSize}`);
    res.setHeader('Content-Length', range.end - range.start + 1);
  } else if (totalSize) {
    res.setHeader('Content-Length', totalSize);
  }

  // Clean up the (possibly remote) stream if the client disconnects.
  const cleanup = () => { try { stream.destroy(); } catch { /* ignore */ } close(); };
  res.on('close', cleanup);
  stream.on('error', (err) => {
    if (!res.headersSent) res.status(502).json({ message: `stream error: ${err.message}` });
    cleanup();
  });

  stream.pipe(res);
};

module.exports = { resolveFileStream, streamFileToResponse, parseRange };
