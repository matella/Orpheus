import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Orpheus color palette — dark theme with golden lyre accents
class OrpheusColors {
  OrpheusColors._();

  // Backgrounds
  static const obsidian = Color(0xFF0D0D0F);
  static const onyx = Color(0xFF161619);
  static const charcoal = Color(0xFF1E1E24);
  static const slate = Color(0xFF2A2A33);

  // Text
  static const mist = Color(0xFF8A8A99);
  static const ivory = Color(0xFFE8E6E1);

  // Accent — Lyre Gold
  static const lyreGold = Color(0xFFD4A843);
  static const amberGlow = Color(0xFFF5C842);
  static const deepGold = Color(0xFF8B6914);

  // Feedback
  static const laurelGreen = Color(0xFF4A7C59);
  static const wineRed = Color(0xFF8B3A3A);

  // Gradients
  static const goldGradient = LinearGradient(
    colors: [deepGold, lyreGold, amberGlow],
    begin: Alignment.centerLeft,
    end: Alignment.centerRight,
  );
}

/// Build the Orpheus dark theme
ThemeData buildOrpheusTheme() {
  final textTheme = _buildTextTheme();

  return ThemeData(
    useMaterial3: true,
    brightness: Brightness.dark,

    // Colors
    colorScheme: const ColorScheme.dark(
      surface: OrpheusColors.obsidian,
      primary: OrpheusColors.lyreGold,
      secondary: OrpheusColors.amberGlow,
      error: OrpheusColors.wineRed,
      onPrimary: OrpheusColors.obsidian,
      onSurface: OrpheusColors.ivory,
      onSecondary: OrpheusColors.obsidian,
      onError: OrpheusColors.ivory,
      surfaceContainerHighest: OrpheusColors.charcoal,
    ),

    scaffoldBackgroundColor: OrpheusColors.obsidian,

    // Typography
    textTheme: textTheme,

    // AppBar
    appBarTheme: AppBarTheme(
      backgroundColor: OrpheusColors.charcoal,
      foregroundColor: OrpheusColors.ivory,
      elevation: 0,
      centerTitle: true,
      titleTextStyle: GoogleFonts.cinzel(
        fontSize: 20,
        fontWeight: FontWeight.w400,
        color: OrpheusColors.lyreGold,
        letterSpacing: 4,
      ),
    ),

    // Bottom Navigation
    bottomNavigationBarTheme: const BottomNavigationBarThemeData(
      backgroundColor: OrpheusColors.charcoal,
      selectedItemColor: OrpheusColors.lyreGold,
      unselectedItemColor: OrpheusColors.mist,
      type: BottomNavigationBarType.fixed,
      elevation: 8,
    ),

    // Cards
    cardTheme: CardTheme(
      color: OrpheusColors.onyx,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(
          color: OrpheusColors.lyreGold.withValues(alpha: 0.15),
          width: 1,
        ),
      ),
    ),

    // Sliders — gold accent
    sliderTheme: SliderThemeData(
      activeTrackColor: OrpheusColors.lyreGold,
      inactiveTrackColor: OrpheusColors.slate,
      thumbColor: OrpheusColors.lyreGold,
      overlayColor: OrpheusColors.lyreGold.withValues(alpha: 0.2),
      trackHeight: 2,
      thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 8),
      overlayShape: const RoundSliderOverlayShape(overlayRadius: 16),
    ),

    // Icon buttons
    iconButtonTheme: IconButtonThemeData(
      style: IconButton.styleFrom(
        foregroundColor: OrpheusColors.ivory,
      ),
    ),

    // Elevated buttons
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: OrpheusColors.lyreGold,
        foregroundColor: OrpheusColors.obsidian,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
        ),
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
        textStyle: GoogleFonts.inter(
          fontSize: 14,
          fontWeight: FontWeight.w600,
        ),
      ),
    ),

    // Text fields
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: OrpheusColors.onyx,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: OrpheusColors.slate),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: OrpheusColors.slate),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: OrpheusColors.lyreGold),
      ),
      labelStyle: const TextStyle(color: OrpheusColors.mist),
      hintStyle: const TextStyle(color: OrpheusColors.mist),
    ),

    // Divider
    dividerTheme: const DividerThemeData(
      color: OrpheusColors.slate,
      thickness: 1,
    ),
  );
}

TextTheme _buildTextTheme() {
  return TextTheme(
    // Display — Cinzel for brand headings
    displayLarge: GoogleFonts.cinzel(
      fontSize: 32,
      fontWeight: FontWeight.w400,
      color: OrpheusColors.lyreGold,
      letterSpacing: 4,
    ),
    displayMedium: GoogleFonts.cinzel(
      fontSize: 24,
      fontWeight: FontWeight.w400,
      color: OrpheusColors.lyreGold,
      letterSpacing: 3,
    ),
    displaySmall: GoogleFonts.cinzel(
      fontSize: 20,
      fontWeight: FontWeight.w400,
      color: OrpheusColors.ivory,
      letterSpacing: 2,
    ),

    // Headlines
    headlineLarge: GoogleFonts.inter(
      fontSize: 24,
      fontWeight: FontWeight.w700,
      color: OrpheusColors.ivory,
    ),
    headlineMedium: GoogleFonts.inter(
      fontSize: 20,
      fontWeight: FontWeight.w600,
      color: OrpheusColors.ivory,
    ),
    headlineSmall: GoogleFonts.inter(
      fontSize: 18,
      fontWeight: FontWeight.w600,
      color: OrpheusColors.ivory,
    ),

    // Titles
    titleLarge: GoogleFonts.inter(
      fontSize: 18,
      fontWeight: FontWeight.w700,
      color: OrpheusColors.ivory,
    ),
    titleMedium: GoogleFonts.inter(
      fontSize: 16,
      fontWeight: FontWeight.w500,
      color: OrpheusColors.ivory,
    ),
    titleSmall: GoogleFonts.inter(
      fontSize: 14,
      fontWeight: FontWeight.w500,
      color: OrpheusColors.mist,
    ),

    // Body
    bodyLarge: GoogleFonts.inter(
      fontSize: 16,
      fontWeight: FontWeight.w400,
      color: OrpheusColors.ivory,
    ),
    bodyMedium: GoogleFonts.inter(
      fontSize: 14,
      fontWeight: FontWeight.w400,
      color: OrpheusColors.ivory,
    ),
    bodySmall: GoogleFonts.inter(
      fontSize: 12,
      fontWeight: FontWeight.w400,
      color: OrpheusColors.mist,
    ),

    // Labels
    labelLarge: GoogleFonts.inter(
      fontSize: 14,
      fontWeight: FontWeight.w500,
      color: OrpheusColors.ivory,
    ),
    labelMedium: GoogleFonts.inter(
      fontSize: 12,
      fontWeight: FontWeight.w500,
      color: OrpheusColors.mist,
    ),
    labelSmall: GoogleFonts.inter(
      fontSize: 10,
      fontWeight: FontWeight.w500,
      color: OrpheusColors.mist,
      letterSpacing: 1.5,
    ),
  );
}
