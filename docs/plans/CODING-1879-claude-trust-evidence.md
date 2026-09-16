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
