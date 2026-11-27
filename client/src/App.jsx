import { useEffect, useState } from 'react';
import LiveTranscriber from './components/LiveTranscriber.jsx';
import HistoryDashboard from './components/HistoryDashboard.jsx';
import { GithubIcon } from './components/Icons.jsx';
import { api } from './lib/api.js';

const REPO_URL = 'https://github.com/AK261102/realtime-speech-to-text';

export default function App() {
  // Bumped whenever a live recording is saved so the history list reloads.
  const [refreshKey, setRefreshKey] = useState(0);
  const health = useHealth();

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <img className="brand-mark" src="/favicon.svg" alt="" />
            <div>
              <div className="brand-name">VoiceScribe</div>
              <div className="brand-tag">Real-time multilingual speech-to-text</div>
            </div>
          </div>
          <div className="status-row">
            <StatusPill health={health} />
            {health.data?.speech?.model && (
              <span className="pill mono hide-sm" title="Speech recognition model">
                {health.data.speech.model}
              </span>
            )}
            <a className="icon-link" href={REPO_URL} target="_blank" rel="noreferrer">
              <GithubIcon /> <span className="hide-sm">Source</span>
            </a>
          </div>
        </div>
      </header>

      <div className="page">
        <section className="hero">
          <h1>
            Speak in Hindi, English or <span className="grad">Hinglish</span>. See it transcribed live.
          </h1>
          <p>
            Audio streams from your microphone over a WebSocket to a streaming speech model. Partial text appears
            as you talk and every session is stored in PostgreSQL.
          </p>
        </section>

        <LiveTranscriber onSaved={() => setRefreshKey((k) => k + 1)} speechReady={health.data?.speech?.configured} />
        <HistoryDashboard refreshKey={refreshKey} />

        <footer className="footer">Node.js · Express · WebSocket · React · PostgreSQL · Gemini Live</footer>
      </div>
    </>
  );
}

function useHealth() {
  const [state, setState] = useState({ status: 'checking', data: null });
  useEffect(() => {
    let cancelled = false;
    const check = () =>
      api
        .health()
        .then((data) => !cancelled && setState({ status: 'ok', data }))
        .catch(() => !cancelled && setState({ status: 'down', data: null }));
    check();
    const id = setInterval(check, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);
  return state;
}

function StatusPill({ health }) {
  if (health.status === 'checking') {
    return (
      <span className="pill">
        <span className="dot" /> Connecting…
      </span>
    );
  }
  if (health.status === 'down') {
    return (
      <span className="pill">
        <span className="dot down" /> Server unreachable
      </span>
    );
  }
  const speechOk = health.data?.speech?.configured !== false; // unknown (older API) counts as ok
  return (
    <span className="pill" title="API, database and speech service status">
      <span className={`dot ${speechOk ? 'ok' : 'warn'}`} />
      {speechOk ? 'All systems operational' : 'Speech service not configured'}
    </span>
  );
}
