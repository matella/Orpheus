import 'dart:developer' as developer;
import 'package:go_router/go_router.dart';
import '../screens/home_screen.dart';
import '../screens/session_screen.dart';
import '../screens/analytics_screen.dart';
import '../screens/intelligence_screen.dart';
import '../screens/settings_screen.dart';
import '../screens/playlist_screen.dart';
import '../screens/auth_screen.dart';
import '../screens/onboarding_screen.dart';
import '../screens/shell_screen.dart';
import '../services/api_service.dart';

/// Cached auth state to avoid hitting the server on every navigation.
/// Refreshed on each redirect check, but short-circuits after first success.
bool _lastKnownAuth = false;
bool _onboardingChecked = false;
bool _onboardingCompleted = false;

/// Call after completing onboarding so the redirect guard doesn't loop back.
void markOnboardingDone() {
  _onboardingChecked = true;
  _onboardingCompleted = true;
}

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

Future<bool> _checkOnboarding() async {
  if (_onboardingChecked) return _onboardingCompleted;
  try {
    final prefs = await apiService.getDjPreferences();
    _onboardingCompleted = prefs['onboardingCompleted'] == true;
    _onboardingChecked = true;
  } catch (e) {
    developer.log('Onboarding check failed: $e', name: 'Router');
    _onboardingCompleted = true; // Assume done on error — don't block startup
    _onboardingChecked = true;
  }
  return _onboardingCompleted;
}

final router = GoRouter(
  initialLocation: '/',
  redirect: (context, state) async {
    final location = state.matchedLocation;
    final isAuthRoute = location == '/auth';
    final isOnboardingRoute = location == '/onboarding';

    // Determine auth state — use cached value after first success
    final isAuthed = _lastKnownAuth ? true : await _checkAuth();

    if (!isAuthed) return isAuthRoute ? null : '/auth';
    if (isAuthRoute) return (await _checkOnboarding()) ? '/' : '/onboarding';
    if (!isOnboardingRoute) {
      final done = await _checkOnboarding();
      if (!done) return '/onboarding';
    }
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
        GoRoute(
          path: '/playlist',
          builder: (context, state) => const PlaylistScreen(),
        ),
      ],
    ),
    GoRoute(
      path: '/auth',
      builder: (context, state) => const AuthScreen(),
    ),
    GoRoute(
      path: '/onboarding',
      builder: (context, state) => const OnboardingScreen(),
    ),
  ],
);
