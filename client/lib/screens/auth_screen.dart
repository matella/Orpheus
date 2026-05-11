import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import '../config/theme.dart';
import '../services/api_service.dart';
import '../widgets/spotify_attribution.dart';

class AuthScreen extends StatefulWidget {
  const AuthScreen({super.key});

  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> {
  bool _isLoading = false;
  String? _error;

  Future<void> _startAuth() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final url = await apiService.getAuthUrl();
      // In a real app, launch URL in browser
      // For now, just display it
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Open this URL in your browser: $url'),
            duration: const Duration(seconds: 10),
          ),
        );
      }
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = 'Failed to connect to server: $e');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                // Logo placeholder
                const Icon(
                  Icons.music_note_rounded,
                  size: 80,
                  color: OrpheusColors.lyreGold,
                ),
                const SizedBox(height: 24),
                Text(
                  'ORPHEUS',
                  style: Theme.of(context).textTheme.displayLarge,
                ),
                const SizedBox(height: 8),
                Text(
                  'Autonomous Music Intelligence',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
                const SizedBox(height: 48),
                ElevatedButton.icon(
                  onPressed: _isLoading ? null : _startAuth,
                  icon: _isLoading
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: OrpheusColors.obsidian,
                          ),
                        )
                      : SvgPicture.asset(
                          'assets/images/spotify_icon_white.svg',
                          height: 20,
                          width: 20,
                          colorFilter: const ColorFilter.mode(
                            OrpheusColors.obsidian,
                            BlendMode.srcIn,
                          ),
                        ),
                  label: const Text('Connect to Spotify'),
                ),
                const SizedBox(height: 24),
                const SpotifyAttribution(style: SpotifyAttributionStyle.full),
                if (_error != null) ...[
                  const SizedBox(height: 16),
                  Text(
                    _error!,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: OrpheusColors.wineRedText,
                        ),
                    textAlign: TextAlign.center,
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
