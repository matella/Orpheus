import 'dart:developer' as developer;
import 'package:go_router/go_router.dart';
import '../screens/home_screen.dart';
import '../screens/session_screen.dart';
import '../screens/analytics_screen.dart';
import '../screens/intelligence_screen.dart';
import '../screens/settings_screen.dart';
import '../screens/auth_screen.dart';
import '../screens/shell_screen.dart';
import '../services/api_service.dart';

/// Cached auth state to avoid hitting the server on every navigation.
/// Refreshed on each redirect check, but short-circuits after first success.
bool _lastKnownAuth = false;

Future<bool> _checkAuth() async {
  try {
    final status = await apiService.getAuthStatus();
    _lastKnownAuth = status['authenticated'] == true;
  } catch (e) {
    developer.log('Auth check failed: $e', name: 'Router');
    // If server is unreachable, allow navigation to proceed —
    // individual screens handle API errors gracefully.
    _lastKnownAuth = false;
  }
  return _lastKnownAuth;
}

final router = GoRouter(
  initialLocation: '/',
  redirect: (context, state) async {
    final isAuthRoute = state.matchedLocation == '/auth';

    // Fast path: once authenticated, skip the HTTP check on every navigation.
    // Only re-verify when navigating to /auth or when never authenticated.
    if (_lastKnownAuth && !isAuthRoute) return null;

    final isAuthed = await _checkAuth();
    if (!isAuthed && !isAuthRoute) return '/auth';
    if (isAuthed && isAuthRoute) return '/';
    return null;
  },
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
