import 'package:flutter/material.dart';
import '../config/theme.dart';
import '../widgets/now_playing_card.dart';
import '../widgets/feedback_buttons.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('ORPHEUS'),
      ),
      body: SafeArea(
        child: Padding(
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
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
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

              const Spacer(),

              // Placeholder for steering sliders (Phase 4)
              Text(
                'Steering controls coming soon',
                style: Theme.of(context).textTheme.labelSmall,
              ),
              const SizedBox(height: 24),
            ],
          ),
        ),
      ),
    );
  }
}
