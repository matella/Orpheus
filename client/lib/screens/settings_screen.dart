import 'package:flutter/material.dart';
import '../config/theme.dart';
import '../config/constants.dart';
import '../services/api_service.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  final _serverUrlController = TextEditingController(text: apiBaseUrl);
  bool _isConnected = false;
  bool _isChecking = false;

  // Automation settings
  bool _autoStartEnabled = true;
  double _autoStartDelay = 5;
  int _quietHoursStart = 23;
  int _quietHoursEnd = 7;
  bool _isLoadingSettings = true;

  Future<void> _checkConnection() async {
    setState(() => _isChecking = true);
    try {
      final healthy = await apiService.checkHealth();
      setState(() => _isConnected = healthy);
    } catch (_) {
      setState(() => _isConnected = false);
    } finally {
      setState(() => _isChecking = false);
    }
  }

  Future<void> _loadSettings() async {
    try {
      final data = await apiService.getSettings();
      if (!mounted) return;
      setState(() {
        _autoStartEnabled = data['autoStartEnabled'] ?? true;
        _autoStartDelay = (data['autoStartDelay'] ?? 5).toDouble();
        _quietHoursStart = data['quietHoursStart'] ?? 23;
        _quietHoursEnd = data['quietHoursEnd'] ?? 7;
        _isLoadingSettings = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _isLoadingSettings = false);
    }
  }

  Future<void> _saveSettings(Map<String, dynamic> update) async {
    try {
      await apiService.updateSettings(update);
    } catch (_) {
      // Optimistic UI — local state already updated
    }
  }

  @override
  void initState() {
    super.initState();
    _checkConnection();
    _loadSettings();
  }

  @override
  void dispose() {
    _serverUrlController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('SETTINGS'),
      ),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          // Server Connection
          Text(
            'Server Connection',
            style: Theme.of(context).textTheme.headlineSmall,
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _serverUrlController,
            decoration: const InputDecoration(
              labelText: 'Server URL',
              hintText: 'http://localhost:3000/api',
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              ElevatedButton(
                onPressed: _isChecking ? null : _checkConnection,
                child: _isChecking
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: OrpheusColors.obsidian,
                        ),
                      )
                    : const Text('Test Connection'),
              ),
              const SizedBox(width: 16),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                decoration: BoxDecoration(
                  color: _isConnected
                      ? OrpheusColors.laurelGreen.withValues(alpha: 0.2)
                      : OrpheusColors.wineRed.withValues(alpha: 0.2),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 8,
                      height: 8,
                      decoration: BoxDecoration(
                        color: _isConnected
                            ? OrpheusColors.laurelGreen
                            : OrpheusColors.wineRed,
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      _isConnected ? 'Connected' : 'Disconnected',
                      style: Theme.of(context).textTheme.labelMedium?.copyWith(
                            color: _isConnected
                                ? OrpheusColors.laurelGreen
                                : OrpheusColors.wineRed,
                          ),
                    ),
                  ],
                ),
              ),
            ],
          ),

          const SizedBox(height: 32),
          const Divider(),
          const SizedBox(height: 32),

          // Automation
          Text(
            'Automation',
            style: Theme.of(context).textTheme.headlineSmall,
          ),
          const SizedBox(height: 12),

          if (_isLoadingSettings)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 24),
              child: Center(
                child: SizedBox(
                  width: 24,
                  height: 24,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: OrpheusColors.lyreGold,
                  ),
                ),
              ),
            )
          else ...[
            // Auto-start toggle
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(
                'Auto-Start Engine',
                style: Theme.of(context).textTheme.titleMedium,
              ),
              subtitle: Text(
                'Start playback when a Spotify device is detected',
                style: Theme.of(context).textTheme.bodySmall,
              ),
              value: _autoStartEnabled,
              activeColor: OrpheusColors.lyreGold,
              onChanged: (value) {
                setState(() => _autoStartEnabled = value);
                _saveSettings({'autoStartEnabled': value});
              },
            ),

            const SizedBox(height: 20),

            // Auto-start delay
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  'Start Delay',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: OrpheusColors.onyx,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    '${_autoStartDelay.round()}s',
                    style: Theme.of(context).textTheme.labelLarge?.copyWith(
                          color: OrpheusColors.lyreGold,
                        ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              'Wait before starting after device detection',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            Slider(
              value: _autoStartDelay,
              min: 0,
              max: 60,
              divisions: 12,
              label: '${_autoStartDelay.round()}s',
              onChanged: _autoStartEnabled
                  ? (value) {
                      setState(() => _autoStartDelay = value);
                    }
                  : null,
              onChangeEnd: (value) {
                _saveSettings({'autoStartDelay': value.round()});
              },
            ),

            const SizedBox(height: 20),

            // Quiet hours
            Text(
              'Quiet Hours',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 4),
            Text(
              'Disable auto-start during these hours',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: _buildHourDropdown(
                    label: 'From',
                    value: _quietHoursStart,
                    onChanged: (hour) {
                      if (hour == null) return;
                      setState(() => _quietHoursStart = hour);
                      _saveSettings({'quietHoursStart': hour});
                    },
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  child: Icon(
                    Icons.arrow_forward,
                    size: 16,
                    color: OrpheusColors.mist,
                  ),
                ),
                Expanded(
                  child: _buildHourDropdown(
                    label: 'Until',
                    value: _quietHoursEnd,
                    onChanged: (hour) {
                      if (hour == null) return;
                      setState(() => _quietHoursEnd = hour);
                      _saveSettings({'quietHoursEnd': hour});
                    },
                  ),
                ),
              ],
            ),
          ],

          const SizedBox(height: 32),
          const Divider(),
          const SizedBox(height: 32),

          // About
          Text(
            'About',
            style: Theme.of(context).textTheme.headlineSmall,
          ),
          const SizedBox(height: 12),
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(
              'Orpheus',
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    color: OrpheusColors.lyreGold,
                  ),
            ),
            subtitle: Text(
              'Autonomous Music Intelligence\nv0.1.0',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildHourDropdown({
    required String label,
    required int value,
    required ValueChanged<int?> onChanged,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: Theme.of(context).textTheme.labelMedium),
        const SizedBox(height: 4),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12),
          decoration: BoxDecoration(
            color: OrpheusColors.onyx,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: OrpheusColors.slate),
          ),
          child: DropdownButton<int>(
            value: value,
            isExpanded: true,
            dropdownColor: OrpheusColors.charcoal,
            underline: const SizedBox.shrink(),
            items: List.generate(
              24,
              (i) => DropdownMenuItem(
                value: i,
                child: Text(
                  '${i.toString().padLeft(2, '0')}:00',
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
              ),
            ),
            onChanged: onChanged,
          ),
        ),
      ],
    );
  }
}
