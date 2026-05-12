import type { StateVector, SteeringControls } from '../intelligence/types.js';

// ── Response Interfaces ────────────────────────────────────────────

export interface WeightSuggestion {
  stateSimilarity: number;
  genre: number;
  preference: number;
  transition: number;
  novelty: number;
  fatigue: number;
  context: number;
  recency: number;
  reasoning: string;
}

export interface SessionNameSuggestion {
  name: string;
}

export interface InsightSuggestion {
  insight: string;
  category: string;
}

export interface SessionRecapSuggestion {
  recap: string;
  mood: string;
  highlights: string[];
}

export interface MonthlyRecapSuggestion {
  recap: string;
  highlights: string[];
  personality: string;
}

export interface ContextInferenceSuggestion {
  energy: number;
  valence: number;
  tempo: number;
  familiarity: number;
  vocalness: number;
  aggressiveness: number;
  reasoning: string;
}

// ── Context Interfaces ─────────────────────────────────────────────

export interface SpotifyGlobalContext {
  topArtistsShortTerm: string[];
  topArtistsMediumTerm: string[];
  dominantGenres: { genre: string; count: number }[];
  topPreferredTracks: { name: string; artist: string; score: number }[];
  listeningProfile: string;
}

export interface TransitionContext {
  adoptedTrackCount: number;
  coherenceScore: number;
  transitionMode: 'observing' | 'autonomous';
}

export interface SessionContext {
  sessionId: number;
  trackCount: number;
  stateTrajectory: {
    energy: number;
    valence: number;
    tempo: number;
    genreCluster: string | null;
  }[];
  currentState: StateVector;
  steering: SteeringControls;
  recentInteractions: {
    trackName: string;
    artist: string;
    interactionType: string;
    completionRatio: number | null;
  }[];
  skipRate: number;
  dominantGenres: string[];
  spotifyGlobal?: SpotifyGlobalContext | null;
  transitionContext?: TransitionContext | null;
}

export interface SessionSummary {
  trackCount: number;
  avgEnergy: number;
  avgValence: number;
  dominantGenres: string[];
  timeOfDay: string;
  durationMinutes: number;
}

// ── Prompt Builders ────────────────────────────────────────────────

export function buildWeightSuggestionPrompt(ctx: SessionContext): string {
  const trajectory = ctx.stateTrajectory
    .slice(-10)
    .map((s, i) => `  ${i + 1}. energy=${s.energy.toFixed(2)} valence=${s.valence.toFixed(2)} tempo=${s.tempo.toFixed(0)} genre=${s.genreCluster ?? 'unknown'}`)
    .join('\n');

  const interactions = ctx.recentInteractions
    .slice(-8)
    .map((i) => `  - ${i.trackName} by ${i.artist}: ${i.interactionType}${i.completionRatio != null ? ` (${(i.completionRatio * 100).toFixed(0)}% listened)` : ''}`)
    .join('\n');

  return `Analyze this listening session and suggest scoring weight multipliers.

SESSION STATE:
- Tracks played: ${ctx.trackCount}
- Skip rate: ${(ctx.skipRate * 100).toFixed(0)}%
- Dominant genres: ${ctx.dominantGenres.join(', ') || 'mixed'}
- Current energy: ${ctx.currentState.energy.toFixed(2)}
- Current valence: ${ctx.currentState.valence.toFixed(2)}
- Fatigue level: ${ctx.currentState.fatigueLevel.toFixed(2)}
- Time context: ${ctx.currentState.context}

STEERING CONTROLS (user preferences 0-1, 0.5=neutral):
- Energy: ${ctx.steering.energy.toFixed(2)}
- Mood: ${ctx.steering.mood.toFixed(2)}
- Familiarity: ${ctx.steering.familiarity.toFixed(2)}
- Vocal vs Instrumental: ${ctx.steering.vocalVsInstrumental.toFixed(2)}

STATE TRAJECTORY (recent):
${trajectory}

RECENT INTERACTIONS:
${interactions}
${ctx.spotifyGlobal ? `
LISTENER PROFILE (from Spotify data):
- ${ctx.spotifyGlobal.listeningProfile}
- Top recent artists: ${ctx.spotifyGlobal.topArtistsShortTerm.slice(0, 5).join(', ') || 'unknown'}
- Dominant genres: ${ctx.spotifyGlobal.dominantGenres.slice(0, 5).map((g) => g.genre).join(', ') || 'mixed'}
- Most preferred tracks: ${ctx.spotifyGlobal.topPreferredTracks.slice(0, 3).map((t) => `${t.name} by ${t.artist}`).join(', ') || 'unknown'}
` : ''}${ctx.transitionContext ? `
TRANSITION CONTEXT:
- Session started by integrating with ${ctx.transitionContext.adoptedTrackCount} existing queue tracks
- Queue coherence score: ${ctx.transitionContext.coherenceScore.toFixed(2)}
- Current mode: ${ctx.transitionContext.transitionMode}
- Note: Prioritize smooth continuation from the adopted tracks rather than abrupt style changes.
` : ''}
TASK: Suggest multipliers for these 8 scoring weights. Each multiplier adjusts how important that dimension is for track selection. Use values between 0.5 (reduce importance) and 2.0 (increase importance). 1.0 means no change.

The 8 weights are:
- stateSimilarity: How close a candidate matches the current session state
- genre: How important genre coherence is (staying within the same genre)
- preference: How much the user historically likes this track
- novelty: How different/new the track is
- transition: How smooth the audio transition would be
- fatigue: Anti-fatigue adjustment
- context: Time-of-day appropriateness
- recency: Penalty for recently played tracks

Respond with ONLY this JSON format:
{
  "stateSimilarity": 1.0,
  "genre": 1.0,
  "preference": 1.0,
  "novelty": 1.0,
  "transition": 1.0,
  "fatigue": 1.0,
  "context": 1.0,
  "recency": 1.0,
  "reasoning": "Brief explanation of your adjustments"
}`;
}

export function buildSessionNamePrompt(summary: SessionSummary): string {
  return `Generate a short, creative name (2-5 words) for a music listening session with these characteristics:

- ${summary.trackCount} tracks played
- Average energy: ${summary.avgEnergy.toFixed(2)} (0=calm, 1=intense)
- Average mood: ${summary.avgValence.toFixed(2)} (0=dark, 1=bright)
- Dominant genres: ${summary.dominantGenres.join(', ') || 'varied'}
- Time: ${summary.timeOfDay}
- Duration: ${summary.durationMinutes} minutes

The name should be evocative and poetic, capturing the mood and feel of the session. Examples: "Midnight Velvet Flow", "Golden Hour Drive", "Electric Dawn".

Respond with ONLY this JSON format:
{
  "name": "Your Session Name"
}`;
}

export function buildInsightPrompt(ctx: SessionContext): string {
  const trajectory = ctx.stateTrajectory
    .slice(-6)
    .map((s) => `energy=${s.energy.toFixed(2)} valence=${s.valence.toFixed(2)}`)
    .join(' -> ');

  const profileLine = ctx.spotifyGlobal?.listeningProfile
    ? `\n- Listener profile: ${ctx.spotifyGlobal.listeningProfile}`
    : '';

  return `Generate ONE brief, interesting insight about this listening session.

SESSION:
- Tracks: ${ctx.trackCount}
- Skip rate: ${(ctx.skipRate * 100).toFixed(0)}%
- Genres: ${ctx.dominantGenres.join(', ') || 'varied'}
- Energy trajectory: ${trajectory}
- Time: ${ctx.currentState.context}${profileLine}${ctx.transitionContext ? `
- Transition: Integrated ${ctx.transitionContext.adoptedTrackCount} existing queue tracks (coherence: ${ctx.transitionContext.coherenceScore.toFixed(2)}), now ${ctx.transitionContext.transitionMode}` : ''}

Generate a single conversational insight (under 120 characters) about listening patterns, mood trajectory, or music discovery. Be specific and observational, not generic.

Categories: "mood", "energy", "discovery", "pattern", "genre"

Respond with ONLY this JSON format:
{
  "insight": "Your insight here",
  "category": "mood"
}`;
}

export interface SessionRecapContext {
  trackCount: number;
  durationMinutes: number;
  avgEnergy: number;
  avgValence: number;
  dominantGenres: string[];
  timeOfDay: string;
  skipRate: number;
  energyArc: string;
}

export function buildSessionRecapPrompt(ctx: SessionRecapContext): string {
  return `Write a brief, personal recap of this listening session that just ended.

SESSION:
- ${ctx.trackCount} tracks over ${ctx.durationMinutes} minutes
- Average energy: ${ctx.avgEnergy.toFixed(2)} (0=calm, 1=intense)
- Average mood: ${ctx.avgValence.toFixed(2)} (0=dark, 1=bright)
- Genres: ${ctx.dominantGenres.join(', ') || 'varied'}
- Time: ${ctx.timeOfDay}
- Skip rate: ${(ctx.skipRate * 100).toFixed(0)}%
- Energy arc: ${ctx.energyArc}

Write a 1-2 sentence recap that captures the vibe and journey of this session. Be poetic but concise. Also identify the overall mood and 1-2 highlights.

Respond with ONLY this JSON format:
{
  "recap": "Your session recap here",
  "mood": "one-word mood descriptor",
  "highlights": ["highlight 1", "highlight 2"]
}`;
}

export interface MonthlyRecapContext {
  year: number;
  month: number;
  totalHours: number;
  totalTracks: number;
  totalSessions: number;
  avgEnergy: number;
  avgValence: number;
  topGenres: { genre: string; count: number }[];
  topArtists: { artist: string; count: number }[];
  skipRate: number;
  discoveryRate: number;
  peakListeningHour: number;
  sessionNames: string[];
}

export function buildMonthlyRecapPrompt(ctx: MonthlyRecapContext): string {
  const monthName = new Date(ctx.year, ctx.month - 1).toLocaleString('en', { month: 'long' });
  const genres = ctx.topGenres.slice(0, 5).map((g) => `${g.genre} (${g.count})`).join(', ');
  const artists = ctx.topArtists.slice(0, 5).map((a) => `${a.artist} (${a.count})`).join(', ');
  const sessions = ctx.sessionNames.length > 0
    ? ctx.sessionNames.slice(0, 5).join(', ')
    : 'unnamed sessions';

  return `Write a monthly listening recap for ${monthName} ${ctx.year}.

STATS:
- ${ctx.totalHours.toFixed(1)} hours of music across ${ctx.totalSessions} sessions
- ${ctx.totalTracks} tracks played
- Average energy: ${ctx.avgEnergy.toFixed(2)} | Average mood: ${ctx.avgValence.toFixed(2)}
- Skip rate: ${(ctx.skipRate * 100).toFixed(0)}% | Discovery rate: ${(ctx.discoveryRate * 100).toFixed(0)}%
- Top genres: ${genres || 'varied'}
- Top artists: ${artists || 'various'}
- Peak listening hour: ${ctx.peakListeningHour}:00
- Notable sessions: ${sessions}

Write a 3-4 sentence narrative recap that captures the listener's musical month. Be personal, warm, and specific. Identify 2-3 highlights and a one-word personality descriptor for their listening style.

Respond with ONLY this JSON format:
{
  "recap": "Your monthly recap here",
  "highlights": ["highlight 1", "highlight 2"],
  "personality": "one-word listener personality"
}`;
}

// ── Music Request Parsing ─────────────────────────────────────────

export interface ParsedMusicRequest {
  artists: string[];
  genres: string[];
  moods: string[];
  descriptors: string[];
  trackCount: number;
  searchSpotify: boolean;
}

export function buildPromptParsePrompt(userPrompt: string): string {
  return `Parse this natural language music request into structured data.

USER REQUEST: "${userPrompt}"

Extract the following:
- artists: Array of artist names mentioned (empty array if none)
- genres: Array of music genres or subgenres mentioned (empty array if none). Normalize to lowercase.
- moods: Array of mood/atmosphere descriptors (e.g., "chill", "energetic", "sad", "party", "focus"). Empty array if none.
- descriptors: Array of special intent keywords like "new", "surprise", "discovery", "deep cuts", "popular". Empty array if none.
- trackCount: How many tracks the user wants (default 5). Look for numeric hints like "a few" (3), "some" (5), or explicit numbers. Max 10.
- searchSpotify: true if the request likely needs tracks beyond the user's library (specific artist requests, niche genres). false if it's a general mood/vibe request that the library likely covers.

Respond with ONLY this JSON format:
{
  "artists": [],
  "genres": [],
  "moods": [],
  "descriptors": [],
  "trackCount": 5,
  "searchSpotify": false
}`;
}

// ── Artist Suggestion for Vague Requests ─────────────────────────

export interface ArtistSuggestion {
  artists: string[];
}

export function buildArtistSuggestionPrompt(userPrompt: string): string {
  return `The user made a vague music request that didn't return enough results from a keyword search. Consider the user's library context from the system prompt when suggesting artists.

USER REQUEST: "${userPrompt}"

Your task: suggest 5-8 specific, well-known artist names whose music matches this request. These artists should:
- Be available on Spotify (major/popular artists preferred)
- Match the mood, genre, and style described in the request
- Provide good variety (don't suggest artists that all sound the same)
- Be real artists with substantial catalogues

For example:
- "chill piano music" → Ludovico Einaudi, Yiruma, Nils Frahm, Ólafur Arnalds, Chad Lawson
- "upbeat workout music" → The Prodigy, Run the Jewels, Dua Lipa, Rage Against the Machine, Major Lazer
- "sad indie songs" → Bon Iver, Phoebe Bridgers, Elliott Smith, Mazzy Star, Iron & Wine

Respond with ONLY this JSON format:
{
  "artists": ["Artist Name 1", "Artist Name 2", "Artist Name 3", "Artist Name 4", "Artist Name 5"]
}`;
}

export interface ContextInferenceInput {
  timeBracket: string;
  dayOfWeek: string;
  learnedPrefs: {
    energy: number;
    valence: number;
    tempo: number;
    familiarity: number;
    vocalness: number;
    aggressiveness: number;
    genres: string | null;
    sampleCount: number;
  } | null;
  recentSessionMoods: string[];
  recentGenres: string[];
}

// ── Playlist Generation ──────────────────────────────────────────

export interface PlaylistNameSuggestion {
  name: string;
  description: string;
}

export interface PlaylistPromptParsed extends ParsedMusicRequest {
  suggestedEnergyArc?: string | null;
  suggestedBpmRange?: [number, number] | null;
}

export function buildPlaylistPromptParsePrompt(userPrompt: string): string {
  return `Parse this playlist request into structured data for curated playlist generation.

USER REQUEST: "${userPrompt}"

Extract the following:
- artists: Artist names mentioned (empty array if none)
- genres: Genres/subgenres mentioned, normalized to lowercase (empty array if none)
- moods: Mood/atmosphere descriptors like "chill", "energetic", "focus", "party" (empty array if none)
- descriptors: Special intent keywords like "new", "discovery", "deep cuts", "popular", "favorites" (empty array if none)
- trackCount: Rough number of tracks implied (default 15, max 50). Look for hints like "a few" (8), "long playlist" (30), explicit numbers.
- searchSpotify: true if the request likely needs tracks beyond the user's library (specific artists, niche genres). false for general mood/vibe requests.
- suggestedEnergyArc: If the prompt implies an energy shape, suggest one of: "steady", "build_up", "wind_down", "peak_and_fade". null if not implied. Examples: "workout warmup" = "build_up", "winding down for sleep" = "wind_down", "study session" = "steady".
- suggestedBpmRange: If a BPM range is implied (e.g., "upbeat" = [110, 140], "chill" = [70, 100], "high energy" = [130, 180]), return [min, max]. null if not implied.

Respond with ONLY this JSON format:
{
  "artists": [],
  "genres": [],
  "moods": [],
  "descriptors": [],
  "trackCount": 15,
  "searchSpotify": false,
  "suggestedEnergyArc": null,
  "suggestedBpmRange": null
}`;
}

export function buildPlaylistNamePrompt(context: {
  prompt: string;
  trackCount: number;
  durationMinutes: number;
  dominantGenres: string[];
  avgEnergy: number;
  avgValence: number;
  energyArc: string;
  sampleTrackNames: string[];
}): string {
  return `Generate a name and description for this playlist.

ORIGINAL REQUEST: "${context.prompt}"

PLAYLIST STATS:
- ${context.trackCount} tracks, ${context.durationMinutes} minutes
- Genres: ${context.dominantGenres.join(', ') || 'varied'}
- Average energy: ${context.avgEnergy.toFixed(2)} (0=calm, 1=intense)
- Average mood: ${context.avgValence.toFixed(2)} (0=dark, 1=bright)
- Energy arc: ${context.energyArc}
- Sample tracks: ${context.sampleTrackNames.slice(0, 5).join(', ')}

Generate:
1. A creative playlist name (2-5 words, evocative and poetic)
2. A 1-2 sentence description capturing the playlist's mood and journey

Respond with ONLY this JSON format:
{
  "name": "Your Playlist Name",
  "description": "A brief description of the playlist mood and journey"
}`;
}

// ── Genre Inference ──────────────────────────────────────────

export interface GenreInferenceInput {
  tracks: { id: number; name: string; artist: string; album: string | null }[];
}

export interface GenreInferenceResult {
  tracks: { id: number; genre: string | null; confidence: number }[];
}

export function buildGenreInferencePrompt(input: GenreInferenceInput): string {
  const trackLines = input.tracks
    .map((t) => `  - ID ${t.id}: "${t.name}" by ${t.artist}${t.album ? ` (album: ${t.album})` : ''}`)
    .join('\n');

  return `Classify the primary genre of each track below. Use ONLY the canonical genre names from the GENRE NORMALIZATION section in your system prompt. If you are not confident about a track's genre, set confidence below 0.5.

TRACKS:
${trackLines}

For each track, determine the single most likely primary genre based on the artist name, track title, and album context. Use your knowledge of music artists, their catalogues, and sonic signatures.

Rules:
- Use ONLY canonical genre names (the left-side keys from GENRE NORMALIZATION). Do not invent new genre names.
- If an artist spans multiple genres, pick the one most likely for this specific track/album.
- Set confidence 0.7-1.0 for well-known artists with clear genre identity.
- Set confidence 0.4-0.6 for lesser-known artists or ambiguous cases.
- Set confidence below 0.3 if you truly don't know.

Respond with ONLY this JSON format:
{
  "tracks": [
    { "id": <track_id>, "genre": "<canonical_genre>", "confidence": 0.85 }
  ]
}`;
}

// ── DJ Curator ───────────────────────────────────────────────────────

export interface CurationPick {
  track_id: string;
  reason: string;
}

export interface CurationResult {
  picks: CurationPick[];
  patter: string;
}

/** JSON Schema passed to Ollama's `format` parameter for schema-constrained output. */
export const CURATION_RESULT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    picks: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: {
        type: 'object',
        properties: {
          track_id: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['track_id', 'reason'],
      },
    },
    patter: { type: 'string' },
  },
  required: ['picks', 'patter'],
};

export interface CandidateTrack {
  trackId: string;        // DB integer string for library tracks; Spotify track ID for external
  name: string;
  artist: string;
  year: number | null;
  genres: string[];
  source: 'library' | 'similar' | 'discovery';
  // External-only fields — present when trackId is a Spotify ID, not a DB integer
  spotifyUri?: string;
  artistId?: string;
  album?: string;
  durationMs?: number;
  popularity?: number;
}

export interface ListenerContextForPrompt {
  topArtists: string[];
  topGenres: string[];
  recentTracks: Array<{ name: string; artist: string }>;
  justPlayed: { name: string; artist: string } | null;
  mood: string | null;
  timePhraseDescription: string;
}

/** Build the user message for the curator — context + candidate pool. */
export function buildCuratorUserMessage(
  ctx: ListenerContextForPrompt,
  pool: CandidateTrack[],
): string {
  const parts: string[] = [];

  parts.push('## Listener');
  if (ctx.topArtists.length > 0) parts.push(`Loves: ${ctx.topArtists.slice(0, 8).join(', ')}`);
  if (ctx.topGenres.length > 0) parts.push(`Genres they live in: ${ctx.topGenres.slice(0, 6).join(', ')}`);
  parts.push(`Time: ${ctx.timePhraseDescription}`);
  if (ctx.mood) parts.push(`Mood set by listener: **${ctx.mood}**`);

  parts.push('\n## Just played');
  parts.push(
    ctx.justPlayed
      ? `  ${ctx.justPlayed.artist} — ${ctx.justPlayed.name}`
      : '  (session start)',
  );

  if (ctx.recentTracks.length > 0) {
    parts.push('\n## Recent session (most recent first)');
    for (const t of ctx.recentTracks.slice(0, 6)) {
      parts.push(`  ${t.artist} — ${t.name}`);
    }
  }

  parts.push(`\n## Candidate pool (${pool.length} tracks)`);
  for (const t of pool) {
    const meta: string[] = [];
    if (t.year) meta.push(String(t.year));
    if (t.genres.length > 0) meta.push(t.genres.slice(0, 2).join('/'));
    const suffix = meta.length > 0 ? ` — ${meta.join(', ')}` : '';
    parts.push(`  [${t.trackId}] ${t.artist} — ${t.name}${suffix}  (${t.source})`);
  }

  parts.push('\nPick 3. Return JSON only.');

  return parts.join('\n');
}

export function buildContextInferencePrompt(ctx: ContextInferenceInput): string {
  const learnedSection = ctx.learnedPrefs
    ? `LEARNED PREFERENCES for ${ctx.timeBracket} (from ${ctx.learnedPrefs.sampleCount} sessions):
- Energy: ${ctx.learnedPrefs.energy.toFixed(2)} | Valence: ${ctx.learnedPrefs.valence.toFixed(2)}
- Tempo: ${ctx.learnedPrefs.tempo.toFixed(0)} BPM | Familiarity: ${ctx.learnedPrefs.familiarity.toFixed(2)}
- Preferred genres: ${ctx.learnedPrefs.genres || 'varied'}`
    : 'No learned preferences yet for this time bracket.';

  const moods = ctx.recentSessionMoods.length > 0
    ? ctx.recentSessionMoods.join(', ')
    : 'none available';

  return `Suggest the ideal initial listening state for a new session starting now. Use the user's library context and listening patterns from the system prompt to ground your suggestions.

CONTEXT:
- Time: ${ctx.timeBracket} (${ctx.dayOfWeek})
- Recent session moods: ${moods}
- Recent genres: ${ctx.recentGenres.join(', ') || 'varied'}

${learnedSection}

Based on the time of day, day of week, and listening history, suggest initial state values. Each value is 0-1 except tempo (60-200 BPM).

Respond with ONLY this JSON format:
{
  "energy": 0.5,
  "valence": 0.5,
  "tempo": 120,
  "familiarity": 0.5,
  "vocalness": 0.5,
  "aggressiveness": 0.3,
  "reasoning": "Brief reasoning for your suggestions"
}`;
}
