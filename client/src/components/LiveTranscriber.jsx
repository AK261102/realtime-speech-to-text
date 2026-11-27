import { useEffect, useRef, useState } from 'react';
import { startMicrophone } from '../lib/microphone.js';
import { LANGUAGE_OPTIONS, languageLabel, liveSocketUrl } from '../lib/api.js';
import { ActivityIcon, AlertIcon, CheckIcon, CpuIcon, MicIcon, StopIcon, WaveIcon } from './Icons.jsx';

const MAX_SECONDS = 9 * 60 + 30; // upstream live sessions are limited to 10 minutes
const BARS = 48;
const SILENT_WAVE = Array(BARS).fill(0);

const formatTime = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
const countWords = (text) => (text.trim() ? text.trim().split(/\s+/).length : 0);

const STATUS_TEXT = {
  idle: 'Ready to record',
  connecting: 'Connecting to speech service…',
  listening: 'Listening',
  finishing: 'Finalizing transcript…',
};

export default function LiveTranscriber({ onSaved, speechReady }) {
  const [language, setLanguage] = useState('hi-en');
  const [status, setStatus] = useState('idle'); // idle | connecting | listening | finishing
  const [segments, setSegments] = useState([]); // [{ t: seconds, text }]
  const [interim, setInterim] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [wave, setWave] = useState(SILENT_WAVE);
  const [firstTextMs, setFirstTextMs] = useState(null);
  const [savedId, setSavedId] = useState(null);

  const socketRef = useRef(null);
  const stopMicRef = useRef(null);
  const timerRef = useRef(null);
  const consoleRef = useRef(null);
  const secondsRef = useRef(0);
  const startedAtRef = useRef(0);
  const interimRef = useRef('');

  const active = status !== 'idle';

  // Keep the newest words in view while speaking.
  useEffect(() => {
    const el = consoleRef.current;
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
    setWave(SILENT_WAVE);
  }

  async function start() {
    setError('');
    setNotice('');
    setSegments([]);
    setInterim('');
    interimRef.current = '';
    setSeconds(0);
    setFirstTextMs(null);
    setSavedId(null);
    secondsRef.current = 0;
    startedAtRef.current = performance.now();
    setStatus('connecting');

    const socket = new WebSocket(liveSocketUrl(language));
    socket.binaryType = 'arraybuffer';
    socketRef.current = socket;
    const queued = []; // audio captured before the socket finished opening
    let saved = false;
    let gotText = false;

    const markFirstText = () => {
      if (gotText) return;
      gotText = true;
      setFirstTextMs(Math.round(performance.now() - startedAtRef.current));
    };

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
          markFirstText();
          interimRef.current = msg.text;
          setInterim(msg.text);
          break;
        case 'final':
          markFirstText();
          interimRef.current = '';
          setInterim('');
          setSegments((prev) => [...prev, { t: secondsRef.current, text: msg.text }]);
          break;
        case 'saved':
          saved = true;
          if (msg.record) {
            // Keep any last words that were still interim (the server saved them too).
            const pending = interimRef.current;
            interimRef.current = '';
            setInterim('');
            if (pending) setSegments((prev) => [...prev, { t: secondsRef.current, text: pending }]);
            setSavedId(msg.record.id);
            setNotice(`Saved to history as #${msg.record.id}.`);
            onSaved?.(msg.record);
          } else {
            setNotice('No speech detected, so nothing was saved.');
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
        onLevel: (level) => setWave((prev) => [...prev.slice(1), Math.min(1, level * 9)]),
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
    timerRef.current = setInterval(() => {
      secondsRef.current += 1;
      setSeconds(secondsRef.current);
    }, 1000);
  }

  function stop() {
    cleanup();
    setStatus('finishing');
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'stop' }));
    else socket?.close();
  }

  const fullText = [...segments.map((s) => s.text), interim].join(' ');
  const words = countWords(fullText);
  const hasText = segments.length > 0 || interim;
  const disabled = speechReady === false;

  return (
    <div className="workspace">
      <section className="card" aria-labelledby="live-title">
        <div className="card-head">
          <div className="card-title">
            <span className="icon-badge">
              <WaveIcon />
            </span>
            <div>
              <h2 id="live-title">Live transcription</h2>
              <div className="sub">Streaming recognition with partial results</div>
            </div>
          </div>
          <div className="segmented" role="group" aria-label="Recognition language">
            {LANGUAGE_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                aria-pressed={language === o.value}
                onClick={() => setLanguage(o.value)}
                disabled={active}
                title={o.label}
              >
                {o.short}
              </button>
            ))}
          </div>
        </div>

        <div className="card-body">
          <div className="recorder">
            <button
              type="button"
              className={`mic ${status}`}
              onClick={status === 'idle' ? start : stop}
              disabled={status === 'finishing' || (status === 'idle' && disabled)}
              aria-label={status === 'idle' ? 'Start recording' : 'Stop recording'}
            >
              {status === 'idle' ? <MicIcon size={30} /> : status === 'finishing' ? <span className="spinner" /> : <StopIcon />}
            </button>
            <div className="recorder-info">
              <div className="recorder-state">
                {status === 'listening' && <span className="dot live" />}
                <strong>{disabled && status === 'idle' ? 'Speech service unavailable' : STATUS_TEXT[status]}</strong>
                <span className="timer">
                  {formatTime(seconds)} / {formatTime(MAX_SECONDS)}
                </span>
              </div>
              <div className={`wave ${status === 'listening' ? 'active' : ''}`} aria-hidden="true">
                {wave.map((v, i) => (
                  <span key={i} style={{ height: `${Math.max(8, v * 100)}%` }} />
                ))}
              </div>
            </div>
          </div>

          <div className="console">
            <div className="console-bar">
              <div className="console-dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </div>
              <span>transcript · {languageLabel(language).toLowerCase()}</span>
              <span>{segments.length} seg</span>
            </div>
            <div className="console-body" ref={consoleRef} aria-live="polite">
              {hasText ? (
                <>
                  {segments.map((s, i) => (
                    <div className="line" key={i}>
                      <time>[{formatTime(s.t)}]</time>
                      <p>{s.text}</p>
                    </div>
                  ))}
                  {(interim || status === 'listening') && (
                    <div className="line interim">
                      <time>[{formatTime(seconds)}]</time>
                      <p>
                        {interim}
                        <span className="caret" />
                      </p>
                    </div>
                  )}
                </>
              ) : (
                <p className="console-empty">
                  {active ? (
                    <>
                      <b>$</b> waiting for speech… start talking
                      <span className="caret" />
                    </>
                  ) : (
                    <>
                      <b>$</b> press the microphone and speak, e.g. “आज मेरी meeting है at 5 PM”
                    </>
                  )}
                </p>
              )}
            </div>
          </div>

          {error && (
            <p className="alert error" role="alert">
              <AlertIcon /> {error}
            </p>
          )}
          {notice && !error && (
            <p className="alert success">
              <CheckIcon /> {notice}
            </p>
          )}
        </div>
      </section>

      <aside className="side">
        <section className="card" aria-labelledby="metrics-title">
          <div className="card-head">
            <div className="card-title">
              <span className="icon-badge">
                <ActivityIcon />
              </span>
              <h2 id="metrics-title">Session metrics</h2>
            </div>
          </div>
          <div className="metrics">
            <Metric label="Duration" value={formatTime(seconds)} />
            <Metric label="Words" value={words} />
            <Metric label="Segments" value={segments.length} />
            <Metric
              label="First text"
              value={firstTextMs == null ? '—' : (firstTextMs / 1000).toFixed(2)}
              unit={firstTextMs == null ? '' : 's'}
            />
          </div>
          <div className="metrics-foot">
            <span>Last saved</span>
            <span className="mono">{savedId ? `#${savedId}` : '—'}</span>
          </div>
        </section>

        <section className="card" aria-labelledby="pipeline-title">
          <div className="card-head">
            <div className="card-title">
              <span className="icon-badge">
                <CpuIcon />
              </span>
              <h2 id="pipeline-title">Pipeline</h2>
            </div>
          </div>
          <ol className="pipeline">
            <Step n="01" title="Microphone capture" detail="AudioWorklet · 16 kHz PCM16" />
            <Step n="02" title="Stream to server" detail="WebSocket · 100 ms frames" />
            <Step n="03" title="Speech recognition" detail="Gemini Live · interim + final" />
            <Step n="04" title="Persist" detail="PostgreSQL · transcriptions" />
          </ol>
        </section>
      </aside>
    </div>
  );
}

function Metric({ label, value, unit }) {
  return (
    <div className="metric">
      <span className="eyebrow">{label}</span>
      <span className="metric-value">
        {value}
        {unit && <small>{unit}</small>}
      </span>
    </div>
  );
}

function Step({ n, title, detail }) {
  return (
    <li>
      <span className="step-num">{n}</span>
      <div>
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
    </li>
  );
}
