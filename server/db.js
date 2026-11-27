import pg from 'pg';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30_000,
});

pool.on('error', (err) => {
  // Idle client errors (e.g. serverless Postgres closing idle connections) must not crash the process.
  console.error('Postgres pool error:', err.message);
});

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS transcriptions (
    id               SERIAL PRIMARY KEY,
    title            VARCHAR(200),
    text             TEXT        NOT NULL,
    language         VARCHAR(20) NOT NULL DEFAULT 'auto',
    source           VARCHAR(20) NOT NULL DEFAULT 'live',
    duration_seconds INTEGER,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_transcriptions_created_at ON transcriptions (created_at DESC);
`;

export async function initDb() {
  await pool.query(SCHEMA);
}
