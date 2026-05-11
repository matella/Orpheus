import 'package:flutter/material.dart';
import '../config/theme.dart';

class FeedbackButtons extends StatelessWidget {
  final VoidCallback? onLike;
  final VoidCallback? onDislike;
  final VoidCallback? onSkip;

  const FeedbackButtons({
    super.key,
    this.onLike,
    this.onDislike,
    this.onSkip,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        // Dislike
        _FeedbackButton(
          icon: Icons.thumb_down_rounded,
          color: OrpheusColors.mist,
          activeColor: OrpheusColors.wineRed,
          size: 44,
          onTap: onDislike,
          semanticLabel: 'Dislike this track',
        ),

        // Skip forward (only shown if callback provided)
        if (onSkip != null) ...[
          const SizedBox(width: 32),
          _FeedbackButton(
            icon: Icons.skip_next_rounded,
            color: OrpheusColors.ivory,
            activeColor: OrpheusColors.ivory,
            size: 56,
            onTap: onSkip,
            semanticLabel: 'Skip to next track',
          ),
        ],

        const SizedBox(width: 32),

        // Like
        _FeedbackButton(
          icon: Icons.thumb_up_rounded,
          color: OrpheusColors.mist,
          activeColor: OrpheusColors.lyreGold,
          size: 44,
          onTap: onLike,
          semanticLabel: 'Like this track',
        ),
      ],
    );
  }
}

class _FeedbackButton extends StatefulWidget {
  final IconData icon;
  final Color color;
  final Color activeColor;
  final double size;
  final VoidCallback? onTap;
  final String semanticLabel;

  const _FeedbackButton({
    required this.icon,
    required this.color,
    required this.activeColor,
    required this.size,
    required this.semanticLabel,
    this.onTap,
  });

  @override
  State<_FeedbackButton> createState() => _FeedbackButtonState();
}

class _FeedbackButtonState extends State<_FeedbackButton>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _scaleAnimation;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      duration: const Duration(milliseconds: 150),
      vsync: this,
    );
    _scaleAnimation = Tween<double>(begin: 1.0, end: 0.9).animate(
      CurvedAnimation(parent: _controller, curve: Curves.easeInOut),
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _handleTap() {
    _controller.forward().then((_) {
      if (mounted) _controller.reverse();
    });
    widget.onTap?.call();
  }

  @override
  Widget build(BuildContext context) {
    final isEnabled = widget.onTap != null;

    return Semantics(
      button: true,
      label: widget.semanticLabel,
      enabled: isEnabled,
      child: Tooltip(
        message: widget.semanticLabel,
        child: ScaleTransition(
          scale: _scaleAnimation,
          child: GestureDetector(
            onTap: isEnabled ? _handleTap : null,
            child: Opacity(
              opacity: isEnabled ? 1.0 : 0.4,
              child: Container(
                width: widget.size,
                height: widget.size,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: OrpheusColors.onyx,
                  border: Border.all(
                    color: widget.color.withValues(alpha: 0.3),
                    width: 1.5,
                  ),
                ),
                child: Icon(
                  widget.icon,
                  color: widget.color,
                  size: widget.size * 0.45,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
