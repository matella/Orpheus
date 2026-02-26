import 'package:dio/dio.dart';
import '../config/constants.dart';

class ApiService {
  late final Dio _dio;

  ApiService({String? baseUrl}) {
    _dio = Dio(BaseOptions(
      baseUrl: baseUrl ?? apiBaseUrl,
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 10),
      headers: {'Content-Type': 'application/json'},
    ));

    _dio.interceptors.add(LogInterceptor(
      requestBody: false,
      responseBody: true,
      logPrint: (obj) {}, // Silent in production
    ));
  }

  /// Check authentication status
  Future<Map<String, dynamic>> getAuthStatus() async {
    final response = await _dio.get('/auth/status');
    return response.data;
  }

  /// Get Spotify auth URL
  Future<String> getAuthUrl() async {
    final response = await _dio.get('/auth/login');
    return response.data['url'];
  }

  /// Health check
  Future<bool> checkHealth() async {
    try {
      final response = await _dio.get('/health');
      return response.data['status'] == 'ok';
    } catch (_) {
      return false;
    }
  }

  /// Get current playback state
  Future<Map<String, dynamic>?> getCurrentPlayback() async {
    try {
      final response = await _dio.get('/playback/current');
      return response.data;
    } catch (_) {
      return null;
    }
  }

  /// Skip current track
  Future<void> skipTrack() async {
    await _dio.post('/playback/skip');
  }

  /// Pause playback
  Future<void> pausePlayback() async {
    await _dio.post('/playback/pause');
  }

  /// Resume playback
  Future<void> resumePlayback() async {
    await _dio.post('/playback/resume');
  }

  /// Send like feedback
  Future<void> likeTrack({int? trackId}) async {
    await _dio.post('/feedback/like', data: {'trackId': trackId});
  }

  /// Send dislike feedback
  Future<void> dislikeTrack({int? trackId}) async {
    await _dio.post('/feedback/dislike', data: {'trackId': trackId});
  }

  /// Get steering controls
  Future<Map<String, dynamic>> getSteeringControls() async {
    final response = await _dio.get('/steering');
    return response.data;
  }

  /// Update steering controls
  Future<void> updateSteeringControls(Map<String, double> controls) async {
    await _dio.put('/steering', data: controls);
  }

  // --- Automation Settings ---

  /// Get automation settings
  Future<Map<String, dynamic>> getSettings() async {
    final response = await _dio.get('/settings');
    return response.data;
  }

  /// Update automation settings (partial update supported)
  Future<Map<String, dynamic>> updateSettings(Map<String, dynamic> settings) async {
    final response = await _dio.put('/settings', data: settings);
    return response.data;
  }

  // --- Engine Control ---

  /// Manually start the playback engine
  Future<Map<String, dynamic>> startEngine({String? deviceId}) async {
    final response = await _dio.post('/playback/start', data: {
      if (deviceId != null) 'deviceId': deviceId,
    });
    return response.data;
  }

  /// Manually stop the playback engine
  Future<void> stopEngine() async {
    await _dio.post('/playback/stop');
  }

  // --- AI Integration ---

  /// Get AI system status
  Future<Map<String, dynamic>> getAiStatus() async {
    final response = await _dio.get('/ai/status');
    return response.data;
  }

  /// Get AI suggestions for a session
  Future<List<dynamic>> getAiSuggestions({int? sessionId}) async {
    final response = await _dio.get('/ai/suggestions', queryParameters: {
      if (sessionId != null) 'sessionId': sessionId,
    });
    return response.data['suggestions'] ?? [];
  }

  /// Manually trigger AI analysis
  Future<Map<String, dynamic>> triggerAiAnalysis() async {
    final response = await _dio.post('/ai/analyze');
    return response.data;
  }
}

/// Global API service instance
final apiService = ApiService();
