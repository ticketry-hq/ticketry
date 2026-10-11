# Rendered task workspace contract

Import `TaskWorkspace`, `TaskWorkspaceProps` and the launch-context types from
this feature's public entry. The selected-ticket shell adapter forwards the same
contract. Global key routing uses the separate `navigation` entry so startup
does not load the rendered workspace or its lazy viewers.

## Caller obligations

- Supply the bucket, project, module and foreground owner from authoritative
  selection. A task bucket is its work-item ID; scratch buckets retain the
  existing terminal adapter's identity convention.
- Supply Details content and optional launch context. Omitted launch context and
  conversation run/title default to `null`, and Details entry signal to `0`.
- Keep the rendered instance mounted across workspace/tab changes and
  configuration overlays. Do not key it by bucket or selected tab, or
  reconstruct sessions on entry.
- Set `workspaceActive` to `false` when another workspace or configuration
  surface owns presentation. It defaults to `true`; mounted lifetime does not
  grant foreground authority.
- Forward explicit conversation identity/title and Details entry signals.
  `modal` defaults to `false` and identifies issue-drawer hosting.
  `onBeforeFirstTab` retains the shell's existing navigation escape behavior.
- Use the public Details visibility context when composing content whose
  keyboard behavior depends on the Details surface being selected.

Callers must not resolve remembered targets, cancel restoration, reconcile run
tabs or sequence focus. Architecture lint prevents production callers from
importing the private implementation.

## Private responsibilities

The feature owns restoration request/generation refs, pending surface and
terminal focus, document hydration sequencing, pre-paint run reconciliation,
effective tab presentation, activation/close/reopen/resume actions and durable
target remembering. The implementation lives in focused private modules.

Existing document, terminal, navigation, workspace-ordering and persistence
adapters remain in use. Apollo owns application records and selection;
coordination refs hold transient intent only. Document viewers and terminal
hosts retain their mounted lifetimes, and existing run, terminal-record and
tmux identities pass through the terminal adapters unchanged. Changes continues
to open the independent review workspace.

CODING-2656 establishes this boundary while preserving baseline behavior.
The subsequent approved children own restoration intent/readiness corrections
(2657), async completion guards (2658), and foreground focus corrections plus
integrated desktop verification (2659). This extraction alone is not evidence
that those later race and desktop obligations are complete.

Configuration dismissal is a shell action; authorized terminal focus on
presentation return is coordinated privately by the feature. Its return intent
uses the same entry/explicit-intent guard and checks current navigation, editor
and presentation authority at the existing terminal adapter's focus boundary.
