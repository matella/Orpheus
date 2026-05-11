import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:fl_chart/fl_chart.dart';
import '../config/theme.dart';
import '../providers/session_provider.dart';
import '../widgets/energy_arc.dart';
import '../widgets/session_timeline.dart';
import '../widgets/spotify_attribution.dart';

class SessionScreen extends ConsumerStatefulWidget {
  const SessionScreen({super.key});

  @override
  ConsumerState<SessionScreen> createState() => _SessionScreenState();
}

class _SessionScreenState extends ConsumerState<SessionScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(sessionProvider.notifier).refresh();
    });
  }

  Future<void> _onRefresh() async {
    await ref.read(sessionProvider.notifier).refresh();
  }

  String _formatDuration(int ms) {
    final minutes = ms ~/ 60000;
    if (minutes < 60) return '${minutes}m';
    final hours = minutes ~/ 60;
    final remaining = minutes % 60;
    return '${hours}h ${remaining}m';
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(sessionProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('SESSION'),
      ),
      body: RefreshIndicator(
        color: OrpheusColors.lyreGold,
        backgroundColor: OrpheusColors.charcoal,
        onRefresh: _onRefresh,
        child: state.isLoading && state.activeSession == null && state.sessionHistory.isEmpty
            ? const Center(
                child: CircularProgressIndicator(
                  color: OrpheusColors.lyreGold,
                ),
              )
            : ListView(
                padding: const EdgeInsets.all(20),
                children: [
                  _buildActiveSection(context, state),
                  const SizedBox(height: 32),
                  const Divider(),
                  const SizedBox(height: 24),
                  _buildHistorySection(context, state),
                ],
              ),
      ),
    );
  }

  Widget _buildActiveSection(BuildContext context, SessionState state) {
    final session = state.activeSession;

    if (session == null) {
      return Center(
        child: Column(
          children: [
            const SizedBox(height: 32),
            const Icon(
              Icons.timeline_rounded,
              size: 64,
              color: OrpheusColors.slate,
            ),
            const SizedBox(height: 16),
            Text(
              'No active session',
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: 8),
            Text(
              'Session timeline will appear here\nwhen music starts playing',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ),
      );
    }

    final energyCurve = (state.activeSessionStateHistory)
        .where((h) => h['energy'] != null)
        .map<double>((h) => (h['energy'] as num).toDouble())
        .toList();

    final valenceCurve = (state.activeSessionStateHistory)
        .where((h) => h['valence'] != null)
        .map<double>((h) => (h['valence'] as num).toDouble())
        .toList();

    final avgEnergy = (session['avgEnergy'] as num?)?.toDouble() ?? 0.0;
    final avgValence = (session['avgValence'] as num?)?.toDouble() ?? 0.0;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Active Session',
          style: Theme.of(context).textTheme.headlineSmall,
        ),
        const SizedBox(height: 4),
        Text(
          '${session['trackCount']} tracks \u2022 ${_formatDuration(session['totalDurationMs'] ?? 0)}',
          style: Theme.of(context).textTheme.bodySmall,
        ),
        const SizedBox(height: 20),

        // Gauges
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceEvenly,
          children: [
            EnergyArc(value: avgEnergy, label: 'Energy'),
            EnergyArc(value: avgValence, label: 'Mood'),
          ],
        ),
        const SizedBox(height: 24),

        // Energy timeline
        Text(
          'Energy Curve',
          style: Theme.of(context).textTheme.titleSmall,
        ),
        const SizedBox(height: 8),
        Container(
          decoration: BoxDecoration(
            color: OrpheusColors.onyx,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
              color: OrpheusColors.lyreGold.withValues(alpha: 0.15),
            ),
          ),
          child: SessionTimeline(
            energyCurve: energyCurve,
            valenceCurve: valenceCurve,
          ),
        ),
        const SizedBox(height: 24),

        // Track list
        Text(
          'Tracks Played',
          style: Theme.of(context).textTheme.titleSmall,
        ),
        const SizedBox(height: 12),
        ...state.activeSessionTracks.reversed.take(20).map<Widget>((track) =>
            _buildTrackTile(context, track)),

        const SizedBox(height: 16),
        const SpotifyAttribution(style: SpotifyAttributionStyle.full),
      ],
    );
  }

  Widget _buildTrackTile(BuildContext context, dynamic track) {
    final energy = (track['energy'] as num?)?.toDouble();
    final completion = (track['completionRatio'] as num?)?.toDouble();
    final isSkip = track['interactionType'] == 'skip';

    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: OrpheusColors.onyx,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: isSkip
                ? OrpheusColors.wineRed.withValues(alpha: 0.2)
                : OrpheusColors.slate.withValues(alpha: 0.3),
          ),
        ),
        child: Row(
          children: [
            // Album art
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                color: OrpheusColors.charcoal,
                borderRadius: BorderRadius.circular(8),
              ),
              child: track['albumArtUrl'] != null
                  ? ClipRRect(
                      borderRadius: BorderRadius.circular(8),
                      child: Image.network(
                        track['albumArtUrl'],
                        fit: BoxFit.cover,
                        errorBuilder: (_, __, ___) => const Icon(
                          Icons.music_note,
                          color: OrpheusColors.mist,
                          size: 20,
                        ),
                      ),
                    )
                  : const Icon(
                      Icons.music_note,
                      color: OrpheusColors.mist,
                      size: 20,
                    ),
            ),
            const SizedBox(width: 12),
            // Track info
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    track['name'] ?? '',
                    style: Theme.of(context).textTheme.bodyMedium,
                    overflow: TextOverflow.ellipsis,
                  ),
                  Text(
                    track['artist'] ?? '',
                    style: Theme.of(context).textTheme.bodySmall,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            // Energy + status
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                if (energy != null)
                  SizedBox(
                    width: 40,
                    child: LinearProgressIndicator(
                      value: energy,
                      backgroundColor: OrpheusColors.slate,
                      color: OrpheusColors.lyreGold,
                      minHeight: 3,
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                const SizedBox(height: 4),
                if (isSkip)
                  Text(
                    'SKIP',
                    style: GoogleFonts.jetBrainsMono(
                      fontSize: 9,
                      color: OrpheusColors.wineRedText,
                      fontWeight: FontWeight.w600,
                    ),
                  )
                else if (completion != null)
                  Text(
                    '${(completion * 100).round()}%',
                    style: GoogleFonts.jetBrainsMono(
                      fontSize: 9,
                      color: OrpheusColors.mist,
                    ),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildHistorySection(BuildContext context, SessionState state) {
    final sessions = state.sessionHistory;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              'Past Sessions',
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            Text(
              '${state.totalSessions} total',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ),
        const SizedBox(height: 16),

        if (sessions.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 24),
            child: Center(
              child: Text(
                'No past sessions yet',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ),
          )
        else
          ...sessions.map<Widget>((session) => _buildSessionCard(context, session)),
      ],
    );
  }

  Widget _buildSessionCard(BuildContext context, dynamic session) {
    final energyCurve = (session['energyCurve'] as List<dynamic>?)
            ?.whereType<num>()
            .map<double>((e) => e.toDouble())
            .toList() ??
        [];
    final trackCount = session['trackCount'] ?? 0;
    final totalMs = session['totalDurationMs'] ?? 0;
    final startedAt = session['startedAt'] ?? '';

    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: OrpheusColors.onyx,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: OrpheusColors.lyreGold.withValues(alpha: 0.15),
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Text(
                    _formatSessionDate(startedAt),
                    style: Theme.of(context).textTheme.titleSmall?.copyWith(
                          color: OrpheusColors.ivory,
                        ),
                  ),
                ),
                if (session['autoStarted'] == true)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: OrpheusColors.deepGold.withValues(alpha: 0.2),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Text(
                      'AUTO',
                      style: GoogleFonts.jetBrainsMono(
                        fontSize: 8,
                        color: OrpheusColors.lyreGold,
                        fontWeight: FontWeight.w600,
                        letterSpacing: 1,
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              '$trackCount tracks \u2022 ${_formatDuration(totalMs)}',
              style: Theme.of(context).textTheme.bodySmall,
            ),

            // Mini sparkline
            if (energyCurve.length >= 2) ...[
              const SizedBox(height: 12),
              SizedBox(
                height: 30,
                child: LineChart(
                  LineChartData(
                    minY: 0,
                    maxY: 1,
                    gridData: const FlGridData(show: false),
                    titlesData: const FlTitlesData(show: false),
                    borderData: FlBorderData(show: false),
                    lineTouchData: const LineTouchData(enabled: false),
                    lineBarsData: [
                      LineChartBarData(
                        spots: energyCurve
                            .asMap()
                            .entries
                            .map((e) => FlSpot(e.key.toDouble(), e.value))
                            .toList(),
                        isCurved: true,
                        curveSmoothness: 0.3,
                        color: OrpheusColors.lyreGold.withValues(alpha: 0.7),
                        barWidth: 1.5,
                        dotData: const FlDotData(show: false),
                        belowBarData: BarAreaData(
                          show: true,
                          color: OrpheusColors.lyreGold.withValues(alpha: 0.05),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  String _formatSessionDate(String isoDate) {
    if (isoDate.isEmpty) return '';
    try {
      final dt = DateTime.parse(isoDate);
      final now = DateTime.now();
      final diff = now.difference(dt);

      String dateStr;
      if (diff.inDays == 0) {
        dateStr = 'Today';
      } else if (diff.inDays == 1) {
        dateStr = 'Yesterday';
      } else if (diff.inDays < 7) {
        dateStr = '${diff.inDays} days ago';
      } else {
        dateStr = '${dt.month}/${dt.day}/${dt.year}';
      }

      final hour = dt.hour > 12 ? dt.hour - 12 : (dt.hour == 0 ? 12 : dt.hour);
      final amPm = dt.hour >= 12 ? 'PM' : 'AM';
      final minute = dt.minute.toString().padLeft(2, '0');

      return '$dateStr at $hour:$minute $amPm';
    } catch (_) {
      return isoDate;
    }
  }
}
