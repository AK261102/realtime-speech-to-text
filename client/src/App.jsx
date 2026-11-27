import { useState } from 'react';
import LiveTranscriber from './components/LiveTranscriber.jsx';
import HistoryDashboard from './components/HistoryDashboard.jsx';

export default function App() {
  // Bumped whenever a live recording is saved so the history list reloads.
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true">◉</span>
          <div>
            <h1>Live Speech to Text</h1>
            <p className="muted">Real-time multilingual transcription · Hindi · English · Hinglish</p>
          </div>
        </div>
      </header>

      <main>
        <LiveTranscriber onSaved={() => setRefreshKey((k) => k + 1)} />
        <HistoryDashboard refreshKey={refreshKey} />
      </main>
    </div>
  );
}
