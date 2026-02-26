import 'package:flutter/material.dart';
import 'package:fl_chart/fl_chart.dart';
import 'package:google_fonts/google_fonts.dart';
import '../config/theme.dart';

/// Horizontal scrollable energy curve for a session.
class SessionTimeline extends StatelessWidget {
  final List<double> energyCurve;
  final List<double>? valenceCurve;
  final double height;

  const SessionTimeline({
    super.key,
    required this.energyCurve,
    this.valenceCurve,
    this.height = 160,
  });

  @override
  Widget build(BuildContext context) {
    if (energyCurve.isEmpty) {
      return SizedBox(
        height: height,
        child: Center(
          child: Text(
            'No state data yet',
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ),
      );
    }

    final chartWidth = (energyCurve.length * 40.0).clamp(200.0, double.infinity);

    return SizedBox(
      height: height,
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: SizedBox(
          width: chartWidth,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
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
                      interval: 0.5,
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
                      final label = spot.barIndex == 0 ? 'Energy' : 'Valence';
                      return LineTooltipItem(
                        '$label: ${spot.y.toStringAsFixed(2)}',
                        GoogleFonts.jetBrainsMono(
                          fontSize: 11,
                          color: spot.barIndex == 0
                              ? OrpheusColors.lyreGold
                              : OrpheusColors.amberGlow,
                        ),
                      );
                    }).toList(),
                  ),
                ),
                lineBarsData: [
                  // Energy line
                  LineChartBarData(
                    spots: energyCurve
                        .asMap()
                        .entries
                        .map((e) => FlSpot(e.key.toDouble(), e.value))
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
                      color: OrpheusColors.lyreGold.withValues(alpha: 0.1),
                    ),
                  ),
                  // Valence line (optional)
                  if (valenceCurve != null && valenceCurve!.isNotEmpty)
                    LineChartBarData(
                      spots: valenceCurve!
                          .asMap()
                          .entries
                          .map((e) => FlSpot(e.key.toDouble(), e.value))
                          .toList(),
                      isCurved: true,
                      curveSmoothness: 0.3,
                      color: OrpheusColors.amberGlow.withValues(alpha: 0.6),
                      barWidth: 1.5,
                      dotData: const FlDotData(show: false),
                      dashArray: [4, 4],
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
