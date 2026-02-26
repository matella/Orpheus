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

/// Manages steering control state with debounced API updates.
class SteeringNotifier extends Notifier<Map<String, double>> {
  Timer? _debounceTimer;

  @override
  Map<String, double> build() {
    ref.onDispose(() => _debounceTimer?.cancel());
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

  /// Send current state to the server.
  Future<void> _sendToServer() async {
    try {
      await apiService.updateSteeringControls(state);
    } catch (_) {
      // Silently fail — user sees local state immediately
    }
  }
}

/// Global steering controls provider.
final steeringProvider =
    NotifierProvider<SteeringNotifier, Map<String, double>>(
  SteeringNotifier.new,
);
