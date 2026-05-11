# DJ Voice Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Piper TTS so the DJ's patter text is spoken aloud, with client-orchestrated Spotify volume ducking.

**Architecture:** Server exposes a `GET /api/tts/speak?text=…` endpoint that spawns Piper as a subprocess and returns WAV bytes. When `curator_update` arrives, the Flutter client ducks Spotify volume, fetches WAV, plays it via `just_audio`, then restores volume. A new `tts/` module on the server provides an abstract `TtsAdapter` interface with a Piper implementation, degrading gracefully when the binary is absent.

**Tech Stack:** Node.js 24 + TypeScript (ESM), Fastify 5, Piper TTS CLI (subprocess via `child_process`), Flutter + `just_audio`, Riverpod, Dio.

---

### Task 1: DB migration v8 — add TTS columns to dj_preferences

**Files:**
- Modify: `server/src/database/migrations.ts`

**Step 1: Add migrateV8 function**

Append this function after `migrateV7` (before the closing of the file):

```typescript
function migrateV8(db: DatabaseSync): void {
  logger.info('Running migration v8: TTS settings');

  db.prepare(`ALTER TABLE dj_preferences ADD COLUMN tts_enabled INTEGER NOT NULL DEFAULT 0`).run();
  db.prepare(`ALTER TABLE dj_preferences ADD COLUMN tts_voice TEXT`).run();
  db.prepare(`ALTER TABLE dj_preferences ADD COLUMN tts_duck_volume REAL NOT NULL DEFAULT 0.3`).run();

  setSchemaVersion(db, 8);
  logger.info('Migration v8 complete');
}
```

**Step 2: Register v8 in the migration runner**

Find the `runMigrations` function. It will have a pattern like:
```typescript
if (version < 7) migrateV7(db);
```
Add after it:
```typescript
if (version < 8) migrateV8(db);
```

**Step 3: Verify**

Run the server briefly to confirm migration runs without error:
```bash
cd server && node --experimental-sqlite dist/index.js
```
Or check TypeScript compiles cleanly after each step (done in Task 8).

**Step 4: Commit**
```bash
git add server/src/database/migrations.ts
git commit -m "feat: migration v8 — add TTS settings columns to dj_preferences"
```

---

### Task 2: Extend dj-preferences.repo.ts with TTS fields

**Files:**
- Modify: `server/src/database/repositories/dj-preferences.repo.ts`

**Step 1: Add TTS fields to the `DjPreferences` interface**

After `onboardingCompleted: boolean;` add:
```typescript
  ttsEnabled: boolean;
  ttsVoice: string | null;
  ttsDuckVolume: number;
```

**Step 2: Add TTS fields to `DjPreferencesRow` interface**

After `onboarding_completed: number;` add:
```typescript
  tts_enabled: number;
  tts_voice: string | null;
  tts_duck_volume: number;
```

**Step 3: Update the SELECT query in `getDjPreferences()`**

Replace:
```typescript
  const row = db
    .prepare('SELECT persona, custom_persona, chattiness, discovery_appetite, onboarding_completed FROM dj_preferences WHERE id = 1')
    .get() as DjPreferencesRow | undefined;
```
With:
```typescript
  const row = db
    .prepare('SELECT persona, custom_persona, chattiness, discovery_appetite, onboarding_completed, tts_enabled, tts_voice, tts_duck_volume FROM dj_preferences WHERE id = 1')
    .get() as DjPreferencesRow | undefined;
```

**Step 4: Update the default return in `getDjPreferences()`**

After `onboardingCompleted: false,` add:
```typescript
      ttsEnabled: false,
      ttsVoice: null,
      ttsDuckVolume: 0.3,
```

**Step 5: Update the row-to-object mapping in `getDjPreferences()`**

After `onboardingCompleted: row.onboarding_completed === 1,` add:
```typescript
    ttsEnabled: row.tts_enabled === 1,
    ttsVoice: row.tts_voice,
    ttsDuckVolume: row.tts_duck_volume,
```

**Step 6: Update `updateDjPreferences()` to accept and persist TTS fields**

Change the signature:
```typescript
export function updateDjPreferences(patch: Partial<Omit<DjPreferences, 'onboardingCompleted'>>): DjPreferences {
```

Update the UPDATE query — replace:
```typescript
  db.prepare(`
    UPDATE dj_preferences SET
      persona = ?,
      custom_persona = ?,
      chattiness = ?,
      discovery_appetite = ?,
      updated_at = datetime('now')
    WHERE id = 1
  `).run(
    next.persona,
    next.customPersona,
    next.chattiness,
    next.discoveryAppetite,
  );
```
With:
```typescript
  db.prepare(`
    UPDATE dj_preferences SET
      persona = ?,
      custom_persona = ?,
      chattiness = ?,
      discovery_appetite = ?,
      tts_enabled = ?,
      tts_voice = ?,
      tts_duck_volume = ?,
      updated_at = datetime('now')
    WHERE id = 1
  `).run(
    next.persona,
    next.customPersona,
    next.chattiness,
    next.discoveryAppetite,
    next.ttsEnabled ? 1 : 0,
    next.ttsVoice,
    next.ttsDuckVolume,
  );
```

**Step 7: Commit**
```bash
git add server/src/database/repositories/dj-preferences.repo.ts
git commit -m "feat: add TTS fields to DjPreferences type and repo"
```

---

### Task 3: Add TTS config to config.ts

**Files:**
- Modify: `server/src/config.ts`

**Step 1: Add `tts` block to the Zod schema**

After the `ai` block closing `}),` add:
```typescript
  tts: z.object({
    piperBinaryPath: z.string().optional(),
    piperVoicesDir: z.string().optional(),
  }),
```

**Step 2: Add `tts` block to `loadConfig()` raw object**

After the `ai` block closing `},` add:
```typescript
    tts: {
      piperBinaryPath: process.env.PIPER_BINARY_PATH,
      piperVoicesDir: process.env.PIPER_VOICES_DIR,
    },
```

**Step 3: Update `.env.example` (if it exists)**

Add to `server/.env.example`:
```
# TTS (optional — voice requires Piper installed)
PIPER_BINARY_PATH=C:\path\to\piper.exe
PIPER_VOICES_DIR=C:\path\to\voices
```

**Step 4: Commit**
```bash
git add server/src/config.ts server/.env.example
git commit -m "feat: add Piper TTS config env vars"
```

---

### Task 4: Create tts/adapter.ts — abstract TTS interface

**Files:**
- Create: `server/src/tts/adapter.ts`

**Step 1: Write the file**

```typescript
export interface Voice {
  id: string;
  name: string;
}

export interface TtsAdapter {
  speak(text: string): Promise<Buffer>;
  listVoices(): Promise<Voice[]>;
  isAvailable(): boolean;
}
```

**Step 2: Commit**
```bash
git add server/src/tts/adapter.ts
git commit -m "feat: add TtsAdapter abstract interface"
```

---

### Task 5: Create tts/piper.ts — Piper subprocess implementation

**Files:**
- Create: `server/src/tts/piper.ts`

**Step 1: Write the file**

```typescript
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { config } from '../config.js';
import { AiError } from '../shared/errors.js';
import { logger } from '../shared/logger.js';
import type { TtsAdapter, Voice } from './adapter.js';

const SPEAK_TIMEOUT_MS = 10_000;
const SAMPLE_PHRASE = "And now, here's a track I think you'll love.";

export class PiperAdapter implements TtsAdapter {
  isAvailable(): boolean {
    const bin = config.tts.piperBinaryPath;
    return !!bin && existsSync(bin);
  }

  async listVoices(): Promise<Voice[]> {
    const dir = config.tts.piperVoicesDir;
    if (!dir || !existsSync(dir)) return [];

    return readdirSync(dir)
      .filter((f) => f.endsWith('.onnx'))
      .map((f) => ({
        id: f,
        name: basename(f, '.onnx').replace(/[_-]/g, ' '),
      }));
  }

  async speak(text: string, voiceId?: string | null): Promise<Buffer> {
    if (!this.isAvailable()) {
      throw new AiError('Piper binary not found');
    }

    const bin = config.tts.piperBinaryPath!;
    const voicesDir = config.tts.piperVoicesDir ?? '';
    const voice = voiceId ?? (await this.listVoices())[0]?.id;

    if (!voice) {
      throw new AiError('No Piper voice model found');
    }

    const modelPath = join(voicesDir, voice);

    return new Promise((resolve, reject) => {
      const proc = spawn(bin, ['--model', modelPath, '--output_file', '-'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const chunks: Buffer[] = [];
      const timer = setTimeout(() => {
        proc.kill();
        reject(new AiError('Piper TTS timed out'));
      }, SPEAK_TIMEOUT_MS);

      proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
      proc.stderr.on('data', (data: Buffer) => {
        logger.debug({ msg: data.toString() }, 'Piper stderr');
      });

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(new AiError(`Piper exited with code ${code}`));
        } else {
          resolve(Buffer.concat(chunks));
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(new AiError(`Failed to spawn Piper: ${err.message}`));
      });

      proc.stdin.write(text);
      proc.stdin.end();
    });
  }

  async preview(voiceId: string): Promise<Buffer> {
    return this.speak(SAMPLE_PHRASE, voiceId);
  }
}

export const piperAdapter = new PiperAdapter();
```

**Step 2: Commit**
```bash
git add server/src/tts/piper.ts
git commit -m "feat: add PiperAdapter TTS implementation with subprocess + timeout"
```

---

### Task 6: Create tts.routes.ts — HTTP endpoints

**Files:**
- Create: `server/src/api/routes/tts.routes.ts`

**Step 1: Write the file**

```typescript
import type { FastifyInstance } from 'fastify';
import { piperAdapter } from '../../tts/piper.js';
import { getDjPreferences, updateDjPreferences } from '../../database/repositories/dj-preferences.repo.js';
import { logger } from '../../shared/logger.js';

const TTS_UNAVAILABLE = { error: 'tts_unavailable', message: 'Piper TTS is not installed or configured.' };

export async function ttsRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/tts/voices
   * List available Piper voice models from PIPER_VOICES_DIR.
   */
  fastify.get('/voices', async (_request, reply) => {
    if (!piperAdapter.isAvailable()) {
      return reply.status(503).send(TTS_UNAVAILABLE);
    }
    const voices = await piperAdapter.listVoices();
    return { voices };
  });

  /**
   * GET /api/tts/speak?text=…
   * Generate and return WAV audio for the given text using the saved voice.
   */
  fastify.get<{ Querystring: { text: string } }>('/speak', async (request, reply) => {
    if (!piperAdapter.isAvailable()) {
      return reply.status(503).send(TTS_UNAVAILABLE);
    }

    const { text } = request.query;
    if (!text || text.trim().length === 0) {
      return reply.status(400).send({ error: 'text query parameter is required' });
    }

    const prefs = getDjPreferences();

    try {
      const wav = await piperAdapter.speak(text.trim(), prefs.ttsVoice);
      reply.header('Content-Type', 'audio/wav');
      reply.header('Content-Length', wav.length);
      return reply.send(wav);
    } catch (err) {
      logger.warn({ err }, 'TTS speak failed');
      return reply.status(503).send(TTS_UNAVAILABLE);
    }
  });

  /**
   * POST /api/tts/preview
   * Generate a WAV preview for a specific voice using a sample phrase.
   */
  fastify.post<{ Body: { voiceId: string } }>('/preview', async (request, reply) => {
    if (!piperAdapter.isAvailable()) {
      return reply.status(503).send(TTS_UNAVAILABLE);
    }

    const { voiceId } = request.body ?? {};
    if (!voiceId) {
      return reply.status(400).send({ error: 'voiceId is required' });
    }

    try {
      const wav = await piperAdapter.preview(voiceId);
      reply.header('Content-Type', 'audio/wav');
      reply.header('Content-Length', wav.length);
      return reply.send(wav);
    } catch (err) {
      logger.warn({ err, voiceId }, 'TTS preview failed');
      return reply.status(503).send(TTS_UNAVAILABLE);
    }
  });

  /**
   * PUT /api/tts/settings
   * Persist TTS preferences: enabled, voice, duck volume.
   */
  fastify.put<{ Body: { ttsEnabled?: boolean; ttsVoice?: string | null; ttsDuckVolume?: number } }>(
    '/settings',
    async (request, reply) => {
      const { ttsEnabled, ttsVoice, ttsDuckVolume } = request.body ?? {};
      const updated = updateDjPreferences({
        ...(ttsEnabled !== undefined && { ttsEnabled }),
        ...(ttsVoice !== undefined && { ttsVoice }),
        ...(ttsDuckVolume !== undefined && { ttsDuckVolume }),
      });
      return reply.send({
        ttsEnabled: updated.ttsEnabled,
        ttsVoice: updated.ttsVoice,
        ttsDuckVolume: updated.ttsDuckVolume,
      });
    },
  );
}
```

**Step 2: Commit**
```bash
git add server/src/api/routes/tts.routes.ts
git commit -m "feat: add TTS routes (speak, voices, preview, settings)"
```

---

### Task 7: Add setVolume to Spotify player + playback route

**Files:**
- Modify: `server/src/spotify/player.ts`
- Modify: `server/src/api/routes/playback.routes.ts`

**Step 1: Add `setVolume` to `server/src/spotify/player.ts`**

Append after the last export in the file:
```typescript
/**
 * Set Spotify playback volume (0–100).
 */
export async function setVolume(volumePercent: number): Promise<void> {
  const clamped = Math.max(0, Math.min(100, Math.round(volumePercent)));
  await spotifyFetch(`/me/player/volume?volume_percent=${clamped}`, { method: 'PUT' });
}
```

**Step 2: Add the route in `server/src/api/routes/playback.routes.ts`**

Add `setVolume` to the import at the top of the file. The existing import looks like:
```typescript
import { getPlayerState, getDevices, pause, resume, skipToPrevious } from '../../spotify/player.js';
```
Change to:
```typescript
import { getPlayerState, getDevices, pause, resume, skipToPrevious, setVolume } from '../../spotify/player.js';
```

Then find a good place (e.g., after the resume route) and add:
```typescript
  /**
   * PUT /api/playback/volume
   * Set Spotify playback volume. Body: { volumePercent: number (0–100) }
   */
  fastify.put<{ Body: { volumePercent: number } }>('/volume', async (request, reply) => {
    const { volumePercent } = request.body ?? {};
    if (typeof volumePercent !== 'number') {
      return reply.status(400).send({ error: 'volumePercent (number) is required' });
    }
    try {
      await setVolume(volumePercent);
      return reply.send({ volumePercent: Math.max(0, Math.min(100, Math.round(volumePercent))) });
    } catch (err) {
      return reply.status(500).send({ error: 'Failed to set volume' });
    }
  });
```

**Step 3: Commit**
```bash
git add server/src/spotify/player.ts server/src/api/routes/playback.routes.ts
git commit -m "feat: add setVolume to Spotify player and PUT /api/playback/volume route"
```

---

### Task 8: Register TTS routes in server.ts + TypeScript check

**Files:**
- Modify: `server/src/api/server.ts`

**Step 1: Add the import**

After the `djRoutes` import line:
```typescript
import { djRoutes } from './routes/dj.routes.js';
```
Add:
```typescript
import { ttsRoutes } from './routes/tts.routes.js';
```

**Step 2: Register the routes**

After:
```typescript
  await server.register(djRoutes, { prefix: '/api/dj' });
```
Add:
```typescript
  await server.register(ttsRoutes, { prefix: '/api/tts' });
```

**Step 3: Run TypeScript check**

```bash
cd server && npx tsc --noEmit
```
Expected: no errors. Fix any type errors before continuing.

**Step 4: Commit**
```bash
git add server/src/api/server.ts
git commit -m "feat: register TTS routes and verify TypeScript"
```

---

### Task 9: Add just_audio to pubspec.yaml + TTS + volume methods to api_service.dart

**Files:**
- Modify: `client/pubspec.yaml`
- Modify: `client/lib/services/api_service.dart`

**Step 1: Add just_audio to pubspec.yaml**

In the `dependencies:` section, after `url_launcher: ^6.3.0`, add:
```yaml
  just_audio: ^0.9.40
```

**Step 2: Add volume method to api_service.dart**

Find the playback section in `api_service.dart`. After the `resume()` method, add:
```dart
  /// Set Spotify playback volume (0–100).
  Future<void> setVolume(int volumePercent) async {
    await _dio.put('/playback/volume', data: {'volumePercent': volumePercent});
  }
```

**Step 3: Add TTS methods to api_service.dart**

Add a new section near the end of the class (before the closing `}`):
```dart
  // ── TTS ──────────────────────────────────────────────────────────────────

  /// List available Piper voice models.
  Future<List<Map<String, dynamic>>> getTtsVoices() async {
    final response = await _dio.get('/tts/voices');
    final voices = response.data['voices'] as List<dynamic>? ?? [];
    return voices.cast<Map<String, dynamic>>();
  }

  /// Generate a WAV preview for a specific voice. Returns raw bytes.
  Future<List<int>> previewTtsVoice(String voiceId) async {
    final response = await _dio.post<List<int>>(
      '/tts/preview',
      data: {'voiceId': voiceId},
      options: Options(responseType: ResponseType.bytes),
    );
    return response.data ?? [];
  }

  /// Update TTS settings on the server.
  Future<void> updateTtsSettings({
    bool? ttsEnabled,
    String? ttsVoice,
    double? ttsDuckVolume,
  }) async {
    await _dio.put('/tts/settings', data: {
      if (ttsEnabled != null) 'ttsEnabled': ttsEnabled,
      if (ttsVoice != null) 'ttsVoice': ttsVoice,
      if (ttsDuckVolume != null) 'ttsDuckVolume': ttsDuckVolume,
    });
  }

  /// Get current playback state (includes volumePercent).
  Future<Map<String, dynamic>> getPlaybackCurrent() async {
    final response = await _dio.get('/playback/current');
    return response.data as Map<String, dynamic>? ?? {};
  }
```

**Step 4: Commit**
```bash
git add client/pubspec.yaml client/lib/services/api_service.dart
git commit -m "feat: add just_audio dep and TTS + volume methods to api_service"
```

---

### Task 10: Extend DjPreferences in dj_provider.dart with TTS fields

**Files:**
- Modify: `client/lib/providers/dj_provider.dart`

**Step 1: Add TTS fields to the `DjPreferences` class**

After `onboardingCompleted: false,` in the constructor, add:
```dart
    this.ttsEnabled = false,
    this.ttsVoice,
    this.ttsDuckVolume = 0.3,
```

Add the field declarations after `final bool onboardingCompleted;`:
```dart
  final bool ttsEnabled;
  final String? ttsVoice;
  final double ttsDuckVolume;
```

**Step 2: Update `copyWith`**

After `bool? onboardingCompleted,` add:
```dart
    bool? ttsEnabled,
    String? ttsVoice,
    double? ttsDuckVolume,
```

After `onboardingCompleted: onboardingCompleted ?? this.onboardingCompleted,` add:
```dart
      ttsEnabled: ttsEnabled ?? this.ttsEnabled,
      ttsVoice: ttsVoice ?? this.ttsVoice,
      ttsDuckVolume: ttsDuckVolume ?? this.ttsDuckVolume,
```

**Step 3: Update `fromJson`**

After `onboardingCompleted: json['onboardingCompleted'] as bool? ?? false,` add:
```dart
      ttsEnabled: json['ttsEnabled'] as bool? ?? false,
      ttsVoice: json['ttsVoice'] as String?,
      ttsDuckVolume: (json['ttsDuckVolume'] as num?)?.toDouble() ?? 0.3,
```

**Step 4: Update `_applyPatch` in `DjNotifier`**

After `discoveryAppetite: patch['discoveryAppetite'] as String?,` add:
```dart
      ttsEnabled: patch['ttsEnabled'] as bool?,
      ttsVoice: patch['ttsVoice'] as String?,
      ttsDuckVolume: (patch['ttsDuckVolume'] as num?)?.toDouble(),
```

**Step 5: Commit**
```bash
git add client/lib/providers/dj_provider.dart
git commit -m "feat: add TTS fields to DjPreferences in dj_provider"
```

---

### Task 11: Create tts_service.dart — audio lifecycle

**Files:**
- Create: `client/lib/services/tts_service.dart`

**Step 1: Write the file**

```dart
import 'package:just_audio/just_audio.dart';
import 'api_service.dart';
import '../config/constants.dart';

class TtsService {
  /// Speak patter text: duck Spotify volume, play WAV, restore.
  ///
  /// [text] — the patter to speak.
  /// [duckVolume] — Spotify volume fraction during speech (0.0–1.0).
  ///
  /// Silently no-ops if [text] is empty or the server returns 503.
  Future<void> speakPatter(String text, double duckVolume) async {
    if (text.trim().isEmpty) return;

    // Get current volume so we can restore it.
    int originalVolume = 50;
    try {
      final state = await apiService.getPlaybackCurrent();
      originalVolume = (state['volumePercent'] as num?)?.toInt() ?? 50;
    } catch (_) {}

    final duckPercent = (originalVolume * duckVolume).round().clamp(0, 100);

    try {
      await apiService.setVolume(duckPercent);

      final player = AudioPlayer();
      try {
        final url = '${apiService.baseUrl}/tts/speak?text=${Uri.encodeComponent(text.trim())}';
        await player.setUrl(url);
        await player.play();
        await player.processingStateStream
            .firstWhere((s) => s == ProcessingState.completed);
      } finally {
        await player.dispose();
      }
    } finally {
      // Always restore volume, even on error.
      try {
        await apiService.setVolume(originalVolume);
      } catch (_) {}
    }
  }
}

final ttsService = TtsService();
```

**Step 2: Commit**
```bash
git add client/lib/services/tts_service.dart
git commit -m "feat: add TtsService for duck-play-restore audio lifecycle"
```

---

### Task 12: Update home_screen.dart — invoke TtsService on curator_update

**Files:**
- Modify: `client/lib/screens/home_screen.dart`

**Step 1: Add the import**

At the top of the file, after the existing service imports, add:
```dart
import '../services/tts_service.dart';
import '../providers/dj_provider.dart';
```
(If `dj_provider.dart` is already imported, skip it.)

**Step 2: Invoke TtsService in the curator_update case**

Find the WS handler case (around line 249–250):
```dart
        case 'curator_update':
          ref.read(djProvider.notifier).onCuratorUpdate(data);
```

Replace with:
```dart
        case 'curator_update':
          ref.read(djProvider.notifier).onCuratorUpdate(data);
          final patter = data['patter'] as String? ?? '';
          final prefs = ref.read(djProvider).preferences;
          if (patter.isNotEmpty && prefs.ttsEnabled && prefs.chattiness != 'silent') {
            ttsService.speakPatter(patter, prefs.ttsDuckVolume).catchError((_) {});
          }
```

**Step 3: Commit**
```bash
git add client/lib/screens/home_screen.dart
git commit -m "feat: invoke TtsService on curator_update in home_screen"
```

---

### Task 13: Update settings_screen.dart — replace coming-soon stub with real DJ Voice UI

**Files:**
- Modify: `client/lib/screens/settings_screen.dart`

**Step 1: Add state variables for TTS**

In `_SettingsScreenState`, after the existing state variables, add:
```dart
  // TTS / DJ Voice settings
  bool _ttsEnabled = false;
  String? _ttsVoice;
  double _ttsDuckVolume = 0.3;
  List<Map<String, dynamic>> _ttsVoices = [];
  bool _ttsAvailable = true;
  bool _ttsPreviewLoading = false;
```

**Step 2: Load TTS settings in `initState` or `_loadSettings`**

In whatever lifecycle method loads settings (look for `_loadSettings()` or `initState`), add:
```dart
    try {
      final prefs = ref.read(djProvider).preferences;
      setState(() {
        _ttsEnabled = prefs.ttsEnabled;
        _ttsVoice = prefs.ttsVoice;
        _ttsDuckVolume = prefs.ttsDuckVolume;
      });
      final voices = await apiService.getTtsVoices();
      setState(() {
        _ttsVoices = voices;
        _ttsAvailable = true;
      });
    } catch (e) {
      // 503 means Piper not installed
      setState(() => _ttsAvailable = false);
    }
```

**Step 3: Replace the coming-soon Opacity block**

Find and replace this entire block (lines ~411–444):
```dart
          // DJ Voice (coming soon)
          Opacity(
            opacity: 0.45,
            child: Column(
              ...
            ),
          ),
```

Replace with a call to a new builder method:
```dart
          _buildDjVoiceSection(),
```

**Step 4: Add the `_buildDjVoiceSection()` method**

Add this method to `_SettingsScreenState`:
```dart
  Widget _buildDjVoiceSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Text('DJ Voice', style: Theme.of(context).textTheme.headlineSmall),
            const Spacer(),
            Switch(
              value: _ttsEnabled,
              activeColor: OrpheusColors.lyreGold,
              onChanged: _ttsAvailable
                  ? (v) {
                      setState(() => _ttsEnabled = v);
                      ref.read(djProvider.notifier).updatePreferences({'ttsEnabled': v});
                      apiService.updateTtsSettings(ttsEnabled: v).catchError((_) {});
                    }
                  : null,
            ),
          ],
        ),
        const SizedBox(height: 4),
        Text(
          _ttsAvailable
              ? 'Spoken DJ commentary between tracks using Piper TTS.'
              : 'Piper TTS is not installed. Set PIPER_BINARY_PATH and PIPER_VOICES_DIR in your .env to enable.',
          style: Theme.of(context).textTheme.bodySmall,
        ),
        if (_ttsAvailable && _ttsEnabled) ...[
          const SizedBox(height: 16),
          // Voice selector
          DropdownButtonFormField<String>(
            value: _ttsVoices.any((v) => v['id'] == _ttsVoice) ? _ttsVoice : null,
            decoration: InputDecoration(
              labelText: 'Voice',
              labelStyle: OrpheusTypography.bodySmall.copyWith(color: OrpheusColors.mist),
              filled: true,
              fillColor: OrpheusColors.onyx,
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
            ),
            dropdownColor: OrpheusColors.onyx,
            style: OrpheusTypography.bodySmall.copyWith(color: OrpheusColors.ivory),
            items: _ttsVoices
                .map((v) => DropdownMenuItem<String>(
                      value: v['id'] as String,
                      child: Text(v['name'] as String? ?? v['id'] as String),
                    ))
                .toList(),
            onChanged: (v) {
              setState(() => _ttsVoice = v);
              apiService.updateTtsSettings(ttsVoice: v).catchError((_) {});
            },
          ),
          const SizedBox(height: 8),
          // Preview button
          OutlinedButton.icon(
            onPressed: _ttsPreviewLoading || _ttsVoice == null
                ? null
                : () async {
                    setState(() => _ttsPreviewLoading = true);
                    try {
                      final bytes = await apiService.previewTtsVoice(_ttsVoice!);
                      if (bytes.isNotEmpty) {
                        final player = AudioPlayer();
                        await player.setAudioSource(
                          AudioSource.uri(Uri.dataFromBytes(bytes, mimeType: 'audio/wav')),
                        );
                        await player.play();
                        await player.processingStateStream
                            .firstWhere((s) => s == ProcessingState.completed);
                        await player.dispose();
                      }
                    } catch (_) {
                    } finally {
                      if (mounted) setState(() => _ttsPreviewLoading = false);
                    }
                  },
            icon: _ttsPreviewLoading
                ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.play_arrow, size: 18),
            label: Text('Preview voice', style: OrpheusTypography.bodySmall),
            style: OutlinedButton.styleFrom(foregroundColor: OrpheusColors.lyreGold),
          ),
          const SizedBox(height: 16),
          // Duck volume slider
          Row(
            children: [
              Expanded(
                child: Text('Music volume during speech', style: OrpheusTypography.bodySmall.copyWith(color: OrpheusColors.mist)),
              ),
              Text(
                '${(_ttsDuckVolume * 100).round()}%',
                style: OrpheusTypography.labelSmall.copyWith(color: OrpheusColors.lyreGold),
              ),
            ],
          ),
          Slider(
            value: _ttsDuckVolume,
            min: 0.0,
            max: 1.0,
            divisions: 20,
            activeColor: OrpheusColors.lyreGold,
            inactiveColor: OrpheusColors.slate,
            onChanged: (v) => setState(() => _ttsDuckVolume = v),
            onChangeEnd: (v) {
              apiService.updateTtsSettings(ttsDuckVolume: v).catchError((_) {});
            },
          ),
        ],
      ],
    );
  }
```

**Step 5: Add just_audio import to settings_screen.dart**

At the top of the file, add:
```dart
import 'package:just_audio/just_audio.dart';
```

**Step 6: Commit**
```bash
git add client/lib/screens/settings_screen.dart
git commit -m "feat: replace DJ Voice coming-soon stub with live Piper TTS settings UI"
```

---

### Task 14: TypeScript final check + docs update + branch commit

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`

**Step 1: Run final TypeScript check**
```bash
cd server && npx tsc --noEmit
```
Expected: no errors.

**Step 2: Update CLAUDE.md**

In the Server architecture section, update:
- **AI** (`ai/`) — add note that `generateChat<T>()` is used by TTS routes (no — TTS doesn't use Ollama, it uses Piper directly)
- **Spotify** (`spotify/`) — add `setVolume()` to the player description
- Add new **TTS** (`tts/`) module description:
  - `tts/adapter.ts` — `TtsAdapter` interface: `speak()`, `listVoices()`, `isAvailable()`
  - `tts/piper.ts` — Piper CLI subprocess, 10s timeout, stdout WAV capture, singleton `piperAdapter`
- **API** — add `tts` route module to the list (4 endpoints: speak, voices, preview, settings)
- **Database** — update schema to v8, add TTS columns
- **Client** — update `settings_screen.dart` description (DJ Voice section now live), add `tts_service.dart`

**Step 3: Update README.md**

- Add TTS section to features
- Add `PUT /api/playback/volume` to API endpoints
- Add TTS endpoints table
- Update project structure with `tts/` module and `tts_service.dart`

**Step 4: Final commit**
```bash
git add CLAUDE.md README.md
git commit -m "docs: update CLAUDE.md and README for DJ Voice Phase 2"
```
