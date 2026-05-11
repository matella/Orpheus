# DJ Curator Scaffold

LLM-driven track curation for a custom Spotify DJ. A local model picks the next 3 tracks from a candidate pool you build, gives a one-line reason per pick, and optionally writes spoken patter for between tracks.

## Files

- `models.py` — `Track`, `ListenerContext`, `Pick`, `CurationResult`
- `candidates.py` — pool builders (Spotify library + ListenBrainz + Last.fm + discovery)
- `curator.py` — system prompt, Ollama call, JSON-schema-constrained output, validation against the pool so hallucinated track IDs can't reach the player
- `demo.py` — runnable demo with mock tracks, no API keys

## Run the demo

```
ollama pull qwen2.5:7b
ollama serve                # in another terminal
python demo.py
```

You should see a 3-track queue with reasons, plus optional patter. Try setting `ctx.mood = "late night"` in `demo.py` and re-run — the picks should shift noticeably.

## Wiring to the real thing

1. **Spotify library + search** — fill in `spotify_user_library_sample` and `spotify_search` in `candidates.py`. Easiest path is `spotipy`. Cache search results aggressively, since Last.fm/ListenBrainz hits will repeat.
2. **ListenBrainz / Last.fm** — the fetchers already make the HTTP calls. The missing step is resolving their results (MBIDs or "artist – title" strings) into Spotify track IDs via `spotify_search`. Build a persistent SQLite cache for these mappings.
3. **Playback** — hand `result.picks[0].track.track_id` to the Web Playback SDK (`addToQueue` or direct `play`). Schedule the next `curate()` call ~30 seconds before track-end.
4. **Patter → voice** — send `result.patter` to Piper or Kokoro, duck Spotify volume via the SDK, play the audio, restore. Skip the TTS round-trip entirely when `patter` is empty (the prompt explicitly allows silence as a valid choice).

## Knobs worth turning first

- **`SYSTEM_PROMPT` in `curator.py`** — the heart of the personality. Swap in different curators: "late-night NTS host", "Saturday morning soul show", "high-energy gym set".
- **`build_pool` ratios** (default 50/35/15) — bump discovery to 30% for adventurous radio, drop it to 5% for comfort listening.
- **`temperature`** in `_call_ollama` — 0.7 is balanced. Lower (0.4) for safer picks, higher (0.9) for more variance run-to-run.
- **Pool size** — 60 is a reasonable upper bound for a 7B model's attention. If you go bigger, switch to a 14B model or pre-rank with embeddings before handing to the LLM.

## Why the JSON schema matters

`curator.py` passes a JSON schema in Ollama's `format` parameter. This guarantees parseable output and the right shape — no regex parsing, no "the model added a preamble" edge cases. Requires Ollama 0.5+ (December 2024+).

The pool validation in `curate()` is the second line of defense: even with constrained JSON, the model can return a plausible-looking but invalid track_id. Those get silently dropped and backfilled from the pool, so the queue is never short.
