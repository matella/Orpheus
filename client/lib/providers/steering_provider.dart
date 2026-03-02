import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../config/constants.dart';
import '../services/api_service.dart';

/// Default steering values (all neutral at 0.5).
const Map<String, double> _defaultSteering = {
  'energy': 0.5,
  'mood': 0.5,
  'familiarity': 0.5,
  'vocalVsInstrumental': 0.5,
  'aggressiveness': 0.5,
  'genreOpenness': 0.5,
  'focusVsParty': 0.5,
};

// ── Sync Status ──────────────────────────────────────────────────────

/// Sync lifecycle for steering controls.
enum SteeringSyncStatus { idle, syncing, synced, error }

/// Tracks whether the latest steering change has been confirmed by the server.
class SteeringSyncNotifier extends Notifier<SteeringSyncStatus> {
  Timer? _resetTimer;

  @override
  SteeringSyncStatus build() {
    ref.onDispose(() => _resetTimer?.cancel());
    return SteeringSyncStatus.idle;
  }

  void setSyncing() {
    _resetTimer?.cancel();
    state = SteeringSyncStatus.syncing;
  }

  void setSynced() {
    state = SteeringSyncStatus.synced;
    _resetTimer?.cancel();
    _resetTimer = Timer(const Duration(milliseconds: 1500), () {
      state = SteeringSyncStatus.idle;
    });
  }

  void setError() {
    state = SteeringSyncStatus.error;
    // Persists until the next sync attempt clears it via setSyncing()
  }
}

/// Global sync-status provider for the steering controls.
final steeringSyncProvider =
    NotifierProvider<SteeringSyncNotifier, SteeringSyncStatus>(
  SteeringSyncNotifier.new,
);

// ── Steering Controls ────────────────────────────────────────────────

/// Manages steering control state with debounced API updates.
class SteeringNotifier extends Notifier<Map<String, double>> {
  Timer? _debounceTimer;
  Timer? _wsConfirmTimer;

  @override
  Map<String, double> build() {
    ref.onDispose(() {
      _debounceTimer?.cancel();
      _wsConfirmTimer?.cancel();
    });
    return {..._defaultSteering};
  }

  /// Load current steering controls from the server.
  Future<void> load() async {
    try {
      final data = await apiService.getSteeringControls();
      final controls = <String, double>{};
      for (final key in _defaultSteering.keys) {
        final val = data[key];
        if (val is num) {
          controls[key] = val.toDouble();
        } else {
          controls[key] = _defaultSteering[key]!;
        }
      }
      state = controls;
    } catch (_) {
      // Keep defaults on error
    }
  }

  /// Update a single control. Debounces the API call by 300ms.
  void updateControl(String key, double value) {
    state = {...state, key: value};

    _debounceTimer?.cancel();
    _debounceTimer = Timer(steeringDebounce, () {
      _sendToServer();
    });
  }

  /// Send current state to the server with sync-status feedback.
  Future<void> _sendToServer() async {
    _wsConfirmTimer?.cancel();
    ref.read(steeringSyncProvider.notifier).setSyncing();
    try {
      await apiService.updateSteeringControls(state);
      // HTTP succeeded — start fallback timer in case WebSocket is down.
      // If the WebSocket delivers `steering_updated` first, setSynced()
      // is called from the WS handler and this timer becomes a no-op.
      _wsConfirmTimer = Timer(const Duration(seconds: 2), () {
        final current = ref.read(steeringSyncProvider);
        if (current == SteeringSyncStatus.syncing) {
          ref.read(steeringSyncProvider.notifier).setSynced();
        }
      });
    } catch (_) {
      ref.read(steeringSyncProvider.notifier).setError();
    }
  }
}

/// Global steering controls provider.
final steeringProvider =
    NotifierProvider<SteeringNotifier, Map<String, double>>(
  SteeringNotifier.new,
);
