# Django backend cross-module dependency map

Scope: current Python source under Vertical A (`backend/worktracker`) and Vertical B
(`backend/apps/{runs,execution,terminals,worktrees,documents}`). Tests are included and
identified by their paths. Multiple symbols on one import statement are kept on one line.

## 1. Vertical B imports from `worktracker`

### `runs`

- `backend/apps/runs/api.py:18` -> `worktracker.auth.ApiKeyAuth`
- `backend/apps/runs/models.py:5` -> `worktracker.models.Issue`
- `backend/apps/runs/projections.py:11` -> `worktracker.models.{Issue, Project, State}`
- `backend/apps/runs/projections.py:12` -> `worktracker.state_projection.workflow_state_projection`
- `backend/apps/runs/signals.py:13` -> `worktracker.models.State`
- `backend/apps/runs/signals.py:14` -> `worktracker.signals.{issue_state_changed, workflow_state_changed}`
- `backend/apps/runs/tests/conftest.py:3` -> `worktracker.tests.factories.ensure_issue`
- `backend/apps/runs/tests/test_automation_launch.py:17` -> `worktracker.models.{Issue, IssueType, IssueTypeTransition, LaunchBinding, Project, State, Workspace}`
- `backend/apps/runs/tests/test_automation_launch.py:26` -> `worktracker.services.projects.create_project`
- `backend/apps/runs/tests/test_automation_launch.py:27` -> `worktracker.signals.issue_state_changed`
- `backend/apps/runs/tests/test_dao.py:10` -> `worktracker.tests.factories.{ensure_issue, fixture_issue_id, fixture_uuid}`
- `backend/apps/runs/tests/test_lifecycle_api.py:18` -> `worktracker.tests.factories.{fixture_issue_id, fixture_uuid}`
- `backend/apps/runs/tests/test_status_stream.py:23` -> `worktracker.models.{Issue, IssueType, Project, State, Workspace}`
- `backend/apps/runs/tests/test_status_stream.py:24` -> `worktracker.services.workflow_config`
- `backend/apps/runs/tests/test_status_stream.py:25` -> `worktracker.tests.factories.{fixture_issue_id, fixture_uuid}`
- `backend/apps/runs/tests/test_work_item_state_signal.py:7` -> `worktracker.models.{Issue, IssueType, Project, State, Workspace}`

### `execution`

- `backend/apps/execution/api.py:11` -> `worktracker.auth.ApiKeyAuth`
- `backend/apps/execution/driver.py:9` -> `worktracker.models.{Issue, LaunchBinding}`
- `backend/apps/execution/driver.py:10` -> `worktracker.state_groups.state_group`
- `backend/apps/execution/models.py:2` -> `worktracker.models.{Issue, Project}`
- `backend/apps/execution/signals.py:8` -> `worktracker.signals.issue_state_changed`
- `backend/apps/execution/signals.py:15` -> `worktracker.models.Issue`
- `backend/apps/execution/tests/test_api.py:12` -> `worktracker.models.{Issue, IssueType, LaunchBinding, Project, State, Workspace}`
- `backend/apps/execution/tests/test_graph.py:10` -> `worktracker.models.{Issue, IssueType, LaunchBinding, Project, State, Workspace}`
- `backend/apps/execution/tests/test_graph.py:18` -> `worktracker.signals.issue_state_changed`
- `backend/apps/execution/tests/test_signals.py:6` -> `worktracker.signals.issue_state_changed`

### `terminals`

- `backend/apps/terminals/agents/registry.py:41` -> `worktracker.launch_capabilities.PROVIDER_CAPABILITIES`
- `backend/apps/terminals/agents/registry.py:42` -> `worktracker.services.launch_bindings.{LaunchBindingError, validate_provider_options}`
- `backend/apps/terminals/launch.py:52` -> `worktracker.models.Issue`
- `backend/apps/terminals/launch_configuration.py:7` -> `worktracker.models.Issue`
- `backend/apps/terminals/launch_configuration.py:8` -> `worktracker.services.launch_bindings.{LaunchBindingError, apply_global_launch_default, resolve_launch_binding, resolve_issue_launch_binding, validate_provider_options}`
- `backend/apps/terminals/session.py:158` -> `worktracker.services.launch_bindings.{LaunchBindingError, validate_provider_options}`
- `backend/apps/terminals/tests/conftest.py:9` -> `worktracker.tests.factories.ensure_issue`
- `backend/apps/terminals/tests/test_agent_registry.py:33` -> `worktracker.tests.factories.fixture_issue_id`
- `backend/apps/terminals/tests/test_api.py:19` -> `worktracker.models.{Issue, IssueType, Project, Workspace}`
- `backend/apps/terminals/tests/test_api.py:20` -> `worktracker.tests.factories.{ensure_issue, fixture_issue_id, fixture_uuid}`
- `backend/apps/terminals/tests/test_consumers.py:22` -> `worktracker.tests.factories.{fixture_issue_id, fixture_uuid}`
- `backend/apps/terminals/tests/test_dao.py:9` -> `worktracker.tests.factories.fixture_issue_id`
- `backend/apps/terminals/tests/test_launch_configuration.py:17` -> `worktracker.models.{Issue, IssueType, LaunchBinding, Project, State, Workspace}`
- `backend/apps/terminals/tests/test_required_skill_launch.py:33` -> `worktracker.required_skills.DEFAULT_REQUIRED_SKILLS`
- `backend/apps/terminals/tests/test_required_skill_launch.py:34` -> `worktracker.tests.factories.fixture_issue_id`
- `backend/apps/terminals/tests/test_session.py:19` -> `worktracker.tests.factories.{fixture_issue_id, fixture_uuid}`
- `backend/apps/terminals/tests/test_session_resume.py:14` -> `worktracker.tests.factories.fixture_issue_id`
- `backend/apps/terminals/tests/test_session_spawn.py:31` -> `worktracker.tests.factories.{fixture_issue_id, fixture_uuid}`
- `backend/apps/terminals/tests/test_tmux.py:32` -> `worktracker.tests.factories.fixture_issue_id`
- `backend/apps/terminals/tests/test_viewer_leases.py:14` -> `worktracker.tests.factories.fixture_issue_id`

### `worktrees`

- `backend/apps/worktrees/signals.py:35` -> `worktracker.models.Issue`
- `backend/apps/worktrees/tests/test_close_hook.py:16` -> `worktracker.models.{Issue, Project, State, Workspace}`

### `documents`

- `backend/apps/documents/api.py:28` -> `worktracker.auth.ApiKeyAuth`
- `backend/apps/documents/tests/conftest.py:6` -> `worktracker.tests.factories.ensure_issue`
- `backend/apps/documents/tests/test_docs.py:27` -> `worktracker.tests.factories.{ensure_issue, fixture_issue_id, fixture_uuid}`

## 2. `worktracker` imports from `backend/apps/*`

- `backend/worktracker/launch_capabilities.py:58` -> `apps.settings_store.provider_catalog.load_provider_catalog`
- `backend/worktracker/openapi.py:9` -> `apps.settings_store.schemas.ConfigBody`
- `backend/worktracker/services/launch_bindings.py:17` -> `apps.settings_store.provider_catalog.ProviderCatalog`
- `backend/worktracker/services/launch_bindings.py:59` -> `apps.settings_store.provider_catalog.{PROVIDER_ORDER, load_provider_catalog}`
- `backend/worktracker/services/launch_bindings.py:131` -> `apps.settings_store.provider_catalog.load_provider_catalog`
- `backend/worktracker/services/scoped_workflows.py:272` -> `apps.settings_store.provider_catalog.{PROVIDER_ORDER, load_provider_catalog}`
- `backend/worktracker/tests/test_launch_bindings.py:215` -> `apps.settings_store.models.AppSetting`
- `backend/worktracker/tests/test_launch_bindings.py:236` -> `apps.settings_store.models.AppSetting`
- `backend/worktracker/tests/test_launch_bindings_api.py:6` -> `apps.settings_store.models.AppSetting`
- `backend/worktracker/tests/test_launch_policy_lifetime.py:17` -> `apps.settings_store.models.AppSetting`
- `backend/worktracker/tests/test_launch_policy_lifetime.py:18` -> `apps.settings_store.provider_catalog.{PROVIDER_CATALOG_KEY, PROVIDER_CATALOG_SCOPE, ProviderCatalog}`
- `backend/worktracker/tests/test_review_finding.py:16` -> `apps.runs.models.AutomationAttempt`

There are no production `worktracker` imports from the five Vertical B apps; its
production `apps.*` imports all target `settings_store`. The sole A-to-B import is test-only.

## 3. Cross-boundary Django model relations

- `backend/apps/runs/models.py:12` — `AgentRun.issue` -> `worktracker.Issue` (`ForeignKey`)
- `backend/apps/runs/models.py:35` — `AutomationAttempt.issue` -> `worktracker.Issue` (`ForeignKey`)
- `backend/apps/execution/models.py:15` — `GraphRun.root` -> `worktracker.Issue` (`OneToOneField`)
- `backend/apps/execution/models.py:22` — `GraphRun.project` -> `worktracker.Project` (`ForeignKey`)
- `backend/apps/execution/models.py:29` — `GraphRun.module` -> `worktracker.Issue` (`ForeignKey`)
- `backend/apps/execution/models.py:48` — `LaunchedTask.task` -> `worktracker.Issue` (`OneToOneField`)
- `backend/apps/execution/models.py:55` — `LaunchedTask.root` -> `worktracker.Issue` (`ForeignKey`)

All current cross-boundary relations point B -> A. There are none in current
`worktracker` models pointing to B. Migration string targets mirror these relations
(`worktracker.issue` / `worktracker.project`); no additional current relation is hidden
behind a string target.

## 4. Shared infrastructure module names

- `studio_server.settings`
- `django.db`
- `django.db.models.signals`
- `django.dispatch`
- `apps.settings_store.config`
- `apps.settings_store.provider_catalog`
- `apps.runs.bus`
- `worktracker.signals`

Placement notes: `apps.settings_store` is shared configuration infrastructure and has
bidirectional imports with `worktracker`; `apps/worktracker_queries.py` is a thin
apps-layer query adapter over `worktracker.services.queries`; `studio_server` is the
composition root (settings, ASGI, routing, and API router registration), not either
vertical. Its runtime API imports `worktracker.api.router`; its tests also import
`worktracker` fixtures/models.

## 5. Count summary

- Vertical B files importing `worktracker`: **38** total (**14 production**, **24 test**).
- `worktracker` files importing `apps.*`: **8** total (**4 production**, **4 test**).

Counts are unique files, not import statements or imported symbols.
