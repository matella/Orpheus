import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:url_launcher/url_launcher.dart';
import '../config/theme.dart';
import '../providers/playlist_provider.dart';

const _energyArcOptions = [
  ('steady', 'Steady', Icons.horizontal_rule_rounded),
  ('build_up', 'Build Up', Icons.trending_up_rounded),
  ('wind_down', 'Wind Down', Icons.trending_down_rounded),
  ('peak_and_fade', 'Peak & Fade', Icons.landscape_rounded),
];

class PlaylistScreen extends ConsumerStatefulWidget {
  const PlaylistScreen({super.key});

  @override
  ConsumerState<PlaylistScreen> createState() => _PlaylistScreenState();
}

class _PlaylistScreenState extends ConsumerState<PlaylistScreen> {
  final _promptController = TextEditingController();

  // Settings
  double _durationMinutes = 30;
  double _discoveryRate = 0.3;
  String _energyArc = 'steady';
  double _transitionSmoothness = 0.5;
  int _maxPerArtist = 3;
  String _sourcePreference = 'library';
  bool _advancedExpanded = false;

  @override
  void dispose() {
    _promptController.dispose();
    super.dispose();
  }

  void _generate() {
    final prompt = _promptController.text.trim();
    if (prompt.isEmpty) return;

    ref.read(playlistProvider.notifier).generate({
      'prompt': prompt,
      'durationMinutes': _durationMinutes.round(),
      'discoveryRate': _discoveryRate,
      'energyArc': _energyArc,
      'transitionSmoothness': _transitionSmoothness,
      'maxPerArtist': _maxPerArtist,
      'sourcePreference': _sourcePreference,
    });
  }

  void _reset() {
    ref.read(playlistProvider.notifier).reset();
    _promptController.clear();
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(playlistProvider);

    return Scaffold(
      appBar: AppBar(
        title: Text(
          'CREATE PLAYLIST',
          style: GoogleFonts.cinzel(
            fontSize: 16,
            fontWeight: FontWeight.w400,
            letterSpacing: 2,
          ),
        ),
      ),
      body: SafeArea(
        child: switch (state.status) {
          PlaylistGenerationStatus.idle => _buildForm(),
          PlaylistGenerationStatus.generating => _buildProgress(state),
          PlaylistGenerationStatus.complete => _buildResult(state),
          PlaylistGenerationStatus.error => _buildError(state),
        },
      ),
    );
  }

  // ── Form ─────────────────────────────────────────────────────

  Widget _buildForm() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Prompt
          _sectionLabel('DESCRIBE YOUR PLAYLIST'),
          const SizedBox(height: 8),
          TextField(
            controller: _promptController,
            maxLines: 3,
            maxLength: 500,
            style: Theme.of(context).textTheme.bodyMedium,
            decoration: InputDecoration(
              hintText: 'Chill evening jazz for reading...\nUpbeat workout mix with high energy...\nSad indie songs for a rainy day...',
              hintStyle: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: OrpheusColors.mist,
                  ),
              filled: true,
              fillColor: OrpheusColors.onyx,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: const BorderSide(color: OrpheusColors.slate),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: const BorderSide(color: OrpheusColors.slate),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: const BorderSide(color: OrpheusColors.lyreGold),
              ),
            ),
          ),

          const SizedBox(height: 20),

          // Duration
          _sectionLabel('DURATION'),
          const SizedBox(height: 4),
          Row(
            children: [
              Expanded(
                child: Slider(
                  value: _durationMinutes,
                  min: 5,
                  max: 180,
                  divisions: 35,
                  onChanged: (v) => setState(() => _durationMinutes = v),
                ),
              ),
              SizedBox(
                width: 60,
                child: Text(
                  '${_durationMinutes.round()} min',
                  style: GoogleFonts.jetBrainsMono(
                    fontSize: 13,
                    color: OrpheusColors.lyreGold,
                  ),
                  textAlign: TextAlign.end,
                ),
              ),
            ],
          ),

          const SizedBox(height: 16),

          // Discovery rate
          _sectionLabel('DISCOVERY'),
          const SizedBox(height: 4),
          Row(
            children: [
              Text('Favorites', style: Theme.of(context).textTheme.bodySmall),
              Expanded(
                child: Slider(
                  value: _discoveryRate,
                  min: 0,
                  max: 1,
                  divisions: 10,
                  onChanged: (v) => setState(() => _discoveryRate = v),
                ),
              ),
              Text('New', style: Theme.of(context).textTheme.bodySmall),
              const SizedBox(width: 8),
              SizedBox(
                width: 40,
                child: Text(
                  '${(_discoveryRate * 100).round()}%',
                  style: GoogleFonts.jetBrainsMono(
                    fontSize: 13,
                    color: OrpheusColors.lyreGold,
                  ),
                  textAlign: TextAlign.end,
                ),
              ),
            ],
          ),

          const SizedBox(height: 16),

          // Energy Arc
          _sectionLabel('ENERGY ARC'),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final (value, label, icon) in _energyArcOptions)
                ChoiceChip(
                  selected: _energyArc == value,
                  onSelected: (_) => setState(() => _energyArc = value),
                  avatar: Icon(icon, size: 18),
                  label: Text(label),
                  selectedColor: OrpheusColors.deepGold,
                  side: BorderSide(
                    color: _energyArc == value
                        ? OrpheusColors.lyreGold
                        : OrpheusColors.slate,
                  ),
                ),
            ],
          ),

          const SizedBox(height: 20),

          // Advanced settings (expandable)
          _buildAdvancedSettings(),

          const SizedBox(height: 24),

          // Generate button
          SizedBox(
            width: double.infinity,
            child: ElevatedButton.icon(
              onPressed: _promptController.text.trim().isNotEmpty
                  ? _generate
                  : null,
              icon: const Icon(Icons.auto_awesome, size: 20),
              label: Text(
                'GENERATE PLAYLIST',
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
          ),

          const SizedBox(height: 24),
        ],
      ),
    );
  }

  Widget _buildAdvancedSettings() {
    return Container(
      decoration: BoxDecoration(
        color: OrpheusColors.onyx,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: OrpheusColors.slate),
      ),
      child: Column(
        children: [
          InkWell(
            onTap: () => setState(() => _advancedExpanded = !_advancedExpanded),
            borderRadius: BorderRadius.circular(12),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    'ADVANCED',
                    style: GoogleFonts.cinzel(
                      fontSize: 10,
                      fontWeight: FontWeight.w400,
                      color: OrpheusColors.mist,
                      letterSpacing: 3,
                    ),
                  ),
                  Icon(
                    _advancedExpanded
                        ? Icons.keyboard_arrow_up
                        : Icons.keyboard_arrow_down,
                    color: OrpheusColors.mist,
                    size: 20,
                  ),
                ],
              ),
            ),
          ),
          if (_advancedExpanded)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Transition smoothness
                  _sectionLabel('TRANSITION SMOOTHNESS'),
                  Row(
                    children: [
                      Text('Loose', style: Theme.of(context).textTheme.bodySmall),
                      Expanded(
                        child: Slider(
                          value: _transitionSmoothness,
                          min: 0,
                          max: 1,
                          divisions: 10,
                          onChanged: (v) =>
                              setState(() => _transitionSmoothness = v),
                        ),
                      ),
                      Text('Tight', style: Theme.of(context).textTheme.bodySmall),
                    ],
                  ),
                  const SizedBox(height: 12),

                  // Max per artist
                  _sectionLabel('MAX TRACKS PER ARTIST'),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      IconButton(
                        onPressed: _maxPerArtist > 1
                            ? () => setState(() => _maxPerArtist--)
                            : null,
                        icon: const Icon(Icons.remove_rounded),
                        iconSize: 20,
                        style: IconButton.styleFrom(
                          backgroundColor: OrpheusColors.charcoal,
                          shape: const CircleBorder(),
                        ),
                      ),
                      const SizedBox(width: 16),
                      Text(
                        '$_maxPerArtist',
                        style: GoogleFonts.jetBrainsMono(
                          fontSize: 18,
                          color: OrpheusColors.lyreGold,
                        ),
                      ),
                      const SizedBox(width: 16),
                      IconButton(
                        onPressed: _maxPerArtist < 10
                            ? () => setState(() => _maxPerArtist++)
                            : null,
                        icon: const Icon(Icons.add_rounded),
                        iconSize: 20,
                        style: IconButton.styleFrom(
                          backgroundColor: OrpheusColors.charcoal,
                          shape: const CircleBorder(),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),

                  // Source preference
                  _sectionLabel('SOURCE'),
                  const SizedBox(height: 8),
                  SegmentedButton<String>(
                    segments: const [
                      ButtonSegment(
                        value: 'library',
                        label: Text('Library Only'),
                        icon: Icon(Icons.library_music_rounded, size: 16),
                      ),
                      ButtonSegment(
                        value: 'library_and_spotify',
                        label: Text('+ Spotify'),
                        icon: Icon(Icons.explore_rounded, size: 16),
                      ),
                    ],
                    selected: {_sourcePreference},
                    onSelectionChanged: (v) =>
                        setState(() => _sourcePreference = v.first),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  // ── Progress ─────────────────────────────────────────────────

  Widget _buildProgress(PlaylistState state) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(40),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            SizedBox(
              width: 80,
              height: 80,
              child: CircularProgressIndicator(
                value: state.progress > 0 ? state.progress / 100 : null,
                strokeWidth: 4,
                color: OrpheusColors.lyreGold,
                backgroundColor: OrpheusColors.slate,
              ),
            ),
            const SizedBox(height: 24),
            Text(
              '${state.progress.round()}%',
              style: GoogleFonts.jetBrainsMono(
                fontSize: 28,
                color: OrpheusColors.lyreGold,
              ),
            ),
            const SizedBox(height: 12),
            Text(
              state.progressMessage,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: OrpheusColors.mist,
                  ),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }

  // ── Result ───────────────────────────────────────────────────

  Widget _buildResult(PlaylistState state) {
    final playlist = state.result;
    if (playlist == null) return const SizedBox.shrink();

    final tracks = playlist['tracks'] as List? ?? [];
    final spotifyUrl = playlist['spotifyPlaylistUrl'] as String?;

    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Playlist name
          Text(
            playlist['name'] as String? ?? 'Untitled',
            style: GoogleFonts.cinzel(
              fontSize: 22,
              fontWeight: FontWeight.w600,
              color: OrpheusColors.lyreGold,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            playlist['description'] as String? ?? '',
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: OrpheusColors.mist,
                ),
          ),
          const SizedBox(height: 16),

          // Stats row
          _buildStats(playlist),

          const SizedBox(height: 20),

          // Action buttons
          Row(
            children: [
              if (spotifyUrl != null)
                Expanded(
                  child: ElevatedButton.icon(
                    onPressed: () => _openUrl(spotifyUrl),
                    icon: const Icon(Icons.open_in_new_rounded, size: 18),
                    label: const Text('OPEN IN SPOTIFY'),
                    style: ElevatedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 14),
                    ),
                  ),
                ),
              if (spotifyUrl != null) const SizedBox(width: 12),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _reset,
                  icon: const Icon(Icons.add_rounded, size: 18),
                  label: const Text('CREATE ANOTHER'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: OrpheusColors.lyreGold,
                    side: const BorderSide(color: OrpheusColors.lyreGold),
                    padding: const EdgeInsets.symmetric(vertical: 14),
                  ),
                ),
              ),
            ],
          ),

          const SizedBox(height: 24),

          // Track list
          _sectionLabel('TRACKS'),
          const SizedBox(height: 12),

          for (final track in tracks) _buildTrackTile(track),

          const SizedBox(height: 24),
        ],
      ),
    );
  }

  Widget _buildStats(Map<String, dynamic> playlist) {
    final trackCount = (playlist['trackCount'] as num?)?.toInt() ?? 0;
    final totalMs = (playlist['totalDurationMs'] as num?)?.toInt() ?? 0;
    final genTimeMs = (playlist['generationTimeMs'] as num?)?.toInt() ?? 0;
    final aiEnhanced = playlist['aiEnhanced'] as bool? ?? false;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: OrpheusColors.onyx,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: OrpheusColors.slate),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceAround,
        children: [
          _statItem('$trackCount', 'tracks'),
          _statItem('${(totalMs / 60000).round()}', 'min'),
          _statItem('${(genTimeMs / 1000).toStringAsFixed(1)}s', 'gen'),
          if (aiEnhanced)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(
                color: OrpheusColors.deepGold.withValues(alpha: 0.2),
                borderRadius: BorderRadius.circular(6),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.auto_awesome, size: 12, color: OrpheusColors.lyreGold),
                  const SizedBox(width: 4),
                  Text(
                    'AI',
                    style: GoogleFonts.inter(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: OrpheusColors.lyreGold,
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Widget _statItem(String value, String label) {
    return Column(
      children: [
        Text(
          value,
          style: GoogleFonts.jetBrainsMono(
            fontSize: 16,
            color: OrpheusColors.lyreGold,
          ),
        ),
        Text(
          label,
          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: OrpheusColors.mist,
                fontSize: 11,
              ),
        ),
      ],
    );
  }

  Widget _buildTrackTile(dynamic track) {
    final t = track as Map<String, dynamic>;
    final position = t['position'] as int? ?? 0;
    final name = t['name'] as String? ?? '';
    final artist = t['artist'] as String? ?? '';
    final albumArtUrl = t['albumArtUrl'] as String?;

    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: OrpheusColors.onyx,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: OrpheusColors.slate, width: 0.5),
        ),
        child: Row(
          children: [
            SizedBox(
              width: 28,
              child: Text(
                '$position',
                style: GoogleFonts.jetBrainsMono(
                  fontSize: 12,
                  color: OrpheusColors.mist,
                ),
                textAlign: TextAlign.center,
              ),
            ),
            const SizedBox(width: 10),
            if (albumArtUrl != null) ...[
              ClipRRect(
                borderRadius: BorderRadius.circular(4),
                child: Image.network(
                  albumArtUrl,
                  width: 36,
                  height: 36,
                  fit: BoxFit.cover,
                  errorBuilder: (_, __, ___) => Container(
                    width: 36,
                    height: 36,
                    color: OrpheusColors.charcoal,
                    child: const Icon(Icons.music_note, size: 16, color: OrpheusColors.mist),
                  ),
                ),
              ),
              const SizedBox(width: 10),
            ],
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    name,
                    style: Theme.of(context).textTheme.bodyMedium,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  Text(
                    artist,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: OrpheusColors.mist,
                        ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ── Error ────────────────────────────────────────────────────

  Widget _buildError(PlaylistState state) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(40),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(
              Icons.error_outline_rounded,
              size: 48,
              color: OrpheusColors.wineRed,
            ),
            const SizedBox(height: 16),
            Text(
              'Generation Failed',
              style: GoogleFonts.cinzel(
                fontSize: 18,
                color: OrpheusColors.wineRed,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              state.errorMessage ?? 'Unknown error',
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: OrpheusColors.mist,
                  ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 24),
            OutlinedButton.icon(
              onPressed: _reset,
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('TRY AGAIN'),
              style: OutlinedButton.styleFrom(
                foregroundColor: OrpheusColors.lyreGold,
                side: const BorderSide(color: OrpheusColors.lyreGold),
                padding: const EdgeInsets.symmetric(
                    horizontal: 24, vertical: 12),
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ── Helpers ──────────────────────────────────────────────────

  Widget _sectionLabel(String text) {
    return Text(
      text,
      style: GoogleFonts.cinzel(
        fontSize: 10,
        fontWeight: FontWeight.w400,
        color: OrpheusColors.lyreGold,
        letterSpacing: 3,
      ),
    );
  }

  Future<void> _openUrl(String url) async {
    final uri = Uri.parse(url);
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }
}
