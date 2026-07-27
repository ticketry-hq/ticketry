import { describe, expect, it } from "vitest";
import {
  createSettingsChangeLedger,
  observeConfirmedSettings,
} from "../features/settings/changeLedger";
import type { State } from "../shared/api/types";

const states: State[] = [
  {
    id: "todo",
    name: "Todo",
    group: "unstarted",
    color: "#64748b",
    sort_order: 0,
  },
];

describe("settings change ledger", () => {
  it("does not record an optimistic update that rolls back", () => {
    const initial = observeConfirmedSettings(
      createSettingsChangeLedger(),
      {
        projectId: "project-1",
        loading: false,
        action: null,
        states,
        issueTypes: [],
        workflows: {},
      },
      1,
    );
    const optimistic = observeConfirmedSettings(
      initial,
      {
        projectId: "project-1",
        loading: false,
        action: "state:todo",
        states: [{ ...states[0], name: "Ready" }],
        issueTypes: [],
        workflows: {},
      },
      2,
    );
    const rolledBack = observeConfirmedSettings(
      optimistic,
      {
        projectId: "project-1",
        loading: false,
        action: null,
        states,
        issueTypes: [],
        workflows: {},
      },
      3,
    );

    expect(rolledBack.entries).toEqual([]);
  });
});
