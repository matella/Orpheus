/// API base URL — override at build time with --dart-define=API_BASE_URL=...
const String apiBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'http://127.0.0.1:3000/api',
);

/// WebSocket URL — override at build time with --dart-define=WS_BASE_URL=...
const String wsBaseUrl = String.fromEnvironment(
  'WS_BASE_URL',
  defaultValue: 'ws://127.0.0.1:3000/ws',
);

/// Steering slider debounce duration
const Duration steeringDebounce = Duration(milliseconds: 300);
