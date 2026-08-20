## Direct agent launch

- DRF-native capability attempted: A work-item-scoped `GenericViewSet` action with named request and response serializers.
- Exact missing behavior: DRF CRUD has no native operation for launching a task-scoped external coding session without mutating the work item or graph-run state.
- Why a frontend adapter over the generated SDK is insufficient: The backend must resolve trusted task, module, workflow-state, and launch-policy data before starting the process.
- Why a serializer field / `validate` / `read_only_fields` is insufficient: The serializer validates and normalizes the optional provider override, but cannot perform the launch side effect.
- Why `permission_classes` and `get_queryset` scoping are insufficient: Default API-key authentication secures the operation and the URL binds its target, but neither resolves launch policy nor starts a run.
- Why a database constraint/default is insufficient: Provider availability, configured prompts, required skills, and terminal availability are runtime conditions rather than row invariants.
- Why an existing service function is insufficient: `apps.execution.driver.launch_task_agent` remains the launch authority; a custom action is still required to expose the non-CRUD command.
- Smallest custom seam: `WorkItemExecutionDomainActionMixin.launch_agent`, a serializer-backed POST action that delegates once and serializes the durable launch facts.
- Service module / `transaction.atomic` used: `apps.execution.driver.launch_task_agent`; its launch seam owns cleanup of partial terminal launches. This operation intentionally creates no graph-run state and changes no workflow state.
- Protected fields excluded from the request schema: `target_id` and `agent_run_id` are response-only; callers may supply only the optional `agent` override.
- Identity/scope binding (URL kwarg + queryset filter): The target work-item identity comes only from the `issue_id` URL kwarg; the service rejects missing, archived, or module-less targets before launching.
- Contract-drift and regression test: Execution API tests cover default binding, explicit override, unchanged workflow/graph state, all established errors, strict 422 request validation, and default API-key authentication; OpenAPI generation and contract checks preserve `workItemsLaunchAgentCreate`.
- Registry entry, if this is genuinely non-CRUD: `MODEL_ROUTES["LaunchAgent"]` registers the POST command, implemented by `WorkItemExecutionDomainActionMixin.launch_agent`.
