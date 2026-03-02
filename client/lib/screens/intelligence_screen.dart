import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../config/theme.dart';
import '../services/api_service.dart';

/// AI Intelligence screen — shows AI status, insights, recaps, and context inference.
class IntelligenceScreen extends StatefulWidget {
  const IntelligenceScreen({super.key});

  @override
  State<IntelligenceScreen> createState() => _IntelligenceScreenState();
}

class _IntelligenceScreenState extends State<IntelligenceScreen> {
  Map<String, dynamic>? _aiStatus;
  List<dynamic> _suggestions = [];
  List<dynamic> _recaps = [];
  bool _isLoading = true;
  bool _isAnalyzing = false;
  bool _isGeneratingRecap = false;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  /// Load each AI endpoint independently so a single failure
  /// doesn't blank the entire page.
  Future<void> _loadData() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    int failures = 0;

    _aiStatus = await _safeLoad(() => apiService.getAiStatus(), () => failures++);
    final suggestionsResult = await _safeLoad<List<dynamic>>(() => apiService.getAiSuggestions(), () => failures++);
    _suggestions = suggestionsResult ?? [];
    final recapsData = await _safeLoad(() => apiService.getAiRecaps(), () => failures++);
    _recaps = (recapsData?['recaps'] as List<dynamic>?) ?? [];

    if (!mounted) return;
    setState(() {
      _isLoading = false;
      if (failures == 3) {
        _errorMessage = 'Could not load AI data. Check server connection.';
      } else if (failures > 0) {
        _errorMessage = 'Some AI data could not be loaded.';
      }
    });
  }

  Future<T?> _safeLoad<T>(Future<T> Function() loader, [VoidCallback? onError]) async {
    try {
      return await loader();
    } catch (_) {
      onError?.call();
      return null;
    }
  }

  Future<void> _triggerAnalysis() async {
    setState(() => _isAnalyzing = true);
    try {
      await apiService.triggerAiAnalysis();
      await _loadData();
    } catch (_) {
      // Silently handle
    }
    if (mounted) setState(() => _isAnalyzing = false);
  }

  Future<void> _generateRecap() async {
    setState(() => _isGeneratingRecap = true);
    try {
      await apiService.generateAiRecap();
      await _loadData();
    } catch (_) {
      // Silently handle
    }
    if (mounted) setState(() => _isGeneratingRecap = false);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('INTELLIGENCE')),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _loadData,
              color: OrpheusColors.lyreGold,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  _buildStatusCard(),
                  const SizedBox(height: 16),
                  _buildActionsCard(),
                  const SizedBox(height: 16),
                  _buildInsightsSection(),
                  const SizedBox(height: 16),
                  _buildRecapsSection(),
                  const SizedBox(height: 16),
                  _buildSuggestionsSection(),
                  const SizedBox(height: 32),
                ],
              ),
            ),
    );
  }

  Widget _buildStatusCard() {
    final enabled = _aiStatus?['enabled'] ?? false;
    final ollama = _aiStatus?['ollama'] as Map<String, dynamic>?;
    final reachable = ollama?['reachable'] ?? false;
    final modelLoaded = ollama?['modelLoaded'] ?? false;
    final model = _aiStatus?['model'] ?? 'unknown';

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  enabled && reachable
                      ? Icons.auto_awesome
                      : Icons.auto_awesome_outlined,
                  color: enabled && reachable
                      ? OrpheusColors.lyreGold
                      : OrpheusColors.mist,
                ),
                const SizedBox(width: 12),
                Text('AI Status',
                    style: Theme.of(context).textTheme.titleLarge),
                const Spacer(),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: enabled && reachable
                        ? OrpheusColors.laurelGreen.withValues(alpha: 0.2)
                        : OrpheusColors.wineRed.withValues(alpha: 0.2),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(
                    enabled && reachable ? 'Online' : 'Offline',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: enabled && reachable
                          ? OrpheusColors.laurelGreen
                          : OrpheusColors.wineRed,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            _statusRow('Model', model.toString()),
            _statusRow('Ollama', reachable ? 'Connected' : 'Unreachable'),
            _statusRow('Model Loaded', modelLoaded ? 'Yes' : 'No'),
            _statusRow('Analysis Interval',
                'Every ${_aiStatus?['analysisInterval'] ?? 5} tracks'),
          ],
        ),
      ),
    );
  }

  Widget _statusRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: Theme.of(context).textTheme.bodySmall),
          Text(
            value,
            style: GoogleFonts.jetBrainsMono(
              fontSize: 12,
              color: OrpheusColors.ivory,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildActionsCard() {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Actions', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: ElevatedButton.icon(
                    onPressed: _isAnalyzing ? null : _triggerAnalysis,
                    icon: _isAnalyzing
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2))
                        : const Icon(Icons.psychology, size: 18),
                    label:
                        Text(_isAnalyzing ? 'Analyzing...' : 'Analyze Session'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: ElevatedButton.icon(
                    onPressed: _isGeneratingRecap ? null : _generateRecap,
                    icon: _isGeneratingRecap
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2))
                        : const Icon(Icons.auto_stories, size: 18),
                    label: Text(
                        _isGeneratingRecap ? 'Generating...' : 'Monthly Recap'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildInsightsSection() {
    final insights = _suggestions
        .where((s) => s['suggestion_type'] == 'insight')
        .take(5)
        .toList();

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.lightbulb_outline,
                    color: OrpheusColors.lyreGold, size: 20),
                const SizedBox(width: 8),
                Text('Recent Insights',
                    style: Theme.of(context).textTheme.titleLarge),
              ],
            ),
            const SizedBox(height: 12),
            if (insights.isEmpty)
              Text(
                'No insights yet. Start a listening session and the AI will observe your patterns.',
                style: Theme.of(context).textTheme.bodySmall,
              )
            else
              ...insights.map((s) {
                final response = _parseResponse(s['response']);
                final insight = response?['insight'] ?? 'Unknown insight';
                final category = response?['category'] ?? 'pattern';
                return Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _categoryIcon(category),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(insight,
                                style: Theme.of(context).textTheme.bodyMedium),
                            const SizedBox(height: 2),
                            Text(
                              category,
                              style: const TextStyle(
                                fontSize: 10,
                                color: OrpheusColors.lyreGold,
                                fontWeight: FontWeight.w600,
                                letterSpacing: 1,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                );
              }),
          ],
        ),
      ),
    );
  }

  Widget _buildRecapsSection() {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.auto_stories,
                    color: OrpheusColors.lyreGold, size: 20),
                const SizedBox(width: 8),
                Text('Monthly Recaps',
                    style: Theme.of(context).textTheme.titleLarge),
              ],
            ),
            const SizedBox(height: 12),
            if (_recaps.isEmpty)
              Text(
                'No recaps yet. Generate one to see a narrative summary of your listening month.',
                style: Theme.of(context).textTheme.bodySmall,
              )
            else
              ..._recaps.map((r) {
                final monthNames = [
                  '',
                  'January',
                  'February',
                  'March',
                  'April',
                  'May',
                  'June',
                  'July',
                  'August',
                  'September',
                  'October',
                  'November',
                  'December'
                ];
                final monthIdx = (r['month'] as int?) ?? 1;
                final monthName = (monthIdx >= 1 && monthIdx <= 12)
                    ? monthNames[monthIdx]
                    : 'Unknown';
                final year = r['year'] ?? 2026;
                final stats = r['stats'] as Map<String, dynamic>? ?? {};
                final personality = stats['personality'] ?? '';

                return Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: OrpheusColors.charcoal,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                        color: OrpheusColors.lyreGold.withValues(alpha: 0.1),
                      ),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text(
                              '$monthName $year',
                              style: GoogleFonts.cinzel(
                                fontSize: 14,
                                color: OrpheusColors.lyreGold,
                                letterSpacing: 1,
                              ),
                            ),
                            if (personality.isNotEmpty)
                              Container(
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 8, vertical: 2),
                                decoration: BoxDecoration(
                                  color: OrpheusColors.lyreGold
                                      .withValues(alpha: 0.15),
                                  borderRadius: BorderRadius.circular(8),
                                ),
                                child: Text(
                                  personality,
                                  style: const TextStyle(
                                    fontSize: 10,
                                    color: OrpheusColors.lyreGold,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ),
                          ],
                        ),
                        const SizedBox(height: 8),
                        Text(
                          r['recap'] ?? '',
                          style: Theme.of(context).textTheme.bodyMedium,
                        ),
                        if (stats['totalHours'] != null) ...[
                          const SizedBox(height: 8),
                          Row(
                            children: [
                              _miniStat(
                                  '${(stats['totalHours'] as num).toStringAsFixed(1)}h',
                                  'listened'),
                              const SizedBox(width: 16),
                              _miniStat(
                                  '${stats['totalTracks'] ?? 0}', 'tracks'),
                              const SizedBox(width: 16),
                              _miniStat(
                                  '${stats['totalSessions'] ?? 0}', 'sessions'),
                            ],
                          ),
                        ],
                      ],
                    ),
                  ),
                );
              }),
          ],
        ),
      ),
    );
  }

  Widget _buildSuggestionsSection() {
    final weights = _suggestions
        .where((s) => s['suggestion_type'] == 'weight')
        .take(3)
        .toList();

    final names = _suggestions
        .where((s) => s['suggestion_type'] == 'name')
        .take(5)
        .toList();

    final recaps = _suggestions
        .where((s) => s['suggestion_type'] == 'recap')
        .take(3)
        .toList();

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.history,
                    color: OrpheusColors.lyreGold, size: 20),
                const SizedBox(width: 8),
                Text('AI History',
                    style: Theme.of(context).textTheme.titleLarge),
              ],
            ),
            const SizedBox(height: 12),

            // Session names
            if (names.isNotEmpty) ...[
              Text('Session Names',
                  style: Theme.of(context).textTheme.labelMedium),
              const SizedBox(height: 6),
              Wrap(
                spacing: 8,
                runSpacing: 6,
                children: names.map((s) {
                  final response = _parseResponse(s['response']);
                  final name = response?['name'] ?? 'Unnamed';
                  return Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: OrpheusColors.slate,
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: Text(
                      name,
                      style: GoogleFonts.inter(
                        fontSize: 12,
                        color: OrpheusColors.lyreGold,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  );
                }).toList(),
              ),
              const SizedBox(height: 16),
            ],

            // Session recaps
            if (recaps.isNotEmpty) ...[
              Text('Session Recaps',
                  style: Theme.of(context).textTheme.labelMedium),
              const SizedBox(height: 6),
              ...recaps.map((s) {
                final response = _parseResponse(s['response']);
                final recap = response?['recap'] ?? '';
                final mood = response?['mood'] ?? '';
                return Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (mood.isNotEmpty) ...[
                        Text(
                          mood,
                          style: const TextStyle(
                            fontSize: 10,
                            color: OrpheusColors.lyreGold,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(width: 8),
                      ],
                      Expanded(
                        child: Text(
                          recap,
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                      ),
                    ],
                  ),
                );
              }),
              const SizedBox(height: 16),
            ],

            // Weight adjustments
            if (weights.isNotEmpty) ...[
              Text('Weight Adjustments',
                  style: Theme.of(context).textTheme.labelMedium),
              const SizedBox(height: 6),
              ...weights.map((s) {
                final response = _parseResponse(s['response']);
                final reasoning = response?['reasoning'] ?? 'No reasoning';
                return Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Icon(Icons.tune,
                          size: 14, color: OrpheusColors.mist),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          reasoning,
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                      ),
                    ],
                  ),
                );
              }),
            ],

            if (weights.isEmpty && names.isEmpty && recaps.isEmpty)
              Text(
                'No AI history yet. Suggestions will appear as sessions are analyzed.',
                style: Theme.of(context).textTheme.bodySmall,
              ),
          ],
        ),
      ),
    );
  }

  Widget _miniStat(String value, String label) {
    return Column(
      children: [
        Text(
          value,
          style: GoogleFonts.jetBrainsMono(
            fontSize: 12,
            fontWeight: FontWeight.w700,
            color: OrpheusColors.lyreGold,
          ),
        ),
        Text(label,
            style: const TextStyle(fontSize: 9, color: OrpheusColors.mist)),
      ],
    );
  }

  Widget _categoryIcon(String category) {
    final icons = {
      'mood': Icons.emoji_emotions_outlined,
      'energy': Icons.bolt,
      'discovery': Icons.explore_outlined,
      'pattern': Icons.insights,
      'genre': Icons.library_music_outlined,
    };
    return Icon(
      icons[category] ?? Icons.lightbulb_outline,
      size: 16,
      color: OrpheusColors.lyreGold,
    );
  }

  Map<String, dynamic>? _parseResponse(dynamic response) {
    if (response is String) {
      try {
        final decoded = jsonDecode(response);
        if (decoded is Map<String, dynamic>) return decoded;
      } catch (_) {
        return null;
      }
    }
    if (response is Map<String, dynamic>) return response;
    return null;
  }
}
