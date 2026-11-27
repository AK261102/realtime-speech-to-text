import { Router } from 'express';
import { pool } from './db.js';

export const LANGUAGES = ['auto', 'hi-IN', 'en-IN', 'en-US'];
const SOURCES = ['live', 'manual'];
const MAX_TEXT = 20_000;
const MAX_TITLE = 200;

const COLUMNS = `id, title, text, language, source,
  duration_seconds AS "durationSeconds", created_at AS "createdAt", updated_at AS "updatedAt"`;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function parseId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Invalid id');
  return id;
}

function cleanTitle(title) {
  if (title == null || title === '') return null;
  if (typeof title !== 'string') throw new HttpError(400, 'title must be a string');
  return title.trim().slice(0, MAX_TITLE) || null;
}

function cleanText(text) {
  if (typeof text !== 'string' || !text.trim()) throw new HttpError(400, 'text is required');
  if (text.length > MAX_TEXT) throw new HttpError(400, `text must be at most ${MAX_TEXT} characters`);
  return text.trim();
}

function cleanLanguage(language) {
  if (language == null) return 'auto';
  if (!LANGUAGES.includes(language)) throw new HttpError(400, `language must be one of ${LANGUAGES.join(', ')}`);
  return language;
}

/** Insert a transcription. Shared by the REST API and the live WebSocket session. */
export async function createTranscription({ title, text, language, source = 'live', durationSeconds = null }) {
  if (!SOURCES.includes(source)) throw new HttpError(400, 'Invalid source');
  const duration = durationSeconds == null ? null : Math.max(0, Math.round(Number(durationSeconds)) || 0);
  const { rows } = await pool.query(
    `INSERT INTO transcriptions (title, text, language, source, duration_seconds)
     VALUES ($1, $2, $3, $4, $5) RETURNING ${COLUMNS}`,
    [cleanTitle(title), cleanText(text), cleanLanguage(language), source, duration],
  );
  return rows[0];
}

export const router = Router();

// List with optional full-text search and pagination.
router.get('/', async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

  const params = [];
  let where = '';
  if (search) {
    params.push(`%${search}%`);
    where = 'WHERE text ILIKE $1 OR title ILIKE $1';
  }

  const [items, count] = await Promise.all([
    pool.query(
      `SELECT ${COLUMNS} FROM transcriptions ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    ),
    pool.query(`SELECT COUNT(*)::int AS total FROM transcriptions ${where}`, params),
  ]);

  res.json({ items: items.rows, total: count.rows[0].total, limit, offset });
});

router.get('/:id', async (req, res) => {
  const { rows } = await pool.query(`SELECT ${COLUMNS} FROM transcriptions WHERE id = $1`, [parseId(req.params.id)]);
  if (!rows.length) throw new HttpError(404, 'Transcription not found');
  res.json(rows[0]);
});

router.post('/', async (req, res) => {
  const { title, text, language, durationSeconds } = req.body ?? {};
  const created = await createTranscription({ title, text, language, durationSeconds, source: 'manual' });
  res.status(201).json(created);
});

router.put('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  const { title, text, language } = req.body ?? {};
  const { rows } = await pool.query(
    `UPDATE transcriptions
        SET title = $1, text = $2, language = $3, updated_at = NOW()
      WHERE id = $4
      RETURNING ${COLUMNS}`,
    [cleanTitle(title), cleanText(text), cleanLanguage(language), id],
  );
  if (!rows.length) throw new HttpError(404, 'Transcription not found');
  res.json(rows[0]);
});

router.delete('/:id', async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM transcriptions WHERE id = $1', [parseId(req.params.id)]);
  if (!rowCount) throw new HttpError(404, 'Transcription not found');
  res.status(204).end();
});
