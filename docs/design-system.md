# Shared design foundation

Light is the first-visit default; a saved explicit theme wins on later visits. Browser storage failure must not prevent switching themes. Keep the existing theme storage key so returning users retain their choice.

`src/styles/tokens.css` owns semantic colours. Layout and controls consume `--bg`, `--card`, `--border`, `--text`, `--muted`, `--accent` and `--accent-text`. The sidebar has independent dark tokens in both themes. Use emerald on controls and highlights, not large background areas.

Use dark text on emerald buttons and darker emerald for light-background text. Never rely on colour alone for status: pair text and icons. Validate final component contrast and chart series in the phase that introduces those components; unused primitives are not finished features.

Shared spacing is based on 4px increments. Cards use 12px radii; controls use 8px. Controls have at least 44px targets where practical. Every form needs visible labels, inline errors and keyboard focus. Future tables need horizontal overflow, dialogs need labelled headings and proper focus management, dropdowns need keyboard interaction, and charts need text alternatives.

The existing workspace navigation supports a mobile drawer, Escape, focus containment, return focus and a skip link. Full browser accessibility and responsive verification remains part of the release test plan.
