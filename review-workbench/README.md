# Ticketry final-review workbench

A disposable, local-only review surface for
`backend/worktracker/reviewed_defaults.json`, the single source of truth for
reviewed repository guidance, launch prompts, state vocabulary, and workflow
graphs.

Run:

```bash
npm run dev
```

Open `http://127.0.0.1:4174`.

Drafts are stored in browser storage. **Finalize review** validates and updates
the tracked artifact, then derives `AGENTS.md` from the accepted artifact's
guidance. It does not write a second artifact.

The workbench fetches and renders that artifact directly. The backend seed
modules `backend/worktracker/launch_seeds.py` and
`backend/worktracker/workflow_seeds.py` are consumers of the artifact; they are
not alternate definitions of these defaults.
