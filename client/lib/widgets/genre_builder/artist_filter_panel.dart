import 'package:flutter/material.dart';
import '../../config/theme.dart';
import '../../models/genre_builder_models.dart';

/// Result artists with exclusion checkboxes + search to force-include an artist.
class ArtistFilterPanel extends StatefulWidget {
  final List<PreviewArtist> artists;
  final Set<String> excluded;
  final Map<String, String> forced;
  final ValueChanged<String> onToggleExcluded;
  final Future<List<PreviewArtist>> Function(String query) onSearch;
  final ValueChanged<PreviewArtist> onForce;
  final ValueChanged<String> onRemoveForced;

  const ArtistFilterPanel({
    super.key,
    required this.artists,
    required this.excluded,
    required this.forced,
    required this.onToggleExcluded,
    required this.onSearch,
    required this.onForce,
    required this.onRemoveForced,
  });

  @override
  State<ArtistFilterPanel> createState() => _ArtistFilterPanelState();
}

class _ArtistFilterPanelState extends State<ArtistFilterPanel> {
  static const _collapsedCount = 12;
  bool _showAll = false;

  @override
  Widget build(BuildContext context) {
    final visible = _showAll ? widget.artists : widget.artists.take(_collapsedCount).toList();
    final small = Theme.of(context).textTheme.bodySmall;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Autocomplete<PreviewArtist>(
          displayStringForOption: (a) => a.name,
          optionsBuilder: (value) => widget.onSearch(value.text),
          onSelected: widget.onForce,
          fieldViewBuilder: (context, controller, focusNode, onSubmit) => TextField(
            controller: controller,
            focusNode: focusNode,
            decoration: const InputDecoration(
              isDense: true,
              prefixIcon: Icon(Icons.push_pin_outlined, size: 18),
              hintText: 'Force-add an artist…',
            ),
          ),
        ),
        if (widget.forced.isNotEmpty) ...[
          const SizedBox(height: 8),
          Wrap(
            spacing: 6,
            children: [
              for (final e in widget.forced.entries)
                InputChip(
                  avatar: const Icon(Icons.push_pin, size: 14, color: OrpheusColors.lyreGold),
                  label: Text(e.value),
                  onDeleted: () => widget.onRemoveForced(e.key),
                ),
            ],
          ),
        ],
        const SizedBox(height: 8),
        for (final a in visible)
          CheckboxListTile(
            dense: true,
            contentPadding: EdgeInsets.zero,
            controlAffinity: ListTileControlAffinity.leading,
            value: !widget.excluded.contains(a.artistId),
            onChanged: (_) => widget.onToggleExcluded(a.artistId),
            title: Text(a.name, maxLines: 1, overflow: TextOverflow.ellipsis),
            secondary: Text('${a.trackCount}', style: small?.copyWith(color: OrpheusColors.mist)),
          ),
        if (widget.artists.length > _collapsedCount)
          TextButton(
            onPressed: () => setState(() => _showAll = !_showAll),
            child: Text(_showAll ? 'Show fewer' : 'Show all ${widget.artists.length} artists'),
          ),
      ],
    );
  }
}
