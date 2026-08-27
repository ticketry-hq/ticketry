# Ticketry desktop agent acceptance

Run the frontend-to-agent proof from the repository root:

```sh
npm run test:e2e:desktop --workspace @worktracker/studio
```

The command builds a debug Tauri application with the test-only embedded
WebDriver feature, then drives Ticketry's visible React UI inside its macOS
WKWebView. It does not need a running Vite development server.

The scenario starts from a fresh temporary installation, completes provider
onboarding, creates a module and Story, and clicks **Run agent**. The click
enters the production Tauri command and real Rust launch authority, terminal,
MCP, hook-spool, lifecycle, and reconciliation services. Ticketry starts a real
child process in an isolated private tmux server.

The child is a disposable `codex`-compatible executable created under the test
directory. It answers `--version`, prints deterministic output, reports normal
hooks through the packaged hook runner, moves the Story through Implement,
Review, and Done over Ticketry's MCP boundary, and exits with a fixed success
code. It never invokes Codex, another paid provider, or a network model API.

The UI observes the active run, terminal activity, every state move, and the
completed run. The suite reloads the webview, restarts the Rust process over the
same isolated data directory, and verifies that Done and the completed terminal
remain visible. Success and failure both stop the app and private tmux server;
success removes the temporary profile and database.

On failure the temporary directory is retained and its path is printed. Its
`artifacts/` directory contains a screenshot, DOM and frontend diagnostics,
Rust stdout/stderr, private tmux inventory and pane output, and disposable
provider evidence. Direct macOS WKWebView automation cannot produce a
Playwright trace; the browser-only suite retains Playwright tracing for its own
seam.

Prerequisites are macOS, Node.js, Rust/Tauri build dependencies, and tmux.
`TICKETRY_DESKTOP_ACCEPTANCE_TMUX` may point to a nonstandard tmux executable.
The embedded WebDriver is enabled only by the Rust `desktop-acceptance` feature
and is absent from production builds. The harness exposes no REST service,
database API, or unrestricted shell endpoint.

For browser compatibility and GraphQL behavior, run instead:

```sh
npm run test:e2e --workspace @worktracker/studio
```

That Playwright suite intentionally expects agent launch to be unavailable in
browser mode and must not be cited as agent-execution proof.
