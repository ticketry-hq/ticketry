# Ticketry workflow skill snapshot

This directory contains an unmodified snapshot of selected packages from
[`mattpocock/skills`](https://github.com/mattpocock/skills). The exact source,
installer, dependency closure, provider matrix, MCP requirements, and digests
are recorded in `lock.json`; the upstream MIT license is retained in
`UPSTREAM_LICENSE`.

Runtime code reads only these packaged resources. It never invokes `npx` or
downloads skill content. Desktop startup installs the verified snapshot into
each supported provider's normal persistent skill directory and refuses to
start if a user-owned conflict prevents that installation. The operation is
idempotent, upgrades only copies recorded in Ticketry's ownership manifest, and
can be repaired manually with:

```sh
muxed-backend skills install
```

Maintainers refresh the snapshot explicitly from the repository root:

```sh
cd backend
uv run python -m apps.terminals.agents.skills.refresh
```

The refresh runs `npx skills@latest add mattpocock/skills` in an isolated
temporary Git repository, resolves and checks out the exact upstream commit,
verifies the installer output byte-for-byte against that commit, and replaces
only `snapshot/`, `UPSTREAM_LICENSE`, and acquisition-derived lock fields.
Review the resulting Git diff, attribution, and provider matrix before merging.
