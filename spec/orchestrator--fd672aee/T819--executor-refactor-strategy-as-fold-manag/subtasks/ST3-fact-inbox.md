# ST3 — Fact inbox: the durable event rows reconcile folds over

**Depends on:** nothing (parallel with ST1/ST2).
**Read first:** `INTERFACES.md` §1 (models), §8 (dao layout); `../ADR-0002…` (why Facts exist).

**STEP 0 — verify:** `ls server/apps/orchestrator/migrations/` (note the highest number — the new
migration must be next), and `grep -n "class HeadlessRun" server/apps/orchestrator/models.py`.

## Goal

A durable, append-only `Fact` table (the reconcile inbox) plus a `config` JSON column on
`HeadlessRun` so a run can be re-interpreted after a restart (ManagedAgent stores the
AgentConfig there in ST4).

## Deliverable 1: model changes in `server/apps/orchestrator/models.py`

Add to `HeadlessRun`: `config = models.JSONField(null=True, blank=True)` (place near `command`).

Add a new model:

```python
class Fact(models.Model):
    """Append-only inbox row: something happened outside the fold (ADR-0002/0003)."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    run = models.ForeignKey(CoordinatorRun, on_delete=models.CASCADE, related_name="facts")
    node_id = models.CharField(max_length=255, blank=True, default="")
    kind = models.CharField(max_length=40)   # "node_exited" | "node_transitioned" | "node_cancelled"
                                             # | "contract_met" | "contract_failed" | "verdict_landed"
                                             # | "question_asked" | "question_answered"
    payload = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    consumed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "orchestrator_facts"
        indexes = [
            models.Index(fields=["run", "consumed_at", "created_at"], name="idx_fact_run_pending"),
            models.Index(fields=["kind"], name="idx_fact_kind"),
        ]
```

Migration: `cd server && DJANGO_SETTINGS_MODULE=studio_server.orchestrate_settings python manage.py makemigrations orchestrator`
then check it in. Do not hand-write the migration unless makemigrations fails.

## Deliverable 2: `server/apps/orchestrator/dao/facts.py`

```python
def append_fact(run_id, *, kind: str, node_id: str = "", payload: dict | None = None) -> Fact: ...
def get_pending_facts(run_id, limit: int = 100) -> list[Fact]:
    # consumed_at IS NULL, ordered by created_at then id (stable), capped at limit
def mark_facts_consumed(fact_ids: list) -> int:
    # UPDATE consumed_at=now WHERE id IN (...) AND consumed_at IS NULL; returns row count
```

Re-export all three from `server/apps/orchestrator/dao/__init__.py` following the exact
style already used there (see INTERFACES.md §8 — plain names in the import list).

## Deliverable 3: `server/apps/orchestrator/tests/test_facts.py`

Same DB-test harness as `tests/test_dao.py`. Tests:

1. `test_append_and_pending_order` — append three facts with different kinds; `get_pending_facts` returns all three in creation order with `consumed_at is None`.
2. `test_mark_consumed_is_idempotent` — consume two of three; pending returns one; consuming the same ids again returns 0 and timestamps don't change.
3. `test_pending_respects_limit` — limit=2 → 2 rows, the oldest two.
4. `test_facts_cascade_with_run` — deleting the CoordinatorRun deletes its facts.
5. `test_headless_run_config_round_trip` — save a dict on `HeadlessRun.config`, reload, equal.

## Acceptance

```bash
cd server && python -m pytest apps/orchestrator/tests/test_facts.py apps/orchestrator/tests/test_dao.py -q
python -m pytest apps/orchestrator -q
```

## Out of scope / do not touch

- Nothing reads or writes Facts in production code yet (ST4 writes, ST5 drains). Do NOT touch driver.py, headless.py, signals.py.
- Do not add a Question model — `question_asked` is just an allowed `kind` string (CODIN-791 will use it).
