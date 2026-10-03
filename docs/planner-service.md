# Planner service in Ticketry

Ticketry starts one in-process planner listener after installing its authoritative GraphQL endpoint. It uses the same installed endpoint as Studio's native transport. Ticketry resolves and owns the data directory, including a configured non-default directory; the planner does not open another database.

No Roadmap refresh or server command is required. This service never calls Roadmap's migration, provenance, receipt or snapshot replacement code. Its reads and guarded writes use Ticketry's current schema and planning operations. Roadmap's legacy frontend operations are not a compatible client contract.

The listener binds `127.0.0.1` on an available port. Set `TICKETRY_PLANNER_PORT` to request a specific port. An invalid value or occupied port fails startup with a diagnostic in the existing service-health gate and application log. The service does not silently choose another port when a configured port is unavailable.

The local `desktop_runtime_configuration` command publishes `plannerEndpoint` only while services are ready:

```ts
interface PlannerEndpoint {
  graphqlUrl: string;
  bearerToken: string;
}
```

The desktop runtime's `plannerEndpoint()` method re-reads that configuration, so a renderer opened during background startup can obtain the ready instance later. A request uses `POST`, `Content-Type: application/json` and `Authorization: Bearer <bearerToken>`. Browser access admits Ticketry's packaged webview origins and the exact configured development origin. Desktop composition resolves `MUXED_DESKTOP_ORIGIN` supplied by the launcher, or Tauri's configured development URL when the variable is absent, and validates an HTTP origin on `127.0.0.1` with a nonzero TCP port before starting the listener. The launcher selects a free port or honors `MUXED_FRONTEND_PORT`; for example, `http://127.0.0.1:5176` admits only that renderer port, not other localhost browser origins. Packaged builds without a development URL need no development origin. The supporting browser adapter resolves `MUXED_DESKTOP_ORIGIN`, or `MUXED_FRONTEND_PORT` with default 5174. `PlannerService::start` takes an optional validated `PlannerFrontendOrigin`; callers outside desktop composition must supply their own origin explicitly. The listener checks its exact loopback Host. Credentials change on restart, remain in memory, and are redacted in debug output.

The adapted Studio planning features retain their existing Apollo client and native GraphQL transport. Both transports execute the same installed schema; this change adds no second frontend state owner or compatibility resolver.

Startup retains the listener in Ticketry's managed service state. A later startup failure rolls it back. Normal exit stops acceptance and joins all admitted requests before the data-directory guard is released. Unexpected listener termination uses the existing service-health publisher.

Verification:

```sh
cargo test --offline --manifest-path studio/src-tauri/Cargo.toml -p ticketry-planner
npm run test:planner:desktop --workspace @worktracker/studio
```

The Rust integration test uses Ticketry's production adoption, installation, directory ownership and command-readiness gate on an isolated profile. It creates projects, Stories, sprints and goals across the native and HTTP transports, observes assignments and edits from both, restarts, and checks persistence and the absence of planner copies or Roadmap provenance. Lifecycle cases cover readiness, credentials, browser access, bind conflicts, request draining and port release.

The desktop case starts the actual Ticketry process and WKWebView on a temporary non-default profile. It performs native GraphQL writes and browser HTTP reads/writes, closes the window through the normal desktop lifecycle, restarts, and confirms persistence. It also starts with an occupied configured port and checks the published failure. Its acceptance build uses Ticketry's supported xterm fallback to avoid requiring the unrelated native terminal library; shipping features are unchanged. Pass `-- --skip-build` to use an existing `desktop-acceptance` binary, or set `TICKETRY_DESKTOP_ACCEPTANCE_BINARY` to its path.
