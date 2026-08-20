# Project onboarding acknowledgement

- DRF-native capability attempted: `ProjectViewSet` model update through `UpdateModelMixin` and `ProjectSerializer`.
- Exact missing behavior: onboarding acknowledgement is a monotonic command that can only clear the server-owned flag and must be idempotent.
- Why a frontend adapter over the generated SDK is insufficient: allowing a general Project patch would expose a protected installation lifecycle field to every client.
- Why a serializer field / `validate` / `read_only_fields` is insufficient: `read_only_fields` correctly protects general writes but cannot express the dedicated false-only transition.
- Why `permission_classes` and `get_queryset` scoping are insufficient: authentication and row scope do not express the monotonic transition.
- Why a database constraint/default is insufficient: the default owns fresh-project behavior but cannot acknowledge an existing pending row.
- Why an existing service function is insufficient: the project onboarding service performs the transition, but an HTTP action is still required to expose it.
- Smallest custom seam: one bodyless `@action` on `ProjectViewSet` returning `ProjectSerializer`.
- Service module / `transaction.atomic` used: `worktracker.services.onboarding.acknowledge_project_onboarding`; the single conditional update is atomic without a multi-row transaction.
- Protected fields excluded from the request schema: `onboarding_required` is read-only and the action declares no request body.
- Identity/scope binding (URL kwarg + queryset filter): `project_id` is bound by `/projects/{project_id}/onboarding/acknowledge` and resolved as the exact Project primary key in the service.
- Contract-drift and regression test: `worktracker/tests/test_project_onboarding.py`, generated `openapi.json`, and `npm run contract:check`.
- Registry entry, if this is genuinely non-CRUD: `ProjectOnboardingActionMixin` in `worktracker.rest.domain_ops`; onboarding acknowledgement is already an allowed named domain operation.
