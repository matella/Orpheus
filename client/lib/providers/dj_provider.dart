import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart' show apiService;

// ── State ────────────────────────────────────────────────────────────────────

class DjPreferences {
  final String persona;
  final String? customPersona;
  final String chattiness;
  final String discoveryAppetite;
  final bool onboardingCompleted;
  final bool ttsEnabled;
  final String? ttsVoice;
  final double ttsDuckVolume;

  const DjPreferences({
    this.persona = 'curator',
    this.customPersona,
    this.chattiness = 'balanced',
    this.discoveryAppetite = 'comfort',
    this.onboardingCompleted = false,
    this.ttsEnabled = false,
    this.ttsVoice,
    this.ttsDuckVolume = 0.3,
  });

  DjPreferences copyWith({
    String? persona,
    String? customPersona,
    String? chattiness,
    String? discoveryAppetite,
    bool? onboardingCompleted,
    bool? ttsEnabled,
    String? ttsVoice,
    double? ttsDuckVolume,
  }) {
    return DjPreferences(
      persona: persona ?? this.persona,
      customPersona: customPersona ?? this.customPersona,
      chattiness: chattiness ?? this.chattiness,
      discoveryAppetite: discoveryAppetite ?? this.discoveryAppetite,
      onboardingCompleted: onboardingCompleted ?? this.onboardingCompleted,
      ttsEnabled: ttsEnabled ?? this.ttsEnabled,
      ttsVoice: ttsVoice ?? this.ttsVoice,
      ttsDuckVolume: ttsDuckVolume ?? this.ttsDuckVolume,
    );
  }

  factory DjPreferences.fromJson(Map<String, dynamic> json) {
    return DjPreferences(
      persona: json['persona'] as String? ?? 'curator',
      customPersona: json['customPersona'] as String?,
      chattiness: json['chattiness'] as String? ?? 'balanced',
      discoveryAppetite: json['discoveryAppetite'] as String? ?? 'comfort',
      onboardingCompleted: json['onboardingCompleted'] as bool? ?? false,
      ttsEnabled: json['ttsEnabled'] as bool? ?? false,
      ttsVoice: json['ttsVoice'] as String?,
      ttsDuckVolume: (json['ttsDuckVolume'] as num?)?.toDouble() ?? 0.3,
    );
  }
}

class CuratorPick {
  final String trackId;
  final String name;
  final String artist;
  final String? source;
  final String reason;

  const CuratorPick({
    required this.trackId,
    required this.name,
    required this.artist,
    this.source,
    required this.reason,
  });

  factory CuratorPick.fromJson(Map<String, dynamic> json) {
    final track = json['track'] as Map<String, dynamic>? ?? {};
    return CuratorPick(
      trackId: track['spotifyId'] as String? ?? '',
      name: track['name'] as String? ?? '',
      artist: track['artist'] as String? ?? '',
      source: track['source'] as String?,
      reason: json['reason'] as String? ?? '',
    );
  }
}

class DjState {
  final DjPreferences preferences;
  final String patter;
  final String? currentPickReason;
  final List<CuratorPick> upNext;
  final bool isLoading;
  final bool isFallback;
  final String? fallbackReason;

  const DjState({
    this.preferences = const DjPreferences(),
    this.patter = '',
    this.currentPickReason,
    this.upNext = const [],
    this.isLoading = false,
    this.isFallback = false,
    this.fallbackReason,
  });

  DjState copyWith({
    DjPreferences? preferences,
    String? patter,
    String? currentPickReason,
    List<CuratorPick>? upNext,
    bool? isLoading,
    bool? isFallback,
    String? fallbackReason,
  }) {
    return DjState(
      preferences: preferences ?? this.preferences,
      patter: patter ?? this.patter,
      currentPickReason: currentPickReason ?? this.currentPickReason,
      upNext: upNext ?? this.upNext,
      isLoading: isLoading ?? this.isLoading,
      isFallback: isFallback ?? this.isFallback,
      fallbackReason: fallbackReason ?? this.fallbackReason,
    );
  }

  String get personaDisplayName {
    switch (preferences.persona) {
      case 'curator': return 'The Curator';
      case 'late_night': return 'Late Night Radio';
      case 'hype': return 'Hype DJ';
      case 'chill': return 'Chill Host';
      case 'custom': return 'Custom';
      default: return 'DJ';
    }
  }

  String get personaIcon {
    switch (preferences.persona) {
      case 'curator': return '🎵';
      case 'late_night': return '🌙';
      case 'hype': return '🔥';
      case 'chill': return '☁️';
      case 'custom': return '✨';
      default: return '🎧';
    }
  }
}

// ── Notifier ─────────────────────────────────────────────────────────────────

class DjNotifier extends Notifier<DjState> {
  @override
  DjState build() {
    _loadPreferences();
    return const DjState(isLoading: true);
  }

  Future<void> _loadPreferences() async {
    try {
      final api = apiService;
      final data = await api.getDjPreferences();
      state = state.copyWith(
        preferences: DjPreferences.fromJson(data),
        isLoading: false,
      );
    } catch (_) {
      state = state.copyWith(isLoading: false);
    }
  }

  Future<void> updatePreferences(Map<String, dynamic> patch) async {
    final optimistic = _applyPatch(state.preferences, patch);
    state = state.copyWith(preferences: optimistic);

    try {
      final api = apiService;
      final data = await api.updateDjPreferences(patch);
      state = state.copyWith(preferences: DjPreferences.fromJson(data));
    } catch (_) {
      // Keep optimistic state on error — server will sync on next load
    }
  }

  DjPreferences _applyPatch(DjPreferences current, Map<String, dynamic> patch) {
    return current.copyWith(
      persona: patch['persona'] as String?,
      customPersona: patch['customPersona'] as String?,
      chattiness: patch['chattiness'] as String?,
      discoveryAppetite: patch['discoveryAppetite'] as String?,
      ttsEnabled: patch['ttsEnabled'] as bool?,
      ttsVoice: patch['ttsVoice'] as String?,
      ttsDuckVolume: (patch['ttsDuckVolume'] as num?)?.toDouble(),
    );
  }

  // Called by WebSocket handler when curator_update arrives
  void onCuratorUpdate(Map<String, dynamic> data) {
    final picks = (data['picks'] as List<dynamic>? ?? [])
        .map((p) => CuratorPick.fromJson(p as Map<String, dynamic>))
        .toList();
    final patter = data['patter'] as String? ?? '';

    // upNext = picks[1..] (pick[0] is about to play)
    final upNext = picks.length > 1 ? picks.sublist(1) : <CuratorPick>[];
    final currentPickReason = picks.isNotEmpty ? picks[0].reason : null;

    state = state.copyWith(
      patter: patter,
      currentPickReason: currentPickReason,
      upNext: upNext,
      isFallback: false,
      fallbackReason: null,
    );
  }

  // Called by WebSocket handler when curator_fallback arrives
  void onCuratorFallback(Map<String, dynamic> data) {
    state = state.copyWith(
      isFallback: true,
      fallbackReason: data['reason'] as String?,
      patter: '',
    );
  }

  // Called by WebSocket handler when curator_restored arrives
  void onCuratorRestored() {
    state = state.copyWith(isFallback: false, fallbackReason: null);
  }

  // Clear patter when a new track starts (so stale patter isn't shown)
  void onTrackChanged() {
    state = state.copyWith(patter: '');
  }

  Future<void> markOnboardingComplete() async {
    try {
      final api = apiService;
      await api.markDjOnboardingComplete();
      state = state.copyWith(
        preferences: state.preferences.copyWith(onboardingCompleted: true),
      );
    } catch (_) {}
  }
}

// ── Providers ────────────────────────────────────────────────────────────────

final djProvider = NotifierProvider<DjNotifier, DjState>(DjNotifier.new);
