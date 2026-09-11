import 'dart:async';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/genre_builder_models.dart';
import '../services/api_service.dart';
import '../services/websocket_service.dart';

enum ExportStatus { idle, exporting, done, error }

const _unset = Object();

class GenreBuilderState {
  final bool loadingLibrary;
  final GenreLibrary? library;
  final String? libraryError;

  // Server-side filters (trigger a debounced preview)
  final Set<String> families;
  final Set<String> excludedGenres;
  final DateTime? likedFrom;
  final DateTime? likedTo;
  final double? energyMin;
  final double? energyMax;

  final bool loadingPreview;
  final String? previewError;
  final List<PreviewTrack> previewTracks;
  final List<PreviewArtist> previewArtists;

  // Local customization (no network)
  final Map<String, List<PreviewTrack>> forcedArtistTracks;
  final Map<String, String> forcedArtistNames;
  final Set<String> excludedArtistIds;
  final Set<int> uncheckedIds;
  final TrackSort sort;
  final List<int>? smoothOrder;
  final int shuffleSeed;
  final int? limit;

  final ExportStatus exportStatus;
  final int exportAdded;
  final int exportTotal;
  final Map<String, dynamic>? exportResult;
  final String? exportError;

  const GenreBuilderState({
    this.loadingLibrary = false,
    this.library,
    this.libraryError,
    this.families = const {},
    this.excludedGenres = const {},
    this.likedFrom,
    this.likedTo,
    this.energyMin,
    this.energyMax,
    this.loadingPreview = false,
    this.previewError,
    this.previewTracks = const [],
    this.previewArtists = const [],
    this.forcedArtistTracks = const {},
    this.forcedArtistNames = const {},
    this.excludedArtistIds = const {},
    this.uncheckedIds = const {},
    this.sort = TrackSort.likedDesc,
    this.smoothOrder,
    this.shuffleSeed = 0,
    this.limit,
    this.exportStatus = ExportStatus.idle,
    this.exportAdded = 0,
    this.exportTotal = 0,
    this.exportResult,
    this.exportError,
  });

  DerivedTracks get derived => deriveTracks(
        previewTracks: previewTracks,
        forcedArtistTracks: forcedArtistTracks,
        excludedArtistIds: excludedArtistIds,
        uncheckedIds: uncheckedIds,
        sort: sort,
        smoothOrder: smoothOrder,
        shuffleSeed: shuffleSeed,
        limit: limit,
      );

  bool get hasSelection => families.isNotEmpty;

  /// Default export name: "`<first family label>` — Orpheus".
  String get defaultPlaylistName {
    final labels = library?.families
            .where((f) => families.contains(f.id))
            .map((f) => f.label)
            .toList() ??
        const <String>[];
    return labels.isEmpty ? 'Orpheus Mix' : '${labels.join(' + ')} — Orpheus';
  }

  GenreBuilderState copyWith({
    bool? loadingLibrary,
    Object? library = _unset,
    Object? libraryError = _unset,
    Set<String>? families,
    Set<String>? excludedGenres,
    Object? likedFrom = _unset,
    Object? likedTo = _unset,
    Object? energyMin = _unset,
    Object? energyMax = _unset,
    bool? loadingPreview,
    Object? previewError = _unset,
    List<PreviewTrack>? previewTracks,
    List<PreviewArtist>? previewArtists,
    Map<String, List<PreviewTrack>>? forcedArtistTracks,
    Map<String, String>? forcedArtistNames,
    Set<String>? excludedArtistIds,
    Set<int>? uncheckedIds,
    TrackSort? sort,
    Object? smoothOrder = _unset,
    int? shuffleSeed,
    Object? limit = _unset,
    ExportStatus? exportStatus,
    int? exportAdded,
    int? exportTotal,
    Object? exportResult = _unset,
    Object? exportError = _unset,
  }) {
    return GenreBuilderState(
      loadingLibrary: loadingLibrary ?? this.loadingLibrary,
      library: identical(library, _unset) ? this.library : library as GenreLibrary?,
      libraryError: identical(libraryError, _unset) ? this.libraryError : libraryError as String?,
      families: families ?? this.families,
      excludedGenres: excludedGenres ?? this.excludedGenres,
      likedFrom: identical(likedFrom, _unset) ? this.likedFrom : likedFrom as DateTime?,
      likedTo: identical(likedTo, _unset) ? this.likedTo : likedTo as DateTime?,
      energyMin: identical(energyMin, _unset) ? this.energyMin : energyMin as double?,
      energyMax: identical(energyMax, _unset) ? this.energyMax : energyMax as double?,
      loadingPreview: loadingPreview ?? this.loadingPreview,
      previewError: identical(previewError, _unset) ? this.previewError : previewError as String?,
      previewTracks: previewTracks ?? this.previewTracks,
      previewArtists: previewArtists ?? this.previewArtists,
      forcedArtistTracks: forcedArtistTracks ?? this.forcedArtistTracks,
      forcedArtistNames: forcedArtistNames ?? this.forcedArtistNames,
      excludedArtistIds: excludedArtistIds ?? this.excludedArtistIds,
      uncheckedIds: uncheckedIds ?? this.uncheckedIds,
      sort: sort ?? this.sort,
      smoothOrder: identical(smoothOrder, _unset) ? this.smoothOrder : smoothOrder as List<int>?,
      shuffleSeed: shuffleSeed ?? this.shuffleSeed,
      limit: identical(limit, _unset) ? this.limit : limit as int?,
      exportStatus: exportStatus ?? this.exportStatus,
      exportAdded: exportAdded ?? this.exportAdded,
      exportTotal: exportTotal ?? this.exportTotal,
      exportResult: identical(exportResult, _unset) ? this.exportResult : exportResult as Map<String, dynamic>?,
      exportError: identical(exportError, _unset) ? this.exportError : exportError as String?,
    );
  }
}

class GenreBuilderNotifier extends Notifier<GenreBuilderState> {
  StreamSubscription<Map<String, dynamic>>? _wsSub;
  Timer? _debounce;
  int _previewRequest = 0;

  @override
  GenreBuilderState build() {
    ref.onDispose(() {
      _wsSub?.cancel();
      _debounce?.cancel();
    });
    _listenToWebSocket();
    Future.microtask(loadLibrary);
    return const GenreBuilderState(loadingLibrary: true);
  }

  void _listenToWebSocket() {
    _wsSub?.cancel();
    _wsSub = wsService.messages.listen((msg) {
      final data = msg['data'] as Map<String, dynamic>?;
      if (data == null) return;
      switch (msg['type']) {
        case 'genre_sync_progress':
          final progress = GenreSyncProgress.fromJson(data);
          final lib = state.library;
          if (lib != null) state = state.copyWith(library: lib.copyWith(syncProgress: progress));
          // Refresh counts once a sync run finishes.
          if (!progress.running && lib != null && lib.syncProgress.running) loadLibrary();
        case 'genre_playlist_export_progress':
          if (state.exportStatus == ExportStatus.exporting) {
            state = state.copyWith(
              exportAdded: (data['added'] as num?)?.toInt() ?? 0,
              exportTotal: (data['total'] as num?)?.toInt() ?? state.exportTotal,
            );
          }
      }
    });
  }

  String _errorText(Object e) {
    if (e is DioException) {
      final body = e.response?.data;
      if (body is Map && body['message'] is String) return body['message'] as String;
      return e.message ?? 'Network error';
    }
    return e.toString();
  }

  Future<void> loadLibrary() async {
    state = state.copyWith(loadingLibrary: true, libraryError: null);
    try {
      final json = await apiService.getLibraryGenres();
      state = state.copyWith(loadingLibrary: false, library: GenreLibrary.fromJson(json));
    } catch (e) {
      state = state.copyWith(loadingLibrary: false, libraryError: _errorText(e));
    }
  }

  Future<void> triggerGenreSync() async {
    try {
      await apiService.triggerGenreSync();
    } catch (e) {
      state = state.copyWith(libraryError: _errorText(e));
    }
  }

  // ── Server filters ────────────────────────────────────────

  void toggleFamily(String familyId) {
    final next = {...state.families};
    if (!next.remove(familyId)) next.add(familyId);
    state = state.copyWith(families: next);
    _schedulePreview();
  }

  void toggleSubGenre(String genre) {
    final next = {...state.excludedGenres};
    if (!next.remove(genre)) next.add(genre);
    state = state.copyWith(excludedGenres: next);
    _schedulePreview();
  }

  void setLikedRange(DateTime? from, DateTime? to) {
    state = state.copyWith(likedFrom: from, likedTo: to);
    _schedulePreview();
  }

  void setEnergyRange(double? min, double? max) {
    state = state.copyWith(energyMin: min, energyMax: max);
    _schedulePreview();
  }

  void _schedulePreview() {
    _debounce?.cancel();
    if (state.families.isEmpty) {
      _previewRequest++;
      state = state.copyWith(previewTracks: const [], previewArtists: const [], loadingPreview: false, previewError: null);
      return;
    }
    state = state.copyWith(loadingPreview: true);
    _debounce = Timer(const Duration(milliseconds: 400), _runPreview);
  }

  Future<void> _runPreview() async {
    final request = ++_previewRequest;
    final s = state;
    try {
      final json = await apiService.previewGenrePlaylist({
        'families': s.families.toList(),
        'excludeGenres': s.excludedGenres.toList(),
        'likedFrom': s.likedFrom == null ? null : formatApiDate(s.likedFrom!),
        'likedTo': s.likedTo == null ? null : formatApiDate(s.likedTo!),
        'energyMin': s.energyMin,
        'energyMax': s.energyMax,
      });
      if (request != _previewRequest) return; // stale response
      final tracks = (json['tracks'] as List)
          .map((t) => PreviewTrack.fromJson(t as Map<String, dynamic>))
          .toList();
      final artists = (json['artists'] as List)
          .map((a) => PreviewArtist.fromJson(a as Map<String, dynamic>))
          .toList();
      final stillPresent = tracks.map((t) => t.id).toSet();
      state = state.copyWith(
        loadingPreview: false,
        previewError: null,
        previewTracks: tracks,
        previewArtists: artists,
        uncheckedIds: state.uncheckedIds.where(stillPresent.contains).toSet(),
        smoothOrder: null,
        sort: state.sort == TrackSort.smooth ? TrackSort.likedDesc : state.sort,
      );
    } catch (e) {
      if (request != _previewRequest) return;
      state = state.copyWith(loadingPreview: false, previewError: _errorText(e));
    }
  }

  // ── Local customization ───────────────────────────────────

  void toggleTrack(int trackId) {
    final next = {...state.uncheckedIds};
    if (!next.remove(trackId)) next.add(trackId);
    state = state.copyWith(uncheckedIds: next);
  }

  void setAllChecked(bool checked) {
    state = state.copyWith(
      uncheckedIds: checked ? <int>{} : state.derived.candidates.map((t) => t.id).toSet(),
    );
  }

  void toggleArtistExcluded(String artistId) {
    final next = {...state.excludedArtistIds};
    if (!next.remove(artistId)) next.add(artistId);
    state = state.copyWith(excludedArtistIds: next);
  }

  Future<List<PreviewArtist>> searchArtists(String query) async {
    if (query.trim().isEmpty) return const [];
    final raw = await apiService.searchLibraryArtists(query.trim());
    return raw.map((a) => PreviewArtist.fromJson(a as Map<String, dynamic>)).toList();
  }

  Future<void> forceArtist(PreviewArtist artist) async {
    try {
      final raw = await apiService.getArtistLikedTracks(artist.artistId);
      final tracks = raw.map((t) => PreviewTrack.fromJson(t as Map<String, dynamic>)).toList();
      state = state.copyWith(
        forcedArtistTracks: {...state.forcedArtistTracks, artist.artistId: tracks},
        forcedArtistNames: {...state.forcedArtistNames, artist.artistId: artist.name},
        excludedArtistIds: {...state.excludedArtistIds}..remove(artist.artistId),
      );
    } catch (e) {
      state = state.copyWith(previewError: _errorText(e));
    }
  }

  void removeForcedArtist(String artistId) {
    state = state.copyWith(
      forcedArtistTracks: {...state.forcedArtistTracks}..remove(artistId),
      forcedArtistNames: {...state.forcedArtistNames}..remove(artistId),
    );
  }

  Future<void> setSort(TrackSort sort) async {
    if (sort == TrackSort.shuffle) {
      state = state.copyWith(sort: sort, shuffleSeed: DateTime.now().millisecondsSinceEpoch);
      return;
    }
    if (sort != TrackSort.smooth) {
      state = state.copyWith(sort: sort);
      return;
    }
    final ids = state.derived.candidates.map((t) => t.id).toList();
    if (ids.isEmpty) return;
    try {
      final ordered = await apiService.orderTracksSmooth(ids);
      state = state.copyWith(sort: TrackSort.smooth, smoothOrder: ordered);
    } catch (e) {
      state = state.copyWith(previewError: _errorText(e));
    }
  }

  void setLimit(int? limit) => state = state.copyWith(limit: limit);

  // ── Export ────────────────────────────────────────────────

  Future<void> exportPlaylist({required String name, required String description, required bool isPublic}) async {
    final ids = state.derived.selected.map((t) => t.id).toList();
    if (ids.isEmpty) return;
    state = state.copyWith(
      exportStatus: ExportStatus.exporting,
      exportAdded: 0,
      exportTotal: ids.length,
      exportResult: null,
      exportError: null,
    );
    try {
      final result = await apiService.exportGenrePlaylist({
        'trackIds': ids,
        'name': name,
        'description': description,
        'isPublic': isPublic,
        'families': state.families.toList(),
      });
      state = state.copyWith(exportStatus: ExportStatus.done, exportResult: result);
    } catch (e) {
      state = state.copyWith(exportStatus: ExportStatus.error, exportError: _errorText(e));
    }
  }

  /// Back to an empty builder (keeps the loaded library).
  void startOver() {
    _debounce?.cancel();
    _previewRequest++;
    state = GenreBuilderState(library: state.library);
  }
}

final genreBuilderProvider = NotifierProvider<GenreBuilderNotifier, GenreBuilderState>(
  GenreBuilderNotifier.new,
);
