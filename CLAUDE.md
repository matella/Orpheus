# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Server (Node.js)
```bash
cd server
npm run dev          # Start dev server (tsx + watch + --experimental-sqlite)
npm run build        # Compile TypeScript (tsc)
npm run start        # Run compiled JS (node --experimental-sqlite dist/index.js)
npm run test         # Run tests (vitest run)
npm run test:watch   # Watch mode tests (vitest)
```

### Client (Flutter)
```bash
cd client
flutter pub get      # Install dependencies
flutter run          # Run on default device
flutter run -d chrome    # Web
flutter run -d windows   # Windows desktop
dart run build_runner build --delete-conflicting-outputs  # Generate freezed/riverpod code
```

### Ollama (optional AI)
```bash
ollama serve         # Start local LLM server (port 11434)
ollama pull llama3.2 # Pull default model
```

### Docker
```bash
docker compose up --build                  # Server + Client
docker compose --profile ai up --build     # Server + Client + Ollama
```

### Kubernetes (k3s + Helm)
```bash
helm install orpheus ./helm/orpheus -f values-local.yaml    # Deploy
helm upgrade orpheus ./helm/orpheus -f values-local.yaml    # Upgrade
helm uninstall orpheus                                       # Remove
```

## Architecture

**Orpheus** is an autonomous music system: Node.js server controls Spotify playback, a Flutter client provides the UI, and an optional Ollama LLM adds reasoning.

### Server (`server/src/`)

Entry point: `index.ts` — initializes DB, starts Fastify server, registers cron tasks.

**Layered architecture:**
- **API** (`api/`) — Fastify routes grouped by domain (auth, playback, steering, sessions, analytics, feedback, context, ai, settings, playlists). WebSocket for real-time push.
- **Playback Engine** (`playback/engine.ts`) — Core loop polling Spotify every 5s. Extends EventEmitter (`track_changed`, `session_started`, `session_ended`, `state_updated`, `transition_complete`). Manages session lifecycle. Supports graceful startup — adopts current Spotify playback and queue when coherent.
- **Intelligence Pipeline** (`intelligence/`) — The track selection brain:
  - `state-vector.ts` — 8D state (energy, valence, tempo, genre, familiarity, vocalness, aggressiveness, fatigue) updated via EMA (alpha=0.2). Skips null audio features.
  - `selector.ts` — Orchestrator: state → steering blend → candidate pool → score → weighted random pick from top 3
  - `scorer.ts` — 8-dimension scoring: stateSimilarity(20%), genre(15%), preference(15%), transition(15%), novelty(10%), fatigue(10%), context(10%), recency(5%)
  - `steering.ts` — 7-axis user controls blended 40% into target state
  - `candidate-pool.ts` — Filters library by energy/genre/tempo proximity, excludes recent tracks/artists
  - `feedback.ts` — Like/dislike/skip → preference score adjustments
  - `context-learning.ts` — Learns time-of-day patterns across sessions
  - `coherence.ts` — Queue coherence analysis for graceful startup
  - `request-handler.ts` — Natural language music request processing
  - `playlist-generator.ts` — AI-enhanced playlist generation: prompt parsing → candidate pool → per-segment scoring → transition ordering → Spotify export
- **Spotify** (`spotify/`) — PKCE OAuth, SDK wrapper, library sync, player control
- **AI** (`ai/`) — Ollama client with structured JSON prompts and three-level system prompt architecture (`full`/`light`/`minimal`). Knowledge module (`knowledge.ts`) loads genre aliases and mood mappings from `data/` at startup, gathers RAG context from DB per-call, and builds modular system prompts. Functions: session naming, recaps, monthly recaps, context inference, weight suggestions, playlist prompt parsing, playlist naming. All fire-and-forget; never blocks playback.
- **Database** (`database/`) — `node:sqlite` (Node 24 built-in), WAL mode, 5 migration versions. 13 repository classes for data access. Uses SAVEPOINT transactions for batch operations (node:sqlite lacks db.transaction()).
- **Scheduler** (`scheduler/`) — Cron tasks: library sync (6h), player poll (5s), analytics compute (midnight), monthly recap (1st of month)

**Key patterns:**
- Singletons exported directly (`export const engine = new PlaybackEngine()`) — no DI container
- Error hierarchy: `OrpheusError` base → `SpotifyAuthError`, `SpotifyApiError`, `PlaybackError`, `DatabaseError`, `AiError`
- Config validated via Zod schema (`config.ts`)
- ESM throughout (`"type": "module"` in package.json)
- Graceful startup: engine checks current Spotify playback, analyzes queue coherence, adopts coherent tracks without interrupting
- SAVEPOINT transactions for batch DB operations (node:sqlite lacks `db.transaction()`)

### Client (`client/lib/`)

Entry point: `main.dart` — wraps app in Riverpod `ProviderScope`.

- **State:** Riverpod providers (`session_provider.dart`, `steering_provider.dart`, `playlist_provider.dart`). Steering uses 300ms debounced API sync with optimistic local updates.
- **Services:** `api_service.dart` (Dio HTTP to `127.0.0.1:3000/api`), `websocket_service.dart` (auto-reconnect WS)
- **Routing:** `go_router` with `ShellRoute` for persistent bottom nav. Auth screen is outside the shell.
- **Theme** (`config/theme.dart`): Dark theme with Lyre Gold (#D4A843) accent. Typography: Cinzel for headings, Inter for body, JetBrains Mono for data values.
- **Screens:** Home (now playing + controls + playlist FAB), Session (history + energy curves), Analytics (charts), Intelligence (AI insights), Settings, Playlist (generation form + result view), Auth

## Critical Constraints

- **Node 24+ required** — uses `node:sqlite` (built-in). The `--experimental-sqlite` flag is mandatory. `better-sqlite3` does not work on this machine.
- **Spotify redirect URI must use `127.0.0.1`** not `localhost` — Spotify requires this for local loopback.
- **Flutter SDK is NOT installed** on this machine — client files are created/edited manually. Do not run `flutter` commands.
- **AI is optional** — all Ollama features degrade gracefully to no-ops. Never make AI a hard dependency.
- **ESM only** — use `import`/`export`, not `require`. File extensions in imports follow Node16 module resolution.

## Environment

Server `.env` requires `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET`. See `server/.env.example` for all variables. DB auto-creates at `server/data/orpheus.db`.
