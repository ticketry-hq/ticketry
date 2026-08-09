# Audit — can the remaining Ninja lane move to DRF?

**Date:** 2026-08-05
**Question asked:** what is the behaviour of the Ninja code versus the DRF code,
and can we actually replace everything that is left on Ninja — or is there a real
gap?

**Short answer:** there is no correctness gap. **Nothing in the remaining Ninja
lane is async by necessity.** The ADR's stated reason for keeping two lanes is
only half true, and the half that is true has an existing sync counterpart
already running in production in this repo.

***

## 1. What is left on Ninja

35 routes: 32 declared in `backend/worktracker/ninja_route_allowlist.txt`
("deliberately remain on Ninja") plus 3 `graph-run` routes that are
registry-declared as a `GraphRun` model (`worktracker/registry.py`) but
Ninja-implemented in `apps/execution/api.py`.

| Category                                | Routes | What the handler actually does                                     |
| --------------------------------------- | -----: | ------------------------------------------------------------------ |
| **A — already synchronous**             |      9 | plain `def`. No async anything.                                    |
| **B — async wrapping synchronous work** |     10 | `await asyncio.to_thread(<blocking tmux call>)`                    |
| **C — async ORM only**                  |      9 | Django's async ORM (`aupdate_or_create`) over single settings rows |
| **D — blocking IO inside `async def`**  |      4 | synchronous `Path(...)` / directory scans inside an async handler  |
| **E — genuinely async**                 |      3 | async ORM plus a channels `group_send` fan-out                     |

### A — already synchronous (9)

Nothing to port. These are sync Ninja handlers today.

* `GET /api/healthz` — `studio_server/api.py:31-32`
* `POST /api/automation-attempts/{attempt_id}/retry` — `apps/runs/api.py:36`
* `GET /api/worktrees`, `POST /api/worktrees/{task_id}/create`,
  `POST /api/worktrees/{task_id}/discard` — `apps/worktrees/api.py:175,197,243`
  (7 sync `def`s in the file, 0 async)
* `POST /api/work-items/{issue_id}/launch-agent` — `apps/execution/api.py:131`
* `GET|POST|DELETE /api/work-items/{issue_id}/graph-run` —
  `apps/execution/api.py:73,89,116` (6 sync `def`s in the file, 0 async)

`apps/worktrees/api.py` and `apps/execution/api.py` contain **zero async
handlers**, despite being named in ADR 0005 as part of the async lane that
justifies keeping Ninja.

### B — async wrapping synchronous work (10, all terminals)

Every terminal route follows the same shape:

```python
lease = await asyncio.to_thread(viewer_leases.acquire, …)   # api.py:88
await asyncio.to_thread(terminal_session.reconcile)          # api.py:226
sessions = await asyncio.to_thread(terminal_session.sessions_for, task_id)
runs = await asyncio.to_thread(_load_resumable_runs)          # api.py:319
```

The tmux work (`libtmux`, session reconcile, viewer leases) **is synchronous
code**. `asyncio.to_thread` exists here to keep the ASGI event loop free while
that sync call blocks — it is a thread hand-off, not concurrency the handler
needs. A sync DRF view does the same blocking call directly on the worker
thread. That is a throughput/pool-sizing consideration, **not a correctness
blocker**, and it is the only category where the trade-off is real.

### C — async ORM only (9, all settings\_store)

`apps/settings_store/dao.py:10-27` is async purely because Django offers an
async ORM API:

```python
async def get_setting(scope, key):
    return await AppSetting.objects.filter(scope=scope, key=key).values_list(…)
async def upsert_setting(…):
    await AppSetting.objects.aupdate_or_create(…)
```

Single-row reads and writes against one `AppSetting` table. There is no
concurrency being exploited. `apps/settings_store/api.py:80` already breaks the
async chain itself with `await sync_to_async(validate_global_launch_default)(…)`.
These are the cheapest possible ports.

### D — blocking IO inside `async def` (4, documents)

`apps/documents/service.py` declares `async def` and then performs
**synchronous** filesystem work inside it:

```python
async def _prune_missing_documents(rows):
    target = Path(row.root_dir) / row.rel_path      # service.py:81  blocking
async def _rescan_roots(…):
    for rel_path in design_docs.scan_documents(Path(root)):   # :109  blocking
```

This is the one category where the current code is *worse* than sync: a
directory scan blocks the event loop for every other request. No `aiofiles`, no
`asyncio.to_thread`. The asset route returns a plain
`HttpResponse(content, content_type=media_type)` (`api.py:94`) — **no streaming
response anywhere in the Ninja lane**, so DRF's weak streaming story is not
engaged.

### E — genuinely async (3, runs)

`lifecycle/events`, `runs/module-activity`, `runs/agent-status` combine async ORM
with a real channels fan-out:

```python
await publish_status(project_id, frame.model_dump())   # api.py:124
# → get_channel_layer().group_send(…)                   bus.py:27-31
```

`group_send` is genuinely async. **But this repo already calls it from sync
code**, in production, on the hot path:

* `apps/runs/signals.py:35` — `async_to_sync(publish_status)(project_id, frame.model_dump())`
* `apps/runs/signals.py:80` — same
* `apps/runs/bus.py:45` — `async_to_sync(publish_backend_session)(…)`
* `apps/execution/driver.py:103,230` — `async_to_sync(spawn_run)(…)` spawns agent
  runs from sync code

So the sync→channels bridge is not hypothetical here; it is the established
pattern for every signal-driven status frame. The three async `runs` handlers are
the *exception*, not the rule.

***

## 2. Where the ADR's premise does and does not hold

ADR 0005 says Ninja stays "for the 28 async handlers in `apps/*` (terminals,
documents, runs, worktrees, execution) because those drive tmux, watchers and
subprocesses" and "DRF is sync-first".

Checked against the code:

| ADR claim                                              | Holds?                                                                                                                     |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `worktrees` and `execution` are part of the async lane | **No.** Both files have zero async handlers.                                                                               |
| `documents` needs async                                | **No.** It does blocking `Path` IO inside `async def`.                                                                     |
| `settings_store` needs async                           | **No.** Async ORM over single rows.                                                                                        |
| `terminals` drives tmux                                | **Yes**, but via `asyncio.to_thread` over sync calls.                                                                      |
| `runs` needs async                                     | **Partly.** `group_send` is async, and `async_to_sync` over it is already the repo's dominant pattern.                     |
| DRF is sync-first                                      | **Yes.** DRF ≥3.16 (`backend/pyproject.toml:8`) has no async view support. This is a genuine constraint, not a preference. |

The two-lane split is defensible for **terminals** on event-loop-utilisation
grounds. For the other 25 routes the justification does not survive contact with
the code.

***

## 3. Answer to the question

**Can we replace everything?** Technically yes, with one real trade-off and one
open cost:

* **Real trade-off (terminals, 10 routes).** Moving `asyncio.to_thread` work onto
  sync DRF views moves blocking tmux calls onto worker threads. Needs a decision
  about worker/thread pool sizing under concurrent terminal use. This is the only
  place the answer is "it depends".
* **Open cost (all 35).** `openapi.json` is still built by a Ninja-only builder
  (`worktracker/openapi.py`) and the async `apps/*` routes were never in it.
  Moving them to DRF would put 35 previously-undocumented routes into the SDKs
  for the first time — a contract expansion, not just a port.
* **Free wins (22 routes).** Categories A, C and D — already-sync handlers, async
  ORM over single rows, and handlers doing blocking IO inside `async def`. Group
  D would get *better*, not worse.

**Should we?** That is a separate question from "can we", and it is not what the
current ticket bought. The registry plus its conformance test already deliver the
property that matters — the surface cannot grow undeclared — and it works across
both lanes by asserting against the route table. The allowlist file is the honest
record of the exception.

***

## 4. What this means for the follow-up work

The two things are **not one ticket**:

1. **Delete the old code (contract phase).** The expand-contract migration left
   residue: `worktracker/api/` is an empty directory with a stale `__pycache__`,
   `auth.py` and `schemas.py` are deleted-but-uncommitted, and
   `worktracker/openapi.py` / `openapi_settings.py` still build the document from
   a Ninja router that no longer serves worktracker CRUD. Mechanical, low-risk,
   well-defined. **This is the ticket the user asked for.**
2. **Migrate the remaining Ninja lane (or decide not to).** 35 routes, a genuine
   trade-off on terminals, and a contract expansion in the SDKs. This is a
   decision that needs its own grill, and this audit is its input. It should not
   be smuggled into a deletion ticket.

Doing (1) without (2) is coherent: the allowlist and the registry exist precisely
so the two lanes can coexist under one declared surface.