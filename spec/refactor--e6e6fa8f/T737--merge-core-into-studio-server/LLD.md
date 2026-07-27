# LLD — T737: Merge `Muxed-core` into the `Muxed-server` package

**Module:** `refactor--e6e6fa8f` (Refactor WorkTracker backend around a domain service layer)
**Work item:** #737
**Phase:** LLD (no implementation in this phase)
**Sub-task split out:** #738 (collapse the loopback HTTP — *not* in scope here)

---

## 1. Objective

Fold the standalone `core/` package (`Muxed-core`) into `server/`, decomposed **by function** into the apps/packages that actually consume each piece. This is a **packaging + import-path move with zero behavior change**: the loopback HTTP, the SDK calls, the agent-launch command strings, and the design-doc path contract all stay byte-for-byte identical. The only thing that disappears is the separately-installed `core` distribution.

The risky transport refactor (removing the localhost round-trip) is explicitly **out of scope** — it is sub-task #738, blocked on #724.

---

## 2. Current state (verified)

### 2.1 What `core` contains

| `core/core/` file | LoC bucket | Internal core deps |
| --- | --- | --- |
| `config.py` | ~part of ≈900 | none (leaf) |
| `models.py` | ~part of ≈900 | none (leaf) — pydantic DTOs **plus** `LifecycleEvent` + `reduce_lifecycle` |
| `worktracker_client.py` | ~part of ≈900 | `core.config`, `core.models` |
| `design_docs.py` | 187 | `core.models` |
| `agents/launcher.py` | ~900 incl. hooks | `core.config`, `core.design_docs`, `core.models` |
| `agents/hooks/{claude,codex,gemini,agy}_hook.py` | (in the ~900) | none on core — standalone scripts launched by file path |

Intra-core DAG (acyclic): `config`,`models` (leaves) ← `worktracker_client`; `models` ← `design_docs` ← `launcher`; `config` ← `launcher`.

### 2.2 Who consumes `core` — confirmed scope

- **Only `server/` imports `core`.** A repo-wide sweep of the application surfaces for `from core.` / `import core` / `muxed_core` returns **nothing**. No external consumer.
- **20 server files** reference `core` (production + tests). The "~42 import sites" in the ticket counts individual import statements/symbols; the file set is the 20 below.

### 2.3 Packaging facts

- `server/pyproject.toml`: depends on `"Muxed-core"`; has `[tool.uv.sources] Muxed-core = { path = "../core", editable = true }`; `packages.find.include` already lists `terminals*`, `documents*` but **not** `worktracker_gateway*`.
- `docker/Dockerfile`: `COPY core core` (line 46) and `./core` inside the `uv pip install` line (line 51), plus a comment naming "core".
- `server/uv.lock` and `core/uv.lock` both reference the `Muxed-core` distribution.
- `core/`'s own `pyproject.toml` deps: `python-dotenv>=1.0.0`, `worktracker-sdk>=0.2.6`, `httpx>=0.27`, `pydantic>=2.0.0` (dev: `pytest`, `pytest-asyncio`).

### 2.4 The hook-launch mechanism (why it survives untouched)

`launcher.py` computes each hook path at launch time as `os.path.join(os.path.dirname(__file__), "hooks", "<x>_hook.py")` and bakes that **absolute filesystem path** into the agent command string. Nothing persists a *module* path. So as long as `launcher.py` and its `hooks/` directory move **together**, the recomputed paths stay correct and no generated/stored command string breaks. Only a docstring mentions `core.agents.hooks.claude_hook`.

---

## 3. Target structure

Three homes, matching the ticket's module→home mapping.

### 3.1 New plain package `server/worktracker_gateway/` — NOT a Django app

Holds the tracker-backend integration cluster used by ~6 apps. **Deliberately not in `INSTALLED_APPS`**: it has no ORM `models.py`, migrations, or admin; registering it would make Django try to import a non-existent app-`models` module. It is a plain importable package on the server source path, installed via the setuptools glob.

| New file | Source | Notes |
| --- | --- | --- |
| `worktracker_gateway/__init__.py` | new (empty) | |
| `worktracker_gateway/config.py` | `core/core/config.py` | verbatim; no internal-import rewrites (leaf) |
| `worktracker_gateway/schemas.py` | `core/core/models.py` | **renamed** to avoid the ORM-`models.py` convention collision; content verbatim |
| `worktracker_gateway/worktracker_client.py` | `core/core/worktracker_client.py` | internal imports rewritten (§4.1) |
| `worktracker_gateway/tests/__init__.py` | new | |
| `worktracker_gateway/tests/test_config_atomic.py` | `core/tests/test_config_atomic.py` | imports rewritten |

### 3.2 New subpackage `server/terminals/agents/`

`terminals` is the sole consumer of the launcher and the app that launches agents.

| New file | Source |
| --- | --- |
| `terminals/agents/__init__.py` | `core/core/agents/__init__.py` |
| `terminals/agents/launcher.py` | `core/core/agents/launcher.py` (internal imports rewritten, §4.1) |
| `terminals/agents/hooks/__init__.py` | `core/core/agents/hooks/__init__.py` |
| `terminals/agents/hooks/{claude,codex,gemini,agy}_hook.py` | same files, moved verbatim |

Hooks **must** land in `terminals/agents/hooks/` (adjacent to `launcher.py`) so the `dirname(__file__)/hooks/` computation resolves. No code change inside the hook scripts.

### 3.3 New module `server/documents/design_docs.py`

`documents` owns the spec/HLD/LLD design-doc path contract.

| New file | Source |
| --- | --- |
| `documents/design_docs.py` | `core/core/design_docs.py` (internal import rewritten, §4.1) |
| `documents/tests/test_design_docs.py` | `core/tests/test_design_docs.py` (imports rewritten) |

### 3.4 Resulting DAG (still acyclic)

`worktracker_gateway` (leaf) ← `documents.design_docs` ← `terminals.agents.launcher`; `terminals` ← `worktracker_gateway` + `documents`. Matches the ticket's stated invariant.

---

## 4. Import rewrites

### 4.1 Inside the moved files

| File | Old import | New import |
| --- | --- | --- |
| `worktracker_gateway/worktracker_client.py` | `from core.config import config, Config, Profile` | `from worktracker_gateway.config import config, Config, Profile` |
| `worktracker_gateway/worktracker_client.py` | `from core.models import (...)` | `from worktracker_gateway.schemas import (...)` |
| `documents/design_docs.py` | `from core.models import ModuleSummary, TaskSummary` | `from worktracker_gateway.schemas import ModuleSummary, TaskSummary` |
| `terminals/agents/launcher.py` | `from core.config import config` | `from worktracker_gateway.config import config` |
| `terminals/agents/launcher.py` | `from core.design_docs import module_dir_name` | `from documents.design_docs import module_dir_name` |
| `terminals/agents/launcher.py` | `from core.models import TaskSummary, ModuleSummary` | `from worktracker_gateway.schemas import TaskSummary, ModuleSummary` |

`config.py`→`worktracker_gateway/config.py` and `models.py`→`worktracker_gateway/schemas.py` have **no** internal core imports — moved verbatim. Hook scripts have no core imports — moved verbatim. The launcher docstring referencing `core.agents.hooks.claude_hook` is updated to `terminals.agents.hooks.claude_hook` (cosmetic).

### 4.2 The symbol→home translation table (applies to every consumer)

| Old | New |
| --- | --- |
| `core.config` | `worktracker_gateway.config` |
| `core.models` | `worktracker_gateway.schemas` |
| `core.worktracker_client` | `worktracker_gateway.worktracker_client` |
| `core.design_docs` | `documents.design_docs` |
| `core.agents.launcher` | `terminals.agents.launcher` |

### 4.3 Consumer files to rewrite (the 20)

**Production (9):**

| File | Old reference | New home |
| --- | --- | --- |
| `documents/api.py` | `from core.worktracker_client import get_repo, resolve_profile` | `worktracker_gateway.worktracker_client` |
| `studio_server/api.py` | `from core.worktracker_client import NoProfileSelected` | `worktracker_gateway.worktracker_client` |
| `studio_server/settings.py` | `from core.config import CONFIG_DIR` | `worktracker_gateway.config` |
| `runs/api.py` | `from core.models import LifecycleEvent, reduce_lifecycle` | `worktracker_gateway.schemas` |
| `runs/management/commands/validate_worktracker_refs.py` | `from core.config import CONFIG_FILE` **and** `from core.design_docs import SPEC_ROOT` | `worktracker_gateway.config` **and** `documents.design_docs` |
| `settings_store/api.py` | `from core.config import Config, Profile` | `worktracker_gateway.config` |
| `terminals/api.py` | `from core.worktracker_client import get_repo` | `worktracker_gateway.worktracker_client` |
| `terminals/consumers.py` | `import core.config as cfgmod`; `from core.agents.launcher import (...)`; `from core.worktracker_client import NoProfileSelected, repository_for, resolve_profile_index` | `worktracker_gateway.config`; `terminals.agents.launcher`; `worktracker_gateway.worktracker_client` |
| `terminals/launch.py` | `from core.agents.launcher import (...)` | `terminals.agents.launcher` |
| `worktrees/api.py` | `import core.config as cfgmod`; `from core.worktracker_client import NoProfileSelected, resolve_profile_index` | `worktracker_gateway.config`; `worktracker_gateway.worktracker_client` |

**Tests that stay in place but get import rewrites (5):**

| File | Old reference | New home |
| --- | --- | --- |
| `documents/tests/conftest.py` | `import core.config as config_module` | `worktracker_gateway.config` |
| `documents/tests/test_docs.py` | `import core.worktracker_client as pc`; `from core.models import (...)` | `worktracker_gateway.worktracker_client`; `worktracker_gateway.schemas` |
| `studio_server/tests/worktracker/test_out_shapes.py` | `from core.models import ModuleSummary, TaskSummary` | `worktracker_gateway.schemas` |
| `studio_server/tests/worktracker/test_selection.py` | `from core.config import Profile`; `from core.worktracker_client import WorktrackerRepository, resolve_profile, repository_for`; (3× `import core.config as config_module`) | `worktracker_gateway.config`; `worktracker_gateway.worktracker_client` |
| `runs/tests/test_lifecycle_stream.py` | `from core.models import LifecycleEvent` | `worktracker_gateway.schemas` |
| `settings_store/tests/conftest.py` | `import core.config as config_module` | `worktracker_gateway.config` |

> These DTO/adapter assertions (`test_out_shapes`, `test_selection`) are the "models/worktracker_client tests" the ticket scope alludes to — they already live under `server/`, so they are **rewritten in place, not relocated**.

**Terminals tests that stay in place but get import rewrites (covered in §5 relocation note):** `terminals/tests/conftest.py`, `test_api.py`, `test_consumers.py`, `test_worktree_launch.py` all reference `core.config` / `core.worktracker_client` / `core.models` and get the §4.2 rewrite in place.

---

## 5. Test relocation (the `core/tests/*` set)

`core/tests/` contains 8 files: `__init__.py` + 7 test modules. There are **no** `test_models.py`/`test_worktracker_client.py` in `core/tests/` — the ticket's "models/worktracker_client tests" reference resolves to the in-`server` tests handled in §4.3.

| `core/tests/` file | New location | Action |
| --- | --- | --- |
| `test_launcher.py` | `terminals/tests/test_launcher.py` | move + rewrite imports |
| `test_claude_hook.py` | `terminals/tests/test_claude_hook.py` | move + rewrite imports |
| `test_codex_hook.py` | `terminals/tests/test_codex_hook.py` | move + rewrite imports |
| `test_gemini_hook.py` | `terminals/tests/test_gemini_hook.py` | move + rewrite imports |
| `test_agy_hook.py` | `terminals/tests/test_agy_hook.py` | move + rewrite imports |
| `test_design_docs.py` | `documents/tests/test_design_docs.py` | move + rewrite imports |
| `test_config_atomic.py` | `worktracker_gateway/tests/test_config_atomic.py` | move + rewrite imports |
| `__init__.py` | — | discard (each destination `tests/` already has its own) |

All 7 are Django-free today; under `server/` they run via `pytest-django` using the existing `DJANGO_SETTINGS_MODULE`. They need no DB. The new `worktracker_gateway/tests/` gets its own `__init__.py`; the destination `terminals/tests/` and `documents/tests/` already exist with conftests. Watch for filename collisions — none of the 7 names already exist in the destination dirs (verified against current listings).

---

## 6. Packaging / wiring changes

### 6.1 `server/pyproject.toml`

- **Remove** `"Muxed-core"` from `[project].dependencies`.
- **Add** core's runtime deps so the symbols still resolve: `python-dotenv>=1.0.0`, `worktracker-sdk>=0.2.6`, `httpx>=0.27`, `pydantic>=2.0.0`. (`httpx` is already a dev dep; promote/keep a single runtime entry.)
- **Remove** the `[tool.uv.sources]` `Muxed-core` line.
- **Add** `"worktracker_gateway*"` to `[tool.setuptools.packages.find].include`. `terminals*` and `documents*` are already present, so `terminals.agents`, `terminals.agents.hooks`, and `documents.design_docs` are auto-included.

### 6.2 `docker/Dockerfile`

- Drop `COPY core core`.
- Drop `./core` from the `uv pip install` line.
- Update the line-44 comment that names "core".

### 6.3 Lockfile

- Regenerate `server/uv.lock` (`uv lock` in `server/`) so the removed source/dependency is reflected.

### 6.4 Delete `core/` entirely

After all imports resolve to the new homes: delete `core/pyproject.toml`, `core/uv.lock`, `core/README.md`, `core/*.egg-info`, and finally the whole `core/` directory (including `core/core/` and `core/tests/`).

---

## 7. Execution order (keeps the suite green at each gate)

1. **Create destinations + move files** (`git mv` to preserve history): `worktracker_gateway/{config,schemas,worktracker_client}.py` (+ `__init__`), `terminals/agents/{__init__,launcher}.py` + `hooks/`, `documents/design_docs.py`. Rewrite the §4.1 internal imports in the moved files.
2. **Rewrite the 20 consumer files** per §4.2/§4.3 (production first, then in-place tests).
3. **Relocate the 7 `core/tests` files** per §5, rewriting their imports; add `worktracker_gateway/tests/__init__.py`.
4. **Packaging** per §6.1/§6.2: edit `server/pyproject.toml`, edit `docker/Dockerfile`, reinstall the editable server package so `worktracker_gateway`/`terminals.agents`/`documents.design_docs` are importable, regenerate `server/uv.lock`.
5. **Delete `core/`** per §6.4.
6. **Validate** per §8.

Steps 1–2 must land together before the suite can pass (no shim/back-compat `core` package is created — clean break, since there are no external consumers).

---

## 8. Validation / acceptance

- `grep -rE 'from core\.|import core\b|muxed_core|Muxed-core'` across the repo (excluding `.git`, `__pycache__`) returns **zero** hits; `core/` directory is gone.
- Full `server/` pytest suite green, including the 7 relocated tests in their new homes.
- `docker build` succeeds with no `COPY core` / `./core` steps.
- No behavioral change: agent-launch command strings (hook file paths), design-doc path resolution (`SPEC_ROOT`, `module_dir_name`), and owned/WorkTracker API calls are byte-identical — confirmed by the relocated launcher/hook/design-doc tests passing unchanged in assertion content.
- The loopback HTTP is untouched (deferred to #738).

---

## 9. Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| `worktracker_gateway` accidentally added to `INSTALLED_APPS` → Django app-loading error (no `models`) | Explicit decision recorded here; it is a plain package, only added to the setuptools `packages.find` glob, never to `INSTALLED_APPS`. |
| Hook path breakage at agent launch | Move `launcher.py` + `hooks/` together; paths are recomputed from `dirname(__file__)`. Relocated hook tests verify. |
| `settings.py` imports `worktracker_gateway.config` at Django settings load | `worktracker_gateway` is Django-free and import-light; no circular import (it never imports Django). Already true for `core.config` today. |
| Stale `*.egg-info` (`muxed_core`, server `SOURCES.txt`) re-resolving the old dist | Delete `core/*.egg-info`; reinstall editable server; regenerate `server/uv.lock`. |
| `documents.design_docs` ← imported by `terminals.agents.launcher` introducing a cycle | DAG check: `documents.design_docs` imports only `worktracker_gateway.schemas`; no edge back to `terminals`. Acyclic. |

---

## 10. Out of scope (explicit)

- Removing the loopback HTTP / direct in-process calls → **#738**.
- Any `worktracker_gateway` boundary abstraction or WorkTracker/WorkTracker swappable bridge → **#739**.
- Any DTO shape, route, or behavior change.
