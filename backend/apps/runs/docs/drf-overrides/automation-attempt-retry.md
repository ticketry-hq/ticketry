# Automation-attempt retry DRF override

## Retry failed automation attempt

- DRF-native capability attempted: a serializer-backed detail action on the owning `AutomationAttemptViewSet`.
- Exact missing behavior: retry is an idempotent command that locks a failed attempt, creates at most one child, launches it, and returns the resulting durable attempt.
- Why a frontend adapter over the generated SDK is insufficient: the idempotency and launch side effect must be enforced by the backend transaction.
- Why a serializer field / `validate` / `read_only_fields` is insufficient: eligibility depends on locked persisted status, retryability, and an existing retry child.
- Why `permission_classes` and `get_queryset` scoping are insufficient: authentication protects the command, but cannot perform its transaction or launch side effect.
- Why a database constraint/default is insufficient: the one-to-one retry relation prevents duplicate children but cannot validate failure state or launch the retry.
- Why an existing service function is insufficient: `apps.runs.api.retry_automation_attempt` owns the behavior and is retained; the custom seam only exposes it as a DRF action.
- Smallest custom seam: `AutomationAttemptActionMixin.retry` binds the URL identity through DRF routing, delegates once, and serializes the returned model.
- Service module / `transaction.atomic` used: `apps.runs.api.retry_automation_attempt` locks the source and creates its child inside `transaction.atomic`.
- Protected fields excluded from the request schema: the action has no request body; all attempt fields are read-only response fields.
- Identity/scope binding (URL kwarg + queryset filter): `attempt_id` is the detail identity on `AutomationAttemptViewSet`; the installation API key is required and the desktop installation owns the attempt store.
- Contract-drift and regression test: contract generation/check plus automation-launch tests cover API-key enforcement, idempotency, retry lineage, response shape, and retryable failures.
- Registry entry, if this is genuinely non-CRUD: `/api/automation-attempts/{attempt_id}/retry` remains in `backend/worktracker/registry.py` because retry is a transactional command with a durable launch side effect.
