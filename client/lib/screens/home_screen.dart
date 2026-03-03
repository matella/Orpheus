import 'dart:async';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import '../config/theme.dart';
import '../providers/steering_provider.dart';
import '../services/api_service.dart';
import '../services/websocket_service.dart';
import '../widgets/now_playing_card.dart';
import '../widgets/feedback_buttons.dart';
import '../widgets/steering_slider.dart';
import 'package:go_router/go_router.dart';

/// Slider configuration: key, label, left endpoint, right endpoint.
const _sliderConfig = [
  ('energy', 'Energy', 'Calm', 'Intense'),
  ('mood', 'Mood', 'Melancholy', 'Upbeat'),
  ('familiarity', 'Discovery', 'Explore', 'Familiar'),
  ('vocalVsInstrumental', 'Vocals', 'Instrumental', 'Vocal'),
  ('aggressiveness', 'Edge', 'Soft', 'Aggressive'),
  ('genreOpenness', 'Genre', 'Stay', 'Explore'),
  ('focusVsParty', 'Vibe', 'Focus', 'Party'),
];

class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  bool _steeringExpanded = false;

  // Engine state
  String _engineStatus = 'idle';
  bool _isStarting = false;
  bool _isStopping = false;

  // Playback state
  String _trackName = '';
  String _artistName = '';
  String _albumName = '';
  String? _albumArtUrl;
  bool _isPlaying = false;
  int _trackCount = 0;
  String? _deviceName;

  // AI state
  String _aiStatus = 'unknown';
  String? _latestInsight;

  // Transition state
  String _transitionMode = 'none';
  int _adoptedTrackCount = 0;
  double? _coherenceScore;
  List<Map<String, dynamic>> _flowTrajectory = [];

  // Error
  String? _errorMessage;
  String? _errorCode;
  bool _isSyncing = false;

  // Prompt
  final TextEditingController _promptController = TextEditingController();
  bool _isPromptProcessing = false;
  String? _promptResult;

  StreamSubscription<Map<String, dynamic>>? _wsSub;

  @override
  void initState() {
    super.initState();
    Future.microtask(
      () => ref.read(steeringProvider.notifier).load(),
    );
    _loadInitialState();
    _loadAiStatus();
    _connectWebSocket();
  }

  @override
  void dispose() {
    _wsSub?.cancel();
    _promptController.dispose();
    super.dispose();
  }

  /// Fetch current playback state from REST API on screen load.
  Future<void> _loadInitialState() async {
    try {
      final data = await apiService.getCurrentPlayback();
      if (!mounted || data == null) return;
      setState(() {
        _engineStatus = data['engineStatus'] ?? 'idle';
        _isPlaying = data['isPlaying'] ?? false;
        _trackCount = data['trackCount'] ?? 0;
        _applyTrack(data['current']);
      });
    } catch (_) {}
  }

  void _applyTrack(dynamic track) {
    if (track is Map<String, dynamic>) {
      _trackName = track['name'] ?? '';
      _artistName = track['artist'] ?? '';
      _albumName = track['album'] ?? '';
      _albumArtUrl = track['albumArtUrl'];
    }
  }

  Future<void> _loadAiStatus() async {
    try {
      final status = await apiService.getAiStatus();
      if (!mounted) return;
      setState(() {
        if (status['enabled'] == true &&
            status['ollama']?['reachable'] == true) {
          _aiStatus = 'active';
        } else if (status['enabled'] == true) {
          _aiStatus = 'offline';
        } else {
          _aiStatus = 'disabled';
        }
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _aiStatus = 'unknown');
    }
  }

  void _connectWebSocket() {
    wsService.connect();
    _wsSub = wsService.messages.listen((msg) {
      if (!mounted) return;
      final type = msg['type'];
      final data = msg['data'] as Map<String, dynamic>?;

      // Handle messages that don't require a data payload first
      if (type == 'steering_updated') {
        // Server confirmed steering controls were persisted
        ref.read(steeringSyncProvider.notifier).setSynced();
        return;
      }

      // All remaining message types require a data payload
      if (data == null) return;

      switch (type) {
        case 'state_updated':
          setState(() {
            final state = data['state'] as Map<String, dynamic>?;
            if (state != null) {
              _engineStatus = state['status'] ?? 'idle';
              _trackCount = state['trackCount'] ?? 0;
              _deviceName = state['deviceName'];
              _transitionMode = state['transitionMode'] ?? 'none';
              _adoptedTrackCount = state['adoptedTrackCount'] ?? 0;
              _coherenceScore =
                  (state['coherenceScore'] as num?)?.toDouble();
            }
            if (data.containsKey('current')) {
              _applyTrack(data['current']);
            }
            if (data.containsKey('trajectory')) {
              _flowTrajectory = List<Map<String, dynamic>>.from(
                data['trajectory'] as List? ?? [],
              );
            }
          });
        case 'track_changed':
          setState(() {
            _applyTrack(data['current']);
            _isPlaying = true;
          });
        case 'session_started':
          setState(() {
            _engineStatus = 'running';
            _deviceName = data['deviceName'];
            _trackCount = 0;
            _isStarting = false;
          });
        case 'session_ended':
          setState(() {
            _engineStatus = 'idle';
            _trackName = '';
            _artistName = '';
            _albumName = '';
            _albumArtUrl = null;
            _isPlaying = false;
            _trackCount = 0;
            _deviceName = null;
            _isStopping = false;
            _transitionMode = 'none';
            _adoptedTrackCount = 0;
            _coherenceScore = null;
            _flowTrajectory = [];
          });
        case 'transition_complete':
          setState(() {
            _transitionMode = 'autonomous';
          });
        case 'ai_insight':
          if (data['insight'] is String) {
            setState(() => _latestInsight = data['insight'] as String);
          }
        case 'request_fulfilled':
          final injected = data['injected'] as int?;
          final prompt = data['prompt'] as String?;
          if (injected != null && injected > 0 && prompt != null) {
            setState(() {
              _promptResult = 'Queued $injected tracks for "$prompt"';
            });
          }
      }
    });
  }

  // --- Actions ---

  Future<void> _startEngine() async {
    setState(() {
      _isStarting = true;
      _errorMessage = null;
      _errorCode = null;
    });
    try {
      await apiService.startEngine();
      if (!mounted) return;
      // WebSocket will push state_updated / session_started
      setState(() => _isStarting = false);
    } on DioException catch (e) {
      if (!mounted) return;
      final data = e.response?.data;
      String message = 'Failed to start engine';
      String? code;
      if (data is Map<String, dynamic>) {
        message = (data['message'] as String?) ?? message;
        code = data['error'] as String?;
      }
      setState(() {
        _isStarting = false;
        _errorMessage = message;
        _errorCode = code;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _isStarting = false;
        _errorMessage = 'Failed to start engine';
        _errorCode = null;
      });
    }
  }

  Future<void> _syncLibrary() async {
    setState(() {
      _isSyncing = true;
      _errorMessage = null;
      _errorCode = null;
    });
    try {
      final result = await apiService.syncLibrary();
      if (!mounted) return;
      final library = result['library'] as Map<String, dynamic>?;
      final total = library?['total'] ?? 0;
      final withFeatures = library?['withFeatures'] ?? 0;
      setState(() {
        _isSyncing = false;
        if (withFeatures > 0) {
          _errorMessage = 'Library synced: $total tracks ($withFeatures ready). Try starting the engine now.';
          _errorCode = 'SYNC_SUCCESS';
        } else if (total > 0) {
          _errorMessage = 'Found $total tracks but audio features not yet ready. Try syncing again.';
          _errorCode = 'EMPTY_LIBRARY';
        } else {
          _errorMessage = 'No tracks found. Make sure you have saved tracks on Spotify.';
          _errorCode = 'EMPTY_LIBRARY';
        }
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _isSyncing = false;
        _errorMessage = 'Library sync failed. Check server connection.';
      });
    }
  }

  Future<void> _stopEngine() async {
    setState(() {
      _isStopping = true;
      _errorMessage = null;
    });
    try {
      await apiService.stopEngine();
      // WebSocket will push session_ended to clear _isStopping.
      // Safety fallback: if WS is down and session_ended never arrives,
      // reset _isStopping after a generous timeout.
      Future.delayed(const Duration(seconds: 5), () {
        if (mounted && _isStopping) {
          setState(() {
            _isStopping = false;
            _engineStatus = 'idle';
          });
        }
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _isStopping = false);
    }
  }

  Future<void> _onLike() async {
    try {
      await apiService.likeTrack();
    } catch (_) {}
  }

  Future<void> _onDislike() async {
    try {
      await apiService.dislikeTrack();
    } catch (_) {}
  }

  Future<void> _onSkip() async {
    try {
      await apiService.skipTrack();
    } catch (_) {}
  }

  Future<void> _onPrevious() async {
    try {
      await apiService.previousTrack();
    } catch (_) {}
  }

  Future<void> _togglePlayPause() async {
    try {
      if (_isPlaying) {
        await apiService.pausePlayback();
        if (mounted) setState(() => _isPlaying = false);
      } else {
        await apiService.resumePlayback();
        if (mounted) setState(() => _isPlaying = true);
      }
    } catch (_) {}
  }

  Future<void> _sendPrompt() async {
    final prompt = _promptController.text.trim();
    if (prompt.isEmpty) return;

    setState(() {
      _isPromptProcessing = true;
      _promptResult = null;
    });

    try {
      final result = await apiService.sendMusicRequest(prompt);
      if (!mounted) return;
      final injected = result['injected'] as int? ?? 0;
      final tracks = result['tracks'] as List? ?? [];
      setState(() {
        _isPromptProcessing = false;
        if (injected > 0) {
          final names = tracks
              .take(3)
              .map((t) => t['name'] as String? ?? '')
              .join(', ');
          _promptResult =
              'Queued $injected tracks: $names${tracks.length > 3 ? '...' : ''}';
        } else {
          _promptResult =
              result['message'] as String? ?? 'No matching tracks found.';
        }
      });
      _promptController.clear();
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _isPromptProcessing = false;
        _promptResult = 'Failed to process request.';
      });
    }
  }

  bool get _isEngineRunning =>
      _engineStatus == 'running' || _engineStatus == 'paused';

  // --- Build ---

  @override
  Widget build(BuildContext context) {
    final steering = ref.watch(steeringProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('ORPHEUS')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => context.go('/playlist'),
        icon: const Icon(Icons.queue_music_rounded),
        label: Text(
          'PLAYLIST',
          style: GoogleFonts.inter(
            fontSize: 12,
            fontWeight: FontWeight.w600,
            letterSpacing: 1.5,
          ),
        ),
        backgroundColor: OrpheusColors.lyreGold,
        foregroundColor: OrpheusColors.obsidian,
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          child: Column(
            children: [
              const SizedBox(height: 16),

              // Status bar
              _buildStatusBar(),

              const SizedBox(height: 20),

              // Engine button
              _buildEngineButton(),

              // Error message
              if (_errorMessage != null) ...[
                const SizedBox(height: 12),
                _buildError(),
              ],

              const SizedBox(height: 24),

              // Now Playing card
              NowPlayingCard(
                trackName: _isEngineRunning && _trackName.isNotEmpty
                    ? _trackName
                    : 'Waiting for playback...',
                artistName: _isEngineRunning && _artistName.isNotEmpty
                    ? _artistName
                    : _isEngineRunning
                        ? 'Selecting track...'
                        : 'Start the engine to begin',
                albumName: _albumName,
                albumArtUrl: _isEngineRunning ? _albumArtUrl : null,
                isPlaying: _isPlaying && _isEngineRunning,
              ),

              const SizedBox(height: 16),

              // Flow indicator (when engine is running and trajectory exists)
              if (_isEngineRunning && _flowTrajectory.length > 1)
                _buildFlowIndicator(),

              const SizedBox(height: 16),

              // Playback controls — previous, play/pause, next
              if (_isEngineRunning) _buildPlaybackControls(),

              const SizedBox(height: 16),

              // Feedback buttons — like / dislike
              FeedbackButtons(
                onLike: _isEngineRunning ? _onLike : null,
                onDislike: _isEngineRunning ? _onDislike : null,
                onSkip: null, // Skip is now in playback controls
              ),

              const SizedBox(height: 16),

              // AI prompt input
              if (_isEngineRunning) _buildPromptInput(),

              const SizedBox(height: 16),

              // AI insight banner
              if (_latestInsight != null) _buildInsightBanner(),

              // Steering controls
              _buildSteeringSection(steering),

              const SizedBox(height: 24),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildPlaybackControls() {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        // Previous
        IconButton(
          onPressed: _onPrevious,
          icon: const Icon(Icons.skip_previous_rounded),
          iconSize: 32,
          color: OrpheusColors.ivory,
          style: IconButton.styleFrom(
            backgroundColor: OrpheusColors.onyx,
            shape: const CircleBorder(
              side: BorderSide(color: OrpheusColors.slate, width: 1),
            ),
            padding: const EdgeInsets.all(12),
          ),
        ),

        const SizedBox(width: 20),

        // Play / Pause (larger)
        IconButton(
          onPressed: _togglePlayPause,
          icon: Icon(
            _isPlaying ? Icons.pause_rounded : Icons.play_arrow_rounded,
          ),
          iconSize: 40,
          color: OrpheusColors.obsidian,
          style: IconButton.styleFrom(
            backgroundColor: OrpheusColors.lyreGold,
            shape: const CircleBorder(),
            padding: const EdgeInsets.all(14),
          ),
        ),

        const SizedBox(width: 20),

        // Next
        IconButton(
          onPressed: _onSkip,
          icon: const Icon(Icons.skip_next_rounded),
          iconSize: 32,
          color: OrpheusColors.ivory,
          style: IconButton.styleFrom(
            backgroundColor: OrpheusColors.onyx,
            shape: const CircleBorder(
              side: BorderSide(color: OrpheusColors.slate, width: 1),
            ),
            padding: const EdgeInsets.all(12),
          ),
        ),
      ],
    );
  }

  Widget _buildStatusBar() {
    Color statusColor;
    String statusText;

    if (_isEngineRunning) {
      statusColor = _transitionMode == 'observing'
          ? OrpheusColors.amberGlow
          : OrpheusColors.laurelGreen;
      final parts = <String>[
        _transitionMode == 'observing'
            ? 'Transitioning'
            : _engineStatus == 'paused'
                ? 'Paused'
                : 'Playing',
      ];
      if (_trackCount > 0) parts.add('$_trackCount tracks');
      if (_deviceName != null) parts.add(_deviceName!);
      statusText = parts.join(' · ');
    } else if (_isStarting) {
      statusColor = OrpheusColors.amberGlow;
      statusText = 'Starting engine...';
    } else {
      statusColor = OrpheusColors.mist;
      statusText = 'Engine idle';
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: OrpheusColors.onyx,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: OrpheusColors.slate, width: 1),
      ),
      child: Row(
        children: [
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(
              color: statusColor,
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              statusText,
              style: Theme.of(context).textTheme.bodySmall,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          _buildAiChip(),
        ],
      ),
    );
  }

  Widget _buildEngineButton() {
    if (_isEngineRunning) {
      return SizedBox(
        width: double.infinity,
        child: OutlinedButton.icon(
          onPressed: _isStopping ? null : _stopEngine,
          icon: _isStopping
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: OrpheusColors.wineRed,
                  ),
                )
              : const Icon(Icons.stop_rounded, size: 20),
          label: Text(
            _isStopping ? 'STOPPING...' : 'STOP ENGINE',
            style: GoogleFonts.inter(
              fontSize: 14,
              fontWeight: FontWeight.w600,
              letterSpacing: 2,
            ),
          ),
          style: OutlinedButton.styleFrom(
            foregroundColor: OrpheusColors.wineRed,
            side: const BorderSide(color: OrpheusColors.wineRed, width: 1.5),
            padding: const EdgeInsets.symmetric(vertical: 14),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
            ),
          ),
        ),
      );
    }

    return SizedBox(
      width: double.infinity,
      child: ElevatedButton.icon(
        onPressed: _isStarting ? null : _startEngine,
        icon: _isStarting
            ? const SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: OrpheusColors.obsidian,
                ),
              )
            : const Icon(Icons.play_arrow_rounded, size: 24),
        label: Text(
          _isStarting ? 'STARTING...' : 'START ENGINE',
          style: GoogleFonts.inter(
            fontSize: 14,
            fontWeight: FontWeight.w600,
            letterSpacing: 2,
          ),
        ),
        style: ElevatedButton.styleFrom(
          padding: const EdgeInsets.symmetric(vertical: 16),
        ),
      ),
    );
  }

  Widget _buildError() {
    final isSuccess = _errorCode == 'SYNC_SUCCESS';
    final showSyncButton = _errorCode == 'EMPTY_LIBRARY';
    final color = isSuccess ? OrpheusColors.laurelGreen : OrpheusColors.wineRed;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: color.withValues(alpha: 0.3)),
      ),
      child: Column(
        children: [
          Text(
            _errorMessage!,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(color: color),
            textAlign: TextAlign.center,
          ),
          if (showSyncButton) ...[
            const SizedBox(height: 10),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: _isSyncing ? null : _syncLibrary,
                icon: _isSyncing
                    ? const SizedBox(
                        width: 14,
                        height: 14,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: OrpheusColors.lyreGold,
                        ),
                      )
                    : const Icon(Icons.sync, size: 16),
                label: Text(_isSyncing ? 'Syncing...' : 'Sync Library Now'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: OrpheusColors.lyreGold,
                  side: BorderSide(
                    color: OrpheusColors.lyreGold.withValues(alpha: 0.5),
                  ),
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  textStyle: Theme.of(context).textTheme.labelLarge,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildInsightBanner() {
    return Dismissible(
      key: ValueKey(_latestInsight),
      onDismissed: (_) => setState(() => _latestInsight = null),
      child: Container(
        width: double.infinity,
        margin: const EdgeInsets.only(bottom: 16),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        decoration: BoxDecoration(
          color: OrpheusColors.deepGold.withValues(alpha: 0.15),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: OrpheusColors.lyreGold.withValues(alpha: 0.3),
            width: 1,
          ),
        ),
        child: Row(
          children: [
            const Icon(
              Icons.auto_awesome,
              size: 18,
              color: OrpheusColors.lyreGold,
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                _latestInsight!,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: OrpheusColors.amberGlow,
                    ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildAiChip() {
    Color chipColor;
    switch (_aiStatus) {
      case 'active':
        chipColor = OrpheusColors.laurelGreen;
      case 'offline':
        chipColor = OrpheusColors.wineRed;
      default:
        chipColor = OrpheusColors.slate;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: chipColor.withValues(alpha: 0.2),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 6,
            height: 6,
            decoration: BoxDecoration(
              color: chipColor,
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(width: 6),
          Text(
            'AI',
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  color: chipColor,
                  fontWeight: FontWeight.w600,
                ),
          ),
        ],
      ),
    );
  }

  Widget _buildPromptInput() {
    return Container(
      decoration: BoxDecoration(
        color: OrpheusColors.onyx,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: OrpheusColors.slate, width: 1),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(
                Icons.auto_awesome,
                size: 16,
                color: OrpheusColors.lyreGold,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: TextField(
                  controller: _promptController,
                  enabled: !_isPromptProcessing,
                  style: Theme.of(context).textTheme.bodyMedium,
                  decoration: InputDecoration(
                    hintText: 'Play some chill music...',
                    hintStyle: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: OrpheusColors.mist,
                        ),
                    border: InputBorder.none,
                    enabledBorder: InputBorder.none,
                    focusedBorder: InputBorder.none,
                    filled: false,
                    isDense: true,
                    contentPadding: const EdgeInsets.symmetric(vertical: 8),
                  ),
                  onSubmitted: (_) => _sendPrompt(),
                  textInputAction: TextInputAction.send,
                ),
              ),
              const SizedBox(width: 8),
              _isPromptProcessing
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: OrpheusColors.lyreGold,
                      ),
                    )
                  : IconButton(
                      onPressed: _sendPrompt,
                      icon: const Icon(Icons.send_rounded, size: 20),
                      color: OrpheusColors.lyreGold,
                      padding: EdgeInsets.zero,
                      constraints:
                          const BoxConstraints(minWidth: 32, minHeight: 32),
                    ),
            ],
          ),
          if (_promptResult != null)
            Padding(
              padding: const EdgeInsets.only(top: 6, bottom: 4),
              child: Text(
                _promptResult!,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: OrpheusColors.amberGlow,
                    ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildFlowIndicator() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: OrpheusColors.onyx,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: OrpheusColors.slate, width: 1),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header
          Row(
            children: [
              Text(
                'FLOW',
                style: GoogleFonts.cinzel(
                  fontSize: 10,
                  fontWeight: FontWeight.w400,
                  color: OrpheusColors.lyreGold,
                  letterSpacing: 3,
                ),
              ),
              if (_transitionMode == 'observing') ...[
                const SizedBox(width: 8),
                Text(
                  'TRANSITIONING',
                  style: GoogleFonts.inter(
                    fontSize: 9,
                    fontWeight: FontWeight.w500,
                    color: OrpheusColors.amberGlow,
                    letterSpacing: 1,
                  ),
                ),
              ],
            ],
          ),
          const SizedBox(height: 10),
          // Combined bars + curve
          SizedBox(
            height: 40,
            child: LayoutBuilder(
              builder: (context, constraints) {
                return Stack(
                  children: [
                    // Energy bars
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        for (int i = 0; i < _flowTrajectory.length; i++)
                          Expanded(
                            child: _buildFlowBar(
                              _flowTrajectory[i],
                              isCurrent: i == 0,
                            ),
                          ),
                      ],
                    ),
                    // Curve overlay
                    if (_flowTrajectory.length > 1)
                      CustomPaint(
                        size: Size(constraints.maxWidth, 40),
                        painter: _FlowCurvePainter(
                          trajectory: _flowTrajectory,
                        ),
                      ),
                  ],
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildFlowBar(Map<String, dynamic> trackData,
      {required bool isCurrent}) {
    final energy = (trackData['energy'] as num?)?.toDouble() ?? 0.5;
    final adopted = trackData['adopted'] as bool? ?? false;

    final baseColor = adopted ? OrpheusColors.mist : OrpheusColors.lyreGold;
    final barHeight = 8.0 + (energy * 24.0); // 8–32px

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 2),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.end,
        children: [
          Container(
            width: double.infinity,
            height: barHeight,
            decoration: BoxDecoration(
              color: isCurrent
                  ? baseColor.withValues(alpha: 0.8)
                  : baseColor.withValues(alpha: 0.4),
              borderRadius: BorderRadius.circular(3),
              border: isCurrent
                  ? Border.all(
                      color: OrpheusColors.amberGlow,
                      width: 1.2,
                    )
                  : null,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSteeringSection(Map<String, double> steering) {
    final syncStatus = ref.watch(steeringSyncProvider);

    return Container(
      decoration: BoxDecoration(
        color: OrpheusColors.onyx,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: OrpheusColors.slate, width: 1),
      ),
      child: Column(
        children: [
          // Header with expand/collapse + sync indicator
          InkWell(
            onTap: () => setState(() {
              _steeringExpanded = !_steeringExpanded;
            }),
            borderRadius: BorderRadius.circular(12),
            child: Padding(
              padding:
                  const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Row(
                    children: [
                      Text(
                        'STEERING',
                        style: GoogleFonts.cinzel(
                          fontSize: 12,
                          fontWeight: FontWeight.w400,
                          color: OrpheusColors.lyreGold,
                          letterSpacing: 3,
                        ),
                      ),
                      const SizedBox(width: 8),
                      _buildSyncIndicator(syncStatus),
                    ],
                  ),
                  Icon(
                    _steeringExpanded
                        ? Icons.keyboard_arrow_up
                        : Icons.keyboard_arrow_down,
                    color: OrpheusColors.mist,
                    size: 20,
                  ),
                ],
              ),
            ),
          ),

          // Error message (when expanded and sync failed)
          if (_steeringExpanded &&
              syncStatus == SteeringSyncStatus.error)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: Text(
                'Steering sync failed \u2014 changes may not be applied',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: OrpheusColors.wineRed,
                    ),
              ),
            ),

          // Sliders (when expanded)
          if (_steeringExpanded)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
              child: Column(
                children: [
                  for (final (key, label, left, right) in _sliderConfig) ...[
                    SteeringSlider(
                      label: label,
                      leftLabel: left,
                      rightLabel: right,
                      value: steering[key] ?? 0.5,
                      onChanged: (v) => ref
                          .read(steeringProvider.notifier)
                          .updateControl(key, v),
                    ),
                    const SizedBox(height: 12),
                  ],
                ],
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildSyncIndicator(SteeringSyncStatus status) {
    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 200),
      child: switch (status) {
        SteeringSyncStatus.idle => const SizedBox.shrink(
            key: ValueKey('idle'),
          ),
        SteeringSyncStatus.syncing => const _SyncPulse(
            key: ValueKey('syncing'),
          ),
        SteeringSyncStatus.synced => const Icon(
            Icons.check,
            key: ValueKey('synced'),
            size: 14,
            color: OrpheusColors.laurelGreen,
          ),
        SteeringSyncStatus.error => const Icon(
            Icons.error_outline,
            key: ValueKey('error'),
            size: 14,
            color: OrpheusColors.wineRed,
          ),
      },
    );
  }
}

// ── Pulsing amber dot for "syncing" state ────────────────────────────

class _SyncPulse extends StatefulWidget {
  const _SyncPulse({super.key});

  @override
  State<_SyncPulse> createState() => _SyncPulseState();
}

class _SyncPulseState extends State<_SyncPulse>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      duration: const Duration(milliseconds: 800),
      vsync: this,
    )..repeat(reverse: true);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return FadeTransition(
      opacity: Tween<double>(begin: 0.3, end: 1.0).animate(_controller),
      child: Container(
        width: 6,
        height: 6,
        decoration: const BoxDecoration(
          color: OrpheusColors.amberGlow,
          shape: BoxShape.circle,
        ),
      ),
    );
  }
}

// ── Flow curve painter ───────────────────────────────────────────────

class _FlowCurvePainter extends CustomPainter {
  final List<Map<String, dynamic>> trajectory;

  _FlowCurvePainter({required this.trajectory});

  @override
  void paint(Canvas canvas, Size size) {
    if (trajectory.length < 2) return;

    final n = trajectory.length;
    final slotWidth = size.width / n;

    // Build points: x = center of each bar slot, y = energy mapped to height
    final points = <Offset>[];
    for (int i = 0; i < n; i++) {
      final energy = (trajectory[i]['energy'] as num?)?.toDouble() ?? 0.5;
      final x = slotWidth * i + slotWidth / 2;
      final y = size.height - (energy * size.height * 0.85) - 2;
      points.add(Offset(x, y));
    }

    // Find the transition index (last adopted track)
    int transitionIdx = -1;
    for (int i = 0; i < n; i++) {
      if (trajectory[i]['adopted'] == true) transitionIdx = i;
    }

    // Draw curve with gradient: muted for adopted, gold for Orpheus
    final path = Path()..moveTo(points[0].dx, points[0].dy);

    for (int i = 0; i < points.length - 1; i++) {
      final p0 = points[i];
      final p1 = points[i + 1];
      final midX = (p0.dx + p1.dx) / 2;
      path.cubicTo(midX, p0.dy, midX, p1.dy, p1.dx, p1.dy);
    }

    // Create gradient shader
    final adoptedColor = const Color(0xFF8A8A99); // mist
    final orpheusColor = const Color(0xFFD4A843); // lyreGold

    final Paint curvePaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.0
      ..strokeCap = StrokeCap.round;

    if (transitionIdx >= 0 && transitionIdx < n - 1) {
      // Gradient transition at the handoff point
      final transitionX = points[transitionIdx].dx / size.width;
      curvePaint.shader = LinearGradient(
        colors: [
          adoptedColor.withValues(alpha: 0.7),
          adoptedColor.withValues(alpha: 0.7),
          orpheusColor.withValues(alpha: 0.8),
          orpheusColor.withValues(alpha: 0.8),
        ],
        stops: [
          0.0,
          (transitionX * 0.9).clamp(0.0, 1.0),
          (transitionX * 1.1).clamp(0.0, 1.0),
          1.0,
        ],
      ).createShader(Rect.fromLTWH(0, 0, size.width, size.height));
    } else {
      // All same color (no adopted tracks or all adopted)
      final allAdopted = trajectory.every((t) => t['adopted'] == true);
      curvePaint.color = allAdopted
          ? adoptedColor.withValues(alpha: 0.7)
          : orpheusColor.withValues(alpha: 0.8);
    }

    canvas.drawPath(path, curvePaint);

    // Draw dots at each point
    for (int i = 0; i < points.length; i++) {
      final adopted = trajectory[i]['adopted'] as bool? ?? false;
      final dotColor = adopted ? adoptedColor : orpheusColor;
      final dotPaint = Paint()..color = dotColor.withValues(alpha: i == 0 ? 1.0 : 0.7);
      canvas.drawCircle(points[i], i == 0 ? 3.5 : 2.5, dotPaint);
    }
  }

  @override
  bool shouldRepaint(_FlowCurvePainter oldDelegate) =>
      oldDelegate.trajectory.length != trajectory.length ||
      !_listsEqual(oldDelegate.trajectory, trajectory);
}

bool _listsEqual(List<Map<String, dynamic>> a, List<Map<String, dynamic>> b) {
  if (a.length != b.length) return false;
  for (int i = 0; i < a.length; i++) {
    if (a[i]['energy'] != b[i]['energy'] || a[i]['adopted'] != b[i]['adopted']) {
      return false;
    }
  }
  return true;
}
