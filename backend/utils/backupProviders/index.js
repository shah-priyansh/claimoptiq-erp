// Picks the storage provider for a BackupServer row by its `type`. Every
// provider exposes the same functions (testConnection, putFile, getFile,
// remoteSize, existsRemote, deleteRemote, openReadStream), all taking the
// server row first, so callers never branch on the server type themselves.

const sftp = require('./sftp');
const gdrive = require('./gdrive');

const PROVIDERS = { sftp, gdrive };
const SERVER_TYPES = Object.keys(PROVIDERS);

const providerFor = (server) => {
  const type = (server && server.type) || 'sftp';
  const provider = PROVIDERS[type];
  if (!provider) throw new Error(`unknown backup server type: ${type}`);
  return provider;
};

module.exports = { providerFor, SERVER_TYPES };
