import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'config/theme.dart';
import 'config/routes.dart';

void main() {
  runApp(
    const ProviderScope(
      child: OrpheusApp(),
    ),
  );
}

class OrpheusApp extends StatelessWidget {
  const OrpheusApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'Orpheus',
      theme: buildOrpheusTheme(),
      routerConfig: router,
      debugShowCheckedModeBanner: false,
    );
  }
}
