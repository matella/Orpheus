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
# Tests use an in-memory DB (tests/helpers/db.ts); vitest.config.ts sets dummy Spotify env vars
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
- **API** (`api/`) — Fastify routes grouped by domain (auth, playback, steering, sessions, analytics, feedback, context, ai, settings, playlists, dj, tts, library, genre-playlists). WebSocket for real-time push. TTS routes: `GET /api/tts/speak?text=`, `GET /api/tts/voices`, `POST /api/tts/preview`, `PUT /api/tts/settings`. All return 503 when Piper not installed. Genre playlist routes: `GET /api/library/genres`, `POST /api/library/genres/sync`, `GET /api/library/artists?q=`, `GET /api/library/artists/:artistId/liked-tracks`, `POST /api/genre-playlists/preview`, `POST /api/genre-playlists/order`, `POST /api/genre-playlists/export`.
- **Playback Engine** (`playback/engine.ts`) — Core loop polling Spotify every 5s. Extends EventEmitter (`track_changed`, `session_started`, `session_ended`, `state_updated`, `transition_complete`, `curator_update`, `curator_fallback`, `curator_restored`). Manages session lifecycle. Supports graceful startup — adopts current Spotify playback and queue when coherent. Proactive curator trigger fires when < 30s of audio remains.
- **Intelligence Pipeline** (`intelligence/`) — The track selection brain:
  - `state-vector.ts` — 8D state (energy, valence, tempo, genre, familiarity, vocalness, aggressiveness, fatigue) updated via EMA (alpha=0.2). Skips null audio features.
  - `selector.ts` — Orchestrator: state → steering blend → candidate pool → score → weighted random pick from top 3. Manages `targetGenre` and `targetArtist` locks (session-scoped, cleared on session end)
  - `scorer.ts` — 8-dimension scoring: stateSimilarity(20%), genre(15%), preference(15%), transition(15%), novelty(10%), fatigue(10%), context(10%), recency(5%). Artist lock applies 1.5x/0.4x multiplier on final score
  - `steering.ts` — 7-axis user controls blended 40% into target state
  - `candidate-pool.ts` — Filters library by energy/genre/tempo proximity, excludes recent tracks/artists. Artist lock pre-filters to same-artist candidates when available
  - `feedback.ts` — Like/dislike/skip → preference score adjustments
  - `context-learning.ts` — Learns time-of-day patterns across sessions
  - `coherence.ts` — Queue coherence analysis for graceful startup
  - `request-handler.ts` — Natural language music request processing
  - `playlist-generator.ts` — AI-enhanced playlist generation: prompt parsing → candidate pool → per-segment scoring → transition ordering → Spotify export
  - `genre-families.ts` — Loads `data/genre_families.json`; `classifyGenre()` maps a Spotify genre to the first family whose pattern it contains, else `other`.
  - `genre-playlist.ts` — Genre builder service: family/sub-genre counts over Liked Songs, uncapped preview filter (a track's genres = union over all its artists; AI genre only as fallback), smooth ordering via `track-ordering.ts`.
  - `track-ordering.ts` — `greedyNearestNeighbor` / `transitionCost`, shared by the generator and the genre builder.
  - `curator.ts` — DJ curator orchestrator: calls LLM to pick 3 tracks + patter text. Handles proactive/session-start/steering/rapid-skip triggers, spam-skip detection, fallback mode with 2-min retry, steering debounce (5s). Singleton `curator`. External picks (Spotify IDs, non-integer) are resolved via `_resolveExternalTrack()`: DB lookup, upsert if new, fetch+store audio features. Backfill skips external candidates.
  - `listener-context.ts` — Assembles LLM context (top artists/genres, steering state, DJ prefs, recently played, time-of-day phrase)
  - `pool-builder.ts` — Builds 40–60 track candidate pool at configured library/similar/discovery ratios. Ratios adjusted for steering genreOpenness. Uses appetite ratios: comfort 65/25/10, balanced 50/35/15, adventurous 40/30/30. Similar bucket: Spotify Recommendations API seeded by current track + artist. Discovery bucket: Spotify Recommendations API seeded by diverse top artists. Both fall back to local DB filter on API error/empty.
- **Spotify** (`spotify/`) — PKCE OAuth, SDK wrapper, library sync, player control. `recommendations.ts` wraps `GET /recommendations` and `GET /audio-features` for external track discovery. Playlists use `POST /me/playlists` and `POST /playlists/{id}/items` (Feb 2026 API). `artist-genre-sync.ts` fetches genres one artist at a time (`GET /artists/{id}`), throttled ~5 req/s, 4-min budget per cron run, resumable, emits `genre_sync_progress`. Saved-tracks sync stores `liked_at` and all track artists, and clears `liked_at` for un-liked tracks after a complete pass.
- **AI** (`ai/`) — Ollama client with structured JSON prompts and three-level system prompt architecture (`full`/`light`/`minimal`). Knowledge module (`knowledge.ts`) loads genre aliases and mood mappings from `data/` at startup, gathers RAG context from DB per-call, and builds modular system prompts. Functions: session naming, recaps, monthly recaps, context inference, weight suggestions, playlist prompt parsing, playlist naming, genre inference, **DJ curation** (schema-constrained `/api/chat` via `generateChat<T>()`). All fire-and-forget; never blocks playback.
  - `personas.ts` — 4 preset DJ personas (curator, late_night, hype, chill) + custom slot. `buildPersonaSystemPrompt()` assembles the full system prompt including steering description.
  - `prompts.ts` — `CurationResult` / `CuratorPick` / `CandidateTrack` types; `CURATION_RESULT_SCHEMA` (JSON Schema for Ollama format constraint); `buildCuratorUserMessage()`.
  - `ollama.ts` — `generateJson()` (existing, `/api/generate`) + `generateChat<T>()` (new, `/api/chat` + JSON Schema format).
- **TTS** (`tts/`) — Piper TTS integration for DJ voice audio:
  - `adapter.ts` — `TtsAdapter` interface: `speak(text, voiceId?)`, `listVoices()`, `isAvailable()`
  - `piper.ts` — `PiperAdapter` singleton. Spawns `piper.exe` as subprocess (stdin←text, stdout→WAV). 10s timeout with `settled` flag to prevent double-reject. `isAvailable()` checks `PIPER_BINARY_PATH` exists. Throws `AiError` on failure.
- **Database** (`database/`) — `node:sqlite` (Node 24 built-in), WAL mode, **9 migration versions** (v7: `dj_preferences` table; v8: `tts_enabled`, `tts_voice`, `tts_duck_volume` columns; v9: `tracks.liked_at`, `tracks.features_source`, `artists`, `artist_genres`, `track_artists`). 16 repository modules. `runMigrations(db, targetVersion?)` lets tests build older schemas. Uses SAVEPOINT transactions for batch operations (node:sqlite lacks db.transaction()).
- **Scheduler** (`scheduler/`) — Cron tasks: library sync (6h), player poll (5s), analytics compute (midnight), monthly recap (1st of month), AI genre inference (6h at :30)

**Key patterns:**
- Singletons exported directly (`export const engine = new PlaybackEngine()`) — no DI container
- Error hierarchy: `OrpheusError` base → `SpotifyAuthError`, `SpotifyApiError`, `PlaybackError`, `DatabaseError`, `AiError`
- Config validated via Zod schema (`config.ts`)
- ESM throughout (`"type": "module"` in package.json)
- Graceful startup: engine checks current Spotify playback, analyzes queue coherence, adopts coherent tracks without interrupting
- SAVEPOINT transactions for batch DB operations (node:sqlite lacks `db.transaction()`)

### Client (`client/lib/`)

Entry point: `main.dart` — wraps app in Riverpod `ProviderScope`.

- **State:** Riverpod providers (`session_provider.dart`, `steering_provider.dart`, `playlist_provider.dart`, `dj_provider.dart`). Steering uses 300ms debounced API sync with optimistic local updates. DJ provider loads preferences on init, handles curator WS events (`onCuratorUpdate`, `onCuratorFallback`, `onCuratorRestored`).
- **Services:** `api_service.dart` (Dio HTTP to `127.0.0.1:3000/api`), `websocket_service.dart` (auto-reconnect WS)
- **Routing:** `go_router` with `ShellRoute` for persistent bottom nav. Auth and onboarding screens are outside the shell. Redirect guard checks auth then onboarding completion; `markOnboardingDone()` busts the cached check after the wizard completes.
- **Theme** (`config/theme.dart`): Dark theme with Lyre Gold (#D4A843) accent. Typography: Cinzel for headings, Inter for body, JetBrains Mono for data values. `OrpheusTypography` class provides static `TextStyle` getters for use outside `BuildContext`.
- **Screens:** Home (now playing + DJ patter banner + pick reason + Up Next queue + persona chip), Session (history + energy curves), Analytics (charts), Intelligence (AI insights), Settings (includes DJ Personality + DJ Voice sections), Playlist ("From a prompt" generation form + result view, or "By genre" builder: `widgets/genre_builder/`, side panel ≥ 700 px, stacked below; state in `genre_builder_provider.dart`, pure derivation in `models/genre_builder_models.dart`), Auth, Onboarding (3-step wizard: appetite → chattiness → persona)
- **Services:** `tts_service.dart` — `TtsService` singleton with `speakPatter(text, duckVolume)`. Lifecycle: read current volume → duck → fetch WAV via `apiService.fetchTtsAudio()` → play via `just_audio` → restore volume (in `finally`). `_speaking` flag prevents overlapping playback.

## Critical Constraints

- **Node 24+ required** — uses `node:sqlite` (built-in). The `--experimental-sqlite` flag is mandatory. `better-sqlite3` does not work on this machine.
- **Spotify redirect URI must use `127.0.0.1`** not `localhost` — Spotify requires this for local loopback.
- **Flutter SDK** lives at `/Users/matella/Coding/SDK/flutter` (not on PATH — call `/Users/matella/Coding/SDK/flutter/bin/flutter`). Use it for `flutter analyze` / `flutter test` / `flutter run -d chrome`. Android/Xcode toolchains are not installed.
- **AI is optional** — all Ollama features degrade gracefully to no-ops. Never make AI a hard dependency.
- **ESM only** — use `import`/`export`, not `require`. File extensions in imports follow Node16 module resolution.

## Environment

Server `.env` requires `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET`. See `server/.env.example` for all variables. DB auto-creates at `server/data/orpheus.db`.
