import { useCallback, useEffect, useState } from 'react';
import { api, LANGUAGE_OPTIONS } from '../lib/api.js';
import { speak, stopSpeaking, ttsSupported } from '../lib/speech.js';
import { CheckIcon, CopyIcon, EditIcon, HistoryIcon, PlusIcon, SearchIcon, SpeakerIcon, StopIcon, TrashIcon } from './Icons.jsx';

const PAGE_SIZE = 10;

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const shortLanguage = (value) => LANGUAGE_OPTIONS.find((o) => o.value === value)?.short ?? value;
const formatDuration = (s) => (s == null ? null : s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`);
const countWords = (text) => (text.trim() ? text.trim().split(/\s+/).length : 0);

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
  const [copiedId, setCopiedId] = useState(null);

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
    const label = item.title ? `“${item.title}”` : `transcription #${item.id}`;
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

  async function copy(item) {
    try {
      await navigator.clipboard.writeText(item.text);
      setCopiedId(item.id);
      setTimeout(() => setCopiedId((id) => (id === item.id ? null : id)), 1500);
    } catch {
      /* clipboard unavailable (e.g. insecure context) */
    }
  }

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const firstLoad = loading && items.length === 0;

  return (
    <section className="card" aria-labelledby="history-title">
      <div className="card-head">
        <div className="card-title">
          <span className="icon-badge">
            <HistoryIcon />
          </span>
          <div>
            <h2 id="history-title">Transcription history</h2>
            <div className="sub">
              {firstLoad ? 'Loading…' : `${total} ${total === 1 ? 'record' : 'records'} in PostgreSQL`}
            </div>
          </div>
        </div>
        <div className="history-tools">
          <label className="search">
            <SearchIcon />
            <input
              className="input"
              type="search"
              placeholder="Search text or title…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search transcriptions"
            />
          </label>
          <button type="button" className="btn primary" onClick={() => setCreating(true)} disabled={creating}>
            <PlusIcon /> New
          </button>
        </div>
      </div>

      {error && (
        <p className="alert error" style={{ margin: '14px 20px 0' }} role="alert">
          {error}
        </p>
      )}

      {creating && (
        <TranscriptionForm submitLabel="Create record" onSubmit={handleCreate} onCancel={() => setCreating(false)} />
      )}

      {firstLoad ? (
        <>
          <div className="skeleton" />
          <div className="skeleton" />
        </>
      ) : items.length === 0 ? (
        <div className="empty">
          <span className="icon-badge">
            <HistoryIcon size={20} />
          </span>
          <strong>{query ? 'No matching transcriptions' : 'No transcriptions yet'}</strong>
          <span>{query ? `Nothing matches “${query}”.` : 'Record one above or add one manually with New.'}</span>
        </div>
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
              <li key={item.id}>
                <article className="history-item">
                  <div className="history-main">
                    <div className="history-title">
                      <span className="id">#{String(item.id).padStart(3, '0')}</span>
                      <h3>{item.title || 'Untitled transcription'}</h3>
                      <span className={`tag ${item.source}`}>{item.source === 'live' ? 'LIVE' : 'MANUAL'}</span>
                      <span className="tag">{shortLanguage(item.language)}</span>
                      {item.updatedAt !== item.createdAt && <span className="tag edited">EDITED</span>}
                    </div>
                    <p className="history-text">{item.text}</p>
                    <div className="history-meta">
                      <span>{dateFormat.format(new Date(item.createdAt))}</span>
                      <span>{countWords(item.text)} words</span>
                      {item.durationSeconds != null && <span>{formatDuration(item.durationSeconds)} audio</span>}
                    </div>
                  </div>
                  <div className="history-actions">
                    {ttsSupported && (
                      <button
                        type="button"
                        className={`btn ghost ${speakingId === item.id ? 'active' : ''}`}
                        onClick={() => toggleSpeak(item)}
                        title={speakingId === item.id ? 'Stop reading' : 'Read aloud'}
                        aria-label={speakingId === item.id ? 'Stop reading' : 'Read aloud'}
                      >
                        {speakingId === item.id ? <StopIcon size={16} /> : <SpeakerIcon />}
                      </button>
                    )}
                    <button type="button" className="btn ghost" onClick={() => copy(item)} title="Copy text" aria-label="Copy text">
                      {copiedId === item.id ? <CheckIcon /> : <CopyIcon />}
                    </button>
                    <button type="button" className="btn ghost" onClick={() => setEditingId(item.id)} title="Edit" aria-label="Edit">
                      <EditIcon />
                    </button>
                    <button
                      type="button"
                      className="btn ghost danger"
                      onClick={() => handleDelete(item)}
                      title="Delete"
                      aria-label="Delete"
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </article>
              </li>
            ),
          )}
        </ul>
      )}

      {total > PAGE_SIZE && (
        <div className="pagination">
          <span className="mono">
            {page * PAGE_SIZE + 1}–{Math.min(total, (page + 1) * PAGE_SIZE)} of {total}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn" onClick={() => setPage((p) => p - 1)} disabled={page === 0}>
              ← Previous
            </button>
            <button type="button" className="btn" onClick={() => setPage((p) => p + 1)} disabled={page + 1 >= pages}>
              Next →
            </button>
          </div>
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
      <span className="eyebrow">{initial ? `Editing #${String(initial.id).padStart(3, '0')}` : 'New record'}</span>
      <div className="editor-row">
        <label className="field">
          <span>Title (optional)</span>
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            placeholder="e.g. Team standup notes"
          />
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
      <div className="editor-actions">
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
