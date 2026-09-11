import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orpheus/models/genre_builder_models.dart';
import 'package:orpheus/widgets/genre_builder/export_bar.dart';

void main() {
  testWidgets('disables the button and shows the limit text above 10000 tracks', (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(body: ExportBar(selectedCount: 10001, selectedDurationMs: 0, onCreate: () {})),
    ));

    final button = tester.widget<ElevatedButton>(find.byType(ElevatedButton));
    expect(button.onPressed, isNull);
    expect(find.text('Max $kMaxPlaylistTracks tracks (Spotify limit) · 10001 selected'), findsOneWidget);
  });

  testWidgets('enables the button under the limit', (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(body: ExportBar(selectedCount: 5, selectedDurationMs: 0, onCreate: () {})),
    ));

    final button = tester.widget<ElevatedButton>(find.byType(ElevatedButton));
    expect(button.onPressed, isNotNull);
  });
}
