# Profile-scoped module folders stay in local settings

A Module folder is stored as a `{module_id, path}` link inside its positional
local profile, rather than in planning data. Filesystem paths are machine-local,
and profiles intentionally retain their existing array-position selection
instead of gaining durable IDs for this migration. Module IDs are stored without
validation against planning data, so no database foreign key can protect the
relationship; Studio accepts that trade-off and enforces the operational
invariant in the UI by requiring the active profile's link before a module can be
worked on.

## Consequences

- Legacy module-folder dictionaries migrate to links when local settings load,
  and the next save emits only links.
- A module may resolve to different paths in different profiles, and stale links
  are neither synchronized nor garbage-collected by the planning system.
