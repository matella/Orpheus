import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../config/theme.dart';

class SteeringSlider extends StatelessWidget {
  final String label;
  final String leftLabel;
  final String rightLabel;
  final double value;
  final ValueChanged<double>? onChanged;

  const SteeringSlider({
    super.key,
    required this.label,
    required this.leftLabel,
    required this.rightLabel,
    required this.value,
    this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Label and value
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              label.toUpperCase(),
              style: GoogleFonts.cinzel(
                fontSize: 11,
                fontWeight: FontWeight.w400,
                color: OrpheusColors.mist,
                letterSpacing: 2,
              ),
            ),
            Text(
              value.toStringAsFixed(2),
              style: GoogleFonts.jetBrainsMono(
                fontSize: 11,
                color: OrpheusColors.lyreGold,
              ),
            ),
          ],
        ),
        const SizedBox(height: 4),

        // Slider
        SliderTheme(
          data: SliderTheme.of(context).copyWith(
            activeTrackColor: OrpheusColors.lyreGold,
            inactiveTrackColor: OrpheusColors.slate,
            thumbColor: OrpheusColors.lyreGold,
            overlayColor: OrpheusColors.lyreGold.withValues(alpha: 0.15),
            trackHeight: 2,
            thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 7),
          ),
          child: Slider(
            value: value,
            min: 0.0,
            max: 1.0,
            onChanged: onChanged,
          ),
        ),

        // Endpoint labels
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              leftLabel,
              style: Theme.of(context).textTheme.labelSmall,
            ),
            Text(
              rightLabel,
              style: Theme.of(context).textTheme.labelSmall,
            ),
          ],
        ),
      ],
    );
  }
}
