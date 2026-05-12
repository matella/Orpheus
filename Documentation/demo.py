"""Run the curator end-to-end with mock data. No API keys required.

Prerequisites:
    ollama pull qwen2.5:7b      # or llama3.1:8b, mistral-small3, etc.
    ollama serve                # in another terminal

Then:
    python demo.py

Try setting ctx.mood to "late night", "focus", or "driving" and watch how
the picks shift.
"""
from datetime import datetime

from models import Track, ListenerContext
from candidates import build_pool
from curator import curate


# What the listener already saves — taste-familiar
LIBRARY = [
    Track("t01", "Once in a Lifetime", "Talking Heads", "Remain in Light", 1980,
          genres=["new wave", "art rock"], tags=["polyrhythmic", "anxious"]),
    Track("t02", "Heroes", "David Bowie", "Heroes", 1977,
          genres=["art rock"], tags=["yearning", "anthemic"]),
    Track("t03", "This Must Be the Place", "Talking Heads", "Speaking in Tongues", 1983,
          genres=["new wave"], tags=["warm", "domestic"]),
    Track("t04", "Ashes to Ashes", "David Bowie", "Scary Monsters", 1980,
          genres=["art rock", "new wave"], tags=["fractured", "haunted"]),
    Track("t05", "Atomic", "Blondie", "Eat to the Beat", 1979,
          genres=["new wave", "disco"], tags=["driving"]),
    Track("t06", "Marquee Moon", "Television", "Marquee Moon", 1977,
          genres=["post-punk"], tags=["sprawling", "guitar"]),
    Track("t07", "Psycho Killer", "Talking Heads", "Talking Heads: 77", 1977,
          genres=["new wave"], tags=["tense", "minimal"]),
    Track("t08", "Life on Mars?", "David Bowie", "Hunky Dory", 1971,
          genres=["art rock"], tags=["theatrical", "tender"]),
    Track("t09", "All My Friends", "LCD Soundsystem", "Sound of Silver", 2007,
          genres=["dance-punk"], tags=["cathartic", "building"]),
    Track("t10", "Idioteque", "Radiohead", "Kid A", 2000,
          genres=["electronic", "art rock"], tags=["paranoid", "glitchy"]),
]

# Adjacent territory — same vein as what's playing
SIMILAR = [
    Track("s01", "Genius of Love", "Tom Tom Club", "Tom Tom Club", 1981,
          genres=["new wave", "funk"], tags=["groove", "playful"], source="similar"),
    Track("s02", "Tempted", "Squeeze", "East Side Story", 1981,
          genres=["new wave"], tags=["bittersweet"], source="similar"),
    Track("s03", "I Zimbra", "Talking Heads", "Fear of Music", 1979,
          genres=["new wave", "afrobeat"], tags=["polyrhythmic"], source="similar"),
    Track("s04", "Cars", "Gary Numan", "The Pleasure Principle", 1979,
          genres=["synth-pop"], tags=["cold", "mechanical"], source="similar"),
    Track("s05", "Love Will Tear Us Apart", "Joy Division", "Substance", 1980,
          genres=["post-punk"], tags=["mournful"], source="similar"),
    Track("s06", "Hounds of Love", "Kate Bush", "Hounds of Love", 1985,
          genres=["art pop"], tags=["dramatic", "soaring"], source="similar"),
    Track("s07", "Birthday", "The Sugarcubes", "Life's Too Good", 1988,
          genres=["alternative"], tags=["unhinged", "exuberant"], source="similar"),
    Track("s08", "Holiday in Cambodia", "Dead Kennedys", "Fresh Fruit", 1980,
          genres=["hardcore punk"], tags=["sarcastic", "frantic"], source="similar"),
]

# Discovery — small, considered stretches
DISCOVERY = [
    Track("d01", "Mosquito Smoothie", "Khruangbin", "Con Todo El Mundo", 2018,
          genres=["psychedelic", "instrumental"], tags=["hypnotic"], source="discovery"),
    Track("d02", "An Eagle in Your Mind", "Boards of Canada", "Music Has the Right", 1998,
          genres=["electronic", "ambient"], tags=["hazy", "nostalgic"], source="discovery"),
    Track("d03", "Pyramid Song", "Radiohead", "Amnesiac", 2001,
          genres=["art rock"], tags=["floating", "uncanny"], source="discovery"),
    Track("d04", "Dreams", "Fleetwood Mac", "Rumours", 1977,
          genres=["soft rock"], tags=["airy", "longing"], source="discovery"),
]


def main() -> None:
    ctx = ListenerContext(
        top_artists=["Talking Heads", "David Bowie", "Radiohead",
                     "Brian Eno", "LCD Soundsystem"],
        top_genres=["art rock", "new wave", "post-punk", "art pop"],
        recent_tracks=[LIBRARY[6], LIBRARY[1], LIBRARY[4]],   # Psycho Killer → Heroes → Atomic
        just_played=LIBRARY[0],                                # Once in a Lifetime
        mood=None,           # try "late night", "focus", "driving"
        local_time=datetime.now(),
    )

    pool = build_pool(ctx, LIBRARY, SIMILAR, DISCOVERY, max_size=60)
    print(f"Pool size: {len(pool)} candidates")
    print(f"Just played: {ctx.just_played.label()}")
    print(f"Mood: {ctx.mood or '(none set)'}")
    print(f"Time: {ctx.time_phrase()}")

    result = curate(ctx, pool)

    print("\n— Patter —")
    print(result.patter or "(silence — DJ chose not to talk)")

    print("\n— Queue —")
    for i, p in enumerate(result.picks, 1):
        print(f"{i}. {p.track.label()}")
        print(f"   → {p.reason}")


if __name__ == "__main__":
    main()
