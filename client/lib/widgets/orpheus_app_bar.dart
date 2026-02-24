import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../config/theme.dart';

class OrpheusAppBar extends StatelessWidget implements PreferredSizeWidget {
  final String? title;
  final List<Widget>? actions;

  const OrpheusAppBar({
    super.key,
    this.title,
    this.actions,
  });

  @override
  Size get preferredSize => const Size.fromHeight(kToolbarHeight);

  @override
  Widget build(BuildContext context) {
    return AppBar(
      backgroundColor: OrpheusColors.charcoal,
      title: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(
            Icons.music_note_rounded,
            color: OrpheusColors.lyreGold,
            size: 20,
          ),
          const SizedBox(width: 8),
          Text(
            title ?? 'ORPHEUS',
            style: GoogleFonts.cinzel(
              fontSize: 18,
              fontWeight: FontWeight.w400,
              color: OrpheusColors.lyreGold,
              letterSpacing: 4,
            ),
          ),
        ],
      ),
      centerTitle: true,
      elevation: 0,
      actions: actions,
    );
  }
}
