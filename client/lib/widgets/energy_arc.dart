import 'dart:math';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../config/theme.dart';

/// Semi-circular golden gauge showing a 0-1 value.
class EnergyArc extends StatelessWidget {
  final double value;
  final String label;
  final double size;

  const EnergyArc({
    super.key,
    required this.value,
    this.label = 'Energy',
    this.size = 120,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        SizedBox(
          width: size,
          height: size * 0.6,
          child: CustomPaint(
            painter: _EnergyArcPainter(value: value.clamp(0.0, 1.0)),
            child: Center(
              child: Padding(
                padding: EdgeInsets.only(top: size * 0.15),
                child: Text(
                  '${(value * 100).round()}%',
                  style: GoogleFonts.jetBrainsMono(
                    fontSize: size * 0.18,
                    fontWeight: FontWeight.w600,
                    color: OrpheusColors.lyreGold,
                  ),
                ),
              ),
            ),
          ),
        ),
        const SizedBox(height: 4),
        Text(
          label,
          style: Theme.of(context).textTheme.bodySmall,
        ),
      ],
    );
  }
}

class _EnergyArcPainter extends CustomPainter {
  final double value;

  _EnergyArcPainter({required this.value});

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height * 0.85);
    final radius = size.width * 0.42;

    // Background arc
    final bgPaint = Paint()
      ..color = OrpheusColors.slate
      ..style = PaintingStyle.stroke
      ..strokeWidth = 3
      ..strokeCap = StrokeCap.round;

    canvas.drawArc(
      Rect.fromCircle(center: center, radius: radius),
      pi,
      pi,
      false,
      bgPaint,
    );

    // Foreground arc
    if (value > 0) {
      final fgPaint = Paint()
        ..color = OrpheusColors.lyreGold
        ..style = PaintingStyle.stroke
        ..strokeWidth = 5
        ..strokeCap = StrokeCap.round;

      canvas.drawArc(
        Rect.fromCircle(center: center, radius: radius),
        pi,
        pi * value,
        false,
        fgPaint,
      );
    }
  }

  @override
  bool shouldRepaint(_EnergyArcPainter oldDelegate) => oldDelegate.value != value;
}
