# 12 — WorkItemKey and WorkItemListRow

**Parent:** Shared UI component library for Studio (`../spec.md`)
**Blocked by:** 11
**Status:** ready-for-agent
**LLD:** `12-work-item-key-and-list-row/LLD.md` (+ `LLD.html`)

**What to build:** `features/work-items/` exports `WorkItemKey` (formatted display identifier, shared key style, optional state colour) and `WorkItemListRow` (state `StatusDot`, key, name, trailing slot, click/selected). Child issues, findings and the work-item search list render work items identically. The Stories tree label uses `WorkItemKey`.

**Instances:**
- Key cell `w-20 flex-none font-mono text-xs text-text-muted`: `features/work-items/WorkItemSearchList.tsx:104` (private `Identifier`), `details/ChildIssues.tsx:54`, `details/FindingsPanel.tsx:65`.
- Row body: `ChildIssues.tsx:47`, `FindingsPanel.tsx:59` (with `FindingLocationLabel` and state pill as trailing).
- Tree label: `app/shell/ticket-workspace/tasks/components/WorkItemRowLabel.tsx` (keeps `id · name` format and `data-task-id-token`).
- Other identifier renderers to check: `IssueDetail.tsx:241`, `BlockerChipView.tsx:23`, `Breadcrumb.tsx:31`, `fields/ParentPicker.tsx:54`.
- Single state style: the square chip ("■ Ideas"), replacing the tinted pill in findings.

- [ ] Both components are exported from `features/work-items/index.ts` with tests (key formatting fallback, trailing slot, selected state).
- [ ] ChildIssues, FindingsPanel and WorkItemSearchList use `WorkItemListRow`; the private `Identifier` is deleted.
- [ ] `WorkItemRowLabel` renders its key via `WorkItemKey`; Stories-pane tests pass unchanged.
- [ ] Typecheck, studio tests and `test:overhaul` pass.
