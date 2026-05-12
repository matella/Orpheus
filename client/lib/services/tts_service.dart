import 'package:just_audio/just_audio.dart';
import 'api_service.dart';

class TtsService {
  bool _speaking = false;

  /// Speak patter text: duck Spotify volume, play WAV, restore.
  ///
  /// No-ops if text is empty or a playback is already in progress.
  Future<void> speakPatter(String text, double duckVolume) async {
    if (text.trim().isEmpty || _speaking) return;
    _speaking = true;

    int originalVolume = 50;
    try {
      final state = await apiService.getCurrentPlayback();
      originalVolume = (state?['volumePercent'] as num?)?.toInt() ?? 50;
    } catch (_) {}

    final duckPercent = (originalVolume * duckVolume).round().clamp(0, 100);

    try {
      await apiService.setVolume(duckPercent);

      final bytes = await apiService.fetchTtsAudio(text.trim());
      if (bytes.isEmpty) return;

      final player = AudioPlayer();
      try {
        await player.setAudioSource(
          AudioSource.uri(Uri.dataFromBytes(bytes, mimeType: 'audio/wav')),
        );
        await player.play();
        await player.processingStateStream
            .firstWhere((s) => s == ProcessingState.completed);
      } finally {
        await player.dispose();
      }
    } finally {
      _speaking = false;
      try {
        await apiService.setVolume(originalVolume);
      } catch (_) {}
    }
  }
}

final ttsService = TtsService();
