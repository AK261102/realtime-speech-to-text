import { useCallback, useEffect, useState } from 'react';
import { api, LANGUAGE_OPTIONS, languageLabel } from '../lib/api.js';
import { speak, stopSpeaking, ttsSupported } from '../lib/speech.js';

const PAGE_SIZE = 10;

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const formatDuration = (s) => (s == null ? null : s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`);

export default function HistoryDashboard({ refreshKey }) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [speakingId, setSpeakingId] = useState(null);

  // Debounce the search box.
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.list({ search: query, limit: PAGE_SIZE, offset: page * PAGE_SIZE });
      // Deleting the last item of a page: step back a page.
      if (data.items.length === 0 && page > 0) return setPage((p) => p - 1);
      setItems(data.items);
      setTotal(data.total);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [query, page]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  useEffect(() => () => stopSpeaking(), []);

  async function handleCreate(data) {
    await api.create(data);
    setCreating(false);
    setSearch('');
    setQuery('');
    if (page === 0) load();
    else setPage(0);
  }

  async function handleUpdate(id, data) {
    const updated = await api.update(id, data);
    setItems((list) => list.map((t) => (t.id === id ? updated : t)));
    setEditingId(null);
  }

  async function handleDelete(item) {
    const label = item.title || `the transcription from ${dateFormat.format(new Date(item.createdAt))}`;
    if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return;
    try {
      await api.remove(item.id);
      if (speakingId === item.id) stopSpeaking();
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  function toggleSpeak(item) {
    if (speakingId === item.id) {
      stopSpeaking();
      setSpeakingId(null);
      return;
    }
    setSpeakingId(item.id);
    speak(item.text, { onEnd: () => setSpeakingId((id) => (id === item.id ? null : id)) });
  }

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>Transcription history</h2>
          <p className="muted">
            {total} {total === 1 ? 'transcription' : 'transcriptions'} saved
          </p>
        </div>
        <div className="toolbar">
          <input
            type="search"
            placeholder="Search transcriptions…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search transcriptions"
          />
          <button type="button" className="btn primary" onClick={() => setCreating(true)} disabled={creating}>
            + New
          </button>
        </div>
      </div>

      {error && <p className="alert error">{error}</p>}

      {creating && (
        <TranscriptionForm submitLabel="Create" onSubmit={handleCreate} onCancel={() => setCreating(false)} />
      )}

      {loading && items.length === 0 ? (
        <p className="empty muted">Loading…</p>
      ) : items.length === 0 ? (
        <p className="empty muted">
          {query ? `No transcriptions match “${query}”.` : 'No transcriptions yet. Record one above or add one manually.'}
        </p>
      ) : (
        <ul className="history">
          {items.map((item) =>
            editingId === item.id ? (
              <li key={item.id}>
                <TranscriptionForm
                  initial={item}
                  submitLabel="Save changes"
                  onSubmit={(data) => handleUpdate(item.id, data)}
                  onCancel={() => setEditingId(null)}
                />
              </li>
            ) : (
              <li key={item.id} className="history-item">
                <div className="history-meta">
                  <h3>{item.title || 'Untitled'}</h3>
                  <span className="muted">{dateFormat.format(new Date(item.createdAt))}</span>
                  <span className="badge">{languageLabel(item.language)}</span>
                  <span className={`badge ${item.source}`}>{item.source === 'live' ? 'Live' : 'Manual'}</span>
                  {item.durationSeconds != null && <span className="muted">{formatDuration(item.durationSeconds)}</span>}
                  {item.updatedAt !== item.createdAt && <span className="muted">· edited</span>}
                </div>
                <p className="history-text">{item.text}</p>
                <div className="history-actions">
                  {ttsSupported && (
                    <button type="button" className="btn small" onClick={() => toggleSpeak(item)}>
                      {speakingId === item.id ? '■ Stop' : '🔊 Read aloud'}
                    </button>
                  )}
                  <button type="button" className="btn small" onClick={() => navigator.clipboard?.writeText(item.text)}>
                    Copy
                  </button>
                  <button type="button" className="btn small" onClick={() => setEditingId(item.id)}>
                    Edit
                  </button>
                  <button type="button" className="btn small danger" onClick={() => handleDelete(item)}>
                    Delete
                  </button>
                </div>
              </li>
            ),
          )}
        </ul>
      )}

      {total > PAGE_SIZE && (
        <div className="pagination">
          <button type="button" className="btn small" onClick={() => setPage((p) => p - 1)} disabled={page === 0}>
            ← Previous
          </button>
          <span className="muted mono">
            Page {page + 1} of {pages}
          </span>
          <button
            type="button"
            className="btn small"
            onClick={() => setPage((p) => p + 1)}
            disabled={page + 1 >= pages}
          >
            Next →
          </button>
        </div>
      )}
    </section>
  );
}

function TranscriptionForm({ initial, submitLabel, onSubmit, onCancel }) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [text, setText] = useState(initial?.text ?? '');
  const [language, setLanguage] = useState(initial?.language ?? 'hi-en');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (!text.trim()) return setError('Text cannot be empty.');
    setSaving(true);
    setError('');
    try {
      await onSubmit({ title, text, language });
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <form className="editor" onSubmit={submit}>
      <div className="editor-row">
        <label className="field">
          <span>Title (optional)</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="e.g. Team standup notes" />
        </label>
        <label className="field">
          <span>Language</span>
          <select value={language} onChange={(e) => setLanguage(e.target.value)}>
            {LANGUAGE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span>Text</span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} autoFocus />
      </label>
      {error && <p className="alert error">{error}</p>}
      <div className="history-actions">
        <button type="submit" className="btn primary" disabled={saving}>
          {saving ? 'Saving…' : submitLabel}
        </button>
        <button type="button" className="btn" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  );
}
