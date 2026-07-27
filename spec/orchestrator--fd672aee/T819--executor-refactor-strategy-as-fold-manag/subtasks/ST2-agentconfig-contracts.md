# ST2 — AgentConfig + the contract-check library

**Depends on:** nothing (parallel with ST1).
**Read first:** `INTERFACES.md` §4 (driver pure helpers), §8 (dao exports); `../ADR-0003…` and the "completion contracts" paragraph of `../SPEC-executor-refactor.md`.

**STEP 0 — verify symbols still exist (the tree is under active refactor):**
`grep -n "def check_verify_postcondition\|def _ticket_transitioned\|class PostconditionResult" server/apps/orchestrator/driver.py`
and `grep -n "get_issue_with_state" server/apps/orchestrator/dao/__init__.py`.
If a symbol moved to another module, grep the app for it and import from the new home.

## Goal

Two small pure-ish modules: `AgentConfig` (the declarative spec for one agent launch,
JSON-round-trippable so it can be stored on a DB row) and `contracts.py` (a registry of
named completion checks that ManagedAgent will evaluate when an agent finishes).

## Deliverable 1: `server/apps/orchestrator/agent_config.py`

```python
from __future__ import annotations
from dataclasses import dataclass, field, asdict
from typing import Literal

@dataclass(frozen=True)
class AgentConfig:
    agent: str                 # e.g. "codex" — must be a key the HeadlessPort accepts
    model: str
    task_id: str               # worktracker issue id (str(uuid))
    prompt: str
    cwd: str
    mode: Literal["headless", "interactive"] = "headless"
    phase: str | None = None           # "decompose" | "implement" | "verify" (free string)
    attempt: int | None = None
    timeout_seconds: float = 1800.0
    grace_seconds: float = 10.0
    contract: tuple[str, ...] = ()     # names registered in contracts.CHECKS
    project_id: str | None = None      # interactive only
    module_id: str | None = None       # interactive only

    def to_dict(self) -> dict: ...     # asdict + contract as list
    @classmethod
    def from_dict(cls, data: dict) -> "AgentConfig": ...  # tolerate missing optional keys; contract list -> tuple
```

`from_dict(to_dict(c)) == c` must hold exactly.

## Deliverable 2: `server/apps/orchestrator/contracts.py`

```python
@dataclass(frozen=True)
class CheckContext:
    task_id: str
    cwd: str
    verdict_payload: str | None = None   # raw text of verdict.json when the caller has it

@dataclass(frozen=True)
class CheckResult:
    name: str
    ok: bool
    detail: str = ""
    data: dict = field(default_factory=dict)   # parsed extras, e.g. {"verdict": "accept"}

CHECKS: dict[str, Callable[[CheckContext], CheckResult]] = {}

def register(name: str): ...   # decorator that inserts into CHECKS

def evaluate(contract: tuple[str, ...] | list[str], ctx: CheckContext) -> list[CheckResult]:
    # unknown name -> CheckResult(name=name, ok=False, detail="unknown check")
```

Register exactly two checks in this subtask:

1. `"ticket_transitioned"` — replicate the logic of `driver._ticket_transitioned`
   (driver.py — read its ~5-line body): fetch the issue via
   `dao.get_issue_with_state(ctx.task_id)` and return ok when its state group is the
   completed group, exactly as the driver helper decides it. Import `dao` lazily
   *inside* the function body (keeps module import Django-free until called).
   Wrap lookup failures (missing issue) as `ok=False, detail="issue not found"`.
2. `"verdict_valid"` — call `check_verify_postcondition(verdict_payload=ctx.verdict_payload)`
   (import from where STEP 0 found it). Map: `ok=result.ok`, `detail=result.detail`,
   `data={"verdict": result.verdict, "findings": <findings attr if the VerdictResult has one, else "">}`.
   Inspect the `VerdictResult` dataclass in driver.py for the exact attribute names before writing this.

Add a placeholder registration `"commits_on_branch"` that returns
`CheckResult(name="commits_on_branch", ok=False, detail="not implemented until CODIN-788")` —
it reserves the name so configs can already declare it.

## Deliverable 3: `server/apps/orchestrator/tests/test_contracts.py`

Follow the DB-test pattern used by `tests/test_dao.py` (same settings/bootstrap
harness — copy its header). Tests:

1. `test_agent_config_round_trip` — build an AgentConfig with every field set (contract `("ticket_transitioned","verdict_valid")`), assert `from_dict(to_dict(c)) == c`.
2. `test_evaluate_unknown_check` — `evaluate(("nope",), ctx)` → one result, `ok False`, detail `"unknown check"`.
3. `test_verdict_valid_accepts` / `test_verdict_valid_rejects_garbage` — feed a valid accept payload and a non-JSON string. Steal the exact payload strings from the existing verify-parsing tests in `tests/test_driver.py` (grep it for `verdict`).
4. `test_ticket_transitioned_true_and_false` — create an Issue in the completed state group and one not; assert ok/notok. Copy the issue-creation helper pattern from `tests/test_coordinator_wiring.py` (grep it for how it creates issues and states).
5. `test_commits_on_branch_placeholder` — ok is False, detail mentions 788.

## Acceptance

```bash
cd server && python -m pytest apps/orchestrator/tests/test_contracts.py -q
python -m pytest apps/orchestrator -q
```

## Out of scope / do not touch

- Do NOT modify driver.py (you only import from it), models.py, headless.py.
- No git operations (commits_on_branch stays a placeholder).
- Do not wire these checks into any caller — ST4 does that.
