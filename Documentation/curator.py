"""LLM-based DJ curator.

Calls a local Ollama instance, constrains output to valid JSON via Ollama's
`format` parameter (schema-constrained, supported in Ollama 0.5+), and
validates every returned track_id against the candidate pool so hallucinated
IDs can't reach the player.
"""
from __future__ import annotations
import json
import urllib.request
from typing import Any

from models import Track, ListenerContext, Pick, CurationResult


OLLAMA_URL = "http://localhost:11434/api/chat"
DEFAULT_MODEL = "qwen2.5:7b"      # also good: llama3.1:8b, mistral-small3


SYSTEM_PROMPT = """You are a thoughtful music curator programming a personalized radio experience in real time. One listener. Live. Now. You are not a generic recommender — you have taste, opinions, and a sense of pacing.

You receive: who's listening, what just played, recent session history, and a pool of candidate tracks. You pick the next 3 tracks in queue order.

Principles:
- Coherent journey, not shuffle. Adjacent tracks should connect — mood, era, sonics, lineage, or deliberate contrast. The first pick is the most important: it decides whether the listener stays in the moment or reaches for skip.
- Honor the listener's taste, but don't only feed it back. Roughly 1 in 4 picks should stretch them slightly — adjacent territory, not a hard left turn.
- Read the moment: time of day, mood, what they've leaned into this session.
- Avoid jarring energy or tempo cliffs unless you're doing it on purpose — and if so, say so in the reason.
- Don't stack the same artist twice in three picks unless one is a clear, intentional callback worth flagging in the reason.
- If the listener has set a mood, respect it strictly. Mood overrides the "stretch them" instinct.

CRITICAL: pick only from the provided candidate list. Use the exact track_id strings shown in [brackets]. Never invent a track. If nothing in the pool feels right for slot 3, pick the least-bad option and say so honestly in the reason.

Patter: 1–2 sentences the DJ would say before the first pick starts. Conversational, like a friend with great taste, not a radio announcer. No corny segues, no "and now...", no listing the song you're about to play. Return an empty string for patter if anything you'd say would feel forced or break the mood. Silence is a valid choice."""


# JSON schema we hand to Ollama to constrain output.
RESPONSE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "picks": {
            "type": "array",
            "minItems": 3,
            "maxItems": 3,
            "items": {
                "type": "object",
                "properties": {
                    "track_id": {"type": "string"},
                    "reason":   {"type": "string"},
                },
                "required": ["track_id", "reason"],
            },
        },
        "patter": {"type": "string"},
    },
    "required": ["picks", "patter"],
}


def _format_pool(tracks: list[Track]) -> str:
    """Render the candidate pool as compact scannable lines."""
    lines = []
    for t in tracks:
        meta = []
        if t.year:    meta.append(str(t.year))
        if t.genres:  meta.append("/".join(t.genres[:2]))
        if t.tags:    meta.append("·".join(t.tags[:3]))
        suffix = f" — {', '.join(meta)}" if meta else ""
        lines.append(f"  [{t.track_id}] {t.artist} — {t.name}{suffix}  ({t.source})")
    return "\n".join(lines)


def _build_user_message(ctx: ListenerContext, pool: list[Track]) -> str:
    parts: list[str] = []

    parts.append("## Listener")
    if ctx.top_artists:
        parts.append(f"Loves: {', '.join(ctx.top_artists[:8])}")
    if ctx.top_genres:
        parts.append(f"Genres they live in: {', '.join(ctx.top_genres[:6])}")
    parts.append(f"Time: {ctx.time_phrase()}")
    if ctx.mood:
        parts.append(f"Mood set by listener: **{ctx.mood}**")

    parts.append("\n## Just played")
    parts.append(f"  {ctx.just_played.label()}" if ctx.just_played else "  (session start)")

    if ctx.recent_tracks:
        parts.append("\n## Recent session (most recent first)")
        for t in ctx.recent_tracks[:6]:
            parts.append(f"  {t.label()}")

    parts.append(f"\n## Candidate pool ({len(pool)} tracks)")
    parts.append(_format_pool(pool))

    parts.append("\nPick 3. Return JSON only.")
    return "\n".join(parts)


def _call_ollama(model: str, system: str, user: str, timeout: int = 60) -> dict[str, Any]:
    body = json.dumps({
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user",   "content": user},
        ],
        "format": RESPONSE_SCHEMA,
        "stream": False,
        "options": {"temperature": 0.7},
    }).encode("utf-8")

    req = urllib.request.Request(
        OLLAMA_URL,
        data=body,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        resp = json.loads(r.read())
    return json.loads(resp["message"]["content"])


def curate(ctx: ListenerContext,
           pool: list[Track],
           model: str = DEFAULT_MODEL) -> CurationResult:
    """Ask the LLM to pick 3 tracks from the pool. Validates output.

    Hallucinated track_ids are dropped. If that leaves us with fewer than 3
    picks, we backfill from the pool so the queue is never short.
    """
    if len(pool) < 3:
        raise ValueError(f"Pool too small: {len(pool)} tracks; need at least 3")

    user_msg = _build_user_message(ctx, pool)
    raw = _call_ollama(model, SYSTEM_PROMPT, user_msg)

    pool_by_id = {t.track_id: t for t in pool}
    picks: list[Pick] = []
    used: set[str] = set()
    for item in raw.get("picks", []):
        tid = item.get("track_id", "")
        if tid in pool_by_id and tid not in used:
            picks.append(Pick(track=pool_by_id[tid], reason=item.get("reason", "")))
            used.add(tid)

    # Backfill if the LLM hallucinated or duplicated
    for t in pool:
        if len(picks) >= 3:
            break
        if t.track_id in used:
            continue
        picks.append(Pick(track=t, reason="(validation backfill)"))
        used.add(t.track_id)

    return CurationResult(picks=picks[:3], patter=raw.get("patter", "").strip())
