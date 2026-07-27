# Desktop executable and tmux policy

Muxed Studio's initial desktop target is macOS (11 or newer, x86_64 and Apple
Silicon). Windows is not a supported target because the terminal runtime
requires tmux.

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
