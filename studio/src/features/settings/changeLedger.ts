import type {
  IssueType,
  ProviderCatalog,
  ScopedWorkflowLaunchBinding,
  ScopedWorkflowSettings,
  ScopedWorkflowTransition,
  State,
} from "../../shared/api/types";

export type SettingsLedgerTone = "pending" | "applied";

export interface SettingsLedgerEntry {
  id: number;
  section: "States" | "Issue types" | "Models";
  summary: string;
  tone: SettingsLedgerTone;
  timestamp: number | null;
  transition: "entry" | "commit";
}

interface ConfirmedCollections {
  projectId: string | null;
  states: State[];
  issueTypes: IssueType[];
  workflows: Record<string, ScopedWorkflowSettings>;
}

export interface SettingsChangeLedger {
  entries: SettingsLedgerEntry[];
  confirmed: ConfirmedCollections | null;
  nextId: number;
}

export interface ObservedSettingsCollections extends ConfirmedCollections {
  loading: boolean;
  action: string | null;
}

export function createSettingsChangeLedger(): SettingsChangeLedger {
  return { entries: [], confirmed: null, nextId: 1 };
}

const stateKey = (state: State): string => state.id ?? `name:${state.name}`;
const displayValue = (value: string | null | undefined): string =>
  value && value.trim() ? value : "not configured";

function stateName(
  states: State[],
  stateId: string | null | undefined,
): string {
  if (!stateId) return "not configured";
  return states.find((state) => state.id === stateId)?.name ?? stateId;
}

function typeName(issueTypes: IssueType[], typeId: string): string {
  return issueTypes.find((type) => type.id === typeId)?.name ?? typeId;
}

function cloneCollections(
  input: ConfirmedCollections,
): ConfirmedCollections {
  return structuredClone(input);
}

function diffStates(previous: State[], next: State[]): string[] {
  const changes: string[] = [];
  const previousById = new Map(previous.map((state) => [stateKey(state), state]));
  const nextById = new Map(next.map((state) => [stateKey(state), state]));

  for (const state of next) {
    const before = previousById.get(stateKey(state));
    if (!before) {
      changes.push(`added ${state.name}`);
      continue;
    }
    if (before.name !== state.name) {
      changes.push(`${before.name} renamed to ${state.name}`);
    }
    if (before.group !== state.group) {
      changes.push(
        `${state.name} group changed from ${before.group} to ${state.group}`,
      );
    }
    if (before.color !== state.color) {
      changes.push(
        `${state.name} color changed from ${displayValue(before.color)} to ${displayValue(state.color)}`,
      );
    }
  }
  for (const state of previous) {
    if (!nextById.has(stateKey(state))) changes.push(`deleted ${state.name}`);
  }

  const previousOrder = previous.map(stateKey);
  const nextOrder = next.map(stateKey);
  if (
    previousOrder.length === nextOrder.length &&
    previousOrder.some((key, index) => key !== nextOrder[index])
  ) {
    changes.push(`order changed to ${next.map((state) => state.name).join(" → ")}`);
  }
  return changes;
}

const transitionKey = (
  transition: ScopedWorkflowTransition,
): string => `${transition.from_state_id}:${transition.to_state_id}`;

const bindingKey = (
  binding: ScopedWorkflowLaunchBinding,
): string => binding.state_id;

function diffWorkflow(
  previous: ScopedWorkflowSettings,
  next: ScopedWorkflowSettings,
  states: State[],
  issueTypes: IssueType[],
): string[] {
  const changes: string[] = [];
  const prefix = typeName(issueTypes, next.issue_type_id);
  if (previous.start_state_id !== next.start_state_id) {
    changes.push(
      `${prefix} start state changed from ${stateName(states, previous.start_state_id)} to ${stateName(states, next.start_state_id)}`,
    );
  }

  const previousTransitions = new Map(
    previous.transitions.map((transition) => [
      transitionKey(transition),
      transition,
    ]),
  );
  const nextTransitions = new Map(
    next.transitions.map((transition) => [transitionKey(transition), transition]),
  );
  for (const transition of next.transitions) {
    const before = previousTransitions.get(transitionKey(transition));
    const path =
      `${stateName(states, transition.from_state_id)} → ` +
      stateName(states, transition.to_state_id);
    if (!before) {
      changes.push(`${prefix} allowed ${path}`);
    } else if (before.agent_allowed !== transition.agent_allowed) {
      changes.push(
        `${prefix} ${path} changed to ${
          transition.agent_allowed ? "agents + people" : "people only"
        }`,
      );
    }
  }
  for (const transition of previous.transitions) {
    if (!nextTransitions.has(transitionKey(transition))) {
      changes.push(
        `${prefix} removed ${stateName(states, transition.from_state_id)} → ${stateName(states, transition.to_state_id)}`,
      );
    }
  }

  const previousBindings = new Map(
    previous.launch_bindings.map((binding) => [bindingKey(binding), binding]),
  );
  const nextBindings = new Map(
    next.launch_bindings.map((binding) => [bindingKey(binding), binding]),
  );
  for (const binding of next.launch_bindings) {
    const before = previousBindings.get(bindingKey(binding));
    const destination = stateName(states, binding.state_id);
    if (!before) {
      changes.push(`${prefix} added launch configuration for ${destination}`);
      continue;
    }
    const fields = [
      ["provider", before.agent, binding.agent],
      ["model", before.model, binding.model],
      ["reasoning", before.reasoning, binding.reasoning],
      ["prompt", before.prompt, binding.prompt],
    ] as const;
    for (const [label, oldValue, newValue] of fields) {
      if (oldValue !== newValue) {
        changes.push(
          `${prefix} ${destination} launch ${label} changed from ${displayValue(oldValue)} to ${displayValue(newValue)}`,
        );
      }
    }
    if (before.auto_start !== binding.auto_start) {
      changes.push(
        `${prefix} ${destination} auto-start ${binding.auto_start ? "enabled" : "disabled"}`,
      );
    }
    if (before.subtree_run_enabled !== binding.subtree_run_enabled) {
      changes.push(
        `${prefix} ${destination} subtree runs ${binding.subtree_run_enabled ? "enabled" : "disabled"}`,
      );
    }
  }
  for (const binding of previous.launch_bindings) {
    if (!nextBindings.has(bindingKey(binding))) {
      changes.push(
        `${prefix} removed launch configuration for ${stateName(states, binding.state_id)}`,
      );
    }
  }
  return changes;
}

function diffConfirmedCollections(
  previous: ConfirmedCollections,
  next: ConfirmedCollections,
): Array<Pick<SettingsLedgerEntry, "section" | "summary">> {
  const changes: Array<Pick<SettingsLedgerEntry, "section" | "summary">> =
    diffStates(previous.states, next.states).map((summary) => ({
      section: "States",
      summary,
    }));

  for (const [typeId, workflow] of Object.entries(next.workflows)) {
    const before = previous.workflows[typeId];
    if (!before) continue;
    changes.push(
      ...diffWorkflow(
        before,
        workflow,
        next.states,
        next.issueTypes,
      ).map((summary) => ({ section: "Issue types" as const, summary })),
    );
  }
  return changes;
}

export function observeConfirmedSettings(
  ledger: SettingsChangeLedger,
  input: ObservedSettingsCollections,
  now = Date.now(),
): SettingsChangeLedger {
  if (input.loading) {
    return ledger.confirmed
      ? { ...ledger, confirmed: null }
      : ledger;
  }
  if (input.action !== null) return ledger;

  const nextConfirmed = cloneCollections(input);
  if (
    !ledger.confirmed ||
    ledger.confirmed.projectId !== input.projectId
  ) {
    return {
      ...ledger,
      entries:
        ledger.confirmed?.projectId !== input.projectId ? [] : ledger.entries,
      confirmed: nextConfirmed,
    };
  }

  const changes = diffConfirmedCollections(ledger.confirmed, nextConfirmed);
  if (!changes.length) {
    return { ...ledger, confirmed: nextConfirmed };
  }

  let nextId = ledger.nextId;
  const entries = changes.map((change) => ({
    ...change,
    id: nextId++,
    tone: "applied" as const,
    timestamp: now,
    transition: "entry" as const,
  })).reverse();
  return {
    entries: [...entries, ...ledger.entries],
    confirmed: nextConfirmed,
    nextId,
  };
}

export function describeModelConfigurationChanges(
  saved: ProviderCatalog | null,
  draft: ProviderCatalog,
): string[] {
  if (!saved) return [];
  const changes: string[] = [];
  for (const provider of ["claude", "codex", "gemini"] as const) {
    const before = saved.activated_providers.includes(provider);
    const after = draft.activated_providers.includes(provider);
    if (before !== after) {
      changes.push(
        `${provider} activation changed from ${before ? "On" : "Off"} to ${after ? "On" : "Off"}`,
      );
    }
  }
  const fields = [
    [
      "launch provider",
      saved.global_default?.provider,
      draft.global_default?.provider,
    ],
    ["launch model", saved.global_default?.model, draft.global_default?.model],
    [
      "launch reasoning",
      saved.global_default?.reasoning,
      draft.global_default?.reasoning,
    ],
  ] as const;
  for (const [label, before, after] of fields) {
    if ((before ?? null) !== (after ?? null)) {
      changes.push(
        `${label} changed from ${displayValue(before)} to ${displayValue(after)}`,
      );
    }
  }
  return changes;
}

export function syncPendingSettingsChanges(
  ledger: SettingsChangeLedger,
  section: "Models",
  summaries: string[],
): SettingsChangeLedger {
  const existing = ledger.entries.filter(
    (entry) => entry.section === section && entry.tone === "pending",
  );
  const retained = ledger.entries.filter(
    (entry) => entry.section !== section || entry.tone !== "pending",
  );
  const bySummary = new Map(existing.map((entry) => [entry.summary, entry]));
  let nextId = ledger.nextId;
  const activeSummaries = new Set(summaries);
  const retainedPending = existing.filter((entry) =>
    activeSummaries.has(entry.summary));
  const newPending = summaries.flatMap((summary) => {
    if (bySummary.has(summary)) return [];
    return [{
      id: nextId++,
      section,
      summary,
      tone: "pending" as const,
      timestamp: null,
      transition: "entry" as const,
    }];
  }).reverse();

  return {
    ...ledger,
    entries: [...newPending, ...retainedPending, ...retained],
    nextId,
  };
}

export function commitPendingSettingsChanges(
  ledger: SettingsChangeLedger,
  section: "Models",
  summaries: string[],
  now = Date.now(),
): SettingsChangeLedger {
  const committed = new Set(summaries);
  return {
    ...ledger,
    entries: ledger.entries.map((entry) =>
      entry.section === section &&
      entry.tone === "pending" &&
      committed.has(entry.summary)
        ? {
            ...entry,
            tone: "applied",
            timestamp: now,
            transition: "commit",
          }
        : entry),
  };
}
