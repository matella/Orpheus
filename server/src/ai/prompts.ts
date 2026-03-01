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

  return `You are an AI music advisor for an adaptive music system. Analyze the current listening session and suggest scoring weight multipliers.

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

TASK: Suggest multipliers for these 7 scoring weights. Each multiplier adjusts how important that dimension is for track selection. Use values between 0.5 (reduce importance) and 2.0 (increase importance). 1.0 means no change.

The 7 weights are:
- stateSimilarity: How close a candidate matches the current session state
- preference: How much the user historically likes this track
- novelty: How different/new the track is
- transition: How smooth the transition would be
- fatigue: Anti-fatigue adjustment
- context: Time-of-day appropriateness
- recency: Penalty for recently played tracks

Respond with ONLY this JSON format:
{
  "stateSimilarity": 1.0,
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

  return `You are a music listening companion. Generate ONE brief, interesting insight about the current listening session.

SESSION:
- Tracks: ${ctx.trackCount}
- Skip rate: ${(ctx.skipRate * 100).toFixed(0)}%
- Genres: ${ctx.dominantGenres.join(', ') || 'varied'}
- Energy trajectory: ${trajectory}
- Time: ${ctx.currentState.context}

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
  return `You are a music listening companion. Write a brief, personal recap of a listening session that just ended.

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

  return `You are a music listening companion writing a monthly listening recap for ${monthName} ${ctx.year}.

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
  return `You are a music request parser for an intelligent music player. Parse the user's natural language request into structured data.

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
  return `You are a music expert helping an intelligent music player find tracks on Spotify. The user made a vague music request that didn't return enough results from a keyword search.

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

  return `You are an AI music advisor. Suggest the ideal initial listening state for a new session starting now.

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
