# Orpheus

**Autonomous Adaptive Music Intelligence System**

Orpheus is a self-driving music system that connects to your Spotify account and learns how you listen. It observes your skips, completions, and feedback to build a continuous model of your preferences, then autonomously selects tracks that match your current mood, time of day, and listening context. An optional AI layer powered by Ollama provides session naming, monthly listening recaps, and natural-language reasoning about what to play next.

---

## How It Works

Orpheus runs as a local server that controls Spotify playback on your behalf. When a session starts, the system:

1. **Infers initial state** from time-of-day preferences, recent history, and (optionally) an LLM context inference
2. **Builds a candidate pool** from your cached Spotify library, filtering by energy, genre, tempo, and recency
3. **Scores candidates** against the current state vector using a weighted multi-dimensional distance function
4. **Selects a track** via weighted random sampling (top candidates weighted by inverse distance)
5. **Observes your response** — completions, skips, likes, dislikes — and blends feedback into the state using exponential moving averages
6. **Repeats** — each track shifts the state, and the next selection adapts accordingly

The result is a continuously adapting stream of music that responds to you in real time without requiring manual playlist curation.

---

## Architecture

```
Flutter Client (Dart)          Node.js Server (TypeScript)
+-----------------+            +---------------------------+
| Screens         |  REST/WS   | Fastify API               |
|   Home          | <--------> |   Auth, Playback, Steering |
|   Session       |            |   Sessions, Analytics, AI  |
|   Analytics     |            +---------------------------+
|   Intelligence  |            | Intelligence Pipeline      |
|   Settings      |            |   State Vector -> Steering |
+-----------------+            |   Candidate Pool -> Scorer |
                               |   -> Weighted Selection    |
                               +---------------------------+
                               | Playback Engine            |
                               |   Spotify Web API control  |
                               |   Session lifecycle mgmt   |
                               +---------------------------+
                               | SQLite (node:sqlite)       |
                               |   Tracks, Interactions,    |
                               |   Preferences, Sessions,   |
                               |   State History, Analytics |
                               +---------------------------+
                               | AI Knowledge (RAG)         |
                               |   Genre aliases, mood maps |
                               |   Library context injection|
                               +---------------------------+
                               | Ollama (optional)          |
                               |   Session naming, recaps,  |
                               |   context inference        |
                               +---------------------------+
```

### Server (`server/`)

- **Runtime:** Node.js 24+ with built-in `node:sqlite`
- **Framework:** Fastify 5 with CORS, WebSocket support
- **Language:** TypeScript (ESM)
- **Database:** SQLite via `node:sqlite` (zero native dependencies)
- **Spotify:** Official `@spotify/web-api-ts-sdk` with PKCE auth flow
- **AI:** Ollama REST client (optional, graceful degradation)
- **Scheduler:** `node-cron` for periodic tasks
- **Validation:** Zod for config and request schemas
- **Logging:** Pino with pretty-print

### Client (`client/`)

- **Framework:** Flutter 3.5+
- **State Management:** Riverpod
- **HTTP:** Dio
- **Real-time:** WebSocket via `web_socket_channel`
- **Charts:** fl_chart
- **Routing:** go_router with shell navigation
- **SVG:** flutter_svg for Spotify brand assets
- **Design:** Custom dark theme, Lyre Gold (#D4A843) accents, Cinzel headings, Inter body text, JetBrains Mono for data
- **Accessibility:** Semantics widgets, Tooltips, semantic slider formatters, WCAG AA contrast compliance
- **Branding:** Spotify attribution (icon + text) on all metadata screens per Developer Terms

---

## Features

### Spotify Integration
- PKCE authorization flow (no server-side secret exposure in redirects)
- Full library sync with audio feature caching (energy, valence, tempo, danceability, etc.)
- Playback control: play, pause, skip, resume, device selection
- Background polling to track what's currently playing

### Intelligence Pipeline
- **State Vector:** 8-dimensional representation of current listening context (energy, valence, tempo, genre, familiarity, vocalness, aggressiveness, fatigue)
- **EMA Blending:** New observations blend into the state via exponential moving average (alpha = 0.2). Null audio features are skipped to prevent state drift.
- **Steering Controls:** User-adjustable sliders that bias the candidate scoring (energy, mood, familiarity, vocal preference, aggressiveness, genre openness, focus/party)
- **Candidate Pool:** Genre-filtered, energy-windowed subset of cached tracks with recency penalties
- **Scorer:** Multi-dimensional distance with configurable weights per attribute
- **Coherence Analysis:** Evaluates queue coherence against the intelligence pipeline state for graceful startup decisions
- **Natural Language Requests:** Process requests like "play something energetic" via LLM-guided library search
- **Weighted Random:** Top 3 candidates selected probabilistically by inverse distance (avoids always picking the same "best" track)

### Genre & Artist Lock
- Interactive lock chips in the flow indicator — tap to pin playback to the current genre or artist
- Genre chip shows the current dominant genre (e.g., "ELECTRONIC"), artist chip shows the current artist
- Locked state: gold border + closed lock icon; unlocked: muted border + open lock icon
- Genre lock uses the `targetGenre` mechanism (hard override in scorer and candidate pool)
- Artist lock uses a new `targetArtist` mechanism with scoring multiplier and candidate pre-filtering
- AI prompt integration: phrases like "only play kpop" or "just Daft Punk" auto-activate the corresponding lock
- Genre Openness slider auto-disables when genre is locked
- All locks clear automatically when the session ends

### Feedback & Learning
- Like/dislike buttons with immediate preference score adjustment
- Skip detection with partial-listen analysis
- Completion tracking with preference reinforcement
- Time-of-day preference learning (incremental averaging across sessions)
- Per-track familiarity scoring that evolves with play count

### Graceful Startup
- Engine detects current Spotify playback on start — never interrupts what's already playing
- Analyzes the existing Spotify queue for coherence against the intelligence pipeline
- Adopts coherent tracks seamlessly, seeding state from the adopted queue
- Takes over after the current track if the queue is incoherent

### Automation
- Auto-start: configurable delay before engine begins playback
- Quiet hours: suppresses auto-start during specified hours
- Configurable via settings API and client UI

### Session Management
- Automatic session lifecycle (start on play, end on stop)
- Session history with energy curves, track lists, and state snapshots
- AI-generated session names (post-session)
- AI-generated session recaps (narrative summary of what was played and why)

### Analytics Dashboard
- Total listening time, tracks played, skip rate, completion rate, discovery rate
- Genre distribution (pie chart)
- Daily energy trends (line chart)
- Listening hours heatmap (24-hour bar chart)
- Top tracks by play count
- Daily sparklines for quick trend visualization
- Comprehensive listening stats combining Orpheus and Spotify data

### Playlist Generation
- AI-enhanced playlist creation from natural language prompts ("chill jazz for a long flight", "high energy workout mix")
- Configurable parameters: duration (5–180 min), discovery rate (0–100% new songs), energy arc (steady, build up, wind down, peak & fade), transition smoothness, max tracks per artist, source preference (library only or library + Spotify discovery)
- Reuses the full 8-dimension scoring pipeline — candidates scored per energy arc segment with synthetic scoring contexts
- Greedy nearest-neighbor track ordering for smooth transitions (BPM, energy, valence, key compatibility)
- Optional seed track anchoring from currently playing track
- AI prompt parsing extracts artists, genres, moods, BPM range from natural language (keyword fallback when AI unavailable)
- AI-generated creative playlist names and descriptions
- Automatic Spotify playlist creation and track population
- Real-time WebSocket progress events during generation
- Playlist history with full track lists, scores, and metadata

### AI Integration (Optional)
- Powered by Ollama running locally (default model: llama3.2)
- **Rich System Prompt:** Three-level system prompt architecture (`full`/`light`/`minimal`) with music expert persona, genre normalization, mood mappings, and output format rules
- **RAG Context Injection:** Full-level prompts include the user's actual library stats — top genres, favorite artists, preferred tracks, listening hours, discovery rate, and time-of-day patterns
- **Genre Aliases:** Extensible `genre_aliases.json` (~40 canonical genres with aliases) loaded at startup; normalizes variant spellings (e.g., "kpop" → "k-pop") across AI and keyword parsers
- **Mood Mappings:** Extensible `mood_mappings.json` (~13 moods mapped to genres + energy/valence ranges) for mood-to-music translation
- **Session Naming:** LLM generates evocative session names from track lists
- **Session Recaps:** Narrative summaries of each listening session
- **Monthly Recaps:** End-of-month listening personality analysis with stats
- **Context Inference:** LLM suggests initial state values based on time, weather context, and recent patterns
- **Advisory Suggestions:** Periodic in-session analysis recommending energy/genre shifts
- **Playlist Prompt Parsing:** Extracts structured parameters from natural language playlist descriptions
- **Playlist Naming:** Generates creative 2–5 word names and descriptions for generated playlists
- Graceful degradation: all AI features are no-ops when Ollama is unavailable

### Real-time Updates
- WebSocket push for playback state changes, track transitions, AI events
- Client receives live updates without polling

---

## API Endpoints

All routes are prefixed with `/api`.

| Group | Endpoint | Method | Description |
|-------|----------|--------|-------------|
| Health | `/health` | GET | Server health check |
| Auth | `/auth/status` | GET | Authentication status |
| Auth | `/auth/login` | GET | Get Spotify auth URL |
| Auth | `/auth/callback` | GET | OAuth callback handler |
| Playback | `/playback/current` | GET | Current playback state |
| Playback | `/playback/start` | POST | Start the engine |
| Playback | `/playback/stop` | POST | Stop the engine |
| Playback | `/playback/skip` | POST | Skip current track |
| Playback | `/playback/pause` | POST | Pause playback |
| Playback | `/playback/resume` | POST | Resume playback |
| Playback | `/playback/previous` | POST | Play previous track |
| Playback | `/playback/devices` | GET | Available Spotify devices |
| Playback | `/playback/request` | POST | Natural language music request |
| Steering | `/steering` | GET | Current steering values |
| Steering | `/steering` | PUT | Update steering controls |
| Steering | `/steering/target-genre` | GET | Get genre lock state |
| Steering | `/steering/target-genre` | PUT | Lock to a genre |
| Steering | `/steering/target-genre` | DELETE | Clear genre lock |
| Steering | `/steering/target-artist` | GET | Get artist lock state |
| Steering | `/steering/target-artist` | PUT | Lock to an artist |
| Steering | `/steering/target-artist` | DELETE | Clear artist lock |
| Feedback | `/feedback/like` | POST | Like current track |
| Feedback | `/feedback/dislike` | POST | Dislike current track |
| Sessions | `/sessions` | GET | Paginated session history |
| Sessions | `/sessions/active` | GET | Active session with tracks |
| Sessions | `/sessions/:id` | GET | Session detail by ID |
| Analytics | `/analytics/overview` | GET | Aggregate stats (cached) |
| Analytics | `/analytics/genres` | GET | Genre distribution |
| Analytics | `/analytics/energy` | GET | Daily energy trends |
| Analytics | `/analytics/hours` | GET | Listening hours heatmap |
| Analytics | `/analytics/top-tracks` | GET | Top tracks by plays |
| Analytics | `/analytics/daily` | GET | Daily listening totals |
| Analytics | `/analytics/listening-stats` | GET | Combined listening statistics |
| Settings | `/settings` | GET | All settings |
| Settings | `/settings` | PUT | Update settings |
| Context | `/context/state` | GET | Current intelligence state |
| Context | `/context/time-preferences` | GET | Learned time preferences |
| AI | `/ai/status` | GET | AI system status |
| AI | `/ai/suggestions` | GET | AI suggestion history |
| AI | `/ai/analyze` | POST | Trigger AI analysis |
| AI | `/ai/recaps` | GET | All monthly recaps |
| AI | `/ai/recaps` | POST | Generate monthly recap |
| AI | `/ai/infer` | POST | AI context inference |
| Playlists | `/playlists/generate` | POST | Generate AI-enhanced playlist |
| Playlists | `/playlists` | GET | List playlist history (paginated) |
| Playlists | `/playlists/:id` | GET | Get playlist with tracks |
| Playlists | `/playlists/:id` | DELETE | Delete playlist from local DB |
| WebSocket | `/ws` | WS | Real-time event stream |

---

## Project Structure

```
Music/
  server/
    src/
      ai/                    # Ollama client, prompts, AI service, knowledge/RAG
      api/
        middleware/           # Error handler
        routes/               # auth, playback, steering, sessions,
                              # analytics, settings, context, ai, playlist
        server.ts             # Fastify setup and route registration
        websocket.ts          # WebSocket broadcast infrastructure
      database/
        connection.ts         # SQLite connection (node:sqlite)
        migrations.ts         # Schema v1-v5
        repositories/         # track, interaction, session, preference,
                              # state-history, analytics, settings,
                              # time-preferences, ai-suggestion,
                              # monthly-recap, listening-stats, top-artists,
                              # playlist
        types.ts              # Row type interfaces
      intelligence/
        state-vector.ts       # 8D state with EMA blending
        steering.ts           # User steering control application
        candidate-pool.ts     # Genre/energy/recency filtering
        scorer.ts             # Multi-dimensional distance scoring
        selector.ts           # Pipeline coordinator
        feedback.ts           # Like/dislike/skip processing
        context-learning.ts   # Time-of-day preference learning
        coherence.ts          # Queue coherence analysis
        request-handler.ts    # Natural language request processing
        playlist-generator.ts # AI-enhanced playlist generation pipeline
        types.ts              # Intelligence type definitions
      playback/
        engine.ts             # Session lifecycle, track advancement
        queue.ts              # Track queue management
        session.ts            # Session start/end logic
        types.ts              # Playback type definitions
      scheduler/
        scheduler.ts          # Cron task registration
        tasks/
          sync-library.ts     # Spotify library + audio features sync
          poll-player.ts      # Playback state polling
          compute-analytics.ts # Daily analytics precomputation
          monthly-recap.ts    # Monthly AI recap generation
      shared/
        constants.ts          # Application-wide constants
        errors.ts             # Custom error classes
        logger.ts             # Pino logger configuration
        utils.ts              # Shared utility functions
      spotify/
        auth.ts               # PKCE flow + token management
        client.ts             # Authenticated Spotify SDK wrapper
        library.ts            # Library sync operations
        player.ts             # Playback control operations
        types.ts              # Spotify type definitions
      config.ts               # Zod-validated environment config
      index.ts                # Application entry point
    data/
      orpheus.db              # SQLite database (auto-created)
      genre_aliases.json      # Genre alias map (~40 genres)
      mood_mappings.json      # Mood-to-genre/energy/valence mappings
    .env                      # Environment variables (not committed)
    .env.example              # Environment template

  client/
    lib/
      config/
        constants.dart        # API base URL, app constants
        routes.dart           # go_router configuration
        theme.dart            # Orpheus dark theme, colors, typography
      providers/
        session_provider.dart # Session state management
        steering_provider.dart# Steering control state
        playlist_provider.dart# Playlist generation state + WS progress
      screens/
        home_screen.dart      # Now playing, quick controls, playlist FAB
        session_screen.dart   # Session history, energy curves
        analytics_screen.dart # Charts and stats dashboard
        intelligence_screen.dart # AI status, suggestions, recaps
        settings_screen.dart  # Automation and preference settings
        playlist_screen.dart  # Playlist creation form + result view
        auth_screen.dart      # Spotify login
        shell_screen.dart     # Bottom navigation shell
      services/
        api_service.dart      # Dio HTTP client for all endpoints
        websocket_service.dart# WebSocket connection management
      widgets/
        energy_arc.dart       # Semi-circular energy gauge
        feedback_buttons.dart # Like/dislike controls
        now_playing_card.dart # Current track display
        orpheus_app_bar.dart  # Branded app bar
        session_timeline.dart # Horizontal energy curve chart
        stat_card.dart        # Metric card with sparkline
        spotify_attribution.dart # Spotify branding attribution widget
        steering_slider.dart  # Steering control slider
      main.dart               # Flutter app entry point
    pubspec.yaml              # Flutter dependencies
```

---

## Database Schema

SQLite with 5 migration versions:

- **v1:** Core tables — `tracks`, `interactions`, `sessions`, `preferences`, `state_history`, `steering_history`, `time_preferences`, `analytics_cache`, `settings`, `auth_tokens`
- **v2:** AI support — `ai_suggestions` table, AI-related settings
- **v3:** Reasoning layer — `session_name` column on sessions, `monthly_recaps` table
- **v4:** Spotify top artists — `spotify_top_artists` table, listening stats cache support
- **v5:** Playlist generation — `playlists` table (prompt, parameters, Spotify link, stats), `playlist_tracks` table (track positions, scores, segments with CASCADE delete)

---

## Tech Stack Summary

| Component | Technology |
|-----------|-----------|
| Server Runtime | Node.js 24+ |
| Server Framework | Fastify 5 |
| Language (Server) | TypeScript (ESM) |
| Database | SQLite via `node:sqlite` |
| Spotify SDK | `@spotify/web-api-ts-sdk` |
| Config Validation | Zod |
| Scheduler | node-cron |
| Logging | Pino |
| AI (Optional) | Ollama (llama3.2) |
| Client Framework | Flutter 3.5+ |
| State Management | Riverpod |
| HTTP Client | Dio |
| Charts | fl_chart |
| Routing | go_router |
| Containerization | Docker + Docker Compose |

---

## Docker

Run the full stack with Docker Compose:

```bash
# Server + Client (no AI)
docker compose up --build

# Server + Client + Ollama AI
docker compose --profile ai up --build
```

If using the `ai` profile, pull a model after Ollama starts:

```bash
docker exec orpheus-ollama ollama pull llama3.2
```

The client is served on **port 80** (nginx), the server API on **port 3000**, and Ollama on **port 11434**.

| Service | Container | Port | Notes |
|---------|-----------|------|-------|
| Server | `orpheus-server` | 3000 | Node.js API + WebSocket |
| Client | `orpheus-client` | 80 | Flutter web via nginx (proxies `/api` and `/ws` to server) |
| Ollama | `orpheus-ollama` | 11434 | Optional — enable with `--profile ai` |

The SQLite database is persisted in the `server-data` Docker volume. Ollama models are persisted in `ollama-data`.

> **Note:** You still need a `server/.env` file with your Spotify credentials before building. See [Setup Guide](SETUP.md).

---

## Kubernetes (k3s + Helm)

Deploy to a self-hosted k3s cluster using the included Helm chart:

```bash
# Build and import images into k3s
docker build -t orpheus-server:latest ./server
docker build -t orpheus-client:latest ./client
docker save orpheus-server:latest | sudo k3s ctr images import -
docker save orpheus-client:latest | sudo k3s ctr images import -

# Deploy with Helm
helm install orpheus ./helm/orpheus \
  --set spotify.clientId=YOUR_ID \
  --set spotify.clientSecret=YOUR_SECRET \
  --set global.domain=orpheus.local

# Enable Ollama AI
helm upgrade orpheus ./helm/orpheus --set ollama.enabled=true

# Pull the AI model
kubectl exec -it orpheus-ollama-0 -- ollama pull llama3.2
```

The chart includes: server Deployment (with PVC for SQLite), client Deployment (nginx with templated reverse proxy), optional Ollama StatefulSet (with GPU support), Traefik Ingress, and Spotify credentials Secret.

See the full setup guide: [helm/README.md](helm/README.md)

---

## License

This project is for personal use.
