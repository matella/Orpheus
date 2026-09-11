import 'dart:math';

class GenreCount {
  final String name;
  final int trackCount;
  const GenreCount({required this.name, required this.trackCount});

  factory GenreCount.fromJson(Map<String, dynamic> json) => GenreCount(
        name: json['name'] as String,
        trackCount: (json['trackCount'] as num).toInt(),
      );
}

class GenreFamily {
  final String id;
  final String label;
  final int trackCount;
  final List<GenreCount> genres;
  const GenreFamily({required this.id, required this.label, required this.trackCount, required this.genres});

  factory GenreFamily.fromJson(Map<String, dynamic> json) => GenreFamily(
        id: json['id'] as String,
        label: json['label'] as String,
        trackCount: (json['trackCount'] as num).toInt(),
        genres: (json['genres'] as List? ?? [])
            .map((g) => GenreCount.fromJson(g as Map<String, dynamic>))
            .toList(),
      );
}

class GenreSyncProgress {
  final int done;
  final int total;
  final bool running;
  const GenreSyncProgress({this.done = 0, this.total = 0, this.running = false});

  bool get complete => total == 0 || done >= total;

  factory GenreSyncProgress.fromJson(Map<String, dynamic> json) => GenreSyncProgress(
        done: (json['done'] as num?)?.toInt() ?? 0,
        total: (json['total'] as num?)?.toInt() ?? 0,
        running: json['running'] as bool? ?? false,
      );
}

class GenreLibrary {
  final List<GenreFamily> families;
  final int untaggedCount;
  final bool featuresAvailable;
  final GenreSyncProgress syncProgress;
  const GenreLibrary({
    required this.families,
    required this.untaggedCount,
    required this.featuresAvailable,
    required this.syncProgress,
  });

  GenreLibrary copyWith({GenreSyncProgress? syncProgress}) => GenreLibrary(
        families: families,
        untaggedCount: untaggedCount,
        featuresAvailable: featuresAvailable,
        syncProgress: syncProgress ?? this.syncProgress,
      );

  factory GenreLibrary.fromJson(Map<String, dynamic> json) => GenreLibrary(
        families: (json['families'] as List? ?? [])
            .map((f) => GenreFamily.fromJson(f as Map<String, dynamic>))
            .toList(),
        untaggedCount: (json['untaggedCount'] as num?)?.toInt() ?? 0,
        featuresAvailable: json['featuresAvailable'] as bool? ?? false,
        syncProgress: GenreSyncProgress.fromJson(
          json['genreSyncProgress'] as Map<String, dynamic>? ?? const {},
        ),
      );
}

class PreviewTrack {
  final int id;
  final String spotifyId;
  final String name;
  final String artist;
  final String? albumArtUrl;
  final int durationMs;
  final DateTime? likedAt;
  final double? energy;
  final List<String> artistIds;
  final List<String> matchedGenres;
  const PreviewTrack({
    required this.id,
    required this.spotifyId,
    required this.name,
    required this.artist,
    required this.albumArtUrl,
    required this.durationMs,
    required this.likedAt,
    required this.energy,
    required this.artistIds,
    required this.matchedGenres,
  });

  factory PreviewTrack.fromJson(Map<String, dynamic> json) => PreviewTrack(
        id: (json['id'] as num).toInt(),
        spotifyId: json['spotifyId'] as String,
        name: json['name'] as String? ?? '',
        artist: json['artist'] as String? ?? '',
        albumArtUrl: json['albumArtUrl'] as String?,
        durationMs: (json['durationMs'] as num?)?.toInt() ?? 0,
        likedAt: json['likedAt'] == null ? null : DateTime.tryParse(json['likedAt'] as String),
        energy: (json['energy'] as num?)?.toDouble(),
        artistIds: (json['artistIds'] as List? ?? []).cast<String>(),
        matchedGenres: (json['matchedGenres'] as List? ?? []).cast<String>(),
      );
}

class PreviewArtist {
  final String artistId;
  final String name;
  final int trackCount;
  const PreviewArtist({required this.artistId, required this.name, required this.trackCount});

  factory PreviewArtist.fromJson(Map<String, dynamic> json) => PreviewArtist(
        artistId: json['artistId'] as String,
        name: json['name'] as String? ?? '',
        trackCount: (json['trackCount'] as num?)?.toInt() ?? 0,
      );
}

enum TrackSort { likedDesc, likedAsc, artist, title, shuffle, smooth }

class DerivedTracks {
  final List<PreviewTrack> candidates;
  final List<PreviewTrack> selected;
  const DerivedTracks({required this.candidates, required this.selected});

  int get selectedDurationMs => selected.fold(0, (sum, t) => sum + t.durationMs);
}

int _compareLikedDesc(PreviewTrack a, PreviewTrack b) {
  if (a.likedAt == null && b.likedAt == null) return 0;
  if (a.likedAt == null) return 1;
  if (b.likedAt == null) return -1;
  return b.likedAt!.compareTo(a.likedAt!);
}

int _compareLikedAsc(PreviewTrack a, PreviewTrack b) {
  if (a.likedAt == null && b.likedAt == null) return 0;
  if (a.likedAt == null) return 1;
  if (b.likedAt == null) return -1;
  return a.likedAt!.compareTo(b.likedAt!);
}

/// Applies the builder's local customization to the server preview.
/// Pure function — see Task 9 derivation rules.
DerivedTracks deriveTracks({
  required List<PreviewTrack> previewTracks,
  required Map<String, List<PreviewTrack>> forcedArtistTracks,
  required Set<String> excludedArtistIds,
  required Set<int> uncheckedIds,
  required TrackSort sort,
  List<int>? smoothOrder,
  int shuffleSeed = 0,
  int? limit,
}) {
  final seen = <int>{};
  final merged = <PreviewTrack>[];
  for (final t in [...previewTracks, ...forcedArtistTracks.values.expand((l) => l)]) {
    if (seen.add(t.id)) merged.add(t);
  }

  final candidates = merged
      .where((t) => !t.artistIds.any(excludedArtistIds.contains))
      .toList()
    ..sort(_compareLikedDesc);

  switch (sort) {
    case TrackSort.likedDesc:
      break;
    case TrackSort.likedAsc:
      candidates.sort(_compareLikedAsc);
    case TrackSort.artist:
      candidates.sort((a, b) {
        final byArtist = a.artist.toLowerCase().compareTo(b.artist.toLowerCase());
        return byArtist != 0 ? byArtist : a.name.toLowerCase().compareTo(b.name.toLowerCase());
      });
    case TrackSort.title:
      candidates.sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
    case TrackSort.shuffle:
      candidates.shuffle(Random(shuffleSeed));
    case TrackSort.smooth:
      final rank = {for (final (i, id) in (smoothOrder ?? const <int>[]).indexed) id: i};
      final ranked = candidates.where((t) => rank.containsKey(t.id)).toList()
        ..sort((a, b) => rank[a.id]!.compareTo(rank[b.id]!));
      final rest = candidates.where((t) => !rank.containsKey(t.id)).toList();
      candidates
        ..clear()
        ..addAll(ranked)
        ..addAll(rest);
  }

  var selected = candidates.where((t) => !uncheckedIds.contains(t.id)).toList();
  if (limit != null && limit >= 0 && selected.length > limit) {
    selected = selected.sublist(0, limit);
  }
  return DerivedTracks(candidates: candidates, selected: selected);
}

String formatApiDate(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

/// Unchecked ids to keep after the preview changes: ids still visible,
/// i.e. in the new preview or among force-added artists' tracks.
Set<int> retainUnchecked({
  required Set<int> uncheckedIds,
  required List<PreviewTrack> previewTracks,
  required Map<String, List<PreviewTrack>> forcedArtistTracks,
}) {
  final visible = {
    for (final t in previewTracks) t.id,
    for (final t in forcedArtistTracks.values.expand((l) => l)) t.id,
  };
  return uncheckedIds.where(visible.contains).toSet();
}

/// Builder state touched by toggling an artist's exclusion.
typedef ArtistExclusionState = ({
  Set<String> excludedArtistIds,
  Map<String, List<PreviewTrack>> forcedArtistTracks,
  Map<String, String> forcedArtistNames,
});

/// Toggles an artist's exclusion. Excluding a forced artist also un-forces it
/// (the last action wins), so forced and excluded artists never overlap.
ArtistExclusionState toggleArtistExclusion({
  required String artistId,
  required Set<String> excludedArtistIds,
  required Map<String, List<PreviewTrack>> forcedArtistTracks,
  required Map<String, String> forcedArtistNames,
}) {
  final excluded = {...excludedArtistIds};
  if (excluded.remove(artistId)) {
    return (
      excludedArtistIds: excluded,
      forcedArtistTracks: forcedArtistTracks,
      forcedArtistNames: forcedArtistNames,
    );
  }
  excluded.add(artistId);
  return (
    excludedArtistIds: excluded,
    forcedArtistTracks: {...forcedArtistTracks}..remove(artistId),
    forcedArtistNames: {...forcedArtistNames}..remove(artistId),
  );
}
