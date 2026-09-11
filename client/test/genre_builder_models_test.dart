import 'package:flutter_test/flutter_test.dart';
import 'package:orpheus/models/genre_builder_models.dart';

void main() {
  test('GenreLibrary.fromJson parses families and sync progress', () {
    final lib = GenreLibrary.fromJson({
      'families': [
        {
          'id': 'k-pop', 'label': 'K-pop', 'trackCount': 842,
          'genres': [{'name': 'k-pop girl group', 'trackCount': 410}],
        },
      ],
      'untaggedCount': 312,
      'featuresAvailable': false,
      'genreSyncProgress': {'done': 1830, 'total': 2140, 'running': true},
    });

    expect(lib.families.single.label, 'K-pop');
    expect(lib.families.single.genres.single.trackCount, 410);
    expect(lib.untaggedCount, 312);
    expect(lib.featuresAvailable, isFalse);
    expect(lib.syncProgress.running, isTrue);
    expect(lib.syncProgress.complete, isFalse);
  });

  test('PreviewTrack.fromJson tolerates nulls', () {
    final t = PreviewTrack.fromJson({
      'id': 1, 'spotifyId': 's1', 'name': 'Supernova', 'artist': 'aespa',
      'albumArtUrl': null, 'durationMs': 180000, 'likedAt': '2024-05-01T10:00:00Z',
      'energy': null, 'artistIds': ['a1'], 'matchedGenres': ['k-pop'],
    });
    expect(t.likedAt, DateTime.utc(2024, 5, 1, 10));
    expect(t.energy, isNull);
    expect(t.artistIds, ['a1']);
  });

  test('formatApiDate', () {
    expect(formatApiDate(DateTime(2023, 1, 5)), '2023-01-05');
  });
}
