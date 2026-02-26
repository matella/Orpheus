import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import '../config/theme.dart';
import '../providers/steering_provider.dart';
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

  @override
  void initState() {
    super.initState();
    // Load steering controls from server
    Future.microtask(
      () => ref.read(steeringProvider.notifier).load(),
    );
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

              // Connection status
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
