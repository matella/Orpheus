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
- **Design:** Custom dark theme, Lyre Gold (#D4A843) accents, Cinzel headings, Inter body text, JetBrains Mono for data

---

## Features

### Spotify Integration
- PKCE authorization flow (no server-side secret exposure in redirects)
- Full library sync with audio feature caching (energy, valence, tempo, danceability, etc.)
- Playback control: play, pause, skip, resume, device selection
- Background polling to track what's currently playing

### Intelligence Pipeline
- **State Vector:** 8-dimensional representation of current listening context (energy, valence, tempo, genre, familiarity, vocalness, aggressiveness, fatigue)
- **EMA Blending:** New observations blend into the state via exponential moving average (alpha = 0.3)
- **Steering Controls:** User-adjustable sliders that bias the candidate scoring (energy, mood, familiarity, vocal preference, aggressiveness, genre openness, focus/party)
- **Candidate Pool:** Genre-filtered, energy-windowed subset of cached tracks with recency penalties
- **Scorer:** Multi-dimensional distance with configurable weights per attribute
- **Weighted Random:** Top candidates selected probabilistically by inverse distance (avoids always picking the same "best" track)

### Feedback & Learning
- Like/dislike buttons with immediate preference score adjustment
- Skip detection with partial-listen analysis
- Completion tracking with preference reinforcement
- Time-of-day preference learning (incremental averaging across sessions)
- Per-track familiarity scoring that evolves with play count

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

### AI Integration (Optional)
- Powered by Ollama running locally (default model: llama3.2)
- **Session Naming:** LLM generates evocative session names from track lists
- **Session Recaps:** Narrative summaries of each listening session
- **Monthly Recaps:** End-of-month listening personality analysis with stats
- **Context Inference:** LLM suggests initial state values based on time, weather context, and recent patterns
- **Advisory Suggestions:** Periodic in-session analysis recommending energy/genre shifts
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
| Steering | `/steering` | GET | Current steering values |
| Steering | `/steering` | PUT | Update steering controls |
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
| WebSocket | `/ws` | WS | Real-time event stream |

---

## Project Structure

```
Music/
  server/
    src/
      ai/                    # Ollama client, prompts, AI service
      api/
        middleware/           # Error handler
        routes/               # auth, playback, steering, sessions,
                              # analytics, settings, context, ai
        server.ts             # Fastify setup and route registration
        websocket.ts          # WebSocket broadcast infrastructure
      database/
        connection.ts         # SQLite connection (node:sqlite)
        migrations.ts         # Schema v1-v3
        repositories/         # track, interaction, session, preference,
                              # state-history, analytics, settings,
                              # time-preferences, ai-suggestion,
                              # monthly-recap
        types.ts              # Row type interfaces
      intelligence/
        state-vector.ts       # 8D state with EMA blending
        steering.ts           # User steering control application
        candidate-pool.ts     # Genre/energy/recency filtering
        scorer.ts             # Multi-dimensional distance scoring
        selector.ts           # Pipeline coordinator
        feedback.ts           # Like/dislike/skip processing
        context-learning.ts   # Time-of-day preference learning
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
    data/                     # SQLite database (auto-created)
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
      screens/
        home_screen.dart      # Now playing, quick controls
        session_screen.dart   # Session history, energy curves
        analytics_screen.dart # Charts and stats dashboard
        intelligence_screen.dart # AI status, suggestions, recaps
        settings_screen.dart  # Automation and preference settings
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
        steering_slider.dart  # Steering control slider
      main.dart               # Flutter app entry point
    pubspec.yaml              # Flutter dependencies
```

---

## Database Schema

SQLite with 3 migration versions:

- **v1:** Core tables — `tracks`, `interactions`, `sessions`, `preferences`, `state_history`, `steering_history`, `time_preferences`, `analytics_cache`, `settings`, `auth_tokens`
- **v2:** AI support — `ai_suggestions` table, AI-related settings
- **v3:** Reasoning layer — `session_name` column on sessions, `monthly_recaps` table

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

---

## License

This project is for personal use.
