import 'package:flutter/material.dart';
import '../../config/theme.dart';
import '../../models/genre_builder_models.dart';

/// Liked-date range, track limit, and energy range (only with real features).
class SecondaryFilters extends StatelessWidget {
  final DateTime? likedFrom;
  final DateTime? likedTo;
  final int? limit;
  final double? energyMin;
  final double? energyMax;
  final bool featuresAvailable;
  final void Function(DateTime? from, DateTime? to) onLikedRange;
  final ValueChanged<int?> onLimit;
  final void Function(double? min, double? max) onEnergy;

  const SecondaryFilters({
    super.key,
    this.likedFrom,
    this.likedTo,
    this.limit,
    this.energyMin,
    this.energyMax,
    required this.featuresAvailable,
    required this.onLikedRange,
    required this.onLimit,
    required this.onEnergy,
  });

  Future<void> _pickRange(BuildContext context) async {
    final now = DateTime.now();
    final picked = await showDateRangePicker(
      context: context,
      firstDate: DateTime(2008),
      lastDate: now,
      initialDateRange: likedFrom != null && likedTo != null
          ? DateTimeRange(start: likedFrom!, end: likedTo!)
          : null,
    );
    if (picked != null) onLikedRange(picked.start, picked.end);
  }

  @override
  Widget build(BuildContext context) {
    final small = Theme.of(context).textTheme.bodySmall?.copyWith(color: OrpheusColors.mist);
    final rangeLabel = likedFrom == null
        ? 'Any time'
        : '${formatApiDate(likedFrom!)} → ${likedTo == null ? 'today' : formatApiDate(likedTo!)}';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Liked between', style: small),
        Row(
          children: [
            Expanded(
              child: OutlinedButton.icon(
                onPressed: () => _pickRange(context),
                icon: const Icon(Icons.date_range_rounded, size: 18),
                label: Text(rangeLabel),
              ),
            ),
            if (likedFrom != null)
              IconButton(
                tooltip: 'Clear date range',
                onPressed: () => onLikedRange(null, null),
                icon: const Icon(Icons.close_rounded, size: 18),
              ),
          ],
        ),
        const SizedBox(height: 12),
        Text('Max tracks (empty = all)', style: small),
        TextFormField(
          initialValue: limit?.toString() ?? '',
          keyboardType: TextInputType.number,
          decoration: const InputDecoration(isDense: true, hintText: 'All'),
          onChanged: (v) => onLimit(int.tryParse(v.trim())),
        ),
        if (featuresAvailable) ...[
          const SizedBox(height: 12),
          Text('Energy', style: small),
          RangeSlider(
            values: RangeValues(energyMin ?? 0, energyMax ?? 1),
            divisions: 20,
            labels: RangeLabels(
              ((energyMin ?? 0) * 100).round().toString(),
              ((energyMax ?? 1) * 100).round().toString(),
            ),
            onChanged: (v) => onEnergy(v.start <= 0 ? null : v.start, v.end >= 1 ? null : v.end),
          ),
        ],
      ],
    );
  }
}
