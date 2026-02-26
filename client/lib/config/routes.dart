import 'package:go_router/go_router.dart';
import '../screens/home_screen.dart';
import '../screens/session_screen.dart';
import '../screens/analytics_screen.dart';
import '../screens/intelligence_screen.dart';
import '../screens/settings_screen.dart';
import '../screens/auth_screen.dart';
import '../screens/shell_screen.dart';

final router = GoRouter(
  initialLocation: '/',
  routes: [
    ShellRoute(
      builder: (context, state, child) => ShellScreen(child: child),
      routes: [
        GoRoute(
          path: '/',
          builder: (context, state) => const HomeScreen(),
        ),
        GoRoute(
          path: '/session',
          builder: (context, state) => const SessionScreen(),
        ),
        GoRoute(
          path: '/analytics',
          builder: (context, state) => const AnalyticsScreen(),
        ),
        GoRoute(
          path: '/intelligence',
          builder: (context, state) => const IntelligenceScreen(),
        ),
        GoRoute(
          path: '/settings',
          builder: (context, state) => const SettingsScreen(),
        ),
      ],
    ),
    GoRoute(
      path: '/auth',
      builder: (context, state) => const AuthScreen(),
    ),
  ],
);
