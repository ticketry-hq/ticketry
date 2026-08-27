# Ticketry desktop application

Ticketry is a React application hosted by a Tauri desktop shell. The desktop
process owns the SeaORM database, Seaography GraphQL schema, MCP listener,
terminal lifecycle, and native host operations directly. There is no Python
product runtime or external REST contract.

```text
studio/   React/Vite frontend, Tauri shell, Rust services, and generated GraphQL contracts
scripts/  Development, validation, and release tooling
spec/     Application design history
```

## Development

Install dependencies, then launch the canonical desktop application:

```bash
npm install
npm run desktop:dev
# or: pnpm run dev
```

The launcher rebuilds the Rust application as `Ticketry Dev`, with its own app
identifier and a per-worktree development profile. It can run beside an
installed `Ticketry` app without sharing data, tmux sessions, frontend ports,
or MCP listeners. Frontend, Rust runtime, and MCP output is written to
`.ticketry-dev/logs/ticketry.log`.

Browser-only development uses a small Rust GraphQL adapter. It is a supporting
tool for frontend work, not a separately deployable Ticketry backend:

```bash
npm run web
```

The web launcher and installed app use the same product database and tmux
namespace. Only one may run at a time. The second process refuses to open the
data directory while the first process owns it.

[`config/product-identity.json`](config/product-identity.json) owns the default
data-directory name and the supported configuration variables. Set
`TICKETRY_DATA_DIR` to choose a full path, or `TICKETRY_DATA_DIR_NAME` to choose
one directory below `~/.config`.

Use `--temp-sqlite` with either command for a disposable profile. Ticketry
starts that profile empty, removes it after a clean exit, and stops only tmux
sessions created in its temporary namespace. Normal shutdown preserves
intentional tmux sessions.

## Validation

```bash
npm run caller:check
npm run typecheck
npm run test:overhaul --workspace @worktracker/studio
npm run test --workspace @worktracker/studio
npm run build --workspace @worktracker/studio
cargo check --locked --manifest-path studio/src-tauri/Cargo.toml
```

See [`studio/release/OPERATIONS.md`](studio/release/OPERATIONS.md) for build,
signing, notarization, installation, and recovery procedures.

## License

MIT. See [`LICENSE`](LICENSE).
