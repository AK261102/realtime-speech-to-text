import { useEffect, useRef, useState } from 'react';
import { startMicrophone } from '../lib/microphone.js';
import { LANGUAGE_OPTIONS, liveSocketUrl } from '../lib/api.js';

const MAX_SECONDS = 9 * 60 + 30; // upstream live sessions are limited to 10 minutes

const formatTime = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

export default function LiveTranscriber({ onSaved }) {
  const [language, setLanguage] = useState('hi-en');
  const [status, setStatus] = useState('idle'); // idle | connecting | listening | finishing
  const [segments, setSegments] = useState([]);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);

  const socketRef = useRef(null);
  const stopMicRef = useRef(null);
  const timerRef = useRef(null);
  const transcriptRef = useRef(null);

  const active = status !== 'idle';

  // Keep the newest words in view while speaking.
  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [segments, interim]);

  // Release the microphone and socket if the component unmounts mid-recording.
  useEffect(
    () => () => {
      cleanup();
      socketRef.current?.close();
    },
    [],
  );

  useEffect(() => {
    if (status === 'listening' && seconds >= MAX_SECONDS) stop();
  }, [seconds, status]);

  function cleanup() {
    clearInterval(timerRef.current);
    stopMicRef.current?.();
    stopMicRef.current = null;
    setLevel(0);
  }

  async function start() {
    setError('');
    setNotice('');
    setSegments([]);
    setInterim('');
    setSeconds(0);
    setStatus('connecting');

    const socket = new WebSocket(liveSocketUrl(language));
    socket.binaryType = 'arraybuffer';
    socketRef.current = socket;
    const queued = []; // audio captured before the socket finished opening
    let saved = false;

    socket.onopen = () => {
      queued.forEach((chunk) => socket.send(chunk));
      queued.length = 0;
    };
    socket.onmessage = ({ data }) => {
      const msg = JSON.parse(data);
      switch (msg.type) {
        case 'ready':
          setStatus((s) => (s === 'connecting' ? 'listening' : s));
          break;
        case 'interim':
          setInterim(msg.text);
          break;
        case 'final':
          setInterim('');
          setSegments((prev) => [...prev, msg.text]);
          break;
        case 'saved':
          saved = true;
          if (msg.record) {
            // Show exactly what was stored (includes any last words that were still interim).
            setSegments([msg.record.text]);
            setInterim('');
            setNotice('Saved to history.');
            onSaved?.(msg.record);
          } else {
            setNotice('No speech detected, nothing was saved.');
          }
          break;
        case 'error':
          setError(msg.message);
          break;
      }
    };
    socket.onclose = () => {
      cleanup();
      if (!saved) setError((e) => e || 'Connection to the server was lost.');
      setStatus('idle');
      socketRef.current = null;
    };

    try {
      stopMicRef.current = await startMicrophone({
        onChunk: (chunk) => {
          if (socket.readyState === WebSocket.OPEN) socket.send(chunk);
          else if (socket.readyState === WebSocket.CONNECTING) queued.push(chunk);
        },
        onLevel: setLevel,
      });
    } catch (err) {
      setError(
        err?.name === 'NotAllowedError'
          ? 'Microphone permission was denied. Allow microphone access in your browser and try again.'
          : err?.message || 'Could not access the microphone.',
      );
      socket.close();
      return;
    }
    timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
  }

  function stop() {
    cleanup();
    setStatus('finishing');
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'stop' }));
    else socket?.close();
  }

  const hasText = segments.length > 0 || interim;

  return (
    <section className="card live">
      <div className="card-head">
        <div>
          <h2>Live transcription</h2>
          <p className="muted">Speak in Hindi, English or a mix of both. Words appear as you talk.</p>
        </div>
        <label className="field inline">
          <span>Language</span>
          <select value={language} onChange={(e) => setLanguage(e.target.value)} disabled={active}>
            {LANGUAGE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="recorder">
        <button
          type="button"
          className={`mic ${status}`}
          onClick={status === 'idle' ? start : stop}
          disabled={status === 'finishing'}
          aria-label={status === 'idle' ? 'Start recording' : 'Stop recording'}
          style={{ '--level': Math.min(1, level * 8) }}
        >
          {status === 'idle' ? <MicIcon /> : status === 'finishing' ? <Spinner /> : <StopIcon />}
        </button>
        <div className="recorder-status">
          <strong>
            {
              {
                idle: 'Tap the microphone to start',
                connecting: 'Connecting…',
                listening: 'Listening',
                finishing: 'Finishing up…',
              }[status]
            }
          </strong>
          <span className="muted mono">
            {active ? `${formatTime(seconds)} / ${formatTime(MAX_SECONDS)}` : 'Up to 9½ minutes per recording'}
          </span>
        </div>
      </div>

      <div className="transcript" ref={transcriptRef} aria-live="polite">
        {hasText ? (
          <p>
            {segments.join(' ')} {interim && <span className="interim">{interim}</span>}
          </p>
        ) : (
          <p className="placeholder">{active ? 'Start speaking…' : 'Your transcript will appear here.'}</p>
        )}
      </div>

      {error && <p className="alert error">{error}</p>}
      {notice && !error && <p className="alert success">{notice}</p>}
    </section>
  );
}

const MicIcon = () => (
  <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="2" width="6" height="12" rx="3" />
    <path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8" />
  </svg>
);

const StopIcon = () => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true">
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);

const Spinner = () => <span className="spinner" aria-hidden="true" />;
