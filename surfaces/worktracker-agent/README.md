# worktracker-agent

A standalone [FastMCP](https://github.com/jlowin/fastmcp) server wired directly
to the owned worktracker backend. The run-scoped `terminate_current_run` tool
also forwards its request authorization to Studio's terminal authority.

## Backend

All calls go to the owned worktracker HTTP API:

```
http://127.0.0.1:8787/api/work-tracker
```

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `WORKTRACKER_BASE_URL` | `http://127.0.0.1:8787/api/work-tracker` | Owned worktracker API base URL |
| `WORKTRACKER_API_KEY` | _unset_ | Optional. When unset, the `x-api-key` header is omitted (dev mode) |
| `STUDIO_RUN_CONTROL_URL` | `http://127.0.0.1:8787/api/terminals/self-terminate` | Studio's authenticated current-run termination endpoint |
| `MCP_TRANSPORT` | `http` | FastMCP transport |
| `MCP_HOST` | `127.0.0.1` | Bind host for http/sse |
| `MCP_PORT` | `8123` | Pinned WorkTracker MCP port |

## Running

```bash
python -m worktracker_agent.mcp.main
```

## Tools

`mcp_ping`, `terminate_current_run`, `list_projects`, `list_modules`, `list_tasks`, `get_task_details`,
`create_task`, `create_sub_task`, `update_task_status`,
`append_task_description`, `set_task_blockers`, `add_task_blocker`,
`add_task_dependent`, `get_task_scope_context`, `attach_file`,
`reparent_tasks`, `get_issue_type_workflow_settings`,
`add_issue_type_workflow_transition`, `remove_issue_type_workflow_transition`,
`set_issue_type_workflow_transition_permission`,
`set_issue_type_workflow_start_state`,
`upsert_issue_type_workflow_launch_binding`,
`clear_issue_type_workflow_launch_binding`, and
`set_issue_type_workflow_auto_start`.
