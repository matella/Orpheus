import 'package:flutter/material.dart';
import '../../config/theme.dart';
import '../../models/genre_builder_models.dart';

String formatDuration(int ms) {
  final minutes = ms ~/ 60000;
  return minutes >= 60 ? '${minutes ~/ 60} h ${(minutes % 60).toString().padLeft(2, '0')}' : '$minutes min';
}

const _sortLabels = {
  TrackSort.likedDesc: 'Liked (newest)',
  TrackSort.likedAsc: 'Liked (oldest)',
  TrackSort.artist: 'Artist',
  TrackSort.title: 'Title',
  TrackSort.shuffle: 'Shuffle',
  TrackSort.smooth: 'Smooth transitions',
};

/// Header (counts, select all, sort) + lazily built checkable track rows.
/// Must be given bounded height (it contains an Expanded ListView).
class TrackPreviewList extends StatelessWidget {
  final List<PreviewTrack> candidates;
  final Set<int> uncheckedIds;
  final int selectedCount;
  final int selectedDurationMs;
  final TrackSort sort;
  final bool featuresAvailable;
  final bool loading;
  final ValueChanged<int> onToggle;
  final ValueChanged<bool> onSetAll;
  final ValueChanged<TrackSort> onSort;

  const TrackPreviewList({
    super.key,
    required this.candidates,
    required this.uncheckedIds,
    required this.selectedCount,
    required this.selectedDurationMs,
    required this.sort,
    required this.featuresAvailable,
    required this.loading,
    required this.onToggle,
    required this.onSetAll,
    required this.onSort,
  });

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Column(
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                '$selectedCount / ${candidates.length} selected · ${formatDuration(selectedDurationMs)}',
                style: text.bodySmall?.copyWith(color: OrpheusColors.lyreGold),
              ),
            ),
            IconButton(tooltip: 'Select all', onPressed: () => onSetAll(true), icon: const Icon(Icons.done_all_rounded, size: 20)),
            IconButton(tooltip: 'Unselect all', onPressed: () => onSetAll(false), icon: const Icon(Icons.remove_done_rounded, size: 20)),
            PopupMenuButton<TrackSort>(
              tooltip: 'Sort',
              icon: const Icon(Icons.sort_rounded, size: 20),
              initialValue: sort,
              onSelected: onSort,
              itemBuilder: (_) => [
                for (final s in TrackSort.values)
                  if (s != TrackSort.smooth || featuresAvailable)
                    PopupMenuItem(value: s, child: Text(_sortLabels[s]!)),
              ],
            ),
          ],
        ),
        if (loading) const LinearProgressIndicator(color: OrpheusColors.lyreGold, minHeight: 2),
        Expanded(
          child: candidates.isEmpty
              ? Center(
                  child: Text(
                    loading ? 'Loading…' : 'Pick a genre family to preview tracks',
                    style: text.bodyMedium?.copyWith(color: OrpheusColors.mist),
                  ),
                )
              : ListView.builder(
                  itemCount: candidates.length,
                  itemExtent: 56,
                  itemBuilder: (context, i) {
                    final t = candidates[i];
                    final checked = !uncheckedIds.contains(t.id);
                    return InkWell(
                      onTap: () => onToggle(t.id),
                      child: Row(
                        children: [
                          Checkbox(value: checked, onChanged: (_) => onToggle(t.id)),
                          ClipRRect(
                            borderRadius: BorderRadius.circular(4),
                            child: t.albumArtUrl == null
                                ? Container(width: 40, height: 40, color: OrpheusColors.charcoal)
                                : Image.network(
                                    t.albumArtUrl!,
                                    width: 40,
                                    height: 40,
                                    fit: BoxFit.cover,
                                    errorBuilder: (_, __, ___) =>
                                        Container(width: 40, height: 40, color: OrpheusColors.charcoal),
                                  ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Opacity(
                              opacity: checked ? 1 : 0.4,
                              child: Column(
                                mainAxisAlignment: MainAxisAlignment.center,
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(t.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: text.bodyMedium),
                                  Text(
                                    t.artist,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: text.bodySmall?.copyWith(color: OrpheusColors.mist),
                                  ),
                                ],
                              ),
                            ),
                          ),
                          if (t.likedAt != null)
                            Padding(
                              padding: const EdgeInsets.only(right: 8),
                              child: Text(
                                formatApiDate(t.likedAt!.toLocal()),
                                style: text.bodySmall?.copyWith(color: OrpheusColors.mist),
                              ),
                            ),
                        ],
                      ),
                    );
                  },
                ),
        ),
      ],
    );
  }
}
