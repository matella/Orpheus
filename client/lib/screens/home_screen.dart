import 'dart:async';
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

  // AI state
  String _aiStatus = 'unknown'; // 'active', 'offline', 'disabled', 'unknown'
  String? _latestInsight;
  StreamSubscription<Map<String, dynamic>>? _wsSub;

  @override
  void initState() {
    super.initState();
    // Load steering controls from server
    Future.microtask(
      () => ref.read(steeringProvider.notifier).load(),
    );
    _loadAiStatus();
    _connectWebSocket();
  }

  @override
  void dispose() {
    _wsSub?.cancel();
    super.dispose();
  }

  Future<void> _loadAiStatus() async {
    try {
      final status = await apiService.getAiStatus();
      if (!mounted) return;
      setState(() {
        if (status['enabled'] == true && status['ollama']?['reachable'] == true) {
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
      if (msg['type'] == 'ai_insight' && mounted) {
        final data = msg['data'] as Map<String, dynamic>?;
        if (data != null && data['insight'] is String) {
          setState(() => _latestInsight = data['insight'] as String);
        }
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final steering = ref.watch(steeringProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('ORPHEUS'),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          child: Column(
            children: [
              const SizedBox(height: 24),

              // Now Playing card
              const NowPlayingCard(
                trackName: 'Waiting for playback...',
                artistName: 'Connect to Spotify to begin',
                albumName: '',
                albumArtUrl: null,
                isPlaying: false,
              ),

              const SizedBox(height: 32),

              // Feedback buttons
              const FeedbackButtons(),

              const SizedBox(height: 32),

              // AI insight banner
              if (_latestInsight != null)
                Dismissible(
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
                        Icon(
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
                ),

              // Connection status + AI chip
              Container(
                padding: const EdgeInsets.symmetric(
                    horizontal: 16, vertical: 12),
                decoration: BoxDecoration(
                  color: OrpheusColors.onyx,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(
                    color: OrpheusColors.slate,
                    width: 1,
                  ),
                ),
                child: Row(
                  children: [
                    Container(
                      width: 8,
                      height: 8,
                      decoration: const BoxDecoration(
                        color: OrpheusColors.mist,
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Text(
                      'Waiting for connection...',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                    const Spacer(),
                    _buildAiChip(),
                  ],
                ),
              ),

              const SizedBox(height: 24),

              // Steering controls section
              _buildSteeringSection(steering),

              const SizedBox(height: 24),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildAiChip() {
    Color chipColor;
    String label;

    switch (_aiStatus) {
      case 'active':
        chipColor = OrpheusColors.laurelGreen;
        label = 'AI';
        break;
      case 'offline':
        chipColor = OrpheusColors.wineRed;
        label = 'AI';
        break;
      case 'disabled':
        chipColor = OrpheusColors.slate;
        label = 'AI';
        break;
      default:
        chipColor = OrpheusColors.slate;
        label = 'AI';
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
            label,
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  color: chipColor,
                  fontWeight: FontWeight.w600,
                ),
          ),
        ],
      ),
    );
  }

  Widget _buildSteeringSection(Map<String, double> steering) {
    return Container(
      decoration: BoxDecoration(
        color: OrpheusColors.onyx,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: OrpheusColors.slate,
          width: 1,
        ),
      ),
      child: Column(
        children: [
          // Header with expand/collapse
          InkWell(
            onTap: () => setState(() {
              _steeringExpanded = !_steeringExpanded;
            }),
            borderRadius: BorderRadius.circular(12),
            child: Padding(
              padding: const EdgeInsets.symmetric(
                  horizontal: 16, vertical: 14),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
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

          // Sliders (when expanded)
          if (_steeringExpanded)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
              child: Column(
                children: [
                  for (final (key, label, left, right) in _sliderConfig)
                    ...[
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
}
