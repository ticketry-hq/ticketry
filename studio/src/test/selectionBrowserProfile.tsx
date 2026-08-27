import React from "react";
import { createRoot } from "react-dom/client";
import { TasksPane } from "../app/shell/ticket-workspace/tasks/TasksPane";
import { useStudioStore, setStatesSorted } from "../features/projects";
import { seedConfig } from "../features/studio/stores/configStore";
import { WorkTrackerModuleOpenDocument } from "../features/work-items/generated/workItems.documents";
import { createBrowserRuntime, initializeStudioRuntime } from "../runtime";
import { StudioApolloProvider } from "../shared/apollo/StudioApolloProvider";
import { studioApolloClient } from "../shared/apollo/client";
import { useClientStore } from "../state/clientStore";

type Counts = Record<string, number>;
type ProfileResult = {
  size: number;
  commitP50Ms: number;
  commitP95Ms: number;
  paintP50Ms: number;
  paintP95Ms: number;
  maxPaintMs: number;
  meanCounts: Counts;
};

declare global {
  interface Window {
    __profileReady?: boolean;
    runSelectionProfile?: () => Promise<ProfileResult>;
  }
}

const params = new URLSearchParams(window.location.search);
const size = Number(params.get("size") ?? "100");
const ids = Array.from({ length: size }, (_, index) => `profile-${index}`);
const state = {
  __typename: "WorktrackerState" as const,
  id: "state-1",
  name: "Ideas",
  group: "backlog",
  color: "",
  sort_order: 0,
  is_protected: false,
};
const issueType = {
  __typename: "WorktrackerIssuetype" as const,
  id: "story",
  name: "Story",
  level: "task",
  color: "",
  sort_order: 1,
};
const workItems = ids.map((id, index) => ({
  __typename: "WorktrackerIssue" as const,
  id,
  name: `Profile item ${index}`,
  project_id: "project-1",
  sequence_id: index + 1,
  state_id: state.id,
  description: "",
  parent_id: "module-1",
  module_id: "module-1",
  is_archived: false,
  created_at: "2026-08-06T12:00:00Z",
  updated_at: "2026-08-06T12:00:00Z",
  rank: String(index).padStart(6, "0"),
  issue_type_id: issueType.id,
  project: {
    __typename: "WorktrackerProject" as const,
    id: "project-1",
    slug: "T",
  },
  state_record: state,
  issue_type_record: issueType,
  children: {
    __typename: "WorktrackerIssueConnection" as const,
    nodes: [],
  },
  blocked_by_edges: {
    __typename: "WorktrackerIssueBlockedByConnection" as const,
    nodes: [],
  },
  blocks_edges: {
    __typename: "WorktrackerIssueBlockedByConnection" as const,
    nodes: [],
  },
}));
const moduleData = {
  module: {
    __typename: "WorktrackerIssueConnection" as const,
    nodes: [{
      __typename: "WorktrackerIssue" as const,
      id: "module-1",
      name: "Module 1",
      project_id: "project-1",
      sequence_id: 1,
      is_archived: false,
      issue_type: "module",
      rank: "0",
      project: {
        __typename: "WorktrackerProject" as const,
        id: "project-1",
        slug: "T",
        manual_module_order: false,
      },
    }],
  },
  work_items: {
    __typename: "WorktrackerIssueConnection" as const,
    nodes: workItems,
  },
};

const browserRuntime = createBrowserRuntime({ environment: {} });
initializeStudioRuntime({
  ...browserRuntime,
  graphQlTransport: () => ({
    graphql_execute: async () => JSON.stringify({ data: moduleData }),
    graphql_subscribe: async () => "profile-subscription",
    graphql_unsubscribe: async () => true,
  }),
});
studioApolloClient().writeQuery({
  query: WorkTrackerModuleOpenDocument,
  variables: { moduleId: "module-1" },
  data: moduleData,
});
setStatesSorted("project-1", [{
  id: "state-1",
  name: "Ideas",
  group: "backlog",
  color: null,
  sort_order: 0,
  is_protected: false,
}]);
seedConfig({ features: { sidebar: true, projects: true } });
useStudioStore.setState({ selectedProjectId: "project-1" });
useClientStore.setState({
  selectedModuleId: "module-1",
  selectedTaskId: ids[0],
  workspaceSelection: { kind: "task" },
  storySearchQuery: "",
  expandedIdsByModule: {},
  collapsedStateIds: new Set(),
});

const counts: Counts = {};
(globalThis as typeof globalThis & {
  __ticketrySelectionProfileProbe?: (point: string) => void;
}).__ticketrySelectionProfileProbe = (point) => {
  counts[point] = (counts[point] ?? 0) + 1;
};

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

function afterNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function waitForSelection(target: HTMLElement): Promise<void> {
  if (target.getAttribute("aria-selected") === "true") return Promise.resolve();
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (target.getAttribute("aria-selected") !== "true") return;
      observer.disconnect();
      resolve();
    });
    observer.observe(target, { attributes: true, attributeFilter: ["aria-selected"] });
  });
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <StudioApolloProvider>
      <section role="region" aria-label="Stories">
        <TasksPane />
      </section>
    </StudioApolloProvider>
  </React.StrictMode>,
);

window.runSelectionProfile = async () => {
  const first = document.querySelector<HTMLElement>(`[data-task-id="${ids[0]}"]`)!;
  const last = document.querySelector<HTMLElement>(`[data-task-id="${ids[size - 1]}"]`)!;
  last.click();
  await waitForSelection(last);
  await afterNextPaint();

  const samples: Array<{ commitMs: number; paintMs: number; counts: Counts }> = [];
  for (let index = 0; index < 20; index += 1) {
    for (const key of Object.keys(counts)) counts[key] = 0;
    const target = index % 2 === 0 ? first : last;
    const selected = waitForSelection(target);
    const started = performance.now();
    target.click();
    await selected;
    const commitMs = performance.now() - started;
    await afterNextPaint();
    samples.push({
      commitMs,
      paintMs: performance.now() - started,
      counts: { ...counts },
    });
  }

  const commitTimes = samples.map((sample) => sample.commitMs);
  const paintTimes = samples.map((sample) => sample.paintMs);
  const points = Object.keys(samples[0]?.counts ?? {});
  return {
    size,
    commitP50Ms: rounded(percentile(commitTimes, 0.5)),
    commitP95Ms: rounded(percentile(commitTimes, 0.95)),
    paintP50Ms: rounded(percentile(paintTimes, 0.5)),
    paintP95Ms: rounded(percentile(paintTimes, 0.95)),
    maxPaintMs: rounded(Math.max(...paintTimes)),
    meanCounts: Object.fromEntries(points.map((point) => [
      point,
      rounded(samples.reduce((sum, sample) => sum + (sample.counts[point] ?? 0), 0) / samples.length),
    ])),
  };
};
window.__profileReady = true;
