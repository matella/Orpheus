import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';
import '../services/websocket_service.dart';

enum PlaylistGenerationStatus { idle, generating, complete, error }

class PlaylistState {
  final PlaylistGenerationStatus status;
  final double progress;
  final String progressMessage;
  final Map<String, dynamic>? result;
  final String? errorMessage;

  const PlaylistState({
    this.status = PlaylistGenerationStatus.idle,
    this.progress = 0,
    this.progressMessage = '',
    this.result,
    this.errorMessage,
  });

  PlaylistState copyWith({
    PlaylistGenerationStatus? status,
    double? progress,
    String? progressMessage,
    Map<String, dynamic>? result,
    String? errorMessage,
  }) {
    return PlaylistState(
      status: status ?? this.status,
      progress: progress ?? this.progress,
      progressMessage: progressMessage ?? this.progressMessage,
      result: result ?? this.result,
      errorMessage: errorMessage ?? this.errorMessage,
    );
  }
}

class PlaylistNotifier extends Notifier<PlaylistState> {
  StreamSubscription<Map<String, dynamic>>? _wsSub;

  @override
  PlaylistState build() {
    ref.onDispose(() => _wsSub?.cancel());
    _listenToWebSocket();
    return const PlaylistState();
  }

  void _listenToWebSocket() {
    _wsSub?.cancel();
    _wsSub = wsService.messages.listen((msg) {
      final type = msg['type'];
      final data = msg['data'] as Map<String, dynamic>?;
      if (data == null) return;

      if (type == 'playlist_generation_progress') {
        final progress = (data['progress'] as num?)?.toDouble() ?? 0;
        final message = data['message'] as String? ?? '';
        state = state.copyWith(
          progress: progress,
          progressMessage: message,
        );
      } else if (type == 'playlist_generation_error' &&
          state.status == PlaylistGenerationStatus.generating) {
        state = state.copyWith(
          status: PlaylistGenerationStatus.error,
          errorMessage: data['message'] as String? ?? 'Generation failed',
        );
      }
    });
  }

  Future<void> generate(Map<String, dynamic> params) async {
    state = const PlaylistState(
      status: PlaylistGenerationStatus.generating,
      progress: 0,
      progressMessage: 'Starting...',
    );

    try {
      final result = await apiService.generatePlaylist(params);
      final playlist = result['playlist'] as Map<String, dynamic>?;
      if (playlist != null) {
        state = state.copyWith(
          status: PlaylistGenerationStatus.complete,
          progress: 100,
          progressMessage: 'Done!',
          result: playlist,
        );
      } else {
        state = state.copyWith(
          status: PlaylistGenerationStatus.error,
          errorMessage: result['message'] as String? ?? 'Unexpected response',
        );
      }
    } catch (e) {
      if (state.status != PlaylistGenerationStatus.error) {
        state = state.copyWith(
          status: PlaylistGenerationStatus.error,
          errorMessage: e.toString(),
        );
      }
    }
  }

  void reset() {
    state = const PlaylistState();
  }
}

final playlistProvider = NotifierProvider<PlaylistNotifier, PlaylistState>(
  PlaylistNotifier.new,
);
