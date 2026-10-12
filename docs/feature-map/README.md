# Frontend feature map

This map describes frontend ownership and generated GraphQL entry points for CODING-2727. Coverage links identify existing tests; they do not assert that a gate passed.

- [Projects and modules](projects.md)
- [Ticket details](ticket-details.md)
- [Stories list](stories-list.md)
- [Workflows and issue types](workflows-and-issue-types.md)
- [Remaining server-record inventory and conversion exceptions](remaining-server-record-inventory.md)

Apollo owns raw server records. Features derive display views from generated operation selections through `studio/src/shared/api/worktrackerConversion.ts`; `state/` must not import generated documents or the adopted feature record contracts.

The implementation handoff must report the actual outcomes of GraphQL generation/drift, typecheck, architecture lint, tests, build, overhaul acceptance, overhaul Playwright and the three database/transport specs. This map is a coverage index, not that execution report.
