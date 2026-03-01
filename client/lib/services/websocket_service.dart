import 'dart:async';
import 'dart:convert';
import 'package:web_socket_channel/web_socket_channel.dart';
import '../config/constants.dart';

/// WebSocket client for real-time server events.
///
/// Connects to the Orpheus server's WebSocket endpoint and provides
/// a broadcast stream of decoded JSON messages. Auto-reconnects on
/// disconnect with a 5-second delay.
class WebSocketService {
  WebSocketChannel? _channel;
  Timer? _reconnectTimer;
  bool _intentionalClose = false;

  final _controller = StreamController<Map<String, dynamic>>.broadcast();

  /// Stream of all WebSocket messages from the server.
  Stream<Map<String, dynamic>> get messages => _controller.stream;

  bool _isConnected = false;

  /// Whether the WebSocket is currently connected and receiving messages.
  bool get isConnected => _isConnected && _channel != null;

  /// Connect to the WebSocket server.
  void connect() {
    _intentionalClose = false;
    _doConnect();
  }

  /// Disconnect from the WebSocket server.
  void disconnect() {
    _intentionalClose = true;
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    _channel?.sink.close();
    _channel = null;
  }

  void _doConnect() {
    try {
      _channel = WebSocketChannel.connect(Uri.parse(wsBaseUrl));

      _channel!.stream.listen(
        (data) {
          // Mark as connected on first successful message
          if (!_isConnected) _isConnected = true;
          try {
            final decoded = jsonDecode(data as String) as Map<String, dynamic>;
            _controller.add(decoded);
          } catch (_) {
            // Ignore malformed messages
          }
        },
        onError: (_) => _scheduleReconnect(),
        onDone: () => _scheduleReconnect(),
      );
    } catch (_) {
      _scheduleReconnect();
    }
  }

  void _scheduleReconnect() {
    _channel = null;
    _isConnected = false;
    if (_intentionalClose) return;

    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(const Duration(seconds: 5), _doConnect);
  }

  /// Clean up resources.
  void dispose() {
    disconnect();
    _controller.close();
  }
}

/// Global WebSocket service singleton.
final wsService = WebSocketService();
