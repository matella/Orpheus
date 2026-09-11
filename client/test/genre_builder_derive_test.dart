import 'package:flutter_test/flutter_test.dart';
import 'package:orpheus/models/genre_builder_models.dart';

PreviewTrack t(int id, {String artist = 'A', List<String> artistIds = const ['a'], String? liked, String? name}) =>
    PreviewTrack(
      id: id, spotifyId: 's$id', name: name ?? 'Song $id', artist: artist, albumArtUrl: null,
      durationMs: 1000, likedAt: liked == null ? null : DateTime.parse(liked), energy: null,
      artistIds: artistIds, matchedGenres: const [],
    );

DerivedTracks derive(List<PreviewTrack> preview, {
  Map<String, List<PreviewTrack>> forced = const {},
  Set<String> excluded = const {},
  Set<int> unchecked = const {},
  TrackSort sort = TrackSort.likedDesc,
  List<int>? smooth,
  int? limit,
}) =>
    deriveTracks(
      previewTracks: preview, forcedArtistTracks: forced, excludedArtistIds: excluded,
      uncheckedIds: unchecked, sort: sort, smoothOrder: smooth, limit: limit,
    );

void main() {
  final a = t(1, liked: '2024-01-01', name: 'b-side');
  final b = t(2, liked: '2024-03-01', artist: 'Zed', artistIds: ['z'], name: 'Alpha');
  final c = t(3, liked: '2024-02-01', artistIds: ['a', 'feat'], name: 'Charlie');

  test('sorts by liked date descending by default', () {
    expect(derive([a, b, c]).candidates.map((x) => x.id), [2, 3, 1]);
  });

  test('excluding an artist removes tracks where it appears anywhere', () {
    expect(derive([a, b, c], excluded: {'feat'}).candidates.map((x) => x.id), [2, 1]);
  });

  test('unchecked tracks stay in candidates but leave selected', () {
    final d = derive([a, b, c], unchecked: {3});
    expect(d.candidates.length, 3);
    expect(d.selected.map((x) => x.id), [2, 1]);
    expect(d.selectedDurationMs, 2000);
  });

  test('forced artist tracks are merged without duplicates', () {
    final extra = t(9, liked: '2025-01-01', artistIds: ['x']);
    final d = derive([a, b], forced: {'x': [extra, a]});
    expect(d.candidates.map((x) => x.id), [9, 2, 1]);
  });

  test('limit applies after unchecking', () {
    expect(derive([a, b, c], unchecked: {2}, limit: 1).selected.map((x) => x.id), [3]);
  });

  test('artist and title sorts are case-insensitive', () {
    expect(derive([a, b, c], sort: TrackSort.title).candidates.map((x) => x.id), [2, 1, 3]);
    expect(derive([a, b, c], sort: TrackSort.artist).candidates.map((x) => x.id), [1, 3, 2]);
  });

  test('smooth order follows server ids, unknown ids at the end', () {
    expect(derive([a, b, c], sort: TrackSort.smooth, smooth: [1, 2]).candidates.map((x) => x.id), [1, 2, 3]);
  });

  test('shuffle is deterministic for a seed', () {
    final list = List.generate(20, (i) => t(i, liked: '2024-01-${(i % 28 + 1).toString().padLeft(2, '0')}'));
    final one = deriveTracks(previewTracks: list, forcedArtistTracks: const {}, excludedArtistIds: const {},
        uncheckedIds: const {}, sort: TrackSort.shuffle, shuffleSeed: 7);
    final two = deriveTracks(previewTracks: list, forcedArtistTracks: const {}, excludedArtistIds: const {},
        uncheckedIds: const {}, sort: TrackSort.shuffle, shuffleSeed: 7);
    expect(one.candidates.map((x) => x.id), two.candidates.map((x) => x.id));
    expect(one.candidates.length, 20);
  });

  test('retainUnchecked keeps unchecks on force-added artist tracks', () {
    final forced = t(9, artistIds: ['x']);
    final kept = retainUnchecked(
      uncheckedIds: {1, 9, 42},
      previewTracks: [a],
      forcedArtistTracks: {'x': [forced]},
    );
    expect(kept, {1, 9});
  });

  test('excluding a forced artist un-forces it; toggling again only un-excludes', () {
    final forcedTrack = t(9, artistIds: ['x']);
    final excluded = toggleArtistExclusion(
      artistId: 'x',
      excludedArtistIds: const {},
      forcedArtistTracks: {'x': [forcedTrack]},
      forcedArtistNames: const {'x': 'X'},
    );
    expect(excluded.excludedArtistIds, {'x'});
    expect(excluded.forcedArtistTracks, isEmpty);
    expect(excluded.forcedArtistNames, isEmpty);

    final again = toggleArtistExclusion(
      artistId: 'x',
      excludedArtistIds: excluded.excludedArtistIds,
      forcedArtistTracks: excluded.forcedArtistTracks,
      forcedArtistNames: excluded.forcedArtistNames,
    );
    expect(again.excludedArtistIds, isEmpty);
    expect(again.forcedArtistTracks, isEmpty);
  });
}
