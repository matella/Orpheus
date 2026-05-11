"""Build a candidate pool from multiple sources.

The LLM is only as good as the pool you give it. Aim for 40–80 candidates
mixing taste-familiar, taste-adjacent, and pure discovery.

This file shows the shape of each fetcher. The Spotify ones are stubs —
wire them to spotipy or raw API calls. The ListenBrainz and Last.fm
fetchers are real and work as-is (you'll just need to map their results
to Spotify IDs via search before using them in playback).
"""
from __future__ import annotations
import json
import urllib.parse
import urllib.request
from typing import Iterable

from models import Track, ListenerContext


# ---------- Spotify (stubs to wire up) ----------

def spotify_user_library_sample(token: str, limit: int = 30) -> list[Track]:
    """Sample from the user's saved tracks.

    Real call: GET https://api.spotify.com/v1/me/tracks?limit=50
    Map each item to Track(track_id=item.track.id, name=..., artist=..., ...).
    For variety across a long library, page randomly rather than always
    pulling the first 50.
    """
    raise NotImplementedError("Wire to Spotify API (spotipy: sp.current_user_saved_tracks)")


def spotify_search(token: str, artist: str, title: str) -> Track | None:
    """Resolve an 'artist + title' string to a Spotify track.

    Used to convert ListenBrainz / Last.fm results (which are MBIDs or
    plain text) into playable Spotify tracks. Cache results aggressively
    — same lookup will repeat a lot.
    """
    raise NotImplementedError("Wire to Spotify API (spotipy: sp.search(q=..., type='track'))")


# ---------- ListenBrainz (free, no auth for reads) ----------

def listenbrainz_similar(recording_mbid: str, limit: int = 20) -> list[dict]:
    """Get similar recordings from ListenBrainz Labs.

    Returns raw dicts; you'd resolve each to a Spotify track via search.
    """
    algorithm = (
        "session_based_days_7500_session_300"
        "_contribution_5_threshold_10_limit_100_filter_True_skip_30"
    )
    params = urllib.parse.urlencode({
        "recording_mbids": recording_mbid,
        "algorithm": algorithm,
    })
    url = f"https://labs.api.listenbrainz.org/similar-recordings/json?{params}"
    try:
        with urllib.request.urlopen(url, timeout=5) as r:
            data = json.loads(r.read())
        return data[:limit] if isinstance(data, list) else []
    except Exception:
        return []


# ---------- Last.fm (free with API key) ----------

def lastfm_similar(api_key: str, artist: str, track: str, limit: int = 20) -> list[dict]:
    """Get similar tracks from Last.fm. Returns [{name, artist:{name}, match}, ...]."""
    params = urllib.parse.urlencode({
        "method": "track.getSimilar",
        "artist": artist,
        "track": track,
        "api_key": api_key,
        "format": "json",
        "limit": limit,
    })
    url = f"https://ws.audioscrobbler.com/2.0/?{params}"
    try:
        with urllib.request.urlopen(url, timeout=5) as r:
            data = json.loads(r.read())
        return data.get("similartracks", {}).get("track", [])
    except Exception:
        return []


def lastfm_tags(api_key: str, artist: str, track: str) -> list[str]:
    """Pull top tags for a track (useful for enriching Track.tags)."""
    params = urllib.parse.urlencode({
        "method": "track.getTopTags",
        "artist": artist,
        "track": track,
        "api_key": api_key,
        "format": "json",
    })
    url = f"https://ws.audioscrobbler.com/2.0/?{params}"
    try:
        with urllib.request.urlopen(url, timeout=5) as r:
            data = json.loads(r.read())
        tags = data.get("toptags", {}).get("tag", [])
        return [t["name"] for t in tags[:5]]
    except Exception:
        return []


# ---------- Pool builder ----------

def build_pool(ctx: ListenerContext,
               library_sample: list[Track],
               similar: list[Track],
               discovery: list[Track],
               max_size: int = 60) -> list[Track]:
    """Combine sources into a deduped pool with a healthy mix.

    Default ratios: ~50% taste-familiar, ~35% similar, ~15% discovery.
    Bump discovery up for more adventurous radio, down for comfort listening.
    """
    seen: set[str] = set()
    pool: list[Track] = []

    # Exclude the very-recent tracks so we don't repeat what just played
    recent_ids = {t.track_id for t in ctx.recent_tracks[:10]}
    if ctx.just_played:
        recent_ids.add(ctx.just_played.track_id)

    def add(tracks: Iterable[Track], cap: int) -> None:
        added = 0
        for t in tracks:
            if t.track_id in seen or t.track_id in recent_ids:
                continue
            if added >= cap:
                break
            seen.add(t.track_id)
            pool.append(t)
            added += 1

    add(library_sample, int(max_size * 0.50))
    add(similar,        int(max_size * 0.35))
    add(discovery,      int(max_size * 0.15))

    return pool
