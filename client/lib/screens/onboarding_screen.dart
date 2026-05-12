import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../config/routes.dart';
import '../config/theme.dart';
import '../providers/dj_provider.dart';

class OnboardingScreen extends ConsumerStatefulWidget {
  const OnboardingScreen({super.key});

  @override
  ConsumerState<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends ConsumerState<OnboardingScreen> {
  int _step = 0;
  bool _isFinishing = false;

  String _appetite = 'comfort';
  String _chattiness = 'balanced';
  String _persona = 'curator';
  final _customPersonaController = TextEditingController();

  static const _appetiteOptions = [
    ('comfort', 'Comfort Zone', '65% familiar  •  25% similar  •  10% new'),
    ('balanced', 'Balanced', '50% familiar  •  35% similar  •  15% new'),
    ('adventurous', 'Adventurous', '40% familiar  •  30% similar  •  30% new'),
  ];

  static const _chattinessOptions = [
    ('silent', 'Silent', 'No commentary, ever. Pure music.'),
    ('minimal', 'Minimal', 'Only at session start or major shifts.'),
    ('balanced', 'Balanced', 'Every few transitions when there\'s something worth saying.'),
    ('chatty', 'Chatty', 'Full radio host energy. Comments most transitions.'),
  ];

  static const _personaOptions = [
    ('curator', 'The Curator', 'Thoughtful, musical connections, minimal commentary.'),
    ('late_night', 'Late Night Radio', 'Warm, intimate, NTS/college radio. Deep cuts only.'),
    ('hype', 'Hype DJ', 'Festival energy, builds momentum, talks often.'),
    ('chill', 'Chill Host', 'Barely speaks. Lets the music breathe.'),
  ];

  @override
  void dispose() {
    _customPersonaController.dispose();
    super.dispose();
  }

  Future<void> _finish() async {
    if (_isFinishing) return;
    setState(() => _isFinishing = true);
    final patch = <String, dynamic>{
      'discoveryAppetite': _appetite,
      'chattiness': _chattiness,
      'persona': _persona,
    };
    if (_persona == 'custom' && _customPersonaController.text.trim().isNotEmpty) {
      patch['customPersona'] = _customPersonaController.text.trim();
    }
    await ref.read(djProvider.notifier).updatePreferences(patch);
    await ref.read(djProvider.notifier).markOnboardingComplete();
    markOnboardingDone();
    if (mounted) context.go('/');
  }

  void _skip() => _finish();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: OrpheusColors.obsidian,
      body: SafeArea(
        child: Column(
          children: [
            _buildHeader(),
            Expanded(child: _buildStep()),
            _buildFooter(),
          ],
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 32, 24, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: List.generate(3, (i) => Expanded(
              child: Container(
                height: 3,
                margin: EdgeInsets.only(right: i < 2 ? 6 : 0),
                decoration: BoxDecoration(
                  color: i <= _step ? OrpheusColors.lyreGold : OrpheusColors.slate,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            )),
          ),
          const SizedBox(height: 24),
          Text(
            _stepTitle(),
            style: OrpheusTypography.displaySmall.copyWith(color: OrpheusColors.ivory),
          ),
          const SizedBox(height: 4),
          Text(_stepSubtitle(), style: OrpheusTypography.bodyMedium.copyWith(color: OrpheusColors.mist)),
        ],
      ),
    );
  }

  String _stepTitle() {
    switch (_step) {
      case 0: return 'How adventurous are you?';
      case 1: return 'How much should the DJ talk?';
      case 2: return 'Pick your DJ personality';
      default: return '';
    }
  }

  String _stepSubtitle() {
    switch (_step) {
      case 0: return 'Sets the balance between familiar and new music.';
      case 1: return 'Controls how often the DJ adds commentary between tracks.';
      case 2: return 'Each persona has a different curation style and voice.';
      default: return '';
    }
  }

  Widget _buildStep() {
    switch (_step) {
      case 0: return _buildAppetiteStep();
      case 1: return _buildChattinessStep();
      case 2: return _buildPersonaStep();
      default: return const SizedBox.shrink();
    }
  }

  Widget _buildAppetiteStep() {
    return ListView(
      padding: const EdgeInsets.symmetric(horizontal: 24),
      children: _appetiteOptions.map((opt) {
        final (value, label, ratioDesc) = opt;
        final selected = _appetite == value;
        return _OptionCard(
          selected: selected,
          onTap: () => setState(() => _appetite = value),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(child: Text(label, style: OrpheusTypography.labelLarge.copyWith(
                    color: selected ? OrpheusColors.lyreGold : OrpheusColors.ivory,
                  ))),
                  if (selected) const Icon(Icons.check_circle, color: OrpheusColors.lyreGold, size: 20),
                ],
              ),
              const SizedBox(height: 6),
              _RatioBar(appetite: value),
              const SizedBox(height: 4),
              Text(ratioDesc, style: OrpheusTypography.bodySmall.copyWith(color: OrpheusColors.mist)),
            ],
          ),
        );
      }).toList(),
    );
  }

  Widget _buildChattinessStep() {
    return ListView(
      padding: const EdgeInsets.symmetric(horizontal: 24),
      children: _chattinessOptions.map((opt) {
        final (value, label, desc) = opt;
        final selected = _chattiness == value;
        return _OptionCard(
          selected: selected,
          onTap: () => setState(() => _chattiness = value),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(label, style: OrpheusTypography.labelLarge.copyWith(
                      color: selected ? OrpheusColors.lyreGold : OrpheusColors.ivory,
                    )),
                    const SizedBox(height: 4),
                    Text(desc, style: OrpheusTypography.bodySmall.copyWith(color: OrpheusColors.mist)),
                  ],
                ),
              ),
              if (selected) const Icon(Icons.check_circle, color: OrpheusColors.lyreGold, size: 20),
            ],
          ),
        );
      }).toList(),
    );
  }

  Widget _buildPersonaStep() {
    return ListView(
      padding: const EdgeInsets.symmetric(horizontal: 24),
      children: [
        ..._personaOptions.map((opt) {
          final (value, label, desc) = opt;
          final selected = _persona == value;
          return _OptionCard(
            selected: selected,
            onTap: () => setState(() => _persona = value),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(label, style: OrpheusTypography.labelLarge.copyWith(
                        color: selected ? OrpheusColors.lyreGold : OrpheusColors.ivory,
                      )),
                      const SizedBox(height: 4),
                      Text(desc, style: OrpheusTypography.bodySmall.copyWith(color: OrpheusColors.mist)),
                    ],
                  ),
                ),
                if (selected) const Icon(Icons.check_circle, color: OrpheusColors.lyreGold, size: 20),
              ],
            ),
          );
        }),
        _OptionCard(
          selected: _persona == 'custom',
          onTap: () => setState(() => _persona = 'custom'),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(child: Text('Custom', style: OrpheusTypography.labelLarge.copyWith(
                    color: _persona == 'custom' ? OrpheusColors.lyreGold : OrpheusColors.ivory,
                  ))),
                  if (_persona == 'custom') const Icon(Icons.check_circle, color: OrpheusColors.lyreGold, size: 20),
                ],
              ),
              if (_persona == 'custom') ...[
                const SizedBox(height: 10),
                TextField(
                  controller: _customPersonaController,
                  maxLength: 500,
                  maxLines: 4,
                  style: OrpheusTypography.bodySmall.copyWith(color: OrpheusColors.ivory),
                  decoration: InputDecoration(
                    hintText: 'Describe your DJ\'s personality, style, and curation taste…',
                    hintStyle: OrpheusTypography.bodySmall.copyWith(color: OrpheusColors.mist),
                    filled: true,
                    fillColor: OrpheusColors.obsidian,
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(8),
                      borderSide: const BorderSide(color: OrpheusColors.slate),
                    ),
                    counterStyle: OrpheusTypography.bodySmall.copyWith(color: OrpheusColors.mist),
                  ),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildFooter() {
    final isLast = _step == 2;
    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
      child: Column(
        children: [
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              onPressed: isLast
                  ? (_isFinishing ? null : _finish)
                  : () => setState(() => _step++),
              style: FilledButton.styleFrom(
                backgroundColor: OrpheusColors.lyreGold,
                foregroundColor: OrpheusColors.obsidian,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
              ),
              child: Text(isLast ? 'Start listening' : 'Continue',
                  style: OrpheusTypography.labelLarge.copyWith(color: OrpheusColors.obsidian)),
            ),
          ),
          const SizedBox(height: 8),
          TextButton(
            onPressed: _skip,
            child: Text('Use defaults', style: OrpheusTypography.bodySmall.copyWith(color: OrpheusColors.mist)),
          ),
        ],
      ),
    );
  }
}

class _OptionCard extends StatelessWidget {
  final bool selected;
  final VoidCallback onTap;
  final Widget child;

  const _OptionCard({required this.selected, required this.onTap, required this.child});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: OrpheusColors.onyx,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: selected ? OrpheusColors.lyreGold : OrpheusColors.slate,
            width: selected ? 1.5 : 1,
          ),
        ),
        child: child,
      ),
    );
  }
}

class _RatioBar extends StatelessWidget {
  final String appetite;

  const _RatioBar({required this.appetite});

  @override
  Widget build(BuildContext context) {
    final ratios = switch (appetite) {
      'comfort' => (0.65, 0.25, 0.10),
      'balanced' => (0.50, 0.35, 0.15),
      'adventurous' => (0.40, 0.30, 0.30),
      _ => (0.65, 0.25, 0.10),
    };

    return Row(
      children: [
        Expanded(flex: (ratios.$1 * 100).round(), child: Container(height: 6, color: const Color(0xFF4A7C59))),
        const SizedBox(width: 2),
        Expanded(flex: (ratios.$2 * 100).round(), child: Container(height: 6, color: const Color(0xFF4A6C9C))),
        const SizedBox(width: 2),
        Expanded(flex: (ratios.$3 * 100).round(), child: Container(height: 6, color: const Color(0xFF8B4A9C))),
      ],
    );
  }
}
