# App-server schema facts

- Generated command: `codex app-server generate-ts --out ./schemas`
- Output: 663 TypeScript files.
- Root contract families: `ClientRequest`, `ClientNotification`, `ServerRequest`, `ServerNotification`, and supporting root types.
- Versioned types live under `schemas/v2/`.
- Request methods include thread lifecycle, turn lifecycle, skills, hooks, marketplace, plugins, apps, filesystem access, model discovery, experimental features, permissions, MCP, accounts, feedback, command execution, configuration, and external agent import.
- A request union member carries a literal `method`, request `id`, and typed `params`.
- The explorer is read-only and works against generated local files. It does not send requests to an app-server.
