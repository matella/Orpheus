import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orpheus/models/genre_builder_models.dart';
import 'package:orpheus/widgets/genre_builder/genre_family_picker.dart';

void main() {
  const families = [
    GenreFamily(id: 'k-pop', label: 'K-pop', trackCount: 842, genres: [
      GenreCount(name: 'k-pop girl group', trackCount: 410),
      GenreCount(name: 'k-rap', trackCount: 30),
    ]),
    GenreFamily(id: 'rock', label: 'Rock', trackCount: 610, genres: []),
  ];

  Widget host({
    Set<String> selected = const {},
    Set<String> excluded = const {},
    GenreSyncProgress progress = const GenreSyncProgress(done: 10, total: 10),
    ValueChanged<String>? onFamily,
    ValueChanged<String>? onSub,
    VoidCallback? onSync,
  }) =>
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: GenreFamilyPicker(
              families: families,
              selected: selected,
              excludedGenres: excluded,
              untaggedCount: 312,
              syncProgress: progress,
              onToggleFamily: onFamily ?? (_) {},
              onToggleSubGenre: onSub ?? (_) {},
              onContinueSync: onSync ?? () {},
            ),
          ),
        ),
      );

  testWidgets('shows families with counts and toggles on tap', (tester) async {
    String? tapped;
    await tester.pumpWidget(host(onFamily: (id) => tapped = id));

    expect(find.text('K-pop · 842'), findsOneWidget);
    expect(find.text('312 untagged tracks'), findsOneWidget);
    await tester.tap(find.text('Rock · 610'));
    expect(tapped, 'rock');
  });

  testWidgets('selected family lists sub-genres; unchecking excludes', (tester) async {
    String? sub;
    await tester.pumpWidget(host(selected: {'k-pop'}, excluded: {'k-rap'}, onSub: (g) => sub = g));

    expect(find.text('k-pop girl group · 410'), findsOneWidget);
    final kRap = tester.widget<FilterChip>(find.widgetWithText(FilterChip, 'k-rap · 30'));
    expect(kRap.selected, isFalse);
    await tester.tap(find.text('k-pop girl group · 410'));
    expect(sub, 'k-pop girl group');
  });

  testWidgets('shows sync progress and continue button while incomplete', (tester) async {
    var synced = false;
    await tester.pumpWidget(host(
      progress: const GenreSyncProgress(done: 1830, total: 2140, running: false),
      onSync: () => synced = true,
    ));

    expect(find.text('Genre sync 1830 / 2140'), findsOneWidget);
    await tester.tap(find.text('Continue sync'));
    expect(synced, isTrue);
  });
}
