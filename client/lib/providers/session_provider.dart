import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';

class SessionState {
  final Map<String, dynamic>? activeSession;
  final List<dynamic> activeSessionTracks;
  final List<dynamic> activeSessionStateHistory;
  final List<dynamic> sessionHistory;
  final int totalSessions;
  final bool isLoading;

  const SessionState({
    this.activeSession,
    this.activeSessionTracks = const [],
    this.activeSessionStateHistory = const [],
    this.sessionHistory = const [],
    this.totalSessions = 0,
    this.isLoading = false,
  });

  SessionState copyWith({
    Map<String, dynamic>? activeSession,
    List<dynamic>? activeSessionTracks,
    List<dynamic>? activeSessionStateHistory,
    List<dynamic>? sessionHistory,
    int? totalSessions,
    bool? isLoading,
  }) {
    return SessionState(
      activeSession: activeSession ?? this.activeSession,
      activeSessionTracks: activeSessionTracks ?? this.activeSessionTracks,
      activeSessionStateHistory:
          activeSessionStateHistory ?? this.activeSessionStateHistory,
      sessionHistory: sessionHistory ?? this.sessionHistory,
      totalSessions: totalSessions ?? this.totalSessions,
      isLoading: isLoading ?? this.isLoading,
    );
  }
}

class SessionNotifier extends Notifier<SessionState> {
  @override
  SessionState build() => const SessionState();

  Future<void> loadActiveSession() async {
    state = state.copyWith(isLoading: true);
    try {
      final data = await apiService.getActiveSession();
      state = state.copyWith(
        activeSession: data['session'],
        activeSessionTracks: data['tracks'] ?? [],
        activeSessionStateHistory: data['stateHistory'] ?? [],
        isLoading: false,
      );
    } catch (_) {
      state = state.copyWith(isLoading: false);
    }
  }

  Future<void> loadSessionHistory({int limit = 20, int offset = 0}) async {
    try {
      final data = await apiService.getSessions(limit: limit, offset: offset);
      state = state.copyWith(
        sessionHistory: data['sessions'] ?? [],
        totalSessions: data['total'] ?? 0,
      );
    } catch (_) {}
  }

  Future<void> refresh() async {
    await Future.wait([
      loadActiveSession(),
      loadSessionHistory(),
    ]);
  }
}

final sessionProvider = NotifierProvider<SessionNotifier, SessionState>(
  SessionNotifier.new,
);
