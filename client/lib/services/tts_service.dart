import 'package:just_audio/just_audio.dart';
import 'api_service.dart';

class TtsService {
  /// Speak patter text: duck Spotify volume, play WAV, restore.
  ///
  /// [text] — the patter to speak.
  /// [duckVolume] — Spotify volume fraction during speech (0.0–1.0).
  ///
  /// Silently no-ops if [text] is empty or the server returns an error.
  Future<void> speakPatter(String text, double duckVolume) async {
    if (text.trim().isEmpty) return;

    // Get current volume so we can restore it after playback.
    int originalVolume = 50;
    try {
      final state = await apiService.getCurrentPlayback();
      originalVolume = (state?['volumePercent'] as num?)?.toInt() ?? 50;
    } catch (_) {}

    final duckPercent = (originalVolume * duckVolume).round().clamp(0, 100);

    try {
      await apiService.setVolume(duckPercent);

      final player = AudioPlayer();
      try {
        final url =
            '${apiService.baseUrl}/tts/speak?text=${Uri.encodeComponent(text.trim())}';
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
