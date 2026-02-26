import 'package:flutter/material.dart';
import 'package:fl_chart/fl_chart.dart';
import 'package:google_fonts/google_fonts.dart';
import '../config/theme.dart';

/// Metric card with optional sparkline, following Orpheus card styling.
class StatCard extends StatelessWidget {
  final String title;
  final String value;
  final String? subtitle;
  final IconData? icon;
  final Color? valueColor;
  final List<double>? sparklineData;

  const StatCard({
    super.key,
    required this.title,
    required this.value,
    this.subtitle,
    this.icon,
    this.valueColor,
    this.sparklineData,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
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
        mainAxisSize: MainAxisSize.min,
        children: [
          // Title row
          Row(
            children: [
              if (icon != null) ...[
                Icon(icon, size: 14, color: OrpheusColors.mist),
                const SizedBox(width: 6),
              ],
              Expanded(
                child: Text(
                  title.toUpperCase(),
                  style: Theme.of(context).textTheme.labelSmall,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),

          // Value
          Text(
            value,
            style: GoogleFonts.jetBrainsMono(
              fontSize: 24,
              fontWeight: FontWeight.w700,
              color: valueColor ?? OrpheusColors.lyreGold,
            ),
          ),

          // Subtitle
          if (subtitle != null) ...[
            const SizedBox(height: 4),
            Text(
              subtitle!,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],

          // Sparkline
          if (sparklineData != null && sparklineData!.length >= 2) ...[
            const SizedBox(height: 12),
            SizedBox(
              height: 40,
              child: LineChart(
                LineChartData(
                  gridData: const FlGridData(show: false),
                  titlesData: const FlTitlesData(show: false),
                  borderData: FlBorderData(show: false),
                  lineTouchData: const LineTouchData(enabled: false),
                  lineBarsData: [
                    LineChartBarData(
                      spots: sparklineData!
                          .asMap()
                          .entries
                          .map((e) => FlSpot(e.key.toDouble(), e.value))
                          .toList(),
                      isCurved: true,
                      curveSmoothness: 0.3,
                      color: OrpheusColors.lyreGold,
                      barWidth: 2,
                      dotData: const FlDotData(show: false),
                      belowBarData: BarAreaData(
                        show: true,
                        color: OrpheusColors.lyreGold.withValues(alpha: 0.1),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
