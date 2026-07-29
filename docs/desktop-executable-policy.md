# Desktop executable and tmux policy

Ticketry's initial desktop target is macOS 11 or newer on arm64 (Apple silicon)
only. Windows, Linux, and Intel macOS are not supported targets.

tmux is a prerequisite, not a bundled executable. macOS does not ship it, so
the preflight directs users to install it with Homebrew (`brew install tmux`) or
to approve a compatible absolute path. A future supported Linux target follows
the same prerequisite policy through its distribution package manager.

The desktop discovers tools without shell startup files. A user may approve an
absolute path only for `tmux`, `claude`, `agy`, `codex`, or `gemini`; Rust checks
the name, executable bit, architecture, and version before atomically saving it
as `approved-executables.json` under the established application data directory.
Invalid entries are never written. At packaged launch, Rust passes only resolved
paths to the backend, which uses them for tmux and agent processes instead of
the interactive-shell PATH. Updating an approval takes effect on the next
desktop launch.

The application also bundles its own `ticketry-hook` executable. It is not a
user-approved tool and is never selected from `PATH`: Tauri resolves the
application-owned absolute path and passes it to the backend. Agent hook
commands use that small native executable to atomically write lifecycle events
to a private per-installation temp spool, which the backend drains. This keeps
packaged hooks compatible with provider command sandboxes without granting
those sandboxes loopback network access or re-entering the one-file Python
sidecar.

The initial distributed application is an unsigned, unnotarized developer
build whose bundle is ad-hoc signed for integrity verification. The executable
discovery and approval checks above do not imply that Ticketry or its bundled
executables have a Developer ID signature or have passed Apple notarization.
Recipients must follow the unsigned-build quarantine instructions in
`studio/release/OPERATIONS.md`.
