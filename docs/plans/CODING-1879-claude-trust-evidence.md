# CODING-1879 Claude directory trust evidence

## Verified contract

- Tested Claude Code: `2.1.270 (Claude Code)`, native arm64 build at `/Users/karthik/.local/share/claude/versions/2.1.270`.
- Anthropic documents that interactive first-directory trust is skipped by `-p`, and that trust accepted for the home directory is session-only and cannot be persisted: <https://code.claude.com/docs/en/security>.
- Anthropic documents `~/.claude.json` as Claude-owned global application state and `CLAUDE_CONFIG_DIR` as the relocation for Claude configuration: <https://code.claude.com/docs/en/claude-directory>.
- With no override, 2.1.270 reads `$HOME/.claude.json`. With an absolute `CLAUDE_CONFIG_DIR=/tmp/config`, it reads `/tmp/config/.claude.json` and creates backups below `/tmp/config/backups/`.
- The verified 2.1.270 trust record is `projects[canonical_repository_root_or_directory].hasTrustDialogAccepted: true`. In a Git checkout the key is the canonical repository root; outside one it is the canonical working directory.
- Missing and boolean `false` both mean approval is required. `false` is Claude's default untrusted project shape, not evidence of a durable refusal. After directory-and-provider-bound approval, Claude's own `setPathTrustedDurably` behavior merges the existing project object and changes only this field to `true`.
- A non-boolean value, malformed root or projects object, relative project key, unsupported version, symlinked state file, non-absolute config override, or home-directory target is unsupported by this adapter and must not be written.

## Coordination and preservation

Installed 2.1.270 coordinates state writers with a `proper-lockfile` directory at `<global-state-path>.lock`, rereads JSON while holding that lock, merges the selected project record, and replaces the state atomically with mode `0600`. Ticketry joins the same lock namespace, rereads and validates under the lock, compares the bytes again before replacement, writes a synced same-directory mode-`0600` temporary file, syncs the parent directory, and removes a failed temporary file. A live or stale lock is reported as busy rather than removed speculatively.

Contract tests use only disposable state and cover preservation of OAuth-shaped data, preferences, other projects and project fields; missing/false trust; malformed and unrecognized state; canonical repository keys; approval binding; concurrent reread; busy coordination; symlink refusal; config override; exact version gating; home-directory refusal; owner-only output; cleanup; and idempotent retry.

## Disposable interactive transcript

The disposable installed-provider probe established the gate without reading or changing live Claude state:

```text
$ CLAUDE_CONFIG_DIR=<tmp>/config claude --version
2.1.270 (Claude Code)

$ CLAUDE_CONFIG_DIR=<tmp>/config claude --worktree evidence
Workspace trust not yet accepted. Run `claude` once in this directory and accept the trust dialog, then retry with --worktree.

# The same refusal occurred with a missing record and with
# hasTrustDialogAccepted: false.

# After the approved adapter wrote true:
$ CLAUDE_CONFIG_DIR=<tmp>/config claude --worktree evidence
# The trust refusal disappeared and Claude created the worktree before
# reaching network/authentication startup.
```

An interactive fresh-process workflow-prompt run was attempted with the disposable configuration. Claude reached first-run login selection, but no disposable `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, or `ANTHROPIC_AUTH_TOKEN` is available. No live credentials or OAuth state were copied. Therefore authenticated prompt consumption and the second-process durability transcript remain unverified; a network/authentication failure is not counted as success.

To finish that check without touching live state, provide a disposable credential and run two TTY sessions from the same prepared directory, with distinct exact reply markers and no `-p` flag. Both transcripts must contain the requested marker and no trust dialog.

## Claude Code 2.1.278 verification, 2026-09-20

The installed native executable reported `2.1.278 (Claude Code)`. Ticketry now
accepts that exact version in addition to 2.1.270 and 2.1.276. No other versions
were added. The regression first failed on 2.1.278 before the allowlist change;
afterward all 25 provider tests passed. Both 2.1.271 and the unverified 2.1.279
remain rejected by inspection and preparation without creating a state file.

Live checks used a disposable Git repository with an empty commit, an external
`git worktree add` checkout, and a fresh `CLAUDE_CONFIG_DIR`. No live Claude
configuration or credentials were copied. Each Claude invocation had a PTY,
used `--safe-mode --strict-mcp-config`, and omitted `--print`. Automatic updates
were disabled. Safe mode did not bypass trust: the negative controls displayed
the trust gate. Probe processes were terminated after collecting startup output.

Observed results:

- With no trust record, `claude --worktree missing` refused to create a worktree:
  `Workspace trust not yet accepted. Run ... and accept the trust dialog ...`.
- Direct interactive startup in the untrusted external checkout displayed
  `Accessing workspace` and `Yes, I trust this folder`.
- With `hasTrustDialogAccepted: false`, direct startup displayed that same trust
  dialog in both the primary repository and external checkout.
- The compiled `active_config_override_version_and_home_limit_are_enforced`
  test's child-process path invoked the real provider adapter with
  `TICKETRY_CLAUDE_TRUST_CASE=supported_latest`, the installed executable, the
  disposable directory, and `CLAUDE_CONFIG_DIR`. Inspection returned an approval
  and preparation persisted it using the production adapter.
- Two fresh interactive processes in each approved directory skipped the trust
  dialog, displayed their supplied prompt, and reached `Not logged in · Please
  run /login`. The canonical directory key and
  `projects[key].hasTrustDialogAccepted: true` therefore remain compatible and
  durable across process restarts for both checkout types.
- In the approved primary repository, `claude --worktree approved` created its
  checkout and reached the same login requirement.

Claude's own `--worktree` option, when invoked from the external checkout,
resolved creation back to the primary repository. It was therefore not used as
evidence for the external directory's trust. Those checks launched directly in
the external checkout instead.

This verifies local trust persistence and worktree startup for 2.1.278. It does
**not** verify an authenticated model response or completion of a workflow
prompt: the isolated configuration was not logged in. That broader launch
acceptance requirement remains outstanding, as in the original evidence above.

Studio acceptance case 327 covers recovery from the reported version error:
retry keeps the existing checkout, requests Claude approval, and does not issue
another worktree-create mutation.
