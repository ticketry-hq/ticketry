import { lazy, Suspense, useEffect, useState } from "react";
import {
  useIssueStore, deriveEpic, resolveBlockerChips, } from "./internal/issueStore";
import { useBacklogStore } from "../internal/backlogStore";
import { usePlanningFilterStore } from "../internal/planningFilterStore";
import { dialog } from "../../../app/stores/dialogStore";
import { useStudioStore } from "../../projects/store";
import StatePicker from "../fields/StatePicker";
import { IconPanelLeft } from "../../../shared/ui/icons";

import NameEditor from "./NameEditor";
import Breadcrumb from "./Breadcrumb";
import Attachments from "./Attachments";
import ChildIssues from "./ChildIssues";
import FindingsPanel from "./FindingsPanel";
import { hasFindingsPanel } from "./internal/findings";
import IssueSidebar from "./IssueSidebar";
import IssueActionsMenu from "./IssueActionsMenu";
import { LaunchAgentAction } from "./LaunchAgentAction";
import { RunSubtreeAction } from "./RunSubtreeAction";
import { readVersionedItem } from "../../../shared/storage/versioned";

const DescriptionEditor = lazy(() => import("../../documents/DescriptionEditor"));

// The Details sidebar's visibility persists globally (#837): one preference
// across every host of this component (drawer and Backlog pane).
const SIDEBAR_KEY = "studio.issueDetail.sidebarVisible:v1";
const LEGACY_SIDEBAR_KEYS = ["studio.issueDetail.sidebarVisible"];

function readSidebarVisible(): boolean {
  return readVersionedItem(SIDEBAR_KEY, LEGACY_SIDEBAR_KEYS) !== "0";
}

// The two-pane issue body: left = summary / status / description / child
// issues; right = the relationship-led Details panel (no assignees — personal
// tracker). Each editable field PATCHes optimistically via issueStore.
//
// Host-agnostic (#827): takes the issue's key-or-id and loads it itself, so
// the Studio drawer and Backlog details render the identical component.
export default function IssueDetail({ issueId }: { issueId: string }) {
  const open = useIssueStore((s) => s.open);
  const openIssue = useIssueStore((s) => s.openIssue);
  const children = useIssueStore((s) => s.children);
  const loading = useIssueStore((s) => s.loading);
  const notFound = useIssueStore((s) => s.notFound);
  const loadError = useIssueStore((s) => s.loadError);
  const saving = useIssueStore((s) => s.saving);
  const patchField = useIssueStore((s) => s.patchField);
  const patchBlockers = useIssueStore((s) => s.patchBlockers);
  const addSubtask = useIssueStore((s) => s.addSubtask);
  const cancelChild = useIssueStore((s) => s.cancelChild);

  const modules = useStudioStore((s) => s.modules);
  const projects = useStudioStore((s) => s.projects);
  const items = useBacklogStore((s) => s.items);
  const deleteIssue = useBacklogStore((s) => s.deleteIssue);
  const selectedProjectId = useStudioStore((s) => s.selectedProjectId);

  const [sidebarVisible, setSidebarVisible] = useState(readSidebarVisible);
  const toggleSidebar = () =>
    setSidebarVisible((v) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, v ? "0" : "1");
      } catch {
        /* ignore unavailable storage */
      }
      return !v;
    });

  // Self-load: a host that hasn't primed the store (for example, a details
  // tab) still renders — openIssue no-ops when this issue is already open.
  useEffect(() => {
    void openIssue(issueId);
  }, [issueId, openIssue]);

  // A leftover `open` from another issue (host switched ids this render) is
  // treated as still-loading; the effect above is fetching the right one.
  const stale =
    open !== null && open.task.id !== issueId && open.task.key !== issueId;

  if (loading || stale) {
    return <div className="grid h-full place-items-center text-base text-text-muted">Loading issue…</div>;
  }
  if (notFound) {
    return (
      <div className="grid h-full place-items-center text-center text-base text-text-muted" data-testid="issue-not-found">
        <div>
          <div className="text-text-primary">Issue not found.</div>
          <div className="mt-1">It may have been deleted or the link is wrong.</div>
        </div>
      </div>
    );
  }
  if (!open) {
    // A non-404 load failure (the 404 path renders the not-found block above).
    // Mutation errors never reach here — those surface as toasts (#638).
    if (loadError) {
      return (
        <div
          className="grid h-full place-items-center px-6 text-center text-base text-lifecycle-danger"
          data-testid="issue-load-error"
        >
          {loadError}
        </div>
      );
    }
    return null;
  }

  const task = open.task;
  const attachments = open.attachments;
  const epic = deriveEpic(task, modules, items);
  const project = projects.find((p) => p.id === task.project_id) ?? null;
  const descriptionValue =
    [task.description_html, task.description, task.description_stripped].find(
      (value) => value?.trim(),
    ) ?? null;

  // Resolve blocker/blocks ids → navigable chips from the loaded project tree.
  const blockedByChips = resolveBlockerChips(task.blocked_by_ids, items, modules);
  const blocksChips = resolveBlockerChips(task.blocks_ids, items, modules);

  const removeBlocker = (id: string) =>
    void patchBlockers(task.blocked_by_ids.filter((x) => x !== id));
  const addBlocker = (id: string) =>
    void patchBlockers([...task.blocked_by_ids, id]);

  // Breadcrumb epic segment → the backlog scoped to that epic. The selection
  // is the shared planning axis (#833); load the project's selection first so
  // the write persists under the right key even on a cold deep-link.
  const scopeEpics = (epicIds: string[]) => {
    const planning = usePlanningFilterStore.getState();
    const projectId = selectedProjectId ?? task.project_id;
    if (planning.projectId !== projectId) planning.setProject(projectId);
    usePlanningFilterStore.getState().setEpicIds(epicIds);
  };

  const goEpic = () => {
    if (!epic) return;
    scopeEpics([epic.id]);
  };

  // Breadcrumb Project segment → the project's full backlog (epic filter cleared
  // so it isn't scoped to whatever was last selected).
  const goProject = () => {
    scopeEpics([]);
  };

  const onDelete = async () => {
    if (task.sub_issues_count > 0) return;
    // G01: a destructive action asks first. Cancel aborts with no mutation.
    const ok = await dialog.confirm({
      title: "Delete issue",
      body: `${task.key} '${task.name}' will be permanently deleted.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await deleteIssue(task.id);
  };

  return (
    <div
      className={`grid h-full overflow-hidden ${
        sidebarVisible ? "grid-cols-[1fr_260px]" : "grid-cols-[1fr]"
      }`}
    >
      {/* Left content column */}
      <div className="overflow-y-auto p-6">
        <div className="flex items-start justify-between gap-3">
          <Breadcrumb
            project={project}
            epic={epic}
            onProjectClick={goProject}
            onEpicClick={goEpic}
          />
          <button
            type="button"
            onClick={toggleSidebar}
            aria-expanded={sidebarVisible}
            aria-label={sidebarVisible ? "Hide details panel" : "Show details panel"}
            title={sidebarVisible ? "Hide details panel" : "Show details panel"}
            data-testid="issue-sidebar-toggle"
            className={`flex-none rounded p-1 transition-colors hover:bg-pane-title hover:text-text-primary ${
              sidebarVisible ? "text-text-secondary" : "text-focus-accent"
            }`}
          >
            <IconPanelLeft size={15} style={{ transform: "scaleX(-1)" }} />
          </button>
        </div>

        <NameEditor
          name={task.name}
          saving={Boolean(saving.name)}
          onSave={(name) => patchField({ name })}
        />

        <div className="mt-4 flex items-center gap-3" data-testid="status-row">
          <LaunchAgentAction issueId={task.id} />
          <StatePicker
            value={task.state}
            saving={Boolean(saving.state_id)}
            onChange={(state_id) => patchField({ state_id })}
          />
          <RunSubtreeAction task={task} moduleId={epic?.id ?? null} />
        </div>

        <div className="mt-6">
          <div className="mb-1 text-xs uppercase tracking-wider text-text-secondary">Description</div>
          <Suspense fallback={null}>
            <DescriptionEditor
              html={descriptionValue}
              onSave={(description_html) => patchField({ description_html })}
            />
          </Suspense>
        </div>

        <Attachments attachments={attachments} />

        {hasFindingsPanel(task) && (
          <FindingsPanel children={children} onCancel={(id) => void cancelChild(id)} />
        )}

        <ChildIssues children={children} onAddSubtask={(name) => void addSubtask(name)} />
      </div>

      {sidebarVisible && (
        <IssueSidebar
          task={task}
          epic={epic}
          saving={saving}
          blockedByChips={blockedByChips}
          blocksChips={blocksChips}
          patchField={patchField}
          addBlocker={addBlocker}
          removeBlocker={removeBlocker}
          goEpic={goEpic}
          actions={
            <IssueActionsMenu
              hasSubtasks={task.sub_issues_count > 0}
              onDelete={onDelete}
            />
          }
        />
      )}
    </div>
  );
}
