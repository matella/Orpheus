"""Data models for the DJ curator."""
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional


@dataclass
class Track:
    track_id: str                  # Spotify track ID (or any stable ID you control)
    name: str
    artist: str
    album: Optional[str] = None
    year: Optional[int] = None
    genres: list[str] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)         # free-form: "polyrhythmic", "late-night"
    source: str = "library"        # "library" | "similar" | "discovery"

    def label(self) -> str:
        parts = [f"{self.artist} — {self.name}"]
        if self.year:
            parts.append(f"({self.year})")
        if self.genres:
            parts.append(f"[{', '.join(self.genres[:3])}]")
        return " ".join(parts)


@dataclass
class ListenerContext:
    top_artists: list[str] = field(default_factory=list)
    top_genres: list[str] = field(default_factory=list)
    recent_tracks: list[Track] = field(default_factory=list)   # most recent first
    just_played: Optional[Track] = None
    mood: Optional[str] = None             # user-set: "focus", "late night", "driving"
    local_time: Optional[datetime] = None

    def time_phrase(self) -> str:
        if not self.local_time:
            return "unknown time"
        h = self.local_time.hour
        if h < 5:  return "deep night"
        if h < 9:  return "morning"
        if h < 12: return "late morning"
        if h < 14: return "midday"
        if h < 18: return "afternoon"
        if h < 21: return "evening"
        return "night"


@dataclass
class Pick:
    track: Track
    reason: str


@dataclass
class CurationResult:
    picks: list[Pick]      # length 3, in queue order — picks[0] plays next
    patter: str            # 1–2 sentences for the DJ to say before picks[0], "" to skip
