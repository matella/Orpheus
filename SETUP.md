# Orpheus Setup Guide

Step-by-step instructions to get Orpheus running locally.

---

## Prerequisites

- **Node.js 24+** (required for built-in `node:sqlite`)
- **npm** (comes with Node.js)
- **Spotify Premium account** (required for playback control)
- **Flutter 3.5+** (for the client app — optional if you only want the server)
- **Ollama** (optional, for AI features)

### Verify Node.js version

```bash
node --version
# Must be v24.0.0 or higher
```

If you need to install/upgrade Node.js: https://nodejs.org/

---

## 1. Create a Spotify Developer App

1. Go to https://developer.spotify.com/dashboard
2. Log in with your Spotify account
3. Click **Create App**
4. Fill in:
   - **App name:** Orpheus (or anything you like)
   - **App description:** Autonomous music intelligence
   - **Redirect URI:** `http://127.0.0.1:3000/api/auth/callback`
   - **APIs used:** Check **Web API** and **Web Playback SDK**
5. Click **Save**
6. Open your app's settings and note the **Client ID** and **Client Secret**

> **Note:** Spotify requires HTTPS for redirect URIs except for loopback addresses (`127.0.0.1`). Do not use `localhost` — use `127.0.0.1` instead.

---

## 2. Configure the Server

```bash
cd server
npm install
```

Create your environment file:

```bash
cp .env.example .env
```

Edit `.env` with your Spotify credentials:

```env
# Required
SPOTIFY_CLIENT_ID=your_client_id_here
SPOTIFY_CLIENT_SECRET=your_client_secret_here
SPOTIFY_REDIRECT_URI=http://127.0.0.1:3000/api/auth/callback

# Server (defaults are fine for local development)
PORT=3000
HOST=0.0.0.0

# Database (auto-created on first run)
DB_PATH=./data/orpheus.db

# Logging (options: fatal, error, warn, info, debug, trace)
LOG_LEVEL=info
```

### Environment Variable Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SPOTIFY_CLIENT_ID` | Yes | — | From Spotify Developer Dashboard |
| `SPOTIFY_CLIENT_SECRET` | Yes | — | From Spotify Developer Dashboard |
| `SPOTIFY_REDIRECT_URI` | No | `http://127.0.0.1:3000/api/auth/callback` | Must match Spotify app settings |
| `PORT` | No | `3000` | Server port |
| `HOST` | No | `0.0.0.0` | Server bind address |
| `DB_PATH` | No | `./data/orpheus.db` | SQLite database file path |
| `LOG_LEVEL` | No | `info` | Pino log level |
| `AI_ENABLED` | No | `true` | Set to `false` to disable AI features |
| `OLLAMA_HOST` | No | `http://localhost:11434` | Ollama server URL |
| `OLLAMA_MODEL` | No | `llama3.2` | Ollama model to use |

---

## 3. Start the Server

```bash
cd server
npm run dev
```

This runs `tsx` with the required `--experimental-sqlite` flag in watch mode. You should see:

```
  ♪ ORPHEUS — Autonomous Music Intelligence

[info] Checking database schema
[info] Database schema up to date
[info] Orpheus server listening { port: 3000, host: '0.0.0.0' }
[info] Orpheus is ready
```

The database and `data/` directory are created automatically on first run.

### Verify the server is running

```bash
curl http://127.0.0.1:3000/api/health
# {"status":"ok","service":"orpheus","timestamp":"..."}
```

---

## 4. Authenticate with Spotify

1. Open your browser and go to:
   ```
   http://127.0.0.1:3000/api/auth/login
   ```
2. This redirects you to Spotify's authorization page
3. Click **Agree** to grant Orpheus access
4. You'll be redirected back to `http://127.0.0.1:3000/api/auth/callback`
5. The server stores your access and refresh tokens in the database

### Verify authentication

```bash
curl http://127.0.0.1:3000/api/auth/status
# {"authenticated":true,"user":{...}}
```

---

## 5. Set Up the Flutter Client

```bash
cd client
flutter pub get
```

### Configure the API URL

Edit `client/lib/config/constants.dart` if your server is running on a different host/port:

```dart
const apiBaseUrl = 'http://localhost:3000/api';
const wsBaseUrl = 'ws://localhost:3000/ws';
```

If running on a physical device, use your machine's local IP address instead of `localhost`.

### Run the client

```bash
flutter run
```

Or for specific platforms:

```bash
flutter run -d chrome     # Web
flutter run -d windows    # Windows desktop
flutter run -d macos      # macOS desktop
flutter run -d linux      # Linux desktop
```

---

## 6. Set Up Ollama (Optional)

Ollama enables AI features: session naming, monthly recaps, context inference, and advisory suggestions. Orpheus works without it — AI features simply become no-ops.

### Install Ollama

Download from https://ollama.com/ and install for your platform.

### Pull the default model

```bash
ollama pull llama3.2
```

### Start Ollama

```bash
ollama serve
```

Ollama runs on port 11434 by default, which matches Orpheus's default configuration.

### Verify Ollama is reachable

```bash
curl http://localhost:11434/api/tags
```

### Using a different model

You can use any Ollama model. Set the `OLLAMA_MODEL` environment variable:

```env
OLLAMA_MODEL=mistral
```

Smaller models (like `llama3.2` at ~2GB) are recommended for fast response times. Orpheus uses structured JSON prompts that work well with most instruction-tuned models.

---

## 7. Start Listening

1. Open Spotify on any device and start playing something (this activates a playback device)
2. In the Orpheus client, go to the **Home** screen
3. Tap **Start Engine** — Orpheus takes over playback
4. Use the **steering sliders** to guide the direction (energy, mood, familiarity, etc.)
5. Use **like/dislike** buttons to give feedback — Orpheus learns from every interaction

### How the engine works

- If Spotify is already playing when you start the engine, Orpheus analyzes the current queue and seamlessly adopts it if the tracks are coherent with your listening profile
- Otherwise, Orpheus creates a new session and begins selecting tracks
- It polls Spotify every few seconds to detect skips, completions, and pauses
- Each track completion or skip updates your preference scores and shifts the state vector
- When you stop the engine, the session ends and (if AI is enabled) a session name and recap are generated

---

## Scheduled Tasks

Orpheus runs several background tasks automatically:

| Task | Schedule | Description |
|------|----------|-------------|
| Library Sync | Every 6 hours | Syncs your Spotify library and fetches audio features |
| Player Poll | Every 5 seconds | Checks current playback state for skip/completion detection |
| Analytics Compute | Midnight daily | Precomputes analytics cache for the dashboard |
| Monthly Recap | 6 AM on the 1st | Generates AI monthly listening recap (if AI enabled) |

---

## Troubleshooting

### "SPOTIFY_CLIENT_ID is required"

Your `.env` file is missing or the credentials are empty. Make sure you copied `.env.example` to `.env` and filled in your Spotify app credentials.

### "node:sqlite" errors

You need Node.js 24 or later. The `node:sqlite` module is built-in starting from Node 24. Check with `node --version`.

### Server starts but auth fails

Make sure the redirect URI in your Spotify Developer Dashboard exactly matches `SPOTIFY_REDIRECT_URI` in your `.env` file. The default is `http://127.0.0.1:3000/api/auth/callback`. Spotify requires `127.0.0.1` (not `localhost`) for local development.

### Playback doesn't start

Spotify requires an active device. Open Spotify on your phone, desktop, or web player and play/pause a track first. Then try starting the Orpheus engine.

### AI features not working

- Check that Ollama is running: `curl http://localhost:11434/api/tags`
- Check the model is pulled: `ollama list`
- Check server logs for Ollama connection errors
- AI features degrade gracefully — the system works fine without them

### Flutter build errors

Make sure your Flutter SDK is 3.5+:

```bash
flutter --version
flutter doctor
```

### Database issues

The SQLite database is created automatically. If you need to start fresh, stop the server and delete the database file:

```bash
rm server/data/orpheus.db
```

The schema will be recreated on next startup.

---

## Production Build

### Server

```bash
cd server
npm run build
node --experimental-sqlite dist/index.js
```

### Client

```bash
cd client
flutter build web       # Web
flutter build windows   # Windows
flutter build apk       # Android
```

---

## Docker Deployment

You can run the full Orpheus stack with Docker Compose instead of installing Node.js and Flutter locally.

### Prerequisites

- **Docker** 24+ and **Docker Compose** v2
- A `server/.env` file with your Spotify credentials (see step 2 above)

### Quick start

```bash
# Server + Client only
docker compose up --build

# Server + Client + Ollama AI
docker compose --profile ai up --build
```

### Pull the AI model (if using Ollama)

```bash
docker exec orpheus-ollama ollama pull llama3.2
```

### Access

| Service | URL |
|---------|-----|
| Client (Flutter web) | http://localhost |
| Server API | http://localhost:3000/api |
| Ollama | http://localhost:11434 |

The client's nginx server reverse-proxies `/api` and `/ws` requests to the server container, so everything works from a single origin.

### Data persistence

- **SQLite database:** stored in the `server-data` Docker volume
- **Ollama models:** stored in the `ollama-data` Docker volume

To reset the database:

```bash
docker compose down
docker volume rm music_server-data
docker compose up --build
```
