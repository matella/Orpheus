import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../config/theme.dart';
import '../../providers/genre_builder_provider.dart';
import '../spotify_attribution.dart';
import 'track_preview_list.dart' show formatDuration;

/// Bottom bar with the create button.
class ExportBar extends StatelessWidget {
  final int selectedCount;
  final int selectedDurationMs;
  final VoidCallback? onCreate;

  const ExportBar({super.key, required this.selectedCount, required this.selectedDurationMs, required this.onCreate});

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
        child: SizedBox(
          width: double.infinity,
          child: ElevatedButton.icon(
            onPressed: selectedCount > 0 ? onCreate : null,
            icon: const Icon(Icons.playlist_add_rounded),
            label: Text('Create · $selectedCount tracks · ${formatDuration(selectedDurationMs)}'),
            style: ElevatedButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 14)),
          ),
        ),
      ),
    );
  }
}

/// Name / description / visibility form, then progress and result.
Future<void> showExportSheet(BuildContext context) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: OrpheusColors.onyx,
    builder: (_) => const _ExportSheet(),
  );
}

class _ExportSheet extends ConsumerStatefulWidget {
  const _ExportSheet();

  @override
  ConsumerState<_ExportSheet> createState() => _ExportSheetState();
}

class _ExportSheetState extends ConsumerState<_ExportSheet> {
  late final TextEditingController _name;
  final _description = TextEditingController();
  bool _isPublic = false;

  @override
  void initState() {
    super.initState();
    _name = TextEditingController(text: ref.read(genreBuilderProvider).defaultPlaylistName);
  }

  @override
  void dispose() {
    _name.dispose();
    _description.dispose();
    super.dispose();
  }

  Future<void> _open(String url) async {
    final uri = Uri.parse(url);
    if (await canLaunchUrl(uri)) await launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(genreBuilderProvider);
    final notifier = ref.read(genreBuilderProvider.notifier);
    final text = Theme.of(context).textTheme;

    final Widget body = switch (state.exportStatus) {
      ExportStatus.idle || ExportStatus.error => Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('New Spotify playlist', style: text.titleMedium),
            const SizedBox(height: 12),
            TextField(
              controller: _name,
              maxLength: 100,
              decoration: const InputDecoration(labelText: 'Name'),
              onChanged: (_) => setState(() {}),
            ),
            TextField(
              controller: _description,
              maxLength: 300,
              maxLines: 2,
              decoration: const InputDecoration(labelText: 'Description'),
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Public'),
              value: _isPublic,
              onChanged: (v) => setState(() => _isPublic = v),
            ),
            if (state.exportError != null)
              Text(state.exportError!, style: text.bodySmall?.copyWith(color: OrpheusColors.wineRedText)),
            const SizedBox(height: 8),
            ElevatedButton(
              onPressed: _name.text.trim().isEmpty
                  ? null
                  : () => notifier.exportPlaylist(
                        name: _name.text.trim(),
                        description: _description.text.trim(),
                        isPublic: _isPublic,
                      ),
              child: Text('Create ${state.derived.selected.length} tracks'),
            ),
          ],
        ),
      ExportStatus.exporting => Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('Adding tracks… ${state.exportAdded} / ${state.exportTotal}', style: text.bodyMedium),
            const SizedBox(height: 12),
            LinearProgressIndicator(
              value: state.exportTotal == 0 ? null : state.exportAdded / state.exportTotal,
              color: OrpheusColors.lyreGold,
              backgroundColor: OrpheusColors.slate,
            ),
          ],
        ),
      ExportStatus.done => Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Playlist created', style: text.titleMedium?.copyWith(color: OrpheusColors.lyreGold)),
            const SizedBox(height: 8),
            if (state.exportResult?['partial'] == true)
              Text(
                'Only ${state.exportResult?['addedCount']} of ${state.exportTotal} tracks were added — Spotify stopped the export.',
                style: text.bodySmall?.copyWith(color: OrpheusColors.wineRedText),
              ),
            const SizedBox(height: 12),
            if (state.exportResult?['spotifyPlaylistUrl'] is String)
              ElevatedButton.icon(
                onPressed: () => _open(state.exportResult!['spotifyPlaylistUrl'] as String),
                icon: const Icon(Icons.open_in_new_rounded),
                label: const Text('Open in Spotify'),
              ),
            const SizedBox(height: 8),
            OutlinedButton(
              onPressed: () {
                notifier.startOver();
                Navigator.of(context).pop();
              },
              child: const Text('New playlist'),
            ),
            const SizedBox(height: 8),
            const SpotifyAttribution(style: SpotifyAttributionStyle.full),
          ],
        ),
    };

    return Padding(
      padding: EdgeInsets.fromLTRB(20, 20, 20, 20 + MediaQuery.of(context).viewInsets.bottom),
      child: body,
    );
  }
}
