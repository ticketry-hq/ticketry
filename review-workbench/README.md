# Ticketry final-review workbench

A disposable, local-only review surface for the defaults currently defined in:

- `AGENTS.md`
- `backend/worktracker/launch_seeds.py`
- `backend/worktracker/workflow_seeds.py`

Run:

```bash
npm run dev
```

Open `http://127.0.0.1:4174`.

Drafts are stored in browser storage. **Finalize review** writes
`review-output.json` beside this file as an ignored audit artifact, updates the
tracked `backend/worktracker/reviewed_defaults.json`, and applies the reviewed
repository guidance to `AGENTS.md`. New Ticketry projects seed their explicit
launch bindings from that reviewed per-issue-type matrix.
