---
status: accepted
amends: 0005-model-shaped-crud-with-quarantined-rpc
---

# One DRF HTTP surface and one generated HTTP contract

All Ticketry HTTP routes move to Django REST Framework, and every one of those
routes enters the canonical OpenAPI document and both generated SDKs.
`django-ninja` is retired after the migration. Channels consumers and their
WebSocket wire contracts remain unchanged because this decision concerns the
HTTP surface, not every transport in the sidecar.

ADR 0005 kept Ninja for the application routes on the premise that their tmux,
watcher, subprocess, and Channels work required async HTTP handlers. The audit
in
`spec/onboarding--d12896d1/T144--worktracker-api-model-shaped-crud-fixed/ninja-vs-drf-audit.md`
found no correctness requirement for that split. Of the 35 remaining routes,
9 are already synchronous, 10 hand synchronous terminal work to
`asyncio.to_thread`, 9 use async ORM calls over individual settings rows, 4
perform filesystem work, and 3 publish through Channels. The repository already
bridges Channels publication from synchronous code. DRF's lack of async views
is therefore an implementation and capacity consideration, not a reason to
retain a second HTTP framework.

Model-shaped resources continue to use DRF viewsets and model-derived
serializers under the rules in ADR 0005. A resource operation that coordinates
domain behavior is still represented as a resource-oriented DRF view, but the
view remains a thin transport adapter: it validates input, makes one call to a
public application service, serializes the result, and maps declared failures.
The service owns coordination, persistence, external effects, and compensation,
and delegates its individual tasks to focused functions. Serializers,
middleware, model signals, and DRF save hooks do not become hidden process
orchestrators.

Terminal creation is the representative case. Creating a terminal-run resource
delegates to the existing control-plane/session service, which resolves launch
configuration, prepares the prompt and provider command, persists the run,
creates and records the tmux session, starts the provider, compensates partial
failure, and publishes lifecycle state. The DRF migration replaces its HTTP
adapter; it does not duplicate that workflow in a view or serializer. Other
terminal lifecycle and viewer-lease operations follow the same resource-view
over service pattern. The packaged single-user sidecar may execute synchronous
tmux work on Django's ASGI handling of sync DRF views; a custom worker pool is
not part of this decision and requires evidence of contention before it is
introduced.

The current exporter deliberately includes only the WorkTracker URLConf. The
migration expands the canonical OpenAPI input to the complete Ticketry HTTP
surface. Migrated routes receive explicit request, response, error, and
authentication schemas; Studio uses generated operations where practical, and
the TypeScript and Python SDKs are regenerated together. This is an intentional
contract expansion. WebSocket frames remain governed by their existing wire
contract rather than OpenAPI.

The route registry and its two-way conformance test remain the durable surface
guard, but the Ninja exception allowlist disappears with the final migrated
route. The Ninja API aggregator, schemas used only by Ninja, packaging metadata,
and the `django-ninja` dependency are then removed. Migration work must preserve
observable behavior, update callers for any deliberately resource-shaped route
changes, and validate terminal concurrency and failure compensation before the
old surface is deleted.

This ADR amends only ADR 0005's framework split and Ninja exception lane. ADR
0005's model-shaped WorkTracker CRUD, five named domain operations, serializer
rules, canonical reads, route registry, catalog models, and stated service
changes remain accepted.
