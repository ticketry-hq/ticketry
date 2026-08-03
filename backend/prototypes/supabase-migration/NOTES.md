# Prototype verdict

The current hypothesis is **yes, as a hybrid migration**: Supabase should own
shared durable state while the desktop sidecar continues to own machine-local
execution. The safest first slice is Django-on-Supabase-Postgres, not a direct
React-to-table rewrite.

Open decision after driving the prototype:

- Is blocking new shared mutations while offline acceptable for Ticketry, or
  is a real offline-first conflict model a requirement?
- Should agent-run history be visible across machines, and which host-local
  fields must be split from that shared record?
- Are design documents shared product data, git-owned artifacts, or only a
  local discovery index?
