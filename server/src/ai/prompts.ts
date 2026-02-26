import type { StateVector, SteeringControls } from '../intelligence/types.js';

// ── Response Interfaces ────────────────────────────────────────────

export interface WeightSuggestion {
  stateSimilarity: number;
  preference: number;
  novelty: number;
  transition: number;
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
