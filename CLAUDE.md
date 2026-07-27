# Agent guidance — unified Studio application

**Read this before changing anything in this repository.** The repository
contains the complete Studio application: its Django backend and `worktracker`
app at `backend/`, API surfaces, and one frontend. The canonical frontend entry is
`studio/index.html` → `studio/src/main.tsx`; its Vite development server listens
on `127.0.0.1:5174`. Work-item planning, agent lifecycle, terminals,
worktrees, documents, prompts, modals, and launch flows belong to this
application.

Use the application’s canonical runtime scripts. `scripts/dev.sh studio` starts
the browser frontend; `npm run desktop:dev` and `pnpm dev` rebuild the sidecar
and launch the desktop application.

## Reference

| Doc | Purpose |
| --- | --- |
| [`README.md`](README.md) | Application layout and install/run/validate commands. |

## Runtime validation

Install from the repository root, then run:

```bash
npm run typecheck
npm run test --workspace @worktracker/studio
npm run build --workspace @worktracker/studio
```

Keep the runtime facts here and in [`AGENTS.md`](AGENTS.md) consistent.
