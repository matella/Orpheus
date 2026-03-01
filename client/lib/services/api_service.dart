import 'dart:developer' as developer;
import 'package:dio/dio.dart';
import '../config/constants.dart';

class ApiService {
  late Dio _dio;

  ApiService({String? baseUrl}) {
    _initDio(baseUrl ?? apiBaseUrl);
  }

  void _initDio(String baseUrl) {
    _dio = Dio(BaseOptions(
      baseUrl: baseUrl,
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 10),
    ));

    _dio.interceptors.add(LogInterceptor(
      requestBody: false,
      responseBody: true,
      logPrint: (obj) {}, // Silent in production
    ));
  }

  /// Update the base URL for all future requests.
  void updateBaseUrl(String newBaseUrl) {
    _initDio(newBaseUrl);
  }

  /// Get the current base URL.
  String get baseUrl => _dio.options.baseUrl;

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
    } catch (e) {
      developer.log('Health check failed: $e', name: 'ApiService');
      return false;
    }
  }

  /// Get current playback state
  Future<Map<String, dynamic>?> getCurrentPlayback() async {
    try {
      final response = await _dio.get('/playback/current');
      return response.data;
    } catch (e) {
      developer.log('getCurrentPlayback failed: $e', name: 'ApiService');
      return null;
    }
  }

  /// Skip current track
  Future<void> skipTrack() async {
    await _dio.post('/playback/skip');
  }

  /// Go to previous track
  Future<void> previousTrack() async {
    await _dio.post('/playback/previous');
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

  /// Get library stats (track count, features fetched)
  Future<Map<String, dynamic>> getLibraryStats() async {
    final response = await _dio.get('/playback/library/stats');
    return response.data;
  }

  /// Manually trigger a full library sync
  Future<Map<String, dynamic>> syncLibrary() async {
    final response = await _dio.post('/playback/library/sync');
    return response.data;
  }

  // --- Music Request ---

  /// Send a natural language music request to queue matching tracks
  Future<Map<String, dynamic>> sendMusicRequest(String prompt) async {
    final response = await _dio.post('/playback/request', data: {'prompt': prompt});
    return response.data;
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

  /// Get all monthly recaps
  Future<Map<String, dynamic>> getAiRecaps() async {
    final response = await _dio.get('/ai/recaps');
    return response.data;
  }

  /// Generate a monthly recap (defaults to previous month)
  Future<Map<String, dynamic>> generateAiRecap({int? year, int? month}) async {
    final response = await _dio.post('/ai/recaps', data: {
      if (year != null) 'year': year,
      if (month != null) 'month': month,
    });
    return response.data;
  }

  /// AI context inference for session start
  Future<Map<String, dynamic>> getAiContextInference() async {
    final response = await _dio.post('/ai/infer');
    return response.data;
  }

  // --- Sessions ---

  /// Get paginated session history
  Future<Map<String, dynamic>> getSessions({int limit = 20, int offset = 0}) async {
    final response = await _dio.get('/sessions', queryParameters: {
      'limit': limit,
      'offset': offset,
    });
    return response.data;
  }

  /// Get the active session with tracks and state curve
  Future<Map<String, dynamic>> getActiveSession() async {
    final response = await _dio.get('/sessions/active');
    return response.data;
  }

  /// Get a specific session by ID with tracks and state curve
  Future<Map<String, dynamic>> getSessionDetail(int sessionId) async {
    final response = await _dio.get('/sessions/$sessionId');
    return response.data;
  }

  // --- Analytics ---

  /// Get overview analytics (cached on server)
  Future<Map<String, dynamic>> getAnalyticsOverview() async {
    final response = await _dio.get('/analytics/overview');
    return response.data;
  }

  /// Get genre distribution
  Future<Map<String, dynamic>> getAnalyticsGenres({int days = 30}) async {
    final response = await _dio.get('/analytics/genres', queryParameters: {'days': days});
    return response.data;
  }

  /// Get energy trend data
  Future<Map<String, dynamic>> getAnalyticsEnergy({int days = 30}) async {
    final response = await _dio.get('/analytics/energy', queryParameters: {'days': days});
    return response.data;
  }

  /// Get listening hours heatmap
  Future<Map<String, dynamic>> getAnalyticsHours({int days = 30}) async {
    final response = await _dio.get('/analytics/hours', queryParameters: {'days': days});
    return response.data;
  }

  /// Get top tracks
  Future<Map<String, dynamic>> getAnalyticsTopTracks({int days = 30, int limit = 20}) async {
    final response = await _dio.get('/analytics/top-tracks', queryParameters: {
      'days': days,
      'limit': limit,
    });
    return response.data;
  }

  /// Get daily listening stats for sparklines
  Future<Map<String, dynamic>> getAnalyticsDaily({int days = 30}) async {
    final response = await _dio.get('/analytics/daily', queryParameters: {'days': days});
    return response.data;
  }
}

/// Global API service instance
final apiService = ApiService();
