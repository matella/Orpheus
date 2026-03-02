import 'dart:async';
import 'dart:convert';
import 'dart:developer' as developer;
import 'dart:math' as math;
import 'package:web_socket_channel/web_socket_channel.dart';
import '../config/constants.dart';

/// WebSocket client for real-time server events.
///
/// Connects to the Orpheus server's WebSocket endpoint and provides
/// a broadcast stream of decoded JSON messages. Auto-reconnects on
/// disconnect with exponential backoff (5s → 10s → 20s → ... capped at 60s).
class WebSocketService {
  WebSocketChannel? _channel;
  Timer? _reconnectTimer;
  bool _intentionalClose = false;
  int _reconnectAttempts = 0;

  final _controller = StreamController<Map<String, dynamic>>.broadcast();

  /// Stream of all WebSocket messages from the server.
  Stream<Map<String, dynamic>> get messages => _controller.stream;

  bool _isConnected = false;

  /// Whether the WebSocket is currently connected and receiving messages.
  bool get isConnected => _isConnected && _channel != null;

  /// Connect to the WebSocket server.
  /// Safe to call multiple times — ignores if already connected or connecting.
  void connect() {
    if (_channel != null) return; // Already connected or connecting
    _intentionalClose = false;
    _reconnectAttempts = 0;
    _doConnect();
  }

  /// Disconnect from the WebSocket server.
  void disconnect() {
    _intentionalClose = true;
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    _channel?.sink.close();
    _channel = null;
    _isConnected = false;
    _reconnectAttempts = 0;
  }

  void _doConnect() {
    try {
      _channel = WebSocketChannel.connect(Uri.parse(wsBaseUrl));

      _channel!.stream.listen(
        (data) {
          // Mark as connected on first successful message and reset backoff
          if (!_isConnected) {
            _isConnected = true;
            _reconnectAttempts = 0;
          }
          try {
            final decoded = jsonDecode(data as String) as Map<String, dynamic>;
            _controller.add(decoded);
          } catch (_) {
            // Ignore malformed messages
          }
        },
        onError: (error) {
          developer.log('WebSocket error: $error', name: 'WebSocketService');
          _scheduleReconnect();
        },
        onDone: () => _scheduleReconnect(),
      );
    } catch (e) {
      developer.log('WebSocket connect failed: $e', name: 'WebSocketService');
      _scheduleReconnect();
    }
  }

  void _scheduleReconnect() {
    _channel = null;
    _isConnected = false;
    if (_intentionalClose) return;

    _reconnectAttempts++;
    // Exponential backoff: 5s, 10s, 20s, 40s, capped at 60s
    final delaySec = math.min(60, 5 * math.pow(2, _reconnectAttempts - 1)).toInt();
    developer.log(
      'WebSocket reconnecting in ${delaySec}s (attempt $_reconnectAttempts)',
      name: 'WebSocketService',
    );

    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(Duration(seconds: delaySec), _doConnect);
  }

  /// Clean up resources.
  void dispose() {
    disconnect();
    _controller.close();
  }
}

/// Global WebSocket service singleton.
final wsService = WebSocketService();
