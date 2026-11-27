import LiveTranscriber from './components/LiveTranscriber.jsx';

export default function App() {
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
        <LiveTranscriber />
      </main>
    </div>
  );
}
