import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { initDb, pool } from './db.js';
import { router as transcriptionsRouter } from './transcriptions.js';
import { attachLiveTranscription } from './live.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const CLIENT_DIST = path.resolve(__dirname, '../client/dist');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ status: 'ok' });
});

app.use('/api/transcriptions', transcriptionsRouter);

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// Serve the built React app (production). In development Vite serves it instead.
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get('/{*splat}', (_req, res) => res.sendFile(path.join(CLIENT_DIST, 'index.html')));
}

// Central error handler: validation errors carry a status, everything else is a 500.
app.use((err, _req, res, _next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
  const status = err.status && err.status < 500 ? err.status : 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 500 ? 'Internal server error' : err.message });
});

const server = http.createServer(app);
attachLiveTranscription(server);

await initDb();
server.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
