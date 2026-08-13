# CODING-555 dogfood record

Status: pending operator daily-driver observation
Decision: **NO-GO until the observation checklist is complete**
Date opened: 2026-08-12

## Automated copied-data gate

* Current Django SQLite fixture adoption, snapshot hash/reopen, restore proof,
  stable-field digest, ledger installation, and restart: automated by
  `work_management_adoption.rs`.
* Unknown owned-table schema refusal before ledger creation: automated.
* Authored Rust command, GraphQL, MCP, persistence, and transition-occurrence
  suites: required in the validation transcript for this ticket.
* Studio create/edit/transition/reparent/blocker/reorder/catalogue mutation
  routing through desktop GraphQL: numbered acceptance case `overhaul-74`.
* Django REST mutation refusal and continued Django-owned execution route
  availability: automated by `test_write_ownership.py`.

## Operator copied-installation pass

Use `MUXED_DATA_DIR` with a private copy, never the ordinary installation.
The copy must be a supported current SQLite installation; PostgreSQL is
deliberately refused by this slice.

* [ ] Open real projects and verify IDs, keys, ranks, revisions, hierarchy,
  dependencies, workflow settings, and attachments.
* [ ] Create and edit a Project, Module, Story, and Implementation.
* [ ] Exercise first and later Module drag, task reorder, reparent, blocker,
  legal transition, and rejected transition rollback.
* [ ] Exercise workflow revision conflict and launch binding edits.
* [ ] Launch an agent, use its Rust MCP task tools, and terminate its own run.
* [ ] Exercise auto-start, restart before consumption, and verify one attempt /
  one run for the transition occurrence.
* [ ] Restart Ticketry and verify all changes persist and transports become
  ready together.
* [ ] Inspect `.ticketry-dev/logs/ticketry.log` for credentials, raw local
  attachment paths, retries, duplicate launches, and fallback to Python MCP.
* [ ] Exercise a pre-readiness failure and verify snapshot discovery/restore
  guidance. Confirm the UI/docs never promise post-write automatic downgrade.

## Ordinary daily-driver observation

* [ ] Day 1 completed with no fallback writer, lost write, duplicate launch,
  unrecoverable startup, or unexplained operational friction.
* [ ] Day 2 completed with the same criteria.
* [ ] Record failures and friction below, even if the final result is no-go.

### Observations

Not yet performed in this coding session. The migration must not proceed to a
later slice until a human operator completes this section and changes the
decision to GO.

## 2026-08-12 validation transcript

The implementation-only gates completed successfully:

* `cargo test` (including authored commands, GraphQL, MCP listener,
  persistence/adoption, transition occurrences, recovery, supervisor, and tmux
  integration);
* the seven targeted Django ownership/occurrence tests;
* `npm run test:overhaul --workspace @worktracker/studio` (38 files, 93 tests,
  including `overhaul-74`);
* Studio typecheck, production build, and GraphQL generation drift check; and
* Rust formatting plus `git diff --check`.

The ordinary installation compatibility preflight is a no-go: its enabled
database marker selects PostgreSQL, which this slice deliberately refuses, and
the SQLite file beside it is at historical WorkTracker migration `0030`, while
the implemented SQLite adopter accepts only the current `0042` leaf or an
already Rust-owned database. No ordinary data was mutated. A consistent,
acceptance-tested PostgreSQL import and the supported historical SQLite bridge
must exist before the copied-installation and two-day observation can begin.
