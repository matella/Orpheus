import 'package:flutter/material.dart';
import '../../config/theme.dart';
import '../../models/genre_builder_models.dart';

/// Multi-select genre families; each selected family shows its sub-genres,
/// which can be unchecked (→ excluded from the preview).
class GenreFamilyPicker extends StatelessWidget {
  final List<GenreFamily> families;
  final Set<String> selected;
  final Set<String> excludedGenres;
  final int untaggedCount;
  final GenreSyncProgress syncProgress;
  final ValueChanged<String> onToggleFamily;
  final ValueChanged<String> onToggleSubGenre;
  final VoidCallback onContinueSync;

  const GenreFamilyPicker({
    super.key,
    required this.families,
    required this.selected,
    required this.excludedGenres,
    required this.untaggedCount,
    required this.syncProgress,
    required this.onToggleFamily,
    required this.onToggleSubGenre,
    required this.onContinueSync,
  });

  @override
  Widget build(BuildContext context) {
    final small = Theme.of(context).textTheme.bodySmall?.copyWith(color: OrpheusColors.mist);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (!syncProgress.complete) ...[
          Text('Genre sync ${syncProgress.done} / ${syncProgress.total}', style: small),
          const SizedBox(height: 4),
          LinearProgressIndicator(
            value: syncProgress.total == 0 ? null : syncProgress.done / syncProgress.total,
            color: OrpheusColors.lyreGold,
            backgroundColor: OrpheusColors.slate,
          ),
          if (!syncProgress.running)
            TextButton(onPressed: onContinueSync, child: const Text('Continue sync')),
          const SizedBox(height: 8),
        ],
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [
            for (final f in families)
              FilterChip(
                label: Text('${f.label} · ${f.trackCount}'),
                selected: selected.contains(f.id),
                onSelected: (_) => onToggleFamily(f.id),
                selectedColor: OrpheusColors.deepGold,
                side: BorderSide(color: selected.contains(f.id) ? OrpheusColors.lyreGold : OrpheusColors.slate),
              ),
          ],
        ),
        for (final f in families.where((f) => selected.contains(f.id) && f.genres.length > 1)) ...[
          const SizedBox(height: 12),
          Text('${f.label} sub-genres', style: small),
          const SizedBox(height: 6),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              for (final g in f.genres)
                FilterChip(
                  label: Text('${g.name} · ${g.trackCount}'),
                  selected: !excludedGenres.contains(g.name),
                  onSelected: (_) => onToggleSubGenre(g.name),
                  visualDensity: VisualDensity.compact,
                ),
            ],
          ),
        ],
        if (untaggedCount > 0) ...[
          const SizedBox(height: 8),
          Text('$untaggedCount untagged tracks', style: small),
        ],
      ],
    );
  }
}
