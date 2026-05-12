import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:just_audio/just_audio.dart';
import '../config/theme.dart';
import '../config/constants.dart';
import '../providers/dj_provider.dart';
import '../services/api_service.dart';

class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  final _serverUrlController = TextEditingController(text: apiBaseUrl);
  final _customPersonaController = TextEditingController();
  bool _customPersonaInitialized = false;
  bool _isConnected = false;
  bool _isChecking = false;

  // Automation settings
  bool _autoStartEnabled = true;
  double _autoStartDelay = 5;
  int _quietHoursStart = 23;
  int _quietHoursEnd = 7;
  bool _isLoadingSettings = true;

  // AI settings
  bool _aiEnabled = true;
  double _aiAnalysisInterval = 5;

  // TTS / DJ Voice settings
  bool _ttsEnabled = false;
  String? _ttsVoice;
  double _ttsDuckVolume = 0.3;
  List<Map<String, dynamic>> _ttsVoices = [];
  bool _ttsAvailable = true;
  bool _ttsPreviewLoading = false;

  Future<void> _checkConnection() async {
    setState(() => _isChecking = true);
    // Apply the current URL before testing
    final url = _serverUrlController.text.trim();
    if (url.isNotEmpty && url != apiService.baseUrl) {
      apiService.updateBaseUrl(url);
    }
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
        _aiEnabled = data['aiEnabled'] ?? true;
        _aiAnalysisInterval = (data['aiAnalysisInterval'] ?? 5).toDouble();
        _isLoadingSettings = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _isLoadingSettings = false);
    }

    try {
      final djPrefs = ref.read(djProvider).preferences;
      setState(() {
        _ttsEnabled = djPrefs.ttsEnabled;
        _ttsVoice = djPrefs.ttsVoice;
        _ttsDuckVolume = djPrefs.ttsDuckVolume;
      });
      final voices = await apiService.getTtsVoices();
      setState(() {
        _ttsVoices = voices;
        _ttsAvailable = true;
      });
    } catch (_) {
      setState(() => _ttsAvailable = false);
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
    _customPersonaController.dispose();
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
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
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
              activeThumbColor: OrpheusColors.lyreGold,
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
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
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
              semanticFormatterCallback: (v) => '${v.round()} seconds delay',
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
                const Padding(
                  padding: EdgeInsets.symmetric(horizontal: 12),
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

          // AI Intelligence
          Text(
            'AI Intelligence',
            style: Theme.of(context).textTheme.headlineSmall,
          ),
          const SizedBox(height: 12),

          if (!_isLoadingSettings) ...[
            // AI toggle
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(
                'AI Advisor',
                style: Theme.of(context).textTheme.titleMedium,
              ),
              subtitle: Text(
                'Let Ollama analyze sessions and suggest scoring adjustments',
                style: Theme.of(context).textTheme.bodySmall,
              ),
              value: _aiEnabled,
              activeThumbColor: OrpheusColors.lyreGold,
              onChanged: (value) {
                setState(() => _aiEnabled = value);
                _saveSettings({'aiEnabled': value});
              },
            ),

            const SizedBox(height: 20),

            // Analysis frequency
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  'Analysis Frequency',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: OrpheusColors.onyx,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    'Every ${_aiAnalysisInterval.round()} tracks',
                    style: Theme.of(context).textTheme.labelLarge?.copyWith(
                          color: OrpheusColors.lyreGold,
                        ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              'How often the AI re-evaluates scoring weights',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            Slider(
              value: _aiAnalysisInterval,
              min: 2,
              max: 20,
              divisions: 18,
              label: '${_aiAnalysisInterval.round()} tracks',
              semanticFormatterCallback: (v) => 'Every ${v.round()} tracks',
              onChanged: _aiEnabled
                  ? (value) {
                      setState(() => _aiAnalysisInterval = value);
                    }
                  : null,
              onChangeEnd: (value) {
                _saveSettings({'aiAnalysisInterval': value.round()});
              },
            ),
          ],

          const SizedBox(height: 32),
          const Divider(),
          const SizedBox(height: 32),

          // DJ Personality
          Text(
            'DJ Personality',
            style: Theme.of(context).textTheme.headlineSmall,
          ),
          const SizedBox(height: 4),
          Text(
            'Shape how your AI DJ picks and introduces tracks.',
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: 16),
          _buildDjPersonalitySection(),

          const SizedBox(height: 32),
          const Divider(),
          const SizedBox(height: 32),

          _buildDjVoiceSection(),

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

  Widget _buildDjPersonalitySection() {
    final djState = ref.watch(djProvider);
    final prefs = djState.preferences;

    // Seed controller once when the provider has loaded a saved custom persona
    if (!_customPersonaInitialized && prefs.customPersona != null) {
      _customPersonaController.text = prefs.customPersona!;
      _customPersonaInitialized = true;
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Persona
        Text('Persona', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            _buildPersonaChip('curator', 'The Curator', '🎵', prefs.persona),
            _buildPersonaChip('late_night', 'Late Night', '🌙', prefs.persona),
            _buildPersonaChip('hype', 'Hype DJ', '🔥', prefs.persona),
            _buildPersonaChip('chill', 'Chill Host', '☁️', prefs.persona),
            _buildPersonaChip('custom', 'Custom', '✨', prefs.persona),
          ],
        ),

        // Custom persona textarea — shown only when Custom is selected
        if (prefs.persona == 'custom') ...[
          const SizedBox(height: 12),
          TextField(
            controller: _customPersonaController,
            maxLength: 500,
            maxLines: 4,
            style: Theme.of(context).textTheme.bodyMedium,
            decoration: InputDecoration(
              hintText: 'Describe your DJ\'s personality, style, and curation taste…',
              hintStyle: Theme.of(context).textTheme.bodySmall,
              counterStyle: Theme.of(context).textTheme.labelSmall,
            ),
            onChanged: (_) {}, // live edits are held in controller
            onEditingComplete: () => _saveCustomPersona(),
            onTapOutside: (_) => _saveCustomPersona(),
          ),
        ],

        const SizedBox(height: 20),

        // Chattiness
        Text('DJ Chattiness', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 4),
        Text(
          'How often the DJ adds commentary between tracks.',
          style: Theme.of(context).textTheme.bodySmall,
        ),
        const SizedBox(height: 10),
        _buildSegmentedToggle(
          options: const ['silent', 'minimal', 'balanced', 'chatty'],
          labels: const ['Silent', 'Minimal', 'Balanced', 'Chatty'],
          selected: prefs.chattiness,
          onSelect: (v) => ref.read(djProvider.notifier).updatePreferences({'chattiness': v}),
        ),

        const SizedBox(height: 20),

        // Discovery Appetite
        Text('Discovery Appetite', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 4),
        Text(
          'Balance between familiar favourites and new discoveries.',
          style: Theme.of(context).textTheme.bodySmall,
        ),
        const SizedBox(height: 10),
        _buildAppetiteToggle(prefs.discoveryAppetite),
      ],
    );
  }

  Widget _buildDjVoiceSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Text('DJ Voice', style: Theme.of(context).textTheme.headlineSmall),
            const Spacer(),
            Switch(
              value: _ttsEnabled,
              activeColor: OrpheusColors.lyreGold,
              onChanged: _ttsAvailable
                  ? (v) {
                      setState(() => _ttsEnabled = v);
                      ref.read(djProvider.notifier).updatePreferences({'ttsEnabled': v});
                      apiService.updateTtsSettings(ttsEnabled: v).catchError((_) {});
                    }
                  : null,
            ),
          ],
        ),
        const SizedBox(height: 4),
        Text(
          _ttsAvailable
              ? 'Spoken DJ commentary between tracks using Piper TTS.'
              : 'Piper TTS is not installed. Set PIPER_BINARY_PATH and PIPER_VOICES_DIR in your .env to enable.',
          style: Theme.of(context).textTheme.bodySmall,
        ),
        if (_ttsAvailable && _ttsEnabled) ...[
          const SizedBox(height: 16),
          DropdownButtonFormField<String>(
            value: _ttsVoices.any((v) => v['id'] == _ttsVoice) ? _ttsVoice : null,
            decoration: InputDecoration(
              labelText: 'Voice',
              labelStyle: OrpheusTypography.bodySmall.copyWith(color: OrpheusColors.mist),
              filled: true,
              fillColor: OrpheusColors.onyx,
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
            ),
            dropdownColor: OrpheusColors.onyx,
            style: OrpheusTypography.bodySmall.copyWith(color: OrpheusColors.ivory),
            items: _ttsVoices
                .map((v) => DropdownMenuItem<String>(
                      value: v['id'] as String,
                      child: Text(v['name'] as String? ?? v['id'] as String),
                    ))
                .toList(),
            onChanged: (v) {
              setState(() => _ttsVoice = v);
              apiService.updateTtsSettings(ttsVoice: v).catchError((_) {});
            },
          ),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: _ttsPreviewLoading || _ttsVoice == null
                ? null
                : () async {
                    setState(() => _ttsPreviewLoading = true);
                    try {
                      final bytes = await apiService.previewTtsVoice(_ttsVoice!);
                      if (bytes.isNotEmpty && mounted) {
                        final player = AudioPlayer();
                        try {
                          await player.setAudioSource(
                            AudioSource.uri(
                              Uri.dataFromBytes(bytes, mimeType: 'audio/wav'),
                            ),
                          );
                          await player.play();
                          await player.processingStateStream
                              .firstWhere((s) => s == ProcessingState.completed);
                        } finally {
                          await player.dispose();
                        }
                      }
                    } catch (_) {
                    } finally {
                      if (mounted) setState(() => _ttsPreviewLoading = false);
                    }
                  },
            icon: _ttsPreviewLoading
                ? const SizedBox(
                    width: 14,
                    height: 14,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.play_arrow, size: 18),
            label: Text('Preview voice', style: OrpheusTypography.bodySmall),
            style: OutlinedButton.styleFrom(foregroundColor: OrpheusColors.lyreGold),
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: Text(
                  'Music volume during speech',
                  style: OrpheusTypography.bodySmall.copyWith(color: OrpheusColors.mist),
                ),
              ),
              Text(
                '${(_ttsDuckVolume * 100).round()}%',
                style: OrpheusTypography.labelSmall.copyWith(color: OrpheusColors.lyreGold),
              ),
            ],
          ),
          Slider(
            value: _ttsDuckVolume,
            min: 0.0,
            max: 1.0,
            divisions: 20,
            activeColor: OrpheusColors.lyreGold,
            inactiveColor: OrpheusColors.slate,
            semanticFormatterCallback: (v) => '${(v * 100).round()}% music volume during speech',
            onChanged: (v) => setState(() => _ttsDuckVolume = v),
            onChangeEnd: (v) {
              apiService.updateTtsSettings(ttsDuckVolume: v).catchError((_) {});
            },
          ),
        ],
      ],
    );
  }

  void _saveCustomPersona() {
    final text = _customPersonaController.text.trim();
    ref.read(djProvider.notifier).updatePreferences({'customPersona': text.isEmpty ? null : text});
  }

  Widget _buildPersonaChip(String value, String label, String icon, String selected) {
    final isSelected = selected == value;
    return GestureDetector(
      onTap: () {
        if (value != 'custom') _saveCustomPersona(); // persist before switching away
        ref.read(djProvider.notifier).updatePreferences({'persona': value});
      },
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: isSelected
              ? OrpheusColors.lyreGold.withValues(alpha: 0.15)
              : OrpheusColors.onyx,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: isSelected ? OrpheusColors.lyreGold : OrpheusColors.slate,
            width: isSelected ? 1.5 : 1,
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(icon, style: const TextStyle(fontSize: 14)),
            const SizedBox(width: 6),
            Text(
              label,
              style: GoogleFonts.inter(
                fontSize: 12,
                fontWeight: FontWeight.w500,
                color: isSelected ? OrpheusColors.lyreGold : OrpheusColors.ivory,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSegmentedToggle({
    required List<String> options,
    required List<String> labels,
    required String selected,
    required ValueChanged<String> onSelect,
  }) {
    return Container(
      decoration: BoxDecoration(
        color: OrpheusColors.onyx,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: OrpheusColors.slate),
      ),
      child: Row(
        children: [
          for (int i = 0; i < options.length; i++)
            Expanded(
              child: GestureDetector(
                onTap: () => onSelect(options[i]),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 150),
                  padding: const EdgeInsets.symmetric(vertical: 10),
                  decoration: BoxDecoration(
                    color: selected == options[i]
                        ? OrpheusColors.lyreGold.withValues(alpha: 0.18)
                        : Colors.transparent,
                    borderRadius: BorderRadius.circular(9),
                  ),
                  child: Text(
                    labels[i],
                    textAlign: TextAlign.center,
                    style: GoogleFonts.inter(
                      fontSize: 11,
                      fontWeight: FontWeight.w500,
                      color: selected == options[i]
                          ? OrpheusColors.lyreGold
                          : OrpheusColors.mist,
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildAppetiteToggle(String selected) {
    final options = [
      ('comfort', 'Comfort'),
      ('balanced', 'Balanced'),
      ('adventurous', 'Explore'),
    ];

    return Column(
      children: [
        Container(
          decoration: BoxDecoration(
            color: OrpheusColors.onyx,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: OrpheusColors.slate),
          ),
          child: Row(
            children: [
              for (final (value, label) in options)
                Expanded(
                  child: GestureDetector(
                    onTap: () => ref.read(djProvider.notifier).updatePreferences({'discoveryAppetite': value}),
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 150),
                      padding: const EdgeInsets.symmetric(vertical: 10),
                      decoration: BoxDecoration(
                        color: selected == value
                            ? OrpheusColors.lyreGold.withValues(alpha: 0.18)
                            : Colors.transparent,
                        borderRadius: BorderRadius.circular(9),
                      ),
                      child: Text(
                        label,
                        textAlign: TextAlign.center,
                        style: GoogleFonts.inter(
                          fontSize: 11,
                          fontWeight: FontWeight.w500,
                          color: selected == value
                              ? OrpheusColors.lyreGold
                              : OrpheusColors.mist,
                        ),
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(height: 8),
        // Mini ratio bar for currently selected appetite
        () {
          final ratios = switch (selected) {
            'balanced' => [0.50, 0.35, 0.15],
            'adventurous' => [0.40, 0.30, 0.30],
            _ => [0.65, 0.25, 0.10],
          };
          return Row(
            children: [
              Expanded(
                flex: (ratios[0] * 100).round(),
                child: Container(height: 4, decoration: BoxDecoration(color: const Color(0xFF4A7C59), borderRadius: BorderRadius.circular(2))),
              ),
              const SizedBox(width: 2),
              Expanded(
                flex: (ratios[1] * 100).round(),
                child: Container(height: 4, decoration: BoxDecoration(color: const Color(0xFF4A6C9C), borderRadius: BorderRadius.circular(2))),
              ),
              const SizedBox(width: 2),
              Expanded(
                flex: (ratios[2] * 100).round(),
                child: Container(height: 4, decoration: BoxDecoration(color: const Color(0xFF8B4A9C), borderRadius: BorderRadius.circular(2))),
              ),
            ],
          );
        }(),
        const SizedBox(height: 4),
        Text(
          switch (selected) {
            'balanced' => '50% familiar  ·  35% similar  ·  15% new',
            'adventurous' => '40% familiar  ·  30% similar  ·  30% new',
            _ => '65% familiar  ·  25% similar  ·  10% new',
          },
          style: GoogleFonts.inter(fontSize: 11, color: OrpheusColors.mist),
        ),
      ],
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
