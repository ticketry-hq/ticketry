# Ticketry workflow skill snapshot

This directory contains an unmodified snapshot of selected packages from
[`mattpocock/skills`](https://github.com/mattpocock/skills). The exact source,
installer, dependency closure, provider matrix, MCP requirements, and digests
are recorded in `lock.json`; the upstream MIT license is retained in
`UPSTREAM_LICENSE`.

Runtime code never invokes `npx` or downloads skill content. A valid existing
provider-visible skill satisfies a workflow requirement regardless of its
content digest. When a required name is absent, Ticketry installs its bundled
snapshot as an offline fallback in the provider's normal persistent skill
directory. When the bundled snapshot changes, Ticketry updates copies whose
bytes still match their recorded installation digest. It preserves user-owned
and edited copies, and warns when a managed copy contains edits. Installation
is idempotent and can also be run manually with:

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
