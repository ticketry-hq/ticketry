# CODING-1550 implementation specification

Story: Serve the WorkTracker MCP over a data-directory socket with a stdio bridge instead of a loopback port.

Work item: `e1bc51e9-4139-4322-b225-cddfaaffd243`. Specification date: 2026-09-07.

## Problem statement

A running agent loses its WorkTracker connection when Ticketry quits or crashes. Its tmux session survives, but its MCP configuration points at the old process's TCP port. Restarting Ticketry can select a different port. Port conflicts can also prevent agent launches altogether.

Users need an existing agent to regain WorkTracker access after the desktop returns without restarting the agent, replacing its terminal session, or losing its conversation. This is a robustness change. Startup optimization belongs to separate work.

## Solution

Ticketry listens on a stable Unix socket inside its data directory. Each provider launches the packaged ticketry-hook executable as its stdio MCP server using a new mcp subcommand. That bridge stays alive with the agent, reconnects when Ticketry returns, and rebuilds the server connection's initialization state.

While Ticketry is unavailable, requests receive a JSON-RPC error promptly. The bridge keeps its stdio pipes open and retries the socket connection in the background. It never queues or automatically replays tool calls.

## User stories

1. As a user running Claude, I want WorkTracker configured through a packaged stdio command so my run does not depend on a TCP port.
2. As a user running Codex, I want the same connection behavior without changing my interactive CLI or conversation ownership.
3. As a user running Gemini, I want the same authenticated WorkTracker tools through stdio.
4. As an agent, I want to list tasks and update permitted workflow states through the existing tool contracts.
5. As a user, I want to quit and reopen Ticketry while my agent remains in tmux and have subsequent tool calls work.
6. As a user, I want recovery after SIGKILL without manually deleting a stale socket.
7. As an agent, I want a prompt, correlated error during an outage so I can decide whether to retry.
8. As a user, I want an interrupted write left unreplayed so reconnection cannot duplicate its effects.
9. As a user, I want several agents to reconnect independently with their original run identities.
10. As a user, I want run credentials, permitted tools, workflow gates, and scope checks enforced after every reconnect.
11. As a user, I want invalid, missing, expired, or foreign run credentials rejected without receiving global authority.
12. As a developer, I want separate data directories to isolate development and packaged MCP listeners.
13. As a developer, I want occupied ports 8123 through 8132 to have no effect on MCP readiness or provider launches.
14. As a user, I want lifecycle hooks to keep delivering through their existing filesystem spool.
15. As a maintainer, I want the packaged bridge, its help command, and all provider configurations verified in release artifacts.
16. As a user, I want startup readiness and durable terminal restoration to retain their current behavior.

## Implementation decisions

### Listener and ownership

- Replace the MCP TCP listener with a Tokio Unix listener and rmcp's generic asynchronous stream transport. Socket messages use newline-delimited UTF-8 JSON, without HTTP or SSE framing.
- Derive the absolute socket pathname by appending mcp.sock to the selected data directory. Pass the selected directory explicitly to the bridge. Do not discover another installation or fall back to TCP.
- Acquire the existing exclusive data-directory ownership guard before binding or removing a stale socket. Apply the same ownership requirement to the development adapter. A second owner must fail without disturbing the first listener.
- Inspect the existing entry without following symlinks. Never remove a regular file, directory, or symlink occupying the socket pathname. With ownership held, refuse to unlink a socket that still accepts connections; unlink a confirmed stale socket and bind the replacement. Permission errors are failures, not evidence of staleness.
- Restrict socket access to the current user. Validate Unix socket pathname length and report an actionable startup error for an unsupported path; never silently relocate it outside the data directory.
- Stop accepting, cancel connection tasks, close the listener, and remove only the socket created by this runtime before releasing ownership on orderly shutdown. Crash recovery uses the same guarded startup path.
- Preserve the preparing-screen ordering and mcp-listener-started trace event. Publish ready only through the existing reconciliation and readiness gates. A genuine socket startup failure remains a visible service failure.

### Authentication and protocol boundary

- Use a private, versioned first-line authentication envelope on the socket, before MCP initialization. It carries the claimed agent run ID and the existing bearer authorization value. The listener consumes it; it never reaches the provider's stdout or rmcp JSON-RPC decoder.
- Give the envelope a bounded size and read deadline. Invalid framing or missing credentials cannot enter a run-bound session. Return a private handshake rejection that the bridge translates into a correlated protocol error when a provider request is available.
- Bind credentials to each connection, not shared mutable service state. Resolve the run through the existing persistent RunAuthority and compare its identity with the claimed run. Tool dispatch continues to authorize each operation through RunAuthority, including its existing special handling for termination of an inactive run.
- Preserve expiry, allowed-operation checks, work-item/project scope, workflow permission checks, and readiness checks. Do not persist a principal that bypasses later authorization checks. Reconnection must neither mint a replacement grant nor extend expiry.
- The existing unauthenticated global-tool behavior is separate from provider run authority. If retained for local tooling, represent it explicitly as a global connection mode and preserve its existing restrictions. A malformed or credential-less provider handshake must never fall back to that mode.
- No database migration or WorkTracker GraphQL contract change is expected. Reuse the persistent grant store. The current 24-hour grant lifetime remains a limit on recovery.

### Bridge lifecycle and request handling

- Add mcp and mcp --help to ticketry-hook. The invocation accepts an absolute data directory and agent run ID. Deliver the bearer value through the provider MCP server environment as TICKETRY_MCP_AUTHORIZATION. Keep secrets out of command arguments, diagnostic output, and durable launch descriptions.
- Build ticketry-hook as a Cargo binary using existing workspace JSON and asynchronous I/O dependencies. Keep command dispatch, existing spool handling, and bridge connection handling in focused private modules. This selects the proposal's Cargo option because request parsing, response correlation, and initialization replay require more than a byte pump.
- The bridge has disconnected, initializing, and ready states. It retries connection failures with exponential backoff starting at 100 ms and capped at one second. Successful initialization resets the backoff. No retry limit expires an otherwise live provider stdio session.
- The first provider initialize request is forwarded once a connection is available, with a bounded connection attempt. If unavailable, answer with JSON-RPC error -32001 and data identifying service_unavailable; keep stdin open so a later initialize can retry. Do not fabricate server capabilities while offline.
- Cache the successfully negotiated initialize parameters and the initialized notification. On reconnect, authenticate again, send initialize with a bridge-private correlation ID, validate the negotiated protocol and required capabilities, then send initialized before forwarding new calls. Consume the internal handshake responses rather than exposing a duplicate initialize response to the provider.
- If a restarted server cannot satisfy the existing negotiated session, return a clear session-incompatible error for subsequent calls. Do not pretend the connection is ready or silently negotiate a different provider session.
- During disconnect or reinitialization, reject new requests with the original JSON-RPC ID and -32001 within one second under an unloaded acceptance fixture. Notifications receive no JSON-RPC response. Never queue tools/call for later delivery.
- Track outstanding forwarded request IDs. On connection loss, settle each outstanding request once with an error indicating that the execution outcome may be unknown. Never replay it, including reads. Ignore stale responses from an old connection generation and isolate internal handshake IDs from provider IDs.
- Correctly handle concurrent calls, string and numeric IDs, fragmented input, multiple messages per read, cancellation notifications, and bounded message sizes. Reuse the installed protocol/JSON facilities rather than implementing a JSON parser. Preserve ordinary rmcp responses without rewriting tool results.
- EOF on provider stdin or a broken provider stdout ends the bridge and cancels retries. Desktop loss alone does not end it. Only protocol messages go to stdout; diagnostics go to stderr without tokens or full authentication envelopes.

### Launch and runtime integration

- ExecutionAuthority and terminal launch authority carry the socket location and bearer value instead of an MCP URL. Reuse the resolved packaged hook-runner executable. Materialize provider command, argument array, and environment values through each provider's native stdio MCP configuration.
- Keep the worktracker-agent server name. Remove HTTP URL, HTTP header, and HTTP transport fields from Claude, Codex, and Gemini configurations. Preserve unrelated provider options, trust settings where applicable, hooks, and required skill delivery. Cover Agy's shared Gemini configuration path so it does not retain a stale URL.
- Update every authority producer and consumer, including desktop launch setup, terminal launch readiness, and the supporting GraphQL development adapter. Shell launch remains usable according to existing shell policy.
- Preserve Agent Run, provider session, and Terminal Session identities and tmux ownership. The resident Codex app-server remains its existing read-only helper; it does not become the MCP bridge or take over the CLI conversation.
- Update development and release hook builds, binary embedding/staging, target handling, release inspection, and tests together. Preserve the executable name and hook subcommand interface. Do not commit generated binaries or caches.

### Remove obsolete ingress and configuration

- Repository inspection finds no production callers of the lifecycle POST ingress. Remove that route and its transport-only tests while retaining lifecycle services and spool behavior.
- The listener also contains workspace launch-path and terminal-launch HTTP adapters. The repository search finds route definitions and tests, but no production HTTP callers. Remove these obsolete transport adapters with the TCP router; retain the in-process launch services and test their behavior through existing service callers. Recheck callers when implementing to account for concurrent work.
- Remove MCP port scanning, port-range constants, development port overrides, URL logging, and MCP port guidance from developer documentation and scripts. The browser GraphQL adapter may retain its separate browser-serving transport; it must use the same data-directory MCP socket contract.
- Keep crate dependency direction and root-only public exports. Update public API boundary contract tests for deliberate export changes. This work adds no product REST API, tool operation, or replacement model CRUD.

## Testing decisions

Tests assert observable protocol results and durable identities, not private state-machine layout. The primary boundary is a real bridge subprocess connected to an MCP runtime using an isolated temporary data directory. Extend existing MCP acceptance fixtures and persistent-authority fixtures; use launch-plan golden tests for provider serialization and desktop smoke tests for actual packaging and tmux behavior.

1. For Claude, Codex, and Gemini, inspect a packaged launch's stdio command, arguments, and secret environment, then successfully call list_tasks and a legal update_task_status on disposable work items. Include paths with spaces and escaping. Cover Agy's shared serialization path in golden tests.
2. Keep one bridge process and stdio connection alive, shut down its server cleanly, verify a correlated outage error, restart on the same directory, and successfully call again with the original credential. Repeat using a killed server process and its stale socket.
3. Verify multiple simultaneous requests, a disconnect with an outstanding write, and a subsequent recovery. Observe one terminal response per request and no automatically duplicated write. Exercise fragmented frames and initialization replay without duplicate initialization output.
4. Verify wrong, missing, expired, foreign-run, and disallowed-tool credentials; retained global-client behavior if applicable; and termination's existing authorization semantics. Repeat authorization checks after reopening the persistent grant store.
5. Verify that a live owner is not displaced, stale sockets recover, non-socket entries remain untouched, separate directories operate concurrently, socket permissions are private, and too-long paths fail explicitly.
6. Bind ports 8123 through 8132 before desktop launch. Verify ready health and normal provider launch with no MCP TCP bind attempts.
7. In packaged desktop smoke tests, quit and relaunch Ticketry during a tmux run, then repeat with SIGKILL. Wait for normal readiness and verify the same agent's next call succeeds with unchanged run, tmux session, and provider conversation identities.
8. Check bridge shutdown on provider EOF, missing executable/configuration diagnostics, token redaction, and hook spool regression coverage. Inspect the release bundle and run the embedded executable's mcp --help.
9. Run cargo test -p ticketry-mcp -p ticketry-launch -p ticketry-desktop from the Rust workspace, plus the bridge binary tests, affected terminal tests, root MCP acceptance tests, public API boundary tests, and affected build-script tests.
10. Compare repeated startup traces using npm run logs:startup against the same-machine baseline. Retain mcp-listener-started behind the preparing screen and investigate any repeatable stage regression rather than asserting identical noisy timings. Keep startup overhead within the existing listener budget.
11. Add or update the Studio acceptance case covering visible readiness and launch/restoration behavior, keep the numbered overhaul gate current, and run npm run test:overhaul --workspace @worktracker/studio before implementation handoff.

## Out of scope

- Implementation tickets during Spec.
- New or renamed MCP tools, changes to WorkTracker semantics, or changes to GraphQL model contracts.
- Replacing the lifecycle hook spool, tmux, terminal renderers, or provider conversation ownership.
- Queueing requests across an outage, automatic tool retries, or exactly-once execution guarantees.
- Credential refresh or extension of the existing grant lifetime.
- Remote MCP access, a TCP compatibility listener, or a new Windows named-pipe transport.
- Startup speed improvements or migration of an already running agent whose configuration predates the stdio bridge.

## Further notes

Restart continuity applies to runs launched with the new bridge, while their credentials remain valid and the same data directory remains available. An interrupted write can have committed before its response was lost; the agent must inspect state before deciding to retry.

The repository currently has substantial unrelated work in progress. Implementation must recheck the affected runtime contracts and preserve those changes. This specification changes no application code.

The requested Spec-to-Tickets workflow is the readiness handoff. The available WorkTracker MCP tools expose no triage-label mutation, so ready-for-agent is not applied as a tracker label. No substitute workflow or implementation tickets are created.

## Socket handshake contract (implemented by CODING-1557)

The listener at `<data-dir>/mcp.sock` speaks newline-delimited UTF-8 JSON. The
first line on every connection is the authentication envelope; the listener
consumes it and answers with exactly one JSON line before any JSON-RPC flows.

Envelope, one of:

```json
{"ticketry_mcp_auth":1,"mode":"run","agent_run_id":"<run id>","authorization":"Bearer <token>"}
{"ticketry_mcp_auth":1,"mode":"global"}
```

Verdict:

```json
{"ticketry_mcp_auth":1,"ok":true}
{"ticketry_mcp_auth":1,"ok":false,"error":"<error>","reason":"<reason>"}
```

After `ok:true` the stream carries ordinary MCP JSON-RPC lines, starting with
the client's `initialize`. After `ok:false` the listener closes the connection.
The envelope is limited to 8 KiB and must arrive within five seconds. Framing
reasons are `handshake_missing`, `handshake_too_large`, `handshake_timeout`,
`handshake_malformed`, `handshake_unsupported_version`, `handshake_mode_unknown`
and `handshake_run_missing`; credential reasons are the existing
`RunAuthority` reasons (`authorization_missing`, `authorization_malformed`,
`authorization_invalid`, `authorization_expired`, `authorization_foreign_run`,
`caller_run_unknown`). A run connection is admitted for an ended run so that
`terminate_current_run` stays reachable; every other tool call is refused with
`caller_run_inactive` by per-call authorization. Every tool call is authorized
again through `RunAuthority` with the connection's bearer value; the global
mode keeps its existing restrictions and is never a fallback for a malformed
run envelope.
