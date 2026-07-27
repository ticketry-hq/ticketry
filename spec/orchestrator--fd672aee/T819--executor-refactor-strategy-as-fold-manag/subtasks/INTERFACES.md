# INTERFACES — exact code surface as of 2026-07-06

> Ground truth extracted for the T819 subtasks. The tree is under active refactor
> (service.py already split into commands.py + console.py). ALWAYS run each
> subtask's STEP 0 symbol check; if a symbol moved, grep for it and adapt.

**INTERFACES**

**1. `server/apps/orchestrator/models.py`**
- [HeadlessRun](/path/to/repository/server/apps/orchestrator/models.py#L8)
  - `id = UUIDField(primary_key=True, default=uuid.uuid4, editable=False)` [L11]
  - `task_id = CharField(max_length=255)` [L12]
  - `phase = CharField(max_length=80, null=True, blank=True)` [L13]
  - `attempt = PositiveIntegerField(null=True, blank=True)` [L14]
  - `agent = CharField(max_length=40)` [L15]
  - `model = CharField(max_length=255)` [L16]
  - `cwd = TextField()` [L17]
  - `pid = IntegerField(null=True, blank=True)` [L18]
  - `process_handle = CharField(max_length=255, null=True, blank=True)` [L19]
  - `status = CharField(max_length=40, default="running")` [L20]
  - `exit_code = IntegerField(null=True, blank=True)` [L21]
  - `timed_out = BooleanField(default=False)` [L22]
  - `timeout_seconds = FloatField(null=True, blank=True)` [L23]
  - `timeout_grace_seconds = FloatField(null=True, blank=True)` [L24]
  - `command = JSONField(default=list)` [L25]
  - `stdout = TextField(default="", blank=True)` [L26]
  - `usage = JSONField(null=True, blank=True)` [L27]
  - `usage_parse_errors = JSONField(default=list, blank=True)` [L28]
  - `verdict = CharField(max_length=20, null=True, blank=True)` [L32]
  - `verdict_findings = TextField(default="", blank=True)` [L33]
  - `started_at = DateTimeField()` [L34]
  - `finished_at = DateTimeField(null=True, blank=True)` [L35]
  - `created_at = DateTimeField(auto_now_add=True)` [L36]
  - `updated_at = DateTimeField(auto_now=True)` [L37]
  - `Meta.db_table = "orchestrator_headless_runs"` [L40]
  - `Meta.indexes = [Index(fields=["task_id", "-started_at"], name="idx_headless_task_started"), Index(fields=["status", "pid"], name="idx_headless_status_pid")]` [L41-L46]

- [CoordinatorRun](/path/to/repository/server/apps/orchestrator/models.py#L49)
  - `id = UUIDField(primary_key=True, default=uuid.uuid4, editable=False)` [L58]
  - `root_id = CharField(max_length=255)` [L59]
  - `strategy = CharField(max_length=120, default="default")` [L60]
  - `model = CharField(max_length=255)` [L61]
  - `model_policy = JSONField(default=dict, blank=True)` [L62]
  - `autonomy = CharField(max_length=20, default="gated")` [L63]
  - `launch_mode = CharField(max_length=20, default="headless")` [L68]
  - `check_command = TextField(null=True, blank=True)` [L69]
  - `status = CharField(max_length=40, default="running")` [L70]
  - `max_depth = PositiveIntegerField(default=2)` [L71]
  - `max_concurrent = PositiveIntegerField(default=3)` [L72]
  - `max_total_runs = PositiveIntegerField(default=10)` [L73]
  - `created_ticket_ids = JSONField(default=list, blank=True)` [L74]
  - `created_at = DateTimeField(auto_now_add=True)` [L75]
  - `updated_at = DateTimeField(auto_now=True)` [L76]
  - `Meta.db_table = "orchestrator_runs"` [L79]
  - `Meta.indexes = [Index(fields=["root_id"], name="idx_run_root"), Index(fields=["status"], name="idx_run_status")]` [L80-L83]

- [RunNode](/path/to/repository/server/apps/orchestrator/models.py#L86)
  - `id = UUIDField(primary_key=True, default=uuid.uuid4, editable=False)` [L93]
  - `run = ForeignKey(CoordinatorRun, on_delete=models.CASCADE, related_name="run_nodes")` [L94-L96]
  - `node_id = CharField(max_length=255)` [L97]
  - `depth = PositiveIntegerField(default=0)` [L98]
  - `phase = CharField(max_length=40, default="implement")` [L99]
  - `status = CharField(max_length=40, default="pending")` [L100]
  - `attempt = PositiveIntegerField(default=0)` [L101]
  - `retried = BooleanField(default=False)` [L102]
  - `anomaly = BooleanField(default=False)` [L103]
  - `agent_run_id = CharField(max_length=255, null=True, blank=True)` [L108]
  - `child_snapshot = JSONField(null=True, blank=True, default=None)` [L114]
  - `created_at = DateTimeField(auto_now_add=True)` [L115]
  - `updated_at = DateTimeField(auto_now=True)` [L116]
  - `Meta.db_table = "orchestrator_run_nodes"` [L119]
  - `Meta.constraints = [UniqueConstraint(fields=["run", "node_id"], name="uniq_run_node")]` [L120-L124]
  - `Meta.indexes = [Index(fields=["run", "status"], name="idx_run_node_status")]` [L125-L127]

**2. `server/apps/orchestrator/state.py`**
- `Phase = Literal["decompose", "implement", "verify"]` [L28]
- `NodeStatus = Literal["pending", "running", "done", "stopped_incomplete", "integration_failed", "failed", "halted"]` [L32-L40]
- `HeaderStatus = Literal["running", "done", "failed", "budget_exceeded", "released"]` [L43]
- `LaunchMode = Literal["headless", "interactive"]` [L50]
- `EventKind = Literal["tick", "node_exited", "node_transitioned", "node_cancelled", "integration_result", "budget_exceeded", "release"]` [L52-L60]
- `ActionKind = Literal["launch"]` [L62]
- `TERMINAL_NODE_STATUSES: frozenset[str] = frozenset({"done", "failed", "integration_failed", "halted"})` [L64-L66]
- `SUCCESS_NODE_STATUSES: frozenset[str] = frozenset({"done"})` [L67]

- [Node](/path/to/repository/server/apps/orchestrator/state.py#L70)
  - `id: str` [L80]
  - `depth: int` [L81]
  - `phase: Phase` [L82]
  - `status: NodeStatus = "pending"` [L83]
  - `attempt: int = 0` [L84]
  - `retried: bool = False` [L85]
  - `anomaly: bool = False` [L86]
  - `blocked_by: tuple[str, ...] = ()` [L87]

- [RunState](/path/to/repository/server/apps/orchestrator/state.py#L90)
  - `run_id: str` [L94]
  - `root_id: str` [L95]
  - `strategy: str` [L96]
  - `policy: object` [L97]
  - `status: HeaderStatus = "running"` [L98]
  - `max_depth: int = 2` [L99]
  - `max_concurrent: int = 3` [L100]
  - `verify_enabled: bool = False` [L104]
  - `launch_mode: LaunchMode = "headless"` [L109]
  - `nodes: tuple[Node, ...] = ()` [L110]
  - `node(self, node_id: str) -> Node | None` [L112-L116]
  - `running_count` property -> `int` [L118-L120]

- [ChildSpec](/path/to/repository/server/apps/orchestrator/state.py#L123)
  - `id: str` [L127]
  - `depth: int` [L128]
  - `needs_decompose: bool = False` [L129]
  - `blocked_by: tuple[str, ...] = ()` [L130]

- [Event](/path/to/repository/server/apps/orchestrator/state.py#L133)
  - `kind: EventKind` [L149]
  - `node_id: str | None = None` [L150]
  - `exit_code: int | None = None` [L151]
  - `timed_out: bool = False` [L152]
  - `cancelled: bool = False` [L153]
  - `decompose_request: bool = False` [L154]
  - `postcondition_ok: bool = False` [L155]
  - `transitioned: bool = False` [L156]
  - `verdict: Literal["accept", "reject"] | None = None` [L160]
  - `children: tuple[ChildSpec, ...] = ()` [L161]
  - `landed: bool = False` [L163]
  - `topology: dict[str, tuple[str, ...]] = field(default_factory=dict)` [L165]

- [LaunchAction](/path/to/repository/server/apps/orchestrator/state.py#L168)
  - `kind: ActionKind = "launch"` [L173]
  - `node_id: str = ""` [L174]
  - `phase: Phase = "implement"` [L175]
  - `depth: int = 0` [L176]
  - `attempt: int = 1` [L177]
  - `agent: str = ""` [L178]
  - `model: str = ""` [L179]
  - `corrective: bool = False` [L180]

- [Decision](/path/to/repository/server/apps/orchestrator/state.py#L183)
  - `next: RunState` [L185]
  - `actions: list[LaunchAction] = field(default_factory=list)` [L186]

**3. `server/apps/orchestrator/reducer.py`**
- `decide(state: RunState, event: Event) -> Decision` [L33-L64]
- Helpers:
  - `_apply_node_exit(state: RunState, event: Event) -> RunState` [L68-L138]
  - `_apply_verify_exit(state: RunState, node: Node, event: Event) -> RunState` [L141-L160]
  - `_apply_node_transition(state: RunState, event: Event) -> RunState` [L163-L193]
  - `_apply_node_cancelled(state: RunState, event: Event) -> RunState` [L196-L208]
  - `_recompute_halts(state: RunState) -> RunState` [L211-L224]
  - `_apply_integration_result(state: RunState, event: Event) -> RunState` [L227-L245]
  - `_add_children(state: RunState, parent: Node, children: tuple[ChildSpec, ...]) -> RunState` [L248-L265]
  - `_schedule(state: RunState) -> tuple[RunState, list[LaunchAction]]` [L269-L305]
  - `_fail_node(state: RunState, node: Node) -> RunState` [L309-L311]
  - `_halt_dependents(state: RunState, failed_id: str) -> RunState` [L314-L334]
  - `_finalize(state: RunState) -> RunState` [L338-L349]
  - `_in_flight(state: RunState) -> bool` [L352-L361]
  - `_release(state: RunState) -> RunState` [L365-L370]
  - `_apply_topology(state: RunState, topology: dict[str, tuple[str, ...]]) -> RunState` [L373-L382]
  - `_with_node(state: RunState, node: Node) -> RunState` [L385-L389]

**4. `server/apps/orchestrator/driver.py`**
- Module-level injection points / seams:
  - `fold(run_id, event, *, launch: Callable[[RunState, LaunchAction], None] | None = None)` accepts injected launcher [L307-L349]
  - `driver._default_launch` is the default launcher used when `launch is None` [L324-L349]
  - `headless.start(...)` is the injected launch scheduler seam [L800-L813]
  - `apps.core.session_registry.get_session()` is the injected interactive Session seam [L855-L856]
  - `apps.core.session_registry.get_headless()` is the injected headless-command seam [L53-L55]

- `fold(run_id, event: Event, *, launch: Callable[[RunState, LaunchAction], None] | None = None) -> Decision` [L307-L349]
  - Calls `dao.get_coordinator_run_select_for_update(run_id)` [L327]
  - Calls `dao.get_run_nodes_ordered(header)` [L328]
  - Calls `_live_topology([r.node_id for r in node_rows])` [L329]
  - Calls `rebuild_state(..., verify_enabled=_verify_enabled(header))` [L330-L332]
  - Calls `decide(state, event)` [L334]
  - Calls `_apply_budget_brake(...)` [L337-L341]
  - Calls `_persist(header, decision.next)` [L342]
  - Calls `_snapshot_decompose_children(header, decision.actions)` [L343]
  - Schedules each action with `transaction.on_commit(lambda a=action, s=decision.next: launcher(s, a))` [L345-L348]

- `_apply_budget_brake(decision: Decision, *, launches_so_far: int, max_total_runs: int) -> Decision` [L352-L377]
- `_snapshot_decompose_children(header, actions: Sequence[LaunchAction]) -> None` [L380-L396]
  - Calls `dao.get_child_issue_ids(action.node_id)` [L392-L394]
  - Calls `dao.update_run_node_child_snapshot(header.id, action.node_id, snapshot)` [L395]

- `_verify_enabled(header) -> bool` [L398-L415]
  - Calls `loader.load_pack(header.strategy)` [L403, L413]
  - Returns `False` for interactive or non-`auto` runs [L405-L411]

- `_persist(header, state: RunState) -> None` [L418-L447]
  - Reads `dao.get_run_nodes_ordered(header)` [L425]
  - Calls `dao.create_run_node(...)` for new nodes [L429-L438]

- `_live_topology(node_ids: Sequence[str]) -> dict[str, tuple[str, ...]]` [L449-L465]
  - Calls `dao.get_issues_with_blocked_by(id_set)` [L458]
  - Uses `issue.blocked_by.all()` to derive edges [L459-L464]

- `gather_decompose_facts(*, root_id: str, root_depth: int, remaining_budget: int) -> PostconditionResult` [L469-L522]
  - Calls `dao.get_root_issue(root_id)` [L492]
  - Calls `dao.get_child_issues_with_blocked_by(root_id)` [L493]
  - Uses `git_integration.topological_order(...)` [L487-L515]
  - Returns `check_decompose_postcondition(...)` [L517-L522]

- `_repo_root() -> str` [L534-L540]
- `_ticket_transitioned(node_id: str) -> bool` [L542-L547]
- `_ticket_cancelled(node_id: str) -> bool` [L549-L558]
- `_read_verdict(node_id: str) -> str | None` [L561-L575]
- `_record_verdict(run_row, vres) -> None` [L578-L583]
- `_latest_reject_findings(node_id: str) -> str` [L586-L594]
- `_node_diff(node_id: str) -> str` [L596-L611]
- `_build_node_exited(run_id, action: LaunchAction, run_row) -> Event` [L614-L669]
  - Calls `dao.get_coordinator_run(run_id)` [L619]
  - Verify path:
    - `check_verify_postcondition(verdict_payload=_read_verdict(action.node_id))` [L625]
    - `_record_verdict(run_row, vres)` [L626]
    - `resolve_exit(...)` [L627-L635]
  - Decompose path:
    - `gather_decompose_facts(...)` [L642-L646]
    - `_accumulate_created_tickets(run_id, action.node_id)` [L652]
    - `resolve_exit(...)` [L662-L669]
  - Implement path:
    - `PostconditionResult(ok=transitioned, detail="implement_transition_only")` [L660]

- `_accumulate_created_tickets(run_id, node_id: str) -> None` [L672-L699]
  - Calls `dao.get_coordinator_run_select_for_update(run_id)` [L684]
  - Calls `dao.get_run_node(run_id, node_id)` [L685]
  - Calls `dao.get_child_issue_ids(node_id)` [L690]
  - Writes `header.created_ticket_ids` and saves [L695-L698]

- `_default_launch(state: RunState, action: LaunchAction) -> None` [L701-L813]
  - Calls `load_pack(state.strategy)` [L742]
  - Calls `dao.get_issue_with_project(action.node_id)` [L743]
  - Uses `_node_diff(action.node_id)` for verify prompts [L745-L748]
  - Uses `_latest_reject_findings(action.node_id)` for corrective implement relaunches [L751-L759]
  - Uses `headless.start(headless.HeadlessSpec(...))` [L800-L813]
  - Emits on-launch-failed fold via `fold(run_id, Event(kind="node_exited", ...))` [L784-L799]

- `_launch_interactive(run_id, action: LaunchAction, issue, prompt: str) -> None` [L816-L887]
  - Calls `get_session().spawn(...)` [L855-L862]
  - Calls `dao.get_module_id_for(issue)` [L851]
  - On spawn success: `dao.update_run_node_agent_run_id(run_id, action.node_id, agent_run_id)` [L882-L884]
  - On spawn failure: folds `Event(kind="node_exited", ...)` [L873-L880]

- `handle_headless_exit(run_row) -> None` [L890-L911]
  - Calls `dao.get_run_node_for_adoption(run_row.task_id, ("running", "budget_exceeded"))` [L900]
  - Builds `LaunchAction(...)` [L903-L908]
  - Calls `_build_node_exited(run_id, action, run_row)` [L910]
  - Calls `fold(run_id, event)` [L911]

- `resume_supervision() -> list` [L914-L927]
  - Wraps `headless.reconcile(on_exit=_on_exit)` [L922-L927]

**5. `server/apps/orchestrator/headless.py`**
- Public API:
  - `worktracker_mcp_url() -> str` [L130-L131]
  - `build_headless_command(*, agent: str, model: str, prompt: str, mcp_url: str | None = None) -> list[str]` [L134-L166]
  - `start(spec: HeadlessSpec) -> None` [L75-L109]
  - `reconcile(*, on_exit: Callable[["HeadlessRun"], Awaitable[None]] | None = None, timeout_policy: TimeoutPolicy | None = None, pid_alive: Callable[[int], bool] | None = None) -> list[HeadlessRun]` [L111-L127]
  - `launch_headless_run(*, agent: str, model: str, task_id: str, prompt: str, cwd: str | os.PathLike[str], timeout_policy: TimeoutPolicy, phase: str | None = None, attempt: int | None = None, process_factory: ProcessFactory | None = None, on_exit: Callable[["HeadlessRun"], Awaitable[None]] | None = None) -> HeadlessRun` [L169-L235]
  - `parse_usage(stdout: str) -> tuple[dict[str, Any] | None, list[str]]` [L318-L349]
  - `adopt_recorded_runs(timeout_policy: TimeoutPolicy | None = None, *, pid_alive: Callable[[int], bool] | None = None, on_exit: Callable[["HeadlessRun"], Awaitable[None]] | None = None) -> list[HeadlessRun]` [L373-L403]
  - `is_pid_alive(pid: int) -> bool` [L448-L455]

- Private API:
  - `_supervise_process(run_id, process: Any, timeout_policy: TimeoutPolicy, started_at, on_exit: Callable[["HeadlessRun"], Awaitable[None]] | None = None) -> None` [L238-L286]
  - `_read_stdout(process: Any) -> str` [L288-L296]
  - `_terminate_process(process: Any) -> None` [L298-L306]
  - `_kill_process(process: Any) -> None` [L308-L316]
  - `_extract_usage(record: dict[str, Any]) -> dict[str, Any]` [L352-L370]
  - `_supervise_adopted_pid(run_id, pid: int, started_at, policy: TimeoutPolicy, on_exit: Callable[["HeadlessRun"], Awaitable[None]] | None = None, *, pid_alive: Callable[[int], bool] | None = None) -> None` [L406-L437]
  - `_notify_exit(run_id, on_exit: Callable[["HeadlessRun"], Awaitable[None]] | None) -> None` [L439-L445]

- Dataclasses / constants:
  - `DEFAULT_MCP_URL = "http://127.0.0.1:8123/mcp/"` [L17]
  - `RUNNING_STATUSES = {"running"}` [L18]
  - `TERMINAL_STATUSES = {"succeeded", "failed", "timed_out", "exited_unknown"}` [L19]
  - `BLOCK_REAL_SPAWN_ENV = "ORCHESTRATOR_BLOCK_REAL_SPAWN"` [L25]
  - `HeadlessLaunchError(RuntimeError)` [L28-L29]
  - `TimeoutPolicy(timeout_seconds: float, terminate_grace_seconds: float = 10.0)` [L32-L36]
  - `HeadlessSpec(agent: str, model: str, task_id: str, prompt: str, cwd: str | os.PathLike[str], timeout_seconds: float, phase: str | None = None, attempt: int | None = None, terminate_grace_seconds: float = 10.0, on_exit: Callable[["HeadlessRun"], Awaitable[None]] | None = None, on_launch_failed: Callable[["HeadlessLaunchError"], Awaitable[None]] | None = None, process_factory: ProcessFactory | None = None)` [L50-L72]

- Exact subprocess argv construction:
  - `build_headless_command()` delegates to `get_headless().headless_command(agent=agent, model=model, prompt=prompt, mcp_url=mcp_url or worktracker_mcp_url())` [L156-L166]
  - `launch_headless_run()` invokes `factory(*command, cwd=str(cwd_path), stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)` [L192-L208]
  - `command` is stored on `HeadlessRun.command` exactly as returned by `build_headless_command()` [L225-L227]

- `HeadlessRun` fields written and timing:
  - On create: `task_id`, `phase`, `attempt`, `agent`, `model`, `cwd`, `pid`, `process_handle`, `status="running"`, `timeout_seconds`, `timeout_grace_seconds`, `command`, `started_at` [L213-L227]
  - On termination/supervision: `status`, `exit_code`, `timed_out`, `stdout`, `usage`, `usage_parse_errors`, `finished_at` [L268-L276]
  - On verify path, `_record_verdict()` writes `verdict`, `verdict_findings` [L578-L583]

- Timeout mechanism:
  - `asyncio.wait_for(process.wait(), timeout=remaining)` [L250-L253]
  - On timeout: `terminate()` then `wait_for(..., timeout=terminate_grace_seconds)` then `kill()` if still alive [L253-L263]
  - Adopted live pids: loop polls `pid_alive(pid)` and when elapsed exceeds `timeout_seconds`, sends `SIGTERM`, waits `terminate_grace_seconds`, then `SIGKILL` if still alive [L416-L428]

**6. `server/apps/orchestrator/loader.py`**
- Public API:
  - `load_pack(strategy: str, *, root: Path | None = None) -> StrategyPack` [L131-L204]
  - `StrategyPack.prompt_for(self, phase: str, issue: "Issue", *, extra: dict[str, str] | None = None) -> str` [L83-L106]
  - `StrategyPack.strategy(self) -> "Strategy"` [L80-L81]

- `StrategyPack` fields [L64-L79]
  - `name: str`
  - `version: str`
  - `phases: tuple[str, ...]`
  - `templates: dict[str, str]`
  - `policy: ModelPolicy`

- `pack.toml` shape enforced by loader [L143-L204]
  - Required root keys:
    - `name` string, default fallback `strategy` [L199]
    - `version` string, default `""` [L200]
    - `phases` list[str] [L151-L155]
    - `policy` table/dict, default `{}` [L186-L188]
  - `phases` must include all `REQUIRED_PHASES = ("decompose", "implement")` [L39-L42]
  - Optional declared phase: `verify` [L43-L46]
  - Every declared phase must have `<phase>.md` [L171-L176]

- Interpolation whitelist tokens [L48-L53]
  - `key`
  - `name`
  - `description`
  - `children`
  - `project_id`
  - `project_slug`
  - `diff`

**7. `server/apps/orchestrator/policy.py`**
- Public API:
  - `normalize_policy(raw: Mapping[str, Any] | None, *, allowed_agents: frozenset[str], fallback_agent: str = "codex", fallback_model: str | None = None) -> ModelPolicy` [L85-L117]
  - `merge_policy(base: ModelPolicy, override: Mapping[str, Any] | None, *, allowed_agents: frozenset[str]) -> ModelPolicy` [L119-L156]

- Types / dataclasses:
  - `PolicyError(ValueError)` [L18-L20]
  - `ModelChoice(agent: str, model: str)` [L22-L26]
  - `PolicyRule(choice: ModelChoice, phase: Phase | None = None, depth: int | None = None, attempt: int | None = None)` [L28-L34]
  - `ModelPolicy(default: ModelChoice, rules: tuple[PolicyRule, ...] = ())` [L47-L50]

- Policy TOML / mapping shape [L92-L117, L125-L155]
  - Top-level table with:
    - `default = { agent = "...", model = "..." }`
    - `rules = [ { phase?, depth?, attempt?, agent, model }, ... ]`
  - `phase` may be `decompose | implement | verify` [L161-L163]
  - `depth` and `attempt` are nonnegative ints; `attempt == 0` rejected [L164-L167]
  - `rules` defaults to empty list, `None` normalized to empty [L107-L116]
  - `ModelPolicy.select(phase: Phase, depth: int, attempt: int) -> ModelChoice` [L52-L61]
  - `ModelPolicy.select_model(...) -> ModelChoice` [L63-L64]
  - `ModelPolicy.as_dict() -> dict[str, Any]` [L66-L82]

**8. `server/apps/orchestrator/dao/runs.py` + `dao/__init__.py`**
- Exported from `dao/__init__.py` [L3-L37]:
  - `has_active_run`
  - `create_coordinator_run`
  - `create_run_node`
  - `get_coordinator_run`
  - `get_coordinator_run_select_for_update`
  - `list_coordinator_runs`
  - `get_headless_runs`
  - `get_active_coordinator_runs`
  - `get_live_headless_runs`
  - `get_latest_headless_by_nodes`
  - `get_live_headless_runs_for_nodes`
  - `get_issues_for_index`
  - `get_issues_by_ids`
  - `get_child_issue_ids`
  - `update_run_node_child_snapshot`
  - `update_run_node_agent_run_id`
  - `get_module_id_for`
  - `get_interactive_run_ids_for_cancelled_node`
  - `get_agent_run_ids_for_run`
  - `get_issues_with_blocked_by`
  - `get_root_issue`
  - `get_issue_with_state`
  - `get_issue_with_project`
  - `get_latest_rejecting_verify_run`
  - `get_run_ids_for_node`
  - `get_run_node_statuses`
  - `get_run_node_ids`
  - `has_run_node`
  - `get_run_nodes_ordered`
  - `archive_issues`
  - `get_child_issues_with_blocked_by`
  - `get_run_node`
  - `get_run_node_for_adoption`

- Defined in `runs.py` [L9-L260]:
  - `has_active_run(parent_id: str, active_statuses: set[str]) -> bool` [L9-L15]
  - `create_coordinator_run(**kwargs) -> CoordinatorRun` [L17-L20]
  - `create_run_node(**kwargs) -> RunNode` [L23-L26]
  - `get_coordinator_run(run_id: str) -> CoordinatorRun` [L29-L32]
  - `get_coordinator_run_select_for_update(run_id: str) -> CoordinatorRun` [L35-L38]
  - `list_coordinator_runs(limit: int) -> list[CoordinatorRun]` [L41-L44]
  - `get_headless_runs(task_id: str, started_at_gte) -> list[HeadlessRun]` [L47-L54]
  - `get_active_coordinator_runs(active_statuses: set[str]) -> list[CoordinatorRun]` [L57-L60]
  - `get_live_headless_runs(live_statuses: set[str]) -> list[HeadlessRun]` [L63-L70]
  - `get_latest_headless_by_nodes(node_ids: list[str], started_at_gte) -> list[HeadlessRun]` [L73-L80]
  - `get_live_headless_runs_for_nodes(node_ids: list[str], live_statuses: set[str]) -> list[HeadlessRun]` [L83-L92]
  - `get_issues_for_index(issue_ids: list[str]) -> list[Issue]` [L95-L100]
  - `get_issues_by_ids(issue_ids: list[str]) -> list[Issue]` [L103-L106]
  - `get_child_issue_ids(parent_id: str) -> list[str]` [L109-L112]
  - `update_run_node_child_snapshot(run_id: str, node_id: str, child_snapshot: list[str] | None) -> None` [L115-L120]
  - `update_run_node_agent_run_id(run_id, node_id: str, agent_run_id: str) -> None` [L123-L128]
  - `get_module_id_for(issue: Issue) -> Optional[str]` [L131-L150]
  - `get_interactive_run_ids_for_cancelled_node(node_id: str, run_statuses: tuple[str, ...]) -> list[str]` [L153-L166]
  - `get_agent_run_ids_for_run(run: CoordinatorRun) -> list[str]` [L169-L176]
  - `get_issues_with_blocked_by(issue_ids: set[str]) -> list[Issue]` [L179-L184]
  - `get_root_issue(root_id: str) -> Issue` [L187-L190]
  - `get_issue_with_state(node_id: str) -> Issue` [L193-L196]
  - `get_issue_with_project(node_id: str) -> Issue` [L199-L202]
  - `get_latest_rejecting_verify_run(node_id: str) -> Optional[HeadlessRun]` [L205-L214]
  - `get_run_ids_for_node(node_id: str, run_statuses: tuple[str, ...]) -> list[str]` [L217-L224]
  - `get_run_node_statuses(run: CoordinatorRun) -> list[str]` [L227-L230]
  - `get_run_node_ids(run: CoordinatorRun) -> list[str]` [L233-L236]
  - `has_run_node(run: CoordinatorRun, node_id: str) -> bool` [L239-L242]
  - `get_run_nodes_ordered(run: CoordinatorRun) -> list[RunNode]` [L245-L248]
  - `archive_issues(ids: list[str]) -> list[Issue]` [L251-L258]
  - `get_child_issues_with_blocked_by(root_id: str) -> list[Issue]` [L261-L264]
  - `get_run_node(run_id: str, node_id: str) -> RunNode | None` [L267-L275]
  - `get_run_node_for_adoption(node_id: str, run_statuses: tuple[str, ...]) -> RunNode | None` [L278-L291]

**9. `server/apps/orchestrator/service.py`**
- Missing in repo. [not present]

**10. `server/apps/orchestrator/signals.py` + `startup.py` + `api.py`**
- `signals.py`
  - `observe_issue_state_changed(sender, issue_id, project_id=None, from_state_id=None, to_state_id=None, from_group=None, to_group=None, **kwargs) -> None` [L19-L73]
    - on `to_group == "completed"`: folds `Event(kind="node_transitioned", node_id=str(issue_id), transitioned=True)` through `driver.fold(...)` [L54-L72]
    - on `to_group == "cancelled"`: calls `_fold_interactive_cancel(str(issue_id))` [L47-L49]
  - `_fold_interactive_cancel(node_id: str) -> None` [L75-L103]
    - calls `dao.get_interactive_run_ids_for_cancelled_node(...)` [L88-L90]
    - folds `Event(kind="node_cancelled", node_id=node_id)` [L95-L99]
    - calls `_terminate_session(agent_run_id)` if `agent_run_id` exists [L101-L102]
  - `_terminate_session(agent_run_id: str) -> None` [L105-L111]
    - calls `get_session().terminate(agent_run_id)` [L106-L109]

- `startup.py`
  - `on_startup() -> None` [L24-L35]
    - calls `scheduler.bind_server_loop(asyncio.get_running_loop())` [L27]
    - calls `driver.resume_supervision()` [L29]
  - `lifespan_app(scope, receive, send) -> None` [L37-L48]
    - handles `lifespan.startup` / `lifespan.shutdown` [L41-L47]

- Wiring:
  - `server/studio_server/orchestrate_asgi.py`
    - sets `DJANGO_SETTINGS_MODULE="studio_server.orchestrate_settings"` [L16]
    - imports `lifespan_app` [L21]
    - `application = ProtocolTypeRouter({"http": django_asgi_app, "lifespan": lifespan_app})` [L23-L30]
  - `server/studio_server/orchestrate_settings.py`
    - `ROOT_URLCONF = "studio_server.orchestrate_urls"` [L4]
    - `ASGI_APPLICATION = "studio_server.orchestrate_asgi.application"` [L5]
    - `INSTALLED_APPS` includes `apps.orchestrator` and `apps.terminals` [L7-L25]

- `api.py`
  - `router = Router(tags=["orchestrator"])` [L21]
  - `StartRunIn(Schema)` fields [L24-L35]:
    - `parent_task_id: str`
    - `strategy: str = "default"`
    - `model: str | None = None`
    - `model_policy: dict[str, Any] | None = None`
    - `autonomy: str = "gated"`
    - `launch_mode: str = "headless"`
    - `check_command: str | None = None`
    - `max_depth: int = 2`
    - `max_concurrent: int = 3`
    - `max_total_runs: int = 10`
    - `run_context_id: str | None = None`
  - Routes:
    - `POST /runs` -> `create_run(request, payload: StartRunIn)` [L45-L50]
    - `GET /runs` -> `read_runs(request, limit: int = 50)` [L53-L56]
    - `POST /runs/kill-all` -> `kill_all(request)` [L58-L60]
    - `GET /runs/{run_id}/nodes/{node_id}/output` -> `read_node_output(request, run_id: str, node_id: str)` [L63-L68]
    - `GET /runs/{run_id}` -> `read_run(request, run_id: str)` [L71-L76]
    - `DELETE /runs/{run_id}` -> `delete_run(request, run_id: str, abort: bool = False, keep_tickets: bool = False)` [L79-L88]

**11. `server/apps/orchestrator/ports.py`**
- Full contents [L1-L61]
  - `SessionPort(Protocol)` [L17-L40]
    - `async def spawn(self, *, agent: str, project_id: str, module_id: str | None, task_id: str, scope: str = "task", initial_prompt: str | None = None) -> str` [L28-L37]
    - `def terminate(self, agent_run_id: str) -> None` [L39]
  - `HeadlessPort(Protocol)` [L42-L61]
    - `def headless_command(self, *, agent: str, model: str, prompt: str, mcp_url: str) -> list[str]` [L57-L59]
    - `def headless_agents(self) -> frozenset[str]` [L61]

**12. `apps.core` session registry + `server/apps/terminals/session.py`**
- `apps/core/session_registry.py`
  - `HeadlessUnsupported(Exception)` [L19-L26]
  - `bind(port: SessionPort) -> None` [L33-L37]
  - `get_session() -> SessionPort` [L39-L50]
  - `bind_headless(port: HeadlessPort) -> None` [L53-L57]
  - `get_headless() -> HeadlessPort` [L59-L69]
  - `reset() -> None` [L72-L76]
  - `reset_headless() -> None` [L78-L81]

- `server/apps/terminals/session.py`
  - `LaunchIntent(agent: str, project_id: str, module_id: str | None, task_id: str, scope: str = "task", initial_prompt: str | None = None, doc_rel_path: str | None = None, doc_id: str | None = None)` [L33-L43]
  - `ViewerSlotBusy(Exception)` [L45-L47]
  - `SessionNotFound(Exception)` [L49-L51]
  - `TerminalSessionError = TmuxSessionError` [L53]
  - `AttachHandle(agent_run_id: str, viewer_id: str, session: TmuxSession)` [L56-L63]
    - `attach_argv(self) -> list[str]` [L65-L66]
    - `scroll(self, direction: str, lines: int = 3) -> None` [L68-L70]
    - `resize(self, cols: int, rows: int) -> None` [L71-L73]
    - `refresh_client_size = resize` [L74]
    - `release(self) -> None` [L76-L80]
    - context manager methods `__enter__`, `__exit__` [L82-L86]
  - `TerminalSessionService.spawn(self, intent: LaunchIntent) -> str` [L89-L144]
    - returns `agent_run_id` [L99-L144]
    - internally calls `_launch(..., agent_run_id=agent_run_id)` [L132-L144]
  - `TerminalSessionService.terminate(self, agent_run_id: str) -> None` [L146-L175]
  - `TerminalSessionService.live_run_for(self, task_id: str) -> AgentRun | None` [L177-L182]
  - `TerminalSessionService.sessions_for(self, task_id: str) -> list[AgentTerminalSession]` [L184-L185]
  - `TerminalSessionService.attach(self, agent_run_id: str, *, viewer_id: str | None = None) -> AttachHandle` [L187-L198]
  - `TerminalSessionService.reconcile(self) -> tmux_sessions.ReconcileResult` [L200-L215]
  - `session = TerminalSessionService()` [L217]

- `session id` / `agent_run_id`
  - Orchestrator-side interactive launch returns `agent_run_id` from `SessionPort.spawn()` [ports.py L21-L37].
  - `TerminalSessionService.spawn()` generates `agent_run_id = uuid.uuid4().hex` and returns it through `_launch(...)` [session.py L99-L144].
  - `RunNode.agent_run_id` stores the latest-wins interactive terminal run id [models.py L104-L108].

**13. Tests in `server/apps/orchestrator/tests/`**
- `conftest.py` [L1-L96]
  - blocks real headless spawns with `ORCHESTRATOR_BLOCK_REAL_SPAWN=1` [L21-L24]
  - binds fake headless port `_FakeHeadlessPort` [L26-L80]
  - fake class names / signatures:
    - `_FakeHeadlessPort.headless_agents(self) -> frozenset[str]` [L39-L40]
    - `_FakeHeadlessPort.headless_command(self, *, agent, model, prompt, mcp_url) -> list[str]` [L42-L79]

- File coverage summary:
  - `test_console_surface.py` [L1-L?]: API console responses, run listing/detail/output serialization, stdout tailing, headless metadata rendering.
  - `test_coordinator_wiring.py` [L1-L?]: fold budget brake, decompose snapshot/abort archive, tracker-seam manual completion, restart adoption, launch scheduling.
  - `test_dao.py` [file present; DAO CRUD/query helpers]
  - `test_driver.py` [L1-L?]: pure driver helpers `rebuild_state`, `resolve_exit`, postconditions, verify parsing, budget logic.
  - `test_headless.py` [L1-L?]: headless argv construction, launch persistence, failures, timeout supervision, restart adoption.
  - `test_interactive_launch.py` [file present; interactive session spawn/teardown and registry binding]
  - `test_policy.py` [file present; policy normalization/resolution]
  - `test_reconcile.py` [file present; reconcile/adoption paths]
  - `test_reducer.py` [L1-L?]: pure reducer quadrants, scheduling, topology, retries, halt propagation, launch-mode behavior.
  - `test_scaffold.py` [file present; import-boundary enforcement]
  - `test_strategies.py` [L1-L?]: strategy pack loading, whitelist enforcement, prompt rendering, manifest errors.
  - `test_strategy.py` [L1-L?]: `Strategy` protocol compatibility.
  - `test_trigger_surface.py` [L1-L?]: API routes and run lifecycle wiring, gated launch, release semantics.

- `conftest.py` blocks real spawns:
  - yes, via env guard in `apps.orchestrator.headless` [conftest.py L21-L24; headless.py L21-L25]

- Fakes live:
  - `server/apps/orchestrator/tests/conftest.py` `_FakeHeadlessPort` [L26-L79]
  - interactive session fakes are in `test_interactive_launch.py` and related snippet harnesses [file present; import from `apps.core.session_registry`]

**14. How tests run**
- `server/pyproject.toml`
  - pytest config: `DJANGO_SETTINGS_MODULE = "studio_server.settings"` [L47-L50]
  - `asyncio_mode = "auto"` [L49]
  - `python_files = ["test_*.py"]` [L50]
- `server/manage.py`
  - default settings module: `studio_server.settings` [L6-L12]
- `server/apps/orchestrator/tests/*` snippet harnesses
  - most DB/integration tests override to `DJANGO_SETTINGS_MODULE="studio_server.orchestrate_settings"` and `PYTHONPATH=<server root>` [e.g. `test_console_surface.py` L16-L31, `test_coordinator_wiring.py` L23-L41, `test_trigger_surface.py` L13-L31]
- `server/README.md`
  - not present in repo path provided; no additional test invocation hints found there.
