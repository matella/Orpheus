import 'package:flutter/material.dart';
import 'package:cached_network_image/cached_network_image.dart';
import '../config/theme.dart';

class NowPlayingCard extends StatelessWidget {
  final String trackName;
  final String artistName;
  final String albumName;
  final String? albumArtUrl;
  final bool isPlaying;

  const NowPlayingCard({
    super.key,
    required this.trackName,
    required this.artistName,
    required this.albumName,
    required this.albumArtUrl,
    required this.isPlaying,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        color: OrpheusColors.onyx,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: OrpheusColors.lyreGold.withValues(alpha: isPlaying ? 0.3 : 0.1),
          width: 1,
        ),
        boxShadow: isPlaying
            ? [
                BoxShadow(
                  color: OrpheusColors.lyreGold.withValues(alpha: 0.08),
                  blurRadius: 24,
                  spreadRadius: 2,
                ),
              ]
            : null,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Album art
          ClipRRect(
            borderRadius: const BorderRadius.vertical(top: Radius.circular(15)),
            child: AspectRatio(
              aspectRatio: 1,
              child: albumArtUrl != null
                  ? CachedNetworkImage(
                      imageUrl: albumArtUrl!,
                      fit: BoxFit.cover,
                      placeholder: (context, url) => Container(
                        color: OrpheusColors.charcoal,
                        child: const Center(
                          child: Icon(
                            Icons.music_note_rounded,
                            size: 64,
                            color: OrpheusColors.slate,
                          ),
                        ),
                      ),
                      errorWidget: (context, url, error) => _albumArtPlaceholder(),
                    )
                  : _albumArtPlaceholder(),
            ),
          ),

          // Track info
          Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  trackName,
                  style: Theme.of(context).textTheme.titleLarge,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 4),
                Text(
                  artistName,
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: OrpheusColors.mist,
                      ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                if (albumName.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(
                    albumName,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: OrpheusColors.slate,
                        ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _albumArtPlaceholder() {
    return Container(
      color: OrpheusColors.charcoal,
      child: const Center(
        child: Icon(
          Icons.music_note_rounded,
          size: 64,
          color: OrpheusColors.slate,
        ),
      ),
    );
  }
}
