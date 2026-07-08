require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

// The DB (Neon @ us-east-1) is ~250ms away over the network from any Indian
// operator. That WAN latency is on every roundtrip, so the two things that
// matter most for perceived speed are:
//   1. Enough concurrent connections that bursts don't queue behind each
//      other (default pool is 10 — small enough that a 3-request page like
//      /claims can hit head-of-line blocking).
//   2. Keep-alive so we amortise the TCP + TLS handshake across the pool's
//      idle window instead of re-negotiating it every few minutes.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX) || 30,
  idleTimeoutMillis: 60 * 1000,
  connectionTimeoutMillis: 10 * 1000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10 * 1000,
});

const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({ adapter });

module.exports = prisma;
