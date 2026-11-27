import { WebSocketServer } from 'ws';
import { GoogleGenAI, Modality } from '@google/genai';
import { createTranscription } from './transcriptions.js';

/*
 * Browser  <--WebSocket-->  this server  <--Gemini Live API-->  Google
 *
 * Client -> server
 *   binary frames          raw PCM, 16-bit little-endian, mono, 16 kHz
 *   {"type":"stop"}        user finished speaking: flush, save, close
 *
 * Server -> client
 *   {"type":"ready"}                         upstream session is open, audio is flowing
 *   {"type":"interim","text"}                speculative text for the segment being spoken
 *   {"type":"final","text","languageCode"}   a finalized segment (append to transcript)
 *   {"type":"saved","record"}                transcription stored in the database (record is null if nothing was said)
 *   {"type":"error","message"}
 *
 * The API key never leaves the server.
 */

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-transcribe-live';
const SAMPLE_RATE = 16_000;
const BYTES_PER_SECOND = SAMPLE_RATE * 2;
const MAX_SESSION_MS = 9.5 * 60 * 1000; // Live transcription sessions are capped at 10 minutes upstream.
const MAX_CONCURRENT_SESSIONS = Number(process.env.MAX_CONCURRENT_SESSIONS) || 10;
const MAX_PENDING_BYTES = BYTES_PER_SECOND * 10; // audio buffered while the upstream session opens
const FLUSH_IDLE_MS = 1500; // after stop: wait this long without new transcripts...
const FLUSH_MAX_MS = 6000; // ...but never longer than this

// UI language option -> BCP-47 hints for the model. Empty list = automatic detection (handles code-mixing).
const LANGUAGE_HINTS = {
  auto: [],
  'hi-en': ['hi-IN', 'en-IN'],
  'hi-IN': ['hi-IN'],
  'en-IN': ['en-IN'],
};

let ai = null;
function getClient() {
  if (!process.env.GEMINI_API_KEY) return null;
  ai ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { apiVersion: 'v1beta' } });
  return ai;
}

let activeSessions = 0;

export function attachLiveTranscription(server) {
  const wss = new WebSocketServer({ server, path: '/ws/transcribe', maxPayload: 256 * 1024 });
  wss.on('connection', (ws, req) => handleConnection(ws, req));
}

function handleConnection(ws, req) {
  const send = (msg) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));
  const fail = (message) => {
    send({ type: 'error', message });
    ws.close(1011, 'error');
  };

  const url = new URL(req.url, 'http://localhost');
  const language = url.searchParams.get('language') || 'auto';
  if (!(language in LANGUAGE_HINTS)) return fail(`Unsupported language "${language}"`);

  const client = getClient();
  if (!client) return fail('Speech service is not configured (GEMINI_API_KEY missing).');
  if (activeSessions >= MAX_CONCURRENT_SESSIONS) return fail('Server is busy, please try again in a minute.');
  activeSessions++;

  const segments = []; // finalized text segments, in order
  let interim = ''; // latest speculative text for the current segment
  let detectedLanguage = null;
  let pending = []; // audio received before the upstream session is ready
  let pendingBytes = 0;
  let audioBytes = 0;
  let session = null;
  let stopping = false;
  let finished = false;
  let idleTimer = null;
  let maxTimer = null;

  const sessionTimer = setTimeout(() => stop('Maximum recording length reached.'), MAX_SESSION_MS);

  const onTranscript = () => {
    if (stopping) {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(finish, FLUSH_IDLE_MS);
    }
  };

  const sendAudio = (chunk) => {
    session.sendRealtimeInput({ audio: { data: chunk.toString('base64'), mimeType: `audio/pcm;rate=${SAMPLE_RATE}` } });
  };

  client.live
    .connect({
      model: MODEL,
      config: {
        responseModalities: [Modality.TEXT],
        inputAudioTranscription: { languageCodes: LANGUAGE_HINTS[language] },
      },
      callbacks: {
        onopen: () => {},
        onmessage: (message) => {
          const content = message.serverContent;
          if (!content) return;
          if (content.interimInputTranscription?.text) {
            interim = content.interimInputTranscription.text;
            send({ type: 'interim', text: interim });
            onTranscript();
          }
          const final = content.inputTranscription;
          if (final?.text) {
            interim = '';
            segments.push(final.text);
            if (final.languageCode) detectedLanguage = final.languageCode;
            send({ type: 'final', text: final.text, languageCode: final.languageCode ?? null });
            onTranscript();
          }
        },
        onerror: (e) => {
          console.error('Gemini live error:', e?.message ?? e);
          send({ type: 'error', message: 'Speech service error. Please try again.' });
          finish();
        },
        onclose: (e) => {
          if (!finished && !stopping) {
            console.warn('Gemini live session closed unexpectedly:', e?.code, e?.reason);
            send({ type: 'error', message: e?.reason ? `Speech service closed: ${e.reason}` : 'Speech service disconnected.' });
          }
          finish();
        },
      },
    })
    .then((s) => {
      session = s;
      if (finished) return session.close();
      for (const chunk of pending) sendAudio(chunk);
      pending = [];
      send({ type: 'ready' });
      if (stopping) beginFlush();
    })
    .catch((err) => {
      console.error('Failed to open Gemini live session:', err?.message ?? err);
      fail('Could not connect to the speech service.');
      finish();
    });

  ws.on('message', (data, isBinary) => {
    if (finished) return;
    if (isBinary) {
      if (stopping) return;
      const chunk = Buffer.from(data);
      if (chunk.length % 2 !== 0) return; // PCM16 frames are always an even number of bytes
      audioBytes += chunk.length;
      if (session) return sendAudio(chunk);
      if (pendingBytes + chunk.length <= MAX_PENDING_BYTES) {
        pending.push(chunk);
        pendingBytes += chunk.length;
      }
      return;
    }
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (msg?.type === 'stop') stop();
  });

  // Browser closed the tab / lost network: keep whatever was transcribed.
  ws.on('close', () => stop());
  ws.on('error', () => stop());

  function stop(reason) {
    if (stopping || finished) return;
    stopping = true;
    if (reason) send({ type: 'error', message: reason });
    if (session) beginFlush();
  }

  // Tell the model the stream ended so it finalizes the last segment, then wait for trailing transcripts.
  function beginFlush() {
    try {
      session.sendRealtimeInput({ audioStreamEnd: true });
    } catch {
      /* session already closed */
    }
    idleTimer = setTimeout(finish, FLUSH_IDLE_MS);
    maxTimer = setTimeout(finish, FLUSH_MAX_MS);
  }

  async function finish() {
    if (finished) return;
    finished = true;
    activeSessions--;
    clearTimeout(sessionTimer);
    clearTimeout(idleTimer);
    clearTimeout(maxTimer);
    try {
      session?.close();
    } catch {
      /* ignore */
    }

    // If the model never finalized the last segment, keep its latest interim hypothesis.
    if (interim) segments.push(interim);
    const text = segments.join(' ').replace(/\s+/g, ' ').trim();

    let record = null;
    if (text) {
      try {
        record = await createTranscription({
          text,
          language,
          source: 'live',
          durationSeconds: audioBytes / BYTES_PER_SECOND,
        });
      } catch (err) {
        console.error('Failed to save transcription:', err);
        send({ type: 'error', message: 'Transcription could not be saved.' });
      }
    }
    send({ type: 'saved', record, detectedLanguage });
    if (ws.readyState === ws.OPEN) ws.close(1000, 'done');
  }
}
