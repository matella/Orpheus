import 'package:flutter/material.dart';
import 'package:fl_chart/fl_chart.dart';
import 'package:google_fonts/google_fonts.dart';
import '../config/theme.dart';
import '../services/api_service.dart';
import '../widgets/stat_card.dart';
import '../widgets/spotify_attribution.dart';

class AnalyticsScreen extends StatefulWidget {
  const AnalyticsScreen({super.key});

  @override
  State<AnalyticsScreen> createState() => _AnalyticsScreenState();
}

class _AnalyticsScreenState extends State<AnalyticsScreen> {
  Map<String, dynamic>? _overview;
  Map<String, dynamic>? _genres;
  Map<String, dynamic>? _hours;
  Map<String, dynamic>? _topTracks;
  Map<String, dynamic>? _daily;
  bool _isLoading = true;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _loadAllData();
  }

  /// Load each analytics endpoint independently so a single failure
  /// doesn't blank the entire page.
  Future<void> _loadAllData() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    int failures = 0;

    _overview = await _safeLoad(() => apiService.getAnalyticsOverview(), () => failures++);
    _genres = await _safeLoad(() => apiService.getAnalyticsGenres(), () => failures++);
    _hours = await _safeLoad(() => apiService.getAnalyticsHours(), () => failures++);
    _topTracks = await _safeLoad(() => apiService.getAnalyticsTopTracks(), () => failures++);
    _daily = await _safeLoad(() => apiService.getAnalyticsDaily(), () => failures++);

    if (!mounted) return;
    setState(() {
      _isLoading = false;
      if (failures == 5) {
        _errorMessage = 'Could not load analytics. Check server connection.';
      } else if (failures > 0) {
        _errorMessage = 'Some analytics data could not be loaded.';
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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('ANALYTICS'),
      ),
      body: RefreshIndicator(
        color: OrpheusColors.lyreGold,
        backgroundColor: OrpheusColors.charcoal,
        onRefresh: _loadAllData,
        child: _isLoading
            ? const Center(
                child: CircularProgressIndicator(
                  color: OrpheusColors.lyreGold,
                ),
              )
            : _overview == null && _errorMessage != null
                ? _buildErrorState(context)
                : _overview == null
                    ? _buildEmptyState(context)
                    : ListView(
                    padding: const EdgeInsets.all(20),
                    children: [
                      _buildOverviewCards(context),
                      const SizedBox(height: 32),
                      _buildGenreChart(context),
                      const SizedBox(height: 32),
                      _buildEnergyTrend(context),
                      const SizedBox(height: 32),
                      _buildListeningHours(context),
                      const SizedBox(height: 32),
                      _buildTopTracks(context),
                      const SizedBox(height: 20),
                      const SpotifyAttribution(style: SpotifyAttributionStyle.full),
                      const SizedBox(height: 24),
                    ],
                  ),
      ),
    );
  }

  Widget _buildErrorState(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(
            Icons.cloud_off_rounded,
            size: 64,
            color: OrpheusColors.wineRed,
          ),
          const SizedBox(height: 16),
          Text(
            'Connection Error',
            style: Theme.of(context).textTheme.headlineSmall,
          ),
          const SizedBox(height: 8),
          Text(
            _errorMessage ?? 'Could not load analytics.',
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: 24),
          OutlinedButton.icon(
            onPressed: _loadAllData,
            icon: const Icon(Icons.refresh, size: 18),
            label: const Text('Retry'),
            style: OutlinedButton.styleFrom(
              foregroundColor: OrpheusColors.lyreGold,
              side: const BorderSide(color: OrpheusColors.lyreGold),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildEmptyState(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(
            Icons.bar_chart_rounded,
            size: 64,
            color: OrpheusColors.slate,
          ),
          const SizedBox(height: 16),
          Text(
            'No data yet',
            style: Theme.of(context).textTheme.headlineSmall,
          ),
          const SizedBox(height: 8),
          Text(
            'Analytics and insights will appear here\nafter listening sessions',
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ],
      ),
    );
  }

  // ── Overview Cards ──

  Widget _buildOverviewCards(BuildContext context) {
    final totalHours = (_overview?['totalListeningHours'] as num?)?.toDouble() ?? 0;
    final tracksPlayed = _overview?['totalTracksPlayed'] ?? 0;
    final skipRate = ((_overview?['skipRate'] as num?)?.toDouble() ?? 0) * 100;
    final discoveryRate = ((_overview?['discoveryRate'] as num?)?.toDouble() ?? 0) * 100;

    // Build sparkline from daily data
    final dailyList = (_daily?['daily'] as List<dynamic>?) ?? [];
    final dailyMs = dailyList
        .map<double>((d) => ((d['totalMs'] as num?)?.toDouble() ?? 0) / 3600000)
        .toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Overview',
          style: Theme.of(context).textTheme.headlineSmall,
        ),
        const SizedBox(height: 4),
        Text(
          'Last 30 days',
          style: Theme.of(context).textTheme.bodySmall,
        ),
        const SizedBox(height: 16),
        Row(
          children: [
            Expanded(
              child: StatCard(
                title: 'Listening',
                value: '${totalHours.toStringAsFixed(1)}h',
                icon: Icons.headphones,
                sparklineData: dailyMs.isNotEmpty ? dailyMs : null,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: StatCard(
                title: 'Tracks',
                value: '$tracksPlayed',
                icon: Icons.library_music,
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: StatCard(
                title: 'Skip Rate',
                value: '${skipRate.round()}%',
                icon: Icons.skip_next,
                valueColor: skipRate > 40
                    ? OrpheusColors.wineRedText
                    : skipRate > 20
                        ? OrpheusColors.amberGlow
                        : OrpheusColors.laurelGreen,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: StatCard(
                title: 'Discovery',
                value: '${discoveryRate.round()}%',
                subtitle: 'New tracks ratio',
                icon: Icons.explore,
              ),
            ),
          ],
        ),
      ],
    );
  }

  // ── Genre Distribution ──

  Widget _buildGenreChart(BuildContext context) {
    final genres = (_genres?['genres'] as List<dynamic>?) ?? [];
    if (genres.isEmpty) return const SizedBox.shrink();

    // Take top 8 genres for the chart
    final topGenres = genres.take(8).toList();
    final genreColors = [
      OrpheusColors.lyreGold,
      OrpheusColors.amberGlow,
      OrpheusColors.deepGold,
      OrpheusColors.laurelGreen,
      const Color(0xFF5B8FB9),
      const Color(0xFF9B59B6),
      const Color(0xFFE67E22),
      const Color(0xFF1ABC9C),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Genres',
          style: Theme.of(context).textTheme.headlineSmall,
        ),
        const SizedBox(height: 16),
        Container(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            color: OrpheusColors.onyx,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
              color: OrpheusColors.lyreGold.withValues(alpha: 0.15),
            ),
          ),
          child: Column(
            children: [
              SizedBox(
                height: 180,
                child: PieChart(
                  PieChartData(
                    sectionsSpace: 2,
                    centerSpaceRadius: 40,
                    sections: topGenres.asMap().entries.map((entry) {
                      final idx = entry.key;
                      final genre = entry.value;
                      return PieChartSectionData(
                        value: (genre['count'] as num?)?.toDouble() ?? 0,
                        color: genreColors[idx % genreColors.length],
                        radius: 50,
                        showTitle: false,
                      );
                    }).toList(),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              // Legend
              Wrap(
                spacing: 16,
                runSpacing: 8,
                children: topGenres.asMap().entries.map((entry) {
                  final idx = entry.key;
                  final genre = entry.value;
                  return Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Container(
                        width: 10,
                        height: 10,
                        decoration: BoxDecoration(
                          color: genreColors[idx % genreColors.length],
                          shape: BoxShape.circle,
                        ),
                      ),
                      const SizedBox(width: 6),
                      Text(
                        '${genre['genre']}',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        '${(genre['percentage'] as num?)?.toStringAsFixed(0) ?? 0}%',
                        style: GoogleFonts.jetBrainsMono(
                          fontSize: 10,
                          color: OrpheusColors.mist,
                        ),
                      ),
                    ],
                  );
                }).toList(),
              ),
            ],
          ),
        ),
      ],
    );
  }

  // ── Energy Trend ──

  Widget _buildEnergyTrend(BuildContext context) {
    final dailyList = (_daily?['daily'] as List<dynamic>?) ?? [];
    if (dailyList.isEmpty) return const SizedBox.shrink();

    final energyPoints = dailyList
        .where((d) => d['avgEnergy'] != null)
        .toList();

    if (energyPoints.length < 2) return const SizedBox.shrink();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Energy Trend',
          style: Theme.of(context).textTheme.headlineSmall,
        ),
        const SizedBox(height: 16),
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: OrpheusColors.onyx,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
              color: OrpheusColors.lyreGold.withValues(alpha: 0.15),
            ),
          ),
          child: SizedBox(
            height: 200,
            child: LineChart(
              LineChartData(
                minY: 0,
                maxY: 1,
                gridData: FlGridData(
                  show: true,
                  drawVerticalLine: false,
                  horizontalInterval: 0.25,
                  getDrawingHorizontalLine: (_) => FlLine(
                    color: OrpheusColors.slate.withValues(alpha: 0.3),
                    strokeWidth: 1,
                  ),
                ),
                titlesData: FlTitlesData(
                  leftTitles: AxisTitles(
                    sideTitles: SideTitles(
                      showTitles: true,
                      reservedSize: 32,
                      interval: 0.25,
                      getTitlesWidget: (value, _) => Text(
                        value.toStringAsFixed(1),
                        style: GoogleFonts.jetBrainsMono(
                          fontSize: 9,
                          color: OrpheusColors.mist,
                        ),
                      ),
                    ),
                  ),
                  bottomTitles: const AxisTitles(
                    sideTitles: SideTitles(showTitles: false),
                  ),
                  topTitles: const AxisTitles(
                    sideTitles: SideTitles(showTitles: false),
                  ),
                  rightTitles: const AxisTitles(
                    sideTitles: SideTitles(showTitles: false),
                  ),
                ),
                borderData: FlBorderData(show: false),
                lineTouchData: LineTouchData(
                  touchTooltipData: LineTouchTooltipData(
                    getTooltipColor: (_) => OrpheusColors.charcoal,
                    getTooltipItems: (spots) => spots.map((spot) {
                      final idx = spot.x.toInt();
                      final date = idx < energyPoints.length
                          ? energyPoints[idx]['date'] ?? ''
                          : '';
                      return LineTooltipItem(
                        '$date\n${spot.y.toStringAsFixed(2)}',
                        GoogleFonts.jetBrainsMono(
                          fontSize: 10,
                          color: OrpheusColors.lyreGold,
                        ),
                      );
                    }).toList(),
                  ),
                ),
                lineBarsData: [
                  LineChartBarData(
                    spots: energyPoints
                        .asMap()
                        .entries
                        .map((e) => FlSpot(
                              e.key.toDouble(),
                              (e.value['avgEnergy'] as num).toDouble(),
                            ))
                        .toList(),
                    isCurved: true,
                    curveSmoothness: 0.3,
                    color: OrpheusColors.lyreGold,
                    barWidth: 2.5,
                    dotData: FlDotData(
                      show: true,
                      getDotPainter: (_, __, ___, ____) =>
                          FlDotCirclePainter(
                        radius: 3,
                        color: OrpheusColors.lyreGold,
                        strokeWidth: 0,
                      ),
                    ),
                    belowBarData: BarAreaData(
                      show: true,
                      gradient: LinearGradient(
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                        colors: [
                          OrpheusColors.lyreGold.withValues(alpha: 0.2),
                          OrpheusColors.lyreGold.withValues(alpha: 0.0),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }

  // ── Listening Hours ──

  Widget _buildListeningHours(BuildContext context) {
    final hoursList = (_hours?['hours'] as List<dynamic>?) ?? [];
    if (hoursList.isEmpty) return const SizedBox.shrink();

    final maxMinutes = hoursList
        .map<double>((h) => (h['minutes'] as num?)?.toDouble() ?? 0)
        .reduce((a, b) => a > b ? a : b);

    if (maxMinutes == 0) return const SizedBox.shrink();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Listening Hours',
          style: Theme.of(context).textTheme.headlineSmall,
        ),
        const SizedBox(height: 16),
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: OrpheusColors.onyx,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
              color: OrpheusColors.lyreGold.withValues(alpha: 0.15),
            ),
          ),
          child: SizedBox(
            height: 200,
            child: BarChart(
              BarChartData(
                maxY: maxMinutes * 1.1,
                gridData: FlGridData(
                  show: true,
                  drawVerticalLine: false,
                  horizontalInterval: (maxMinutes / 4).clamp(1.0, double.infinity),
                  getDrawingHorizontalLine: (_) => FlLine(
                    color: OrpheusColors.slate.withValues(alpha: 0.3),
                    strokeWidth: 1,
                  ),
                ),
                titlesData: FlTitlesData(
                  leftTitles: AxisTitles(
                    sideTitles: SideTitles(
                      showTitles: true,
                      reservedSize: 40,
                      interval: (maxMinutes / 4).clamp(1.0, double.infinity),
                      getTitlesWidget: (value, _) => Text(
                        '${value.round()}m',
                        style: GoogleFonts.jetBrainsMono(
                          fontSize: 9,
                          color: OrpheusColors.mist,
                        ),
                      ),
                    ),
                  ),
                  bottomTitles: AxisTitles(
                    sideTitles: SideTitles(
                      showTitles: true,
                      reservedSize: 20,
                      interval: 1,
                      getTitlesWidget: (value, _) {
                        final hour = value.toInt();
                        if (hour % 6 == 0) {
                          return Padding(
                            padding: const EdgeInsets.only(top: 4),
                            child: Text(
                              '${hour}h',
                              style: GoogleFonts.jetBrainsMono(
                                fontSize: 9,
                                color: OrpheusColors.mist,
                              ),
                            ),
                          );
                        }
                        return const SizedBox.shrink();
                      },
                    ),
                  ),
                  topTitles: const AxisTitles(
                    sideTitles: SideTitles(showTitles: false),
                  ),
                  rightTitles: const AxisTitles(
                    sideTitles: SideTitles(showTitles: false),
                  ),
                ),
                borderData: FlBorderData(show: false),
                barTouchData: BarTouchData(
                  touchTooltipData: BarTouchTooltipData(
                    getTooltipColor: (_) => OrpheusColors.charcoal,
                    getTooltipItem: (group, _, rod, __) {
                      return BarTooltipItem(
                        '${group.x}:00\n${rod.toY.round()} min',
                        GoogleFonts.jetBrainsMono(
                          fontSize: 10,
                          color: OrpheusColors.lyreGold,
                        ),
                      );
                    },
                  ),
                ),
                barGroups: hoursList.map((h) {
                  final hour = (h['hour'] as num).toInt();
                  final minutes = (h['minutes'] as num?)?.toDouble() ?? 0;
                  return BarChartGroupData(
                    x: hour,
                    barRods: [
                      BarChartRodData(
                        toY: minutes,
                        color: OrpheusColors.lyreGold,
                        width: 8,
                        borderRadius: const BorderRadius.vertical(
                          top: Radius.circular(3),
                        ),
                      ),
                    ],
                  );
                }).toList(),
              ),
            ),
          ),
        ),
      ],
    );
  }

  // ── Top Tracks ──

  Widget _buildTopTracks(BuildContext context) {
    final tracks = (_topTracks?['tracks'] as List<dynamic>?) ?? [];
    if (tracks.isEmpty) return const SizedBox.shrink();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Top Tracks',
          style: Theme.of(context).textTheme.headlineSmall,
        ),
        const SizedBox(height: 16),
        ...tracks.asMap().entries.map((entry) {
          final rank = entry.key + 1;
          final track = entry.value;
          return Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              decoration: BoxDecoration(
                color: OrpheusColors.onyx,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: rank <= 3
                      ? OrpheusColors.lyreGold.withValues(alpha: 0.2)
                      : OrpheusColors.slate.withValues(alpha: 0.3),
                ),
              ),
              child: Row(
                children: [
                  // Rank
                  SizedBox(
                    width: 28,
                    child: Text(
                      '$rank',
                      style: GoogleFonts.jetBrainsMono(
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                        color: rank <= 3
                            ? OrpheusColors.lyreGold
                            : OrpheusColors.mist,
                      ),
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
                  // Play count
                  Text(
                    '${track['playCount']}x',
                    style: GoogleFonts.jetBrainsMono(
                      fontSize: 13,
                      color: OrpheusColors.lyreGold,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
            ),
          );
        }),
      ],
    );
  }
}
