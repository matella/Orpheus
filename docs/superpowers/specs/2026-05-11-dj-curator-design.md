# DJ Curator — Design Spec

LLM-driven track curation for Orpheus. Replaces the algorithmic selector as the primary intelligence layer, with the existing pipeline as fallback and transition validator.

## Architecture: AI-First Hybrid

The LLM curator is the brain that decides what to play and why. The algorithmic pipeline becomes the real-time executor and safety net.

### New modules

- **DJ Curator** (`intelligence/curator.ts`) — orchestrates the curation cycle: assemble context, build pool, call LLM, validate picks, return 3 tracks + patter
- **Pool Builder** (`intelligence/pool-builder.ts`) — assembles a candidate pool from multiple sources with user-tunable ratios and steering pre-filtering
- **ListenerContext Assembler** (`intelligence/listener-context.ts`) — gathers listener profile from 6 sources into a single object for the LLM prompt
- **Persona Prompts** (`ai/personas.ts`) — 4 preset DJ personas + custom free-text support, each a complete system prompt
- **DJ Preferences Repo** (`database/repositories/dj-preferences.repo.ts`) — persistence for persona, chattiness, discovery appetite, onboarding state
- **DJ Routes** (`api/routes/dj.routes.ts`) — CRUD endpoints for DJ preferences + onboarding status

### Modified modules

- `ai/ollama.ts` — upgrade from generic `format: 'json'` (current) to schema-constrained generation: pass a full JSON Schema object to Ollama's `format` parameter and switch the curator calls to use the `/api/chat` endpoint (multi-turn messages) instead of `/api/generate`
- `ai/prompts.ts` — add CurationResult type and curator prompt builders (system + user message assemblers)
- `playback/engine.ts` — proactive scheduling (fire curator when last queued track has < 30s remaining), fallback detection, rapid-skip handling
- `playback/queue.ts` — support 3-track batch loading from curator
- `api/websocket.ts` — new events: `curator_update`, `curator_fallback`, `curator_restored`
- `database/migrations.ts` — v7: `dj_preferences` table (**v6 is already used** by the `genre_source` column migration; see below)
- `config.ts` — Last.fm API key (Phase 2), TTS config (Phase 3)
- `index.ts` — register new routes, initialize curator

### Already implemented (merged from `feature/ai-steering-updates`, commit `cec9e70`)

The following work from the plan is **done** and should not be re-done:

- `intelligence/selector.ts` — `targetGenre` and `targetArtist` session locks, `setTargetGenre/Artist`, `clearTargetGenre/Artist` methods
- `intelligence/candidate-pool.ts` — artist-lock pre-filter (forces same-artist when lock active, bypasses same-artist exclusion), genre-lock pre-filter via `referenceGenre` override
- `intelligence/request-handler.ts` — lock intent detection ("only", "just", "nothing but") to auto-activate genre/artist locks
- `intelligence/scorer.ts` — AI multiplier support per score dimension
- `ai/service.ts` — `inferTrackGenres()` batch AI genre classification
- `scheduler/tasks/infer-metadata.ts` — new task: batch-classifies tracks without `genre_cluster` using AI (runs 6h at :30)
- `database/migrations.ts` — **v6** complete: `genre_source TEXT` column added to `tracks`, backfilled to `'spotify'` for existing rows
- `database/repositories/track.repo.ts` — `getTracksNeedingGenreInference()`, `setAiInferredGenre()`, `markGenreInferenceFailed()`, `getGenreInferenceBacklog()`
- `client/lib/widgets/spotify_attribution.dart` — Spotify attribution widget
- `client/lib/screens/home_screen.dart` — major home screen rebuild (now playing redesign, gesture feedback, better layout)

### Demoted modules

- `intelligence/selector.ts` — becomes fallback-only for single-track selection when LLM is unavailable; genre/artist lock logic stays active in both paths
- `intelligence/scorer.ts` — used for transition validation (energy delta check between curator picks), no longer primary selection
- `intelligence/candidate-pool.ts` — pool-builder calls this for the "library" bucket; it is **not replaced**, just wrapped

## LLM Curator Flow

### Trigger conditions

The curator fires proactively, not reactively:

1. **Proactive scheduling** — when `remaining_ms < 30000` on the last planned track (detected during the 5s Spotify poll)
2. **Session start** — immediately when engine starts a new session
3. **User music request** — when the user sends a natural language request
4. **Steering change** — debounced 5s after the last steering slider move
5. **Rapid-skip recovery** — immediate trigger when queue drops to 0 planned tracks

### Step-by-step

**Step 1: Assemble ListenerContext**

Gather from multiple repositories into one object:

| Field | Source |
|---|---|
| `top_artists`, `top_genres` | `top-artists.repo.ts` |
| `recent_tracks`, `just_played` | `session.repo.ts` + engine state |
| `mood`, `steering_values` | `settings.repo.ts` (steering controls) |
| `local_time`, `time_phrase` | system clock + `context-learning.ts` |
| `persona`, `chattiness` | `dj-preferences.repo.ts` |
| `discovery_appetite` | `dj-preferences.repo.ts` |

**Step 2: Build candidate pool**

Three sources, ratios determined by user's discovery appetite setting:

| Appetite | Library | Similar | Discovery |
|---|---|---|---|
| Comfort (default) | 65% | 25% | 10% |
| Balanced | 50% | 35% | 15% |
| Adventurous | 40% | 30% | 30% |

The `genre_openness` steering axis shifts ratios dynamically at runtime — high openness nudges toward the Adventurous ratios regardless of the base setting.

Pre-filtering: steering axes remove obvious mismatches before the LLM sees them. Energy at 0.9 drops tracks with energy < 0.5 from the pool.

Recency exclusion: last 10 tracks and last 3 artists are excluded.

Target pool size: 40–60 tracks (tuned to 7B model context window).

In Phase 1, "Similar" and "Discovery" both draw from the Spotify library with different filtering (similar = same genres as current state, discovery = different genres). Phase 2 replaces these with ListenBrainz and Last.fm external sources.

**Step 3: Call LLM (schema-constrained)**

The prompt is assembled from three parts:

- **System prompt**: DJ persona (selected preset or custom text) + chattiness hint ("the listener prefers minimal commentary — only speak when a transition is surprising") + steering description ("the listener has cranked energy to 0.9 and set mood to dark")
- **User message**: ListenerContext (top artists, genres, time, mood) + just played + recent session history (last 6 tracks) + candidate pool (40-60 tracks formatted as `[track_id] Artist — Title — year/genres/tags (source)`)
- **Format**: Ollama `format` parameter with JSON schema: `{ picks: [{track_id, reason}×3], patter: string }`
- **Options**: temperature 0.7, timeout 15s

**Step 4: Validate picks**

Three validation layers:

1. **Pool validation** — every `track_id` must exist in the candidate pool. Hallucinated IDs are silently dropped and backfilled from the pool.
2. **Transition check** — algorithmic scorer checks adjacent energy deltas between the 3 picks and the currently playing track. If delta > 0.8 between any neighbors, reorder to smooth the transition.
3. **Dedup guard** — no duplicate artists in the 3 picks unless the LLM explicitly flagged it as intentional in the reason text.

**Step 5: Queue and broadcast**

Load 3 validated picks into the queue. Sync first 2 to Spotify queue via API. Broadcast via WebSocket:

- `curator_update` — `{ picks: [{track, reason}×3], patter: "...", source: "llm" }`
- `state_updated` — existing event, extended with curator metadata

### Timing budget

| Step | Duration |
|---|---|
| Context assembly | ~50ms (local DB reads) |
| Pool building | ~100ms (query + filter) |
| LLM call | 2–10s (7B model, local Ollama) |
| Validation | ~5ms (in-memory checks) |
| **Total** | **~3–11s** (within 30s buffer) |

### Rapid-skip handling

When the user skips rapidly and the queue empties before the next proactive call:

1. Queue drops to 0 → trigger immediate curator call
2. While LLM is thinking (2-10s), the **fallback selector picks 1 bridge track** instantly to prevent silence
3. When the LLM returns, its 3 picks replace the bridge track in the queue
4. If the user is spam-skipping (3+ skips in 10s), **throttle**: keep using algorithmic fallback, debounce the curator call until 5s after the last skip

Priority: **never silence > LLM picks when available > bridge with algorithm while waiting**.

### Fallback behavior

When the LLM is unavailable (Ollama down, timeout, model not loaded):

1. **Immediate**: fall back to existing algorithmic selector (single track, scoring-based). Music never stops.
2. **Notify**: broadcast `curator_fallback` event with reason. Client shows "Auto-pilot" indicator.
3. **Retry**: health check every 2 minutes. When LLM recovers, broadcast `curator_restored` and switch back to curator.

## Steering Integration

Steering controls influence curation through **both** paths:

1. **Pool pre-filtering** — steering axes shape which candidates make it into the pool. High energy steering removes low-energy tracks. This is hard filtering.
2. **Prompt description** — the active steering values are described in natural language in the system prompt so the LLM can reason about the listener's intent and reference it in patter.

The LLM never sees raw slider values. They're translated to phrases: "energy cranked high", "mood set to dark", "leaning toward familiar territory".

## DJ Personas

Four presets shipped, plus custom free-text:

### The Curator
Thoughtful, minimal commentary, focuses on musical connections and lineage. Picks tracks that tell a story through sonic and historical relationships. Mentions labels, producers, shared band members.

### Late Night Radio
Warm, intimate, NTS/college radio vibe. Loves deep cuts and album tracks over singles. Speaks softly, references the time of night, builds a cocoon.

### Hype DJ
Energetic, festival-style. Builds momentum across picks, talks more frequently, uses shorter punchy sentences. Biases toward high-energy tracks.

### Chill Host
Laid back, lo-fi vibes. Barely talks — silence is the default. When they do speak, it's one short sentence max. Lets the music breathe.

### Custom
User writes a free-text description (max 500 chars) that is injected as the system prompt persona section. Presets serve as inspiration.

## DJ Patter

### Frequency

Four tiers, stored as a preference and injected as a hint in the LLM system prompt:

| Tier | Behavior | Prompt hint |
|---|---|---|
| **Silent** | No patter generated, `patter` always empty | "Do not generate any commentary. Return empty patter." |
| **Minimal** | Session start + major mood/energy shifts only | "Only speak at the very start of a session or when making a surprising genre/energy shift. Silence is almost always the right choice." |
| **Balanced** (default) | Every 3-5 tracks + shifts + user interactions | "Speak every few transitions when you have something genuine to say. Silence is a valid choice." |
| **Chatty** | Every transition gets a chance | "You're a full radio host. Comment on most transitions. Still skip patter if you'd just be filling dead air." |

The LLM self-regulates within these constraints — empty patter string means silence, which is always valid regardless of tier.

### Patter triggers (beyond frequency)

- Session start (always, unless Silent)
- After a deliberate mood or energy pivot
- After a user music request or steering change
- After returning from a long pause (> 5 minutes)
- Never during consistent "flow" stretches where energy and genre have been stable

### Phase 3: Voice

Patter text is generated in Phase 1 and displayed as text in the client. In Phase 3, an abstract TTS adapter converts patter to audio:

- Abstract interface: `speak(text): AudioBuffer`, `listVoices(): Voice[]`, `preview(voiceId): AudioBuffer`
- Implementations: Piper, Kokoro (decision deferred until after Phase 1)
- Playback: duck Spotify volume via API, play patter audio, restore volume
- Skip TTS entirely when patter is empty

## Onboarding

### When shown

After first successful Spotify auth, before the engine starts. Triggered by checking the `onboarding_completed` flag in `dj_preferences`.

### 3-step wizard

**Step 1 — Discovery Appetite**: Comfort Zone / Balanced / Adventurous. Each option shows a mini ratio bar (library green / similar blue / discovery purple) with a legend above.

**Step 2 — DJ Chattiness**: Silent / Minimal / Balanced / Chatty. Descriptions explain each tier.

**Step 3 — DJ Persona**: 4 preset cards + Custom free-text option with a textarea (max 500 chars, placeholder with example).

### Defaults if skipped

Comfort Zone + Balanced chattiness + The Curator persona. A "Use defaults" link at the bottom of each step allows skipping.

### Persistence

All choices saved to `dj_preferences` table. `onboarding_completed` set to true. All editable later in Settings → DJ Personality.

## Client UI Changes

### Home Screen — New Elements

1. **DJ patter banner** — above album art. Shows LLM commentary in italics with a speech bubble icon. Hidden when patter is empty or chattiness is Silent.
2. **Pick reason** — below track info. One-line italic text explaining why the DJ chose this track. From the LLM's `reason` field.
3. **Up Next queue** — below feedback buttons. Shows the next 2 planned tracks with artist and source tag (library/similar/discovery).
4. **Persona chip** — in the status bar, shows the active persona name with its icon.
5. **Auto-pilot indicator** — replaces the persona chip when in fallback mode. Orange "Auto-pilot" badge. Patter banner replaced with fallback notice.

### Settings Screen — New Section

**DJ Personality** section added between existing sections:

- **Persona**: tap to open persona selection (same cards as onboarding step 3)
- **Chattiness**: segmented toggle — Silent / Minimal / Balanced / Chatty
- **Discovery Appetite**: segmented toggle — Comfort / Balanced / Adventurous, with mini ratio bar and percentage labels below

**DJ Voice** section (greyed out, "coming soon" label until Phase 3):

- Engine selector (dropdown, populated from installed TTS engines)
- Voice selector (dropdown with preview button, populated from engine)
- Volume slider (relative to music)

### New WebSocket Events

| Event | Payload | Client action |
|---|---|---|
| `curator_update` | `{ picks: [...], patter, source: "llm" }` | Update patter banner, pick reason, Up Next queue |
| `curator_fallback` | `{ reason: "timeout" \| "unavailable" }` | Show auto-pilot indicator, hide patter |
| `curator_restored` | `{}` | Hide auto-pilot, resume DJ mode |

Existing events `state_updated` and `track_changed` are extended with curator metadata (current pick reason).

### New Provider

`dj_provider.dart` — Riverpod NotifierProvider managing DJ preferences state (persona, chattiness, discovery appetite, onboarding status). Syncs with API on changes.

## Database

### Migration v7: `dj_preferences` table

> **Note:** Migration v6 was used by the `genre_source` column (added in `cec9e70`). The `dj_preferences` table is therefore v7.

```sql
CREATE TABLE dj_preferences (
  id INTEGER PRIMARY KEY DEFAULT 1,
  persona TEXT NOT NULL DEFAULT 'curator',
  custom_persona TEXT,
  chattiness TEXT NOT NULL DEFAULT 'balanced',
  discovery_appetite TEXT NOT NULL DEFAULT 'comfort',
  onboarding_completed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Constraints:
- `persona` — one of: `curator`, `late_night`, `hype`, `chill`, `custom`
- `chattiness` — one of: `silent`, `minimal`, `balanced`, `chatty`
- `discovery_appetite` — one of: `comfort`, `balanced`, `adventurous`
- `custom_persona` — free text, max 500 chars, only used when `persona = 'custom'`
- Single row (id=1), upserted on every update

### Phase 2 addition: `external_cache` table (migration v8)

```sql
CREATE TABLE external_cache (
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  spotify_track_id TEXT,
  artist TEXT,
  title TEXT,
  cached_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (source, external_id)
);
```

## API Endpoints

### DJ preferences

- `GET /api/dj/preferences` — current DJ preferences
- `PUT /api/dj/preferences` — update preferences (partial update)
- `GET /api/dj/onboarding` — onboarding status (`{ completed: boolean }`)
- `POST /api/dj/onboarding/complete` — mark onboarding as done

### Phase 3: TTS

- `GET /api/tts/engines` — list installed TTS engines
- `GET /api/tts/voices?engine=piper` — list voices for an engine
- `POST /api/tts/preview` — generate preview audio for a voice
- `PUT /api/tts/settings` — update voice/engine/volume

## Phase Breakdown

### Phase 1 — LLM Curator + Onboarding

Everything described above except external sources and TTS. The "similar" and "discovery" pool slots draw from the Spotify library with different genre filtering. Patter is text-only (displayed in client, no audio).

New files (8):
- `intelligence/curator.ts`
- `intelligence/pool-builder.ts`
- `intelligence/listener-context.ts`
- `ai/personas.ts`
- `api/routes/dj.routes.ts`
- `database/repositories/dj-preferences.repo.ts`
- `screens/onboarding_screen.dart`
- `providers/dj_provider.dart`

Modified files (12):
- `ai/ollama.ts` — schema-constrained generation + `/api/chat` endpoint for curator
- `ai/prompts.ts` — CurationResult type + curator prompt builders
- `playback/engine.ts` — proactive scheduling, fallback detection, rapid-skip handling
- `playback/queue.ts` — 3-track batch load
- `api/websocket.ts` — `curator_update`, `curator_fallback`, `curator_restored` events
- `api/server.ts` — register DJ routes
- `database/migrations.ts` — v7: `dj_preferences`
- `config.ts`, `index.ts`
- `home_screen.dart` — DJ patter banner, pick reason, Up Next queue, persona chip, auto-pilot indicator
- `settings_screen.dart` — DJ Personality section
- `routes.dart`, `api_service.dart`, `websocket_service.dart`

Already done, do not modify again:
- `intelligence/selector.ts`, `intelligence/candidate-pool.ts`, `intelligence/request-handler.ts`, `intelligence/scorer.ts`
- `scheduler/tasks/infer-metadata.ts`, `database/repositories/track.repo.ts`

### Phase 2 — External Sources

ListenBrainz and Last.fm integrations. MBID → Spotify ID resolution with SQLite cache. Pool builder upgraded to use real external sources instead of library-based substitutes.

New files (~2):
- `intelligence/external-sources.ts`
- `database/repositories/external-cache.repo.ts`

Modified files (~3):
- `intelligence/pool-builder.ts`
- `database/migrations.ts` (v8 — external_cache)
- `config.ts` (Last.fm API key)

Depends on: Phase 1 (pool builder interface).

### Phase 3 — TTS Voice

Abstract TTS adapter with Piper and Kokoro implementations. Volume ducking via Spotify API. Voice settings in client.

New files (~4):
- `tts/adapter.ts` (interface)
- `tts/piper.ts`
- `tts/kokoro.ts`
- `api/routes/tts.routes.ts`

Modified files (~4):
- `playback/engine.ts` (patter audio scheduling)
- `settings_screen.dart` (un-grey voice section)
- `api_service.dart` (TTS endpoints)
- `config.ts` (TTS config)

Depends on: Phase 1 (patter text output). Independent of Phase 2.

## Key Decisions Log

| Decision | Choice | Rationale |
|---|---|---|
| Architecture | AI-first hybrid | LLM plans, algorithm executes + fallback. Creative curation with deterministic reliability. |
| LLM track order | Trust LLM, validate transitions | AI-first philosophy. Only reorder on energy delta > 0.8. |
| Steering integration | Pre-filter pool + describe in prompt | Hard filter removes mismatches; prompt description lets LLM reason about intent and reference in patter. |
| Default pool ratios | Comfort-first (65/25/10) | User-tunable. Default favors familiarity for new users. |
| Onboarding | 3-step wizard (appetite, chattiness, persona) | Sets the three most experience-defining choices upfront. Skippable with sensible defaults. |
| DJ personas | 4 presets + custom | Presets cover main vibes and serve as inspiration. Custom for power users. |
| Patter frequency | 4 tiers as prompt hint | LLM self-regulates within the hint. Empty patter is always valid. |
| Fallback | Notified + auto-retry (2 min) | User should know when AI is offline. Auto-heals without manual intervention. |
| Rapid-skip | Bridge track + debounced curator | Never silence. Algorithm bridges while LLM catches up. Throttle on spam-skip. |
| TTS engine | Deferred | Build abstract interface. Decide Piper vs Kokoro after Phase 1 ships. |
| Spec scope | One spec, 3 phases | Pieces are tightly coupled in design. Each phase ships independently. |
| Ollama API for curator | `/api/chat` + schema `format` object | Curator needs multi-turn message format (system + user) and strict schema output. Current `ollama.ts` uses `/api/generate` + `format: 'json'` (generic) — adequate for existing fire-and-forget calls but insufficient for the curator's structured 3-pick response. The chat endpoint + schema object constrains output shape, preventing hallucinated track IDs in picks. |
| `candidate-pool.ts` role | Wrapped by pool-builder, not replaced | `cec9e70` already added artist/genre lock logic to the existing candidate pool. Pool-builder calls `buildCandidatePool()` for the "library" bucket with lock context, adds discovery/similar ratio logic on top. No need to duplicate the filtering. |
