import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:google_fonts/google_fonts.dart';
import '../config/theme.dart';

enum SpotifyAttributionStyle {
  /// Icon + "Music from Spotify" — for data views
  full,

  /// Icon only (minimum 21px) — for tight spaces
  iconOnly,

  /// Icon + "Listen on Spotify" — for action contexts
  listenOn,
}

class SpotifyAttribution extends StatelessWidget {
  final SpotifyAttributionStyle style;
  final double iconSize;
  final MainAxisAlignment alignment;

  const SpotifyAttribution({
    super.key,
    this.style = SpotifyAttributionStyle.full,
    this.iconSize = 21.0,
    this.alignment = MainAxisAlignment.center,
  });

  String get _label {
    switch (style) {
      case SpotifyAttributionStyle.full:
        return 'Music from Spotify';
      case SpotifyAttributionStyle.listenOn:
        return 'Listen on Spotify';
      case SpotifyAttributionStyle.iconOnly:
        return '';
    }
  }

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Music data provided by Spotify',
      child: Row(
        mainAxisAlignment: alignment,
        mainAxisSize: MainAxisSize.min,
        children: [
          SvgPicture.asset(
            'assets/images/spotify_icon_white.svg',
            height: iconSize,
            width: iconSize,
            // Muted to match footer context; white variant recolored to blend
            colorFilter: const ColorFilter.mode(
              OrpheusColors.mist,
              BlendMode.srcIn,
            ),
          ),
          if (style != SpotifyAttributionStyle.iconOnly) ...[
            const SizedBox(width: 6),
            Text(
              _label,
              style: GoogleFonts.inter(
                fontSize: 11,
                fontWeight: FontWeight.w400,
                color: OrpheusColors.mist,
                letterSpacing: 0.3,
              ),
            ),
          ],
        ],
      ),
    );
  }
}
