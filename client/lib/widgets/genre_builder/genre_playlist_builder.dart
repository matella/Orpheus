import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../config/theme.dart';
import '../../providers/genre_builder_provider.dart';
import 'artist_filter_panel.dart';
import 'export_bar.dart';
import 'genre_family_picker.dart';
import 'secondary_filters.dart';
import 'track_preview_list.dart';

const _wideBreakpoint = 700.0;

/// "By genre" mode: side panel ≥ 700 px, stacked below.
class GenrePlaylistBuilder extends ConsumerWidget {
  const GenrePlaylistBuilder({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(genreBuilderProvider);
    final notifier = ref.read(genreBuilderProvider.notifier);
    final library = state.library;

    if (library == null) {
      return Center(
        child: state.loadingLibrary
            ? const CircularProgressIndicator(color: OrpheusColors.lyreGold)
            : Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(state.libraryError ?? 'Could not load genres'),
                  TextButton(onPressed: notifier.loadLibrary, child: const Text('Retry')),
                ],
              ),
      );
    }

    final derived = state.derived;
    final sections = <(String, Widget)>[
      (
        'GENRES',
        GenreFamilyPicker(
          families: library.families,
          selected: state.families,
          excludedGenres: state.excludedGenres,
          untaggedCount: library.untaggedCount,
          syncProgress: library.syncProgress,
          onToggleFamily: notifier.toggleFamily,
          onToggleSubGenre: notifier.toggleSubGenre,
          onContinueSync: notifier.triggerGenreSync,
        ),
      ),
      (
        'ARTISTS',
        ArtistFilterPanel(
          artists: state.previewArtists,
          excluded: state.excludedArtistIds,
          forced: state.forcedArtistNames,
          onToggleExcluded: notifier.toggleArtistExcluded,
          onSearch: notifier.searchArtists,
          onForce: notifier.forceArtist,
          onRemoveForced: notifier.removeForcedArtist,
        ),
      ),
      (
        'FILTERS',
        SecondaryFilters(
          likedFrom: state.likedFrom,
          likedTo: state.likedTo,
          limit: state.limit,
          energyMin: state.energyMin,
          energyMax: state.energyMax,
          featuresAvailable: library.featuresAvailable,
          onLikedRange: notifier.setLikedRange,
          onLimit: notifier.setLimit,
          onEnergy: notifier.setEnergyRange,
        ),
      ),
    ];

    final list = TrackPreviewList(
      candidates: derived.candidates,
      uncheckedIds: state.uncheckedIds,
      selectedCount: derived.selected.length,
      selectedDurationMs: derived.selectedDurationMs,
      sort: state.sort,
      featuresAvailable: library.featuresAvailable,
      loading: state.loadingPreview,
      onToggle: notifier.toggleTrack,
      onSetAll: notifier.setAllChecked,
      onSort: notifier.setSort,
    );

    final bar = ExportBar(
      selectedCount: derived.selected.length,
      selectedDurationMs: derived.selectedDurationMs,
      onCreate: () => showExportSheet(context),
    );

    final error = state.previewError == null
        ? const SizedBox.shrink()
        : Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Text(state.previewError!, style: const TextStyle(color: OrpheusColors.wineRedText)),
          );

    return LayoutBuilder(
      builder: (context, constraints) {
        if (constraints.maxWidth >= _wideBreakpoint) {
          return Column(
            children: [
              Expanded(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SizedBox(
                      width: 320,
                      child: ListView(
                        padding: const EdgeInsets.all(16),
                        children: [
                          for (final (label, widget) in sections) ...[
                            _label(context, label),
                            const SizedBox(height: 8),
                            widget,
                            const SizedBox(height: 20),
                          ],
                        ],
                      ),
                    ),
                    const VerticalDivider(width: 1, color: OrpheusColors.slate),
                    Expanded(
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
                        child: Column(children: [error, Expanded(child: list)]),
                      ),
                    ),
                  ],
                ),
              ),
              bar,
            ],
          );
        }
        // Narrow: collapsible sections above a fixed-height list.
        return Column(
          children: [
            Expanded(
              child: CustomScrollView(
                slivers: [
                  SliverList.list(
                    children: [
                      for (final (label, widget) in sections)
                        ExpansionTile(
                          title: _label(context, label),
                          initiallyExpanded: label == 'GENRES',
                          childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                          children: [widget],
                        ),
                      error,
                    ],
                  ),
                  SliverFillRemaining(
                    hasScrollBody: true,
                    child: Padding(padding: const EdgeInsets.symmetric(horizontal: 8), child: list),
                  ),
                ],
              ),
            ),
            bar,
          ],
        );
      },
    );
  }

  Widget _label(BuildContext context, String text) => Text(
        text,
        style: Theme.of(context).textTheme.labelSmall?.copyWith(
              color: OrpheusColors.lyreGold,
              letterSpacing: 3,
            ),
      );
}
