# Stable Optional WorkTracker MCP on Port 8123

## Problem Statement

Ticketry already owns the WorkTracker MCP service that coding agents use to read and change project work, but an external client cannot rely on a stable desktop endpoint if the service chooses a different free port. A client configured once should be able to reach the running Ticketry project at port 8123 without rediscovering an ephemeral endpoint.

The MCP service is an auxiliary integration surface, not a prerequisite for using Ticketry. If another process already owns port 8123, Ticketry must preserve that process, skip its own external MCP service, and continue starting the desktop application and primary backend normally. A collision must never cause Ticketry to take over the port, move the public MCP endpoint silently, or make the desktop unusable.

## Solution

Ticketry will optionally host its existing WorkTracker MCP service at the stable loopback endpoint `http://127.0.0.1:8123/mcp` as part of the desktop-owned sidecar lifecycle. At startup, Ticketry will attempt to reserve exactly port 8123. When the port is available, the supervisor will start the MCP service there, verify that it accepts an MCP initialization request, expose that exact URL to newly launched coding agents, and supervise the service until Ticketry shuts down.

When port 8123 cannot be reserved, Ticketry will not search for or advertise a replacement port. It will record the MCP capability as unavailable, continue bringing up the primary backend and desktop, and show a non-blocking explanation with a restart-based recovery path. Ticketry will never terminate, replace, or otherwise disturb the process that already owns the port.

## User Stories

1. As a Ticketry user, I want the WorkTracker MCP endpoint to remain `http://127.0.0.1:8123/mcp`, so that I can configure an external client once.
2. As a Ticketry user, I want the MCP service to start automatically with the desktop when port 8123 is free, so that external task submission is available without a separate service command.
3. As an external MCP client on the same machine, I want to connect to the normal WorkTracker MCP tool surface at port 8123, so that I can inspect the project and feed it work.
4. As a coding-agent operator, I want agents launched after Ticketry starts to receive the active stable MCP URL, so that their WorkTracker tools target the desktop-owned project.
5. As a Ticketry user, I want the desktop and its primary backend to start when port 8123 is occupied, so that an optional integration cannot block core application use.
6. As the owner of the process already using port 8123, I want Ticketry to leave that process untouched, so that starting Ticketry cannot disrupt another application.
7. As an external MCP client, I do not want Ticketry to move the endpoint to 8124 or another free port, so that a successful connection can never target an undisclosed address.
8. As a Ticketry user, I want a concise warning when the external MCP service was skipped, so that I understand why my external client cannot connect while the desktop still works.
9. As a Ticketry user, I want the warning to identify the 8123 collision and tell me to free the port and restart Ticketry, so that recovery is actionable.
10. As a Ticketry user, I want an MCP initialization failure after bind to degrade only the MCP capability, so that a faulty optional service does not take down the primary backend.
11. As a Ticketry user, I want Ticketry to supervise an MCP process that it started, so that unexpected exits are observable and bounded recovery can occur within the desktop lifecycle.
12. As a Ticketry user, I want quitting Ticketry to stop and reap only the MCP child process owned by that Ticketry instance, so that no managed process leaks and unrelated processes remain safe.
13. As a developer, I want desktop development to exercise the same stable-port and optional-collision policy as the packaged application, so that local validation predicts production behavior.
14. As a developer, I want explicit test overrides to remain available for isolated automated tests, so that tests can avoid machine-specific port conflicts without changing the production endpoint contract.
15. As a developer running multiple worktrees, I want at most one instance to own the stable external MCP port while all instances can still run their primary application services, so that stable endpoint ownership is deterministic.
16. As a security-conscious user, I want the external MCP listener bound to loopback, so that making the endpoint stable does not expose WorkTracker tools to the network by default.
17. As a support engineer, I want startup and supervisor events to distinguish backend failures from optional MCP failures, so that diagnostics describe the degraded capability accurately.
18. As a maintainer, I want the existing WorkTracker MCP tools and contracts reused unchanged, so that endpoint stability does not create a second MCP product or divergent tool surface.

## Implementation Decisions

- The existing WorkTracker MCP service remains the only MCP tool implementation. The feature changes how the desktop launches and exposes that service; it does not fork or duplicate its tools.
- The Tauri shell's existing sidecar supervisor owns the MCP process alongside the primary Python backend. The packaged multi-call sidecar starts in its MCP mode rather than introducing a separately installed executable or user-managed daemon.
- The public endpoint is exactly `http://127.0.0.1:8123/mcp`. The host remains loopback-only and the FastMCP HTTP transport remains the external protocol.
- Port 8123 is a fixed capability address, not the beginning of a candidate range. Production startup attempts only 8123 and never falls forward to 8124, an ephemeral port, a persisted historical port, or any other replacement.
- MCP startup is optional while backend startup remains required. Failure to reserve 8123, spawn the MCP mode, or complete MCP readiness records an MCP-specific failure and leaves the successfully started backend running.
- Port reservation happens before the MCP child is spawned. An address-in-use or permission failure is treated as capability unavailability; Ticketry does not kill, signal, probe for ownership of, or attach to the process occupying the address.
- A successful spawn is not sufficient for readiness. The supervisor sends a bounded MCP initialization request to `/mcp` and marks the service ready only after a valid response. Probe time and response size remain bounded so startup cannot hang on an arbitrary listener.
- The primary backend receives `WORKTRACKER_MCP_URL` only when the supervisor has reserved an MCP endpoint for this launch. The injected value uses the fixed URL, allowing newly launched coding agents to connect to the same desktop-owned service.
- The supervisor continues to own health observation, bounded restart behavior, logging, and shutdown for both child services. It may stop and reap only child handles it created.
- If recovery cannot reclaim port 8123, the application returns to the same degraded MCP-unavailable condition; recovery must not roll over to another port.
- The desktop's serving/ready condition depends on the primary backend, not on the optional MCP child. MCP readiness enriches capability but does not gate application readiness.
- The UI surfaces one deduplicated warning for an MCP startup incident. It states that Ticketry is running, that port 8123 is unavailable, and that the user can free the port and restart Ticketry. The acknowledgement continues without MCP; it does not retry destructively or hide a backend failure.
- Desktop development uses the same fixed optional endpoint policy. Its startup identity reports the MCP URL only when that service is selected to run; it does not describe a shifted port as the stable external endpoint.
- Development-only explicit port overrides may be retained for automated isolation and smoke tests, but an explicit MCP port is still singular: if unavailable, the optional MCP service is skipped rather than shifted. These overrides do not alter the packaged port-8123 contract.
- Browser-only development commands remain supporting tools rather than a separate product. Where they launch the external MCP surface, they preserve the same fixed endpoint semantics instead of introducing endpoint discovery behavior.
- No database migration, WorkTracker schema change, MCP tool contract change, generated SDK change, or Tauri/webview command is required.
- Documentation identifies the fixed loopback URL, explains that MCP is optional, describes port-collision behavior, and distinguishes normal desktop development from supporting browser-only commands.

## Testing Decisions

A good test observes the application-owned service lifecycle rather than private selection helpers: given a real TCP port condition and the real supervisor contract, it asserts whether the primary backend becomes ready, whether the MCP endpoint initializes at the promised address, which service events are emitted, and which owned processes are reaped. Assertions should avoid process implementation details beyond the externally visible endpoint, readiness, diagnostics, and ownership guarantees.

The highest test seam is the existing desktop supervisor contract with its packaged-service command stub. No new production seam is required. The test may inject candidate ports and short timing bounds, while production configuration pins the one public port.

- Extend the supervisor contract to reserve a test port representing 8123, launch the backend/MCP pair, perform the existing MCP initialization probe, and assert that the backend receives the exact MCP URL and both owned children shut down.
- Hold the configured MCP port with a real loopback listener, launch the supervisor with MCP optional, and assert that backend readiness succeeds, no MCP child is running, the occupying listener remains usable, and an MCP bind-failure event is emitted.
- Configure an occupied MCP port followed by an otherwise free candidate and assert that the production-facing configuration never tries the second port. This pins the no-rollover guarantee at the application configuration seam.
- Exercise an MCP child that binds but fails readiness or exits during initialization and assert that the backend remains available and the incident is attributed to MCP.
- Exercise an unexpected MCP exit and bounded recovery, asserting that recovery retries the pinned endpoint only and degrades without changing URLs when it cannot reclaim the port.
- Exercise desktop shutdown in both full-service and degraded modes, asserting that all and only supervisor-owned children are stopped and reaped.
- Extend the Tauri application lifecycle tests to assert that backend-only readiness is sufficient when MCP is optional and that MCP failure produces the non-blocking external-MCP warning rather than a fatal backend health state.
- Extend the rendered notice test to assert the port-8123 explanation, the continue-without-MCP acknowledgement, deduplication, and restart recovery wording.
- Extend desktop development launcher tests to assert a stable default of 8123, no search of subsequent MCP ports after a collision, preservation of explicit single-port test overrides, and accurate startup identity output in both enabled and skipped cases.
- Preserve the existing FastMCP registration and tool-surface tests as prior art for proving that the hosted endpoint exposes the established WorkTracker tools unchanged.

## Out of Scope

- Binding the MCP service to non-loopback interfaces or making it reachable from other machines.
- Adding TLS, reverse proxying, tunneling, firewall configuration, or remote-host deployment.
- Reclaiming port 8123 by terminating or replacing the process that owns it.
- Selecting a fallback port, advertising endpoint discovery, persisting a dynamic endpoint, or reconnecting clients to a changed port.
- Building a second MCP implementation or changing the existing WorkTracker MCP tools, schemas, or semantics.
- Making the MCP service mandatory for Ticketry startup or disabling the primary backend when MCP is unavailable.
- Adding implementation tickets during this specification stage.

## Further Notes

- “External” in this specification means a separate local client process connecting to Ticketry's loopback endpoint. Network exposure requires a separate security and deployment decision.
- Only one concurrently running Ticketry instance can own the stable port. Other instances intentionally continue without their own external MCP service.
- The selected behavioral seam matches the requirement directly: start Ticketry once with the configured port free and once with it occupied, and observe the application and endpoint outcomes at the desktop supervisor boundary.
