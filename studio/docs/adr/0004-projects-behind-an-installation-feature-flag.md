# Projects is gated by an installation feature flag, not removed

Projects is a real concept in the tracker — modules, work items, states, issue types, launch bindings and per-type workflows are all project-scoped, and `create_project` is what seeds every one of them — but it is a large amount of learning curve to put in front of someone's first hour, and most installs only ever want one. Rather than remove the concept (the shape CODIN-1457 originally proposed), we gate its *surface* behind an installation feature flag read from `features.json` in the local config directory, defaulting to hidden, and add a single backend resolver, `resolve_current_project()`, that answers "which project owns this" with the project whose slug is `CODING`, creating it on demand.

We chose a config file over a database row because the flag is a property of an installation, not of the data an installation holds: it must be answerable before any project exists, it should survive a database reset, and turning it back on should be one line in one file rather than a migration. We chose to gate the surface rather than the API so that the domain, the REST contract and the MCP tools stay project-scoped and the flag stays genuinely reversible — flipping it changes what is rendered and which project is resolved, and nothing else.

## Consequences

- With the flag off, project rows other than `CODING` still exist and are still reachable over REST and MCP; they are simply invisible in Studio. An install that already keeps real work in a differently-named project will look empty until the flag is turned on.
- Workflow, state and issue-type settings are project-scoped configuration being edited without a visible project selector. They operate on the resolved project.
- The flag is read once at process start. Editing `features.json` mid-session does nothing until restart, because pane order, keyboard traversal and the resolved project are all settled during bootstrap.
