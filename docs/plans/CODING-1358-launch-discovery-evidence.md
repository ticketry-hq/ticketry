# CODING-1358 launch-discovery evidence

Parent story: CODING-1348

## Trace contract

The launch-discovery record follows one Agent Run through these stages:

1. `launch-transaction-committed`
2. `wake-up-published`
3. `wake-up-received`
4. `durable-event-reread`
5. `graphql-frame-delivered` and `graphql-frame-received`
6. `apollo-run-applied` or `apollo-event-applied`
7. `workspace-render-committed`

Each record has an ISO timestamp, project ID, Agent Run ID, cursor, connection
generation, renderer instance, and runtime instance. A stage that cannot know a
field writes `null` rather than omitting it. Backend wake-up records also carry
the in-memory wake-up authority ID. Durable rereads classify their path as
`wake_up`, `safety_reread`, `post_handshake`, or `durable_backlog`.

## Root cause

Each `RunsServices::new` call creates a new `StatusWakeup` broadcast channel.
`TerminalLaunchService` owns one `RunsServices` instance, while GraphQL schema
composition creates another for `StatusStreamService`. A launch therefore
publishes on the terminal service's channel and the project subscription waits
on the schema's channel. The durable outbox remains correct. The subscriber
finds the launch on its 1,000 ms safety reread unless another publisher using
the schema-owned channel happens to wake it first.

The diagnostic capture proves this when `wake-up-published.wakeupAuthority`
differs from the authority on `wake-up-received` and
`durable-event-reread`, and the reread reports `safety_reread`.

No product correction was applied in CODING-1358.

## CODING-1359 implementation decision

Share one live wake-up authority between launch publication and status-stream
receipt. The correlated authority IDs differed, and no `wake-up-received`
record occurred for the caught-up launches. The authoritative status payload
and Apollo upsert are not the first fault because no wake-up reached the
listener. Duplicate subscription ownership is also unproven: only one backend
listener registered, and React Strict Mode's duplicate setup accepted one
generation. Keep the 1,000 ms durable reread as recovery for a lost wake-up.

## Measurements

The pre-tracer capture in `.ticketry-dev/logs/ticketry.log` established these
facts:

- Six launch transactions committed in 2 to 3 ms.
- Four launches committed before subscription readiness appeared in the first
  replacement snapshot. That replacement connected and applied its snapshot in
  88 ms. The newest recovered run reached the workspace 9,014 ms after its
  original start because the sample crossed the runtime restart.
- One connected launch reached the backend reader after 243 ms, hit the
  frontend's `unknown_run` path, waited for the 250 ms resync debounce, and
  appeared in the workspace after 512 ms.
- A second connected launch reached two live readers after 69 ms and 275 ms,
  but the old trace did not record its workspace render.

The instance-aware caught-up baseline launched the same selected workspace task
three times after the frontend emitted `caught-up` at cursor 295:

| Agent Run | Commit to reread | Commit to render | Delivery |
| --- | ---: | ---: | --- |
| `5919f708812f94b16436873ab1590374` | 850 ms | 4,112 ms | `safety_reread` |
| `5248dabf9a5f94c1ef2a47354e1778ff` | 367 ms | 867 ms | `safety_reread` |
| `b8b0a48aaff52ef96ce01fa2f3cc67b4` | 413 ms | 770 ms | `safety_reread` |

Median commit-to-render latency was **867 ms**; the slowest was **4,112 ms**.
The first sample included the unknown-run replacement-snapshot path and a
slower workspace commit. All three publisher records used wake-up authority
`3b3c124b42cc4a9fb8cba2f860f90d8a`; all three subscription rereads used
`fdeaba286e07405bb6e1b16535bc86c5`. No `wake-up-received` record occurred for
those launches.

## Paired subscription evidence

The old capture contains 18 consecutive duplicate cursor-range reads. The two
readers are separated by 155 to 214 ms, with a 206 ms median. Paired
generation-1 frontend starts can also occur during React Strict Mode's
development setup, cleanup, and second setup because each feed closure starts
its generation counter at zero. Later generations 3, 5, and 7 are replacement
connections created by the reconnect path.

The old records cannot distinguish renderer and runtime ownership. The new
trace does. Equal renderer and runtime IDs mean duplicate forwarding or two
subscriptions in one renderer. Different renderer IDs with one runtime ID mean
two renderer instances. Different runtime IDs mean two backend runtimes.

The clean restart emitted two generation-1 `subscription-started` records 3 ms
apart with renderer `b90b9ab7-7d68-4669-965f-ab843691928a` and runtime
`081b83e3177343bda8ffb793752fad74`. Only one generation was accepted and only
one backend listener registered before the snapshot and caught-up frames. This
pair is duplicate frontend setup/forwarding in one renderer, consistent with
the Strict Mode setup cycle; it is not evidence of two renderer or runtime
instances. The first restart snapshot at cursor 295 contained the six Agent
Runs committed before readiness, proving restart recovery through the first
snapshot.

## Launch identity inventory

User-visible actions that return and consume an Agent Run identity:

- Run now
- Task workspace Agent launch
- Prompted scratch and Instant launch
- New Instant conversation
- Resume terminal or conversation

Actions that rely on status discovery:

- Details-pane Run agent. The desktop and browser calls return an identity,
  but the frontend wrapper discards it and returns `Promise<void>`.
- Workflow transition auto-start
- Run subtree and Run serially
- Retry failed automated launch
- Prepare merge. GraphQL returns an identity, but the frontend transport
  discards the payload.

The MCP `launch_default_coding_agent` and `run_now` tools return an Agent Run
ID. `execute_dependency_graph` returns launched task IDs. A status update that
triggers auto-start returns only the updated task.

Module shell creation returns and consumes a run-shaped ID, but it is not an
Agent Run because it has no provider and does not participate in agent status.
