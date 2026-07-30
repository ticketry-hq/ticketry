# The reviewed defaults artifact is the single vocabulary source

The canonical state vocabulary, task issue types, per-type workflow graphs, and
per-stage skill requirements are declared exactly once, in the reviewed defaults
artifact; the backend state constants, the finalization validator, and the
default skill requirements all derive from it at boot rather than restating it.
We rejected keeping the three hand-maintained copies in lockstep because every
stage rename or insertion silently required four coordinated edits and any
missed copy failed at project-creation time rather than at review time. The
accepted cost is that the validator can no longer detect an unintended state
rename — it now enforces shape and graph invariants only, and the migration and
seeding tests are the sole guard against vocabulary drift.
