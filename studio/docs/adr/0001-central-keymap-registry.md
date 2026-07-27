# Central keymap registry with contextual actions

Studio's shortcuts were handled by four independent listeners (global keymap, capture-phase live-terminal cycle, capture-phase workspace-tab arbitration, modal-local keys), each hard-coding its chords. To make every binding user-configurable (#1313) we route all keyboard resolution through one central keymap registry: an action is identified by (keymap context, action id), the fixed precedence is modal → capture → focused pane → global, and each surface registers its actions instead of matching raw events. We rejected both a fully flat global chord namespace (Enter/Esc legitimately mean different things per context) and per-surface configurable listeners (no single place to detect duplicates, render the legend, or record bindings).

## Consequences

- Chords are stored as modifiers + layout-aware `event.key`; only user overrides persist, host-level in the backend settings store, so defaults evolve with the app.
- The reserved-chord set is runtime-dependent (browser build vs desktop app), so binding validation must know its host runtime.
