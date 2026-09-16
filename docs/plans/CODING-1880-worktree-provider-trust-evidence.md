# CODING-1880 worktree provider trust evidence

## Installed providers

Read-only version checks on 2026-09-16 reported:

- Codex CLI `0.154.0`
- Claude Code `2.1.270`
- Gemini CLI `0.59.0`

## Integration seam

Worktree creation and recovery keep the existing durable Git path. The
`worktree_create` mutation creates, adopts, or replays the checkout and returns
its authoritative status. Provider trust runs afterward against that returned
canonical worktree directory through the same desktop directory-trust command
used by Module setup. A refusal or provider failure therefore leaves the
checkout row, branch, path, Worktree identity, and creation operation intact.
Status recovery inspects the recorded worktree path without writing and offers
trust setup separately, so retry does not create another checkout.

The desktop command delegates Codex, Claude, and Gemini inspection and writes
to `ticketry-provider`. That contract owns config overrides, canonical identity,
denial handling, coordinated rereads, atomic replacement, and idempotent retry.
No launch or title-reader path grants trust.

## Checks run

- `cargo test -p ticketry-provider` passed. This covers the three-provider
  contract plus Codex, Claude, and Gemini directory-trust behavior, including
  overrides, approval binding, preservation, denial, busy writers, malformed
  state, canonical paths, atomic writes, and retry.
- `cargo test -p ticketry-launch --test it worktree_launch_trust -- --nocapture`
  passed. Its disposable Gemini state proves an unattended Worktree launch
  reports approval required without writing, succeeds after explicit setup,
  and lets a child reuse the same trusted checkout.
- `cargo test --test worktree_creation` passed all 16 cases, including retry
  after a post-creation provider failure preserving the same row, path, branch,
  operation, and fact.
- The focused Studio rerun passed 27 tests across Worktree creation, directory
  trust, numbered-gate coverage, and description autosave.
- The full Studio overhaul gate was run. The CODING-1880 cases pass; three
  pre-existing Changes-layout cases remain failing (`overhaul-271` through
  `overhaul-273`). They do not touch this implementation's files.

## Installed-provider check still required

No disposable Codex or Claude credential was available. The required bounded
interactive proof remains unfulfilled for both the Module directory and an
external Worktree: demonstrate the fresh trust gate, prepare approved trust,
consume a unique workflow-prompt marker without a trust dialog, then repeat in
a fresh process to prove persistence. Print mode or a startup authentication
failure does not satisfy this check. Live provider state was not read or
changed.
