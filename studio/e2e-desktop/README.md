# Ticketry desktop agent acceptance

Run the frontend-to-agent proof from the repository root:

```sh
npm run test:e2e:desktop --workspace @worktracker/studio
```

The command builds a debug Tauri application with the test-only embedded
WebDriver feature, then drives Ticketry's visible React UI inside its macOS
WKWebView. It does not need a running Vite development server.

The run starts from a fresh temporary installation, completes provider
onboarding, and creates a module and Story.

It then proves the Story description seam in WebKit before anything is running
(CODING-1528): it clicks the description, types into the rich Markdown editor
through real key events rather than a scripted value, clicks **Save**, switches
to a second Story and saves a different description there, reloads the webview,
and requires each Story to show its own authoritative description — the text
the server returned, not a surviving local draft. The rich editor must be the
path taken; falling back to the Markdown source textarea fails the scenario.
The Chromium suite keeps its own Save and Cancel coverage unchanged.

The run then clicks **Run agent**. The click
enters the production Tauri command and real Rust launch authority, terminal,
MCP, hook-spool, lifecycle, and reconciliation services. Ticketry starts a real
child process in an isolated private tmux server.

The child is a disposable `codex`-compatible executable created under the test
directory. It answers `--version`, prints deterministic output, reports normal
hooks through the packaged hook runner, moves the Story through Implement,
Review, and Done over Ticketry's MCP boundary, and exits with a fixed success
code. It never invokes Codex, another paid provider, or a network model API.

The UI observes the active run, task and module lifecycle indicators, terminal
activity, every state move, and the completed run. It also verifies that the
module aggregate clears after completion. The suite reloads the webview,
restarts the Rust process over the same isolated data directory, and verifies
that Done and the completed terminal remain visible. Success, failure, and
interruption stop the app and private tmux server and remove the temporary
profile and database.

The harness holds ports 8123 through 8132 from before desktop startup through
provider execution. It requires ready health and the MCP socket in the isolated
data directory, checks that the disposable provider receives the packaged stdio
bridge command with non-empty launch authority, and observes the provider move
the Story through that Ticketry instance.

On failure, diagnostics are copied to the ignored `studio/test-results/`
directory before the isolated runtime directory is removed. They include a
screenshot, DOM and frontend diagnostics, Rust stdout/stderr, private tmux
inventory and pane output, and disposable provider evidence. Direct macOS
WKWebView automation cannot produce a Playwright trace; the browser-only suite
retains Playwright tracing for its own seam.

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
