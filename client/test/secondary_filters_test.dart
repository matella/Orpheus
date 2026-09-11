import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orpheus/widgets/genre_builder/secondary_filters.dart';

Widget host({int? limit, ValueChanged<int?>? onLimit}) => MaterialApp(
      home: Scaffold(
        body: SecondaryFilters(
          limit: limit,
          featuresAvailable: false,
          onLikedRange: (_, __) {},
          onLimit: onLimit ?? (_) {},
          onEnergy: (_, __) {},
        ),
      ),
    );

String limitText(WidgetTester tester) =>
    tester.widget<TextField>(find.byType(TextField)).controller!.text;

void main() {
  testWidgets('typing a limit reports it', (tester) async {
    int? reported;
    await tester.pumpWidget(host(onLimit: (v) => reported = v));
    await tester.enterText(find.byType(TextField), '12');
    expect(reported, 12);
  });

  testWidgets('limit field re-syncs when the limit is reset from outside', (tester) async {
    await tester.pumpWidget(host(limit: 5));
    expect(limitText(tester), '5');

    await tester.pumpWidget(host(limit: null));
    expect(limitText(tester), '');
  });
}
