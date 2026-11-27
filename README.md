# Real-time Speech to Text

A web application that transcribes speech **in real time**, including speech that mixes **Hindi and English** (Hinglish) in the same sentence. Every transcription is stored in **PostgreSQL** and shown in a history dashboard with full **CRUD** (create, read, update, delete).

**Live demo:** https://realtime-speech-to-text-s5fj.onrender.com (free tier: the first load can take ~30–50 s while the instance wakes up; use Chrome or Edge and allow microphone access)

## Features

- **Live transcription:** words appear while you speak. Interim (in-progress) text is shown in grey and replaced by the final text when you pause.
- **Multilingual:** auto-detection or language hints for Hindi + English, Hindi only, or English only. Devanagari and Latin script both work, including mixed in one sentence.
- **Automatic saving:** when you stop recording, the transcript is saved to PostgreSQL along with its language and duration.
- **History dashboard:** search, pagination, add manual entries, inline edit (title, text, language), delete with confirmation, copy.
- **Text to speech:** a "Read aloud" button on each entry uses the browser's built-in Web Speech API, so no third-party service is needed. It picks a Hindi or English voice based on the script.
- **Secure by design:** the speech API key stays on the server. The browser only talks to this app's own WebSocket.
- Responsive layout, dark mode and accessible controls.

## Architecture

```
┌────────────── Browser (React) ──────────────┐
│ Microphone → AudioWorklet                   │
│   (resample to 16 kHz, 16-bit PCM, 100 ms)  │
│        │ binary frames   ▲ interim / final  │
└────────┼─────────────────┼──────────────────┘
         ▼   WebSocket     │   /ws/transcribe
┌────────────── Node.js (Express) ────────────┐        ┌─────────────────────────┐
│ live.js: one Gemini Live session per user ◄─┼──────► │ Gemini Live API         │
│   on stop: flush → save transcript          │        │ gemini-3.5-transcribe-  │
│ REST /api/transcriptions (CRUD)             │        │ live (streaming ASR)    │
│ serves the built React app                  │        └─────────────────────────┘
└────────┬────────────────────────────────────┘
         ▼
   PostgreSQL (transcriptions table)
```

**Why a server-side WebSocket bridge rather than calling the speech API from the browser?** The API key never reaches the client. The server controls session limits and concurrency. The transcript is saved by the server, even if the browser tab closes mid-recording.

## Tech stack

| Layer     | Technology                                                       |
| --------- | ---------------------------------------------------------------- |
| Frontend  | React 19, Vite, Web Audio API (AudioWorklet), Web Speech API     |
| Backend   | Node.js 22, Express 5, `ws` (WebSocket)                          |
| Speech    | Google Gemini Live API, `gemini-3.5-transcribe-live` model       |
| Database  | PostgreSQL (`pg`); Neon serverless Postgres in production        |
| Hosting   | Render (single web service: API + WebSocket + static frontend)  |

## Getting started

### Prerequisites

- Node.js 20 or newer
- A PostgreSQL database: local, or a free [Neon](https://neon.tech) project
- A Gemini API key: free at [Google AI Studio](https://aistudio.google.com/apikey)

### Setup

```bash
git clone https://github.com/AK261102/realtime-speech-to-text.git
cd realtime-speech-to-text
npm run install:all          # installs server + client dependencies
cp .env.example .env         # then fill in DATABASE_URL and GEMINI_API_KEY
```

The `transcriptions` table is created automatically on server start.

### Run in development

```bash
npm run dev:server           # API + WebSocket on http://localhost:3000
npm run dev:client           # React app on http://localhost:5173 (proxies /api and /ws)
```

Open http://localhost:5173 and allow microphone access.

### Run in production mode

```bash
npm run build                # builds the React app into client/dist
npm start                    # serves everything on http://localhost:3000
```

### Environment variables

| Variable                  | Required | Description                                                    |
| ------------------------- | -------- | -------------------------------------------------------------- |
| `DATABASE_URL`            | yes      | PostgreSQL connection string (`?sslmode=require` for Neon)     |
| `GEMINI_API_KEY`          | yes      | Gemini API key                                                 |
| `GEMINI_MODEL`            | no       | Live model, default `gemini-3.5-transcribe-live`               |
| `PORT`                    | no       | HTTP port, default `3000`                                      |
| `MAX_CONCURRENT_SESSIONS` | no       | Max simultaneous live recordings, default `10`                 |

## Database schema

```sql
CREATE TABLE transcriptions (
  id               SERIAL PRIMARY KEY,
  title            VARCHAR(200),
  text             TEXT        NOT NULL,
  language         VARCHAR(20) NOT NULL DEFAULT 'auto',  -- auto | hi-en | hi-IN | en-IN
  source           VARCHAR(20) NOT NULL DEFAULT 'live',  -- live | manual
  duration_seconds INTEGER,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

## REST API

| Method   | Endpoint                   | Description                                                   |
| -------- | -------------------------- | ------------------------------------------------------------- |
| `GET`    | `/api/transcriptions`      | List, newest first. Query: `search`, `limit` (≤100), `offset` |
| `GET`    | `/api/transcriptions/:id`  | Get one                                                       |
| `POST`   | `/api/transcriptions`      | Create: `{ text, title?, language? }`                         |
| `PUT`    | `/api/transcriptions/:id`  | Update: `{ text, title?, language? }`                         |
| `DELETE` | `/api/transcriptions/:id`  | Delete                                                        |
| `GET`    | `/api/health`              | Health check (includes database)                              |

Errors are returned as `{ "error": "message" }` with an appropriate status code (400, 404, 500).

## WebSocket protocol: `/ws/transcribe?language=auto|hi-en|hi-IN|en-IN`

| Direction       | Message                                     | Meaning                                         |
| --------------- | ------------------------------------------- | ----------------------------------------------- |
| client → server | binary frame                                | Raw PCM, 16-bit LE, mono, 16 kHz (~100 ms each) |
| client → server | `{"type":"stop"}`                           | Finish: flush audio, save, close                |
| server → client | `{"type":"ready"}`                          | Speech session open                             |
| server → client | `{"type":"interim","text"}`                 | Partial text of the segment being spoken        |
| server → client | `{"type":"final","text","languageCode"}`    | Finalized segment (append to transcript)        |
| server → client | `{"type":"saved","record"}`                 | Saved row (`null` if no speech was detected)    |
| server → client | `{"type":"error","message"}`                | Error description                               |

## Deployment (Render + Neon)

1. Create a free Neon project and copy its connection string.
2. On Render, choose **New → Blueprint** and select this repository. `render.yaml` defines the service.
3. Set `DATABASE_URL` and `GEMINI_API_KEY` when prompted, then deploy.

Render provides HTTPS, which browsers require for microphone access. The free instance sleeps when idle, so the first request after a while takes about 30 seconds.

## Project structure

```
├── server/
│   ├── index.js            # Express app, static hosting, error handling, startup
│   ├── db.js               # PostgreSQL pool + schema bootstrap
│   ├── transcriptions.js   # CRUD router + validation
│   └── live.js             # WebSocket ⇄ Gemini Live bridge
├── client/
│   ├── public/pcm-worklet.js         # mic → 16 kHz PCM16 resampler (AudioWorklet)
│   └── src/
│       ├── components/LiveTranscriber.jsx
│       ├── components/HistoryDashboard.jsx
│       └── lib/ (api.js, microphone.js, speech.js)
└── render.yaml
```

## Limitations and next steps

- A single recording is capped at about 9.5 minutes, because of the upstream live session limit. This could be lifted with session resumption.
- There is no user authentication, so all transcriptions are shared. Next steps would be adding auth and per-user history.
- A self-hosted open-source ASR model (e.g. Whisper via `faster-whisper`) could replace the Gemini backend behind the same WebSocket protocol, on a GPU host.
