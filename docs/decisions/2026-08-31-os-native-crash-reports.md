# OS-native crash reports instead of an embedded minidump handler

**Date:** 2026-08-31
**Origin:** ticket #1349, grilled before entering Spec

Ticketry must produce evidence when the desktop application dies hard (abort,
segfault, native renderer crash, panic-abort). We decided **not** to embed a
crash-time dump handler (crashpad/minidumper). Instead, Ticketry writes a
dirty-shutdown marker at startup, attributes panic-aborts through a panic hook,
and on the next launch collects the crash report the operating system already
wrote (macOS `.ips` in `~/Library/Logs/DiagnosticReports`) into its own
crash-report folder.

## Considered options

- **Embedded minidump handler (crashpad/minidumper).** Rejected: an
  out-of-process handler is heavy machinery, and minidumps contain raw process
  memory (work-item text, prompts, tokens), which forces a redaction and
  consent story. OS reports are thread backtraces, not memory dumps.
- **Both.** Rejected as scope without evidence of need.

## Consequences

- Crash evidence quality depends on the OS reporter. `kill -9` and disabled OS
  reporting yield only the dirty-shutdown marker; the collected report is then
  explicitly marked "no native report found".
- Reports stay local for manual export; there is no upload service and no
  consent flow.
- Symbolication relies on defaults: macOS symbolicates system frames, and the
  release binary's retained symbol table names Ticketry frames (function
  names, no line numbers). No dSYM archive is kept per release.
