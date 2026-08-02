# Frontend/backend synchronization library evaluation

Research date: 2026-08-02

## Executive conclusion

Ticketry should not adopt a full sync engine for the current problem. The closest
fit is:

1. Use **TanStack Query** as the single frontend cache for server-owned work-item
   data.
2. Keep one lightweight server-to-client stream whose messages mean only
   `work_item_changed(project_id, work_item_id)`.
3. On a message, invalidate the work-item detail and affected project-list query
   keys. On reconnect or window focus, invalidate/refetch all active work-item
   queries for the project.
4. Keep Zustand for client-owned UI/session state, not duplicate copies of
   server-owned work items.

This removes the need for `Project.state_revision`, `Issue.state_revision`, the
model-level revision allocator, per-store revision maps, pending state deltas,
and targeted stale-response retry logic, provided that a project-wide refetch on
reconnect is acceptable.

If the product requires resumable delivery of every message, use a persisted
event stream or transactional outbox. That persistence belongs to an event/outbox
row written alongside the domain change, not to generic fields and side effects
on `Issue.save()`.

## What Ticketry has today

Ticketry has a React/Tauri client, a supervised Django sidecar, and an embedded
SQLite database. Django Channels transports receive-only status frames through
an in-memory channel layer. The client then reconciles several Zustand copies of
the same work item and maintains custom cursors, revision guards, pending deltas,
retries, and reconnect behavior.

This is primarily a **server-state cache invalidation problem**, not yet a
multi-device, offline-write replication problem. A full local-first sync engine
would solve a larger problem by changing the database and deployment topology.

## Candidate comparison

| Candidate | What it handles | Fit with Django + embedded SQLite | Verdict |
|---|---|---|---|
| [TanStack Query](https://tanstack.com/query/latest/docs/framework/react/guides/query-invalidation) | Query caching, targeted invalidation, background refetch, mutation lifecycle, retries | High. It is a frontend library and can use the existing REST SDK and status stream. It does not provide transport or durable event delivery. | **Adopt.** Best match for removing duplicated Zustand server state and bespoke reconciliation. |
| [django-eventstream](https://github.com/fanout/django-eventstream#event-storage) | Django-native SSE, reconnecting clients, optional database-backed event recovery | Medium to high. It integrates with Django and can persist events for 24 hours; cross-process sending requires Redis or a GRIP proxy. | **Consider only if resumable event delivery is required.** It places recovery data at the message layer. |
| [Django Channels](https://channels.readthedocs.io/en/stable/topics/channel_layers.html) | WebSocket consumers and channel transport | Already present. Channels explicitly warns that its in-memory layer is for testing/local development and can lose cross-process messages. It is transport, not a synchronization/cache solution. | **Keep as a best-effort invalidation transport** for the single-process sidecar, or replace the receive-only socket with SSE. |
| [Zero](https://zero.rocicorp.dev/docs/when-to-use) | Query-driven client/server sync into a normalized local client store | Low for the current architecture. Zero currently requires PostgreSQL 15+ with logical replication and explicitly does not support offline writes. Its docs describe productivity apps like Linear as a target, but adopting it means replacing embedded SQLite as the server authority and running Zero infrastructure. | **Do not adopt now.** Re-evaluate only for a future Postgres-backed networked product. |
| [PowerSync](https://docs.powersync.com/architecture/client-architecture) | Managed client SQLite, live queries, offline writes, upload queue, server-to-client replication | Low today. The web SDK exists, but it requires a PowerSync Service connected to a supported source database and a custom backend `uploadData()` integration for writes. | **Do not adopt for this bug.** Credible future option if offline/multi-device sync becomes a product requirement. |
| [RxDB](https://rxdb.info/replication.html) | Local JavaScript database, live queries, offline-first replication and conflict handling | Medium technically, low strategically. It can replicate with any backend, but Ticketry must still implement pull/push handlers, checkpoints, deletion tombstones, and backend conflict responses. It also introduces a second client database. | **Do not adopt now.** It relocates rather than eliminates much of the custom server work. |
| [Replicache](https://doc.replicache.dev/byob/intro) | Optimistic local mutations, subscriptions, offline support | Low. Its bring-your-own-backend path is explicitly a guide to building the backend sync protocol, so it does not remove the custom backend responsibility Ticketry is trying to avoid. | **Do not adopt.** Zero is the vendor's more integrated direction, but still requires Postgres. |

## Recommended target design

### Frontend

Use stable query keys such as:

```ts
["work-item", workItemId]
["work-items", projectId, filters]
["children", parentId]
```

When the stream receives `work_item_changed`, call `invalidateQueries()` for the
detail and project-scoped list prefixes. TanStack Query marks them stale and
background-refetches active queries; this is its documented alternative to
manually maintaining a normalized cache.

Mutations should use TanStack Query's mutation lifecycle for optimistic updates
and rollback, then invalidate the affected keys after the server response. A
work-item record should no longer be independently owned by Backlog, Tasks, and
Issue-detail stores.

### Backend

For the current single-machine product, emit a coarse invalidation only after the
database transaction commits. Delivery may remain best effort because reconnect,
visibility change, and app resume perform a project-wide reconciliation.

If every change notification must survive a crash, write a durable event/outbox
record in the same transaction as the work-item change. A dispatcher can publish
it and retry. `django-eventstream` is a plausible Django/SSE implementation for
recoverable UI events, although its event persistence should still be verified
against Ticketry's exact transaction boundary before adoption.

Do not make generic `Issue.save()` responsible for cache synchronization. Legal
workflow transitions belong in an explicit transition service; cache invalidation
should be emitted from the committed application operation.

## Why full sync engines are not drop-in replacements

Zero and the principal Postgres sync engines observe PostgreSQL logical
replication. PowerSync adds a separate sync service and client-managed SQLite.
RxDB and Replicache can retain an arbitrary backend, but require Ticketry to
implement the backend replication contract. All are reasonable when offline
writes, multi-device collaboration, and partial replication are product
requirements. None is a small replacement for the current Django/SQLite status
feed.

## Sources

- [TanStack Query: Query Invalidation](https://tanstack.com/query/latest/docs/framework/react/guides/query-invalidation)
- [TanStack Query: Important Defaults](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults)
- [django-eventstream: event storage and reconnect recovery](https://github.com/fanout/django-eventstream#event-storage)
- [Django Channels: channel layers](https://channels.readthedocs.io/en/stable/topics/channel_layers.html)
- [Zero: when to use it](https://zero.rocicorp.dev/docs/when-to-use)
- [Zero: PostgreSQL requirements](https://zero.rocicorp.dev/docs/connecting-to-postgres)
- [PowerSync: client architecture](https://docs.powersync.com/architecture/client-architecture)
- [PowerSync: JavaScript Web SDK](https://docs.powersync.com/client-sdks/reference/javascript-web)
- [RxDB replication protocol](https://rxdb.info/replication.html)
- [Replicache: build your own backend](https://doc.replicache.dev/byob/intro)

