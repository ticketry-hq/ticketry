import { useEffect, useMemo, useState } from "react";
import { ModalShell } from "../../../app/modal/ModalShell";
import { useModalStore } from "../../../app/modal/modalStore";
import { launchScratchPlanning } from "./create/launchTerminalCreate";
import { launchAgent } from "./internal/actions";
import { useClientStore as useTicketWorkspaceStore } from "../../../state/clientStore";
import {
  providerListPlaceholder,
  useActivatedProviders,
} from "../../workflows";
import { bucketFor } from "./internal/sessionStore";
import { MODAL_ACTIONS } from "../../../app/navigation/keymapRegistry";

export const AGENTS = ["claude", "agy", "codex", "gemini"] as const;
export type Agent = (typeof AGENTS)[number];

export interface AgentPickerPayload {
  /** "open" → open agent on selected task; "open-with-prompt" → carried prompt; "plan" → planning mode. */
  mode: "open" | "open-with-prompt" | "plan" | "instant";
  initialPrompt?: string;
  /** Studio terminal-create callers pass explicit launch context. */
  projectId?: string;
  moduleId?: string;
  /**
   * CODIN-845: explicit task context for task-bound `open`/`open-with-prompt`
   * runs launched from Studio work-item surfaces.
   */
  taskId?: string;
  /** Opens the task workspace's plain module terminal when that surface exists. */
  onTerminal?: () => void;
  /** Optional surface callback after a launch has been placed in its workspace. */
  onLaunched?: () => void;
}

type PickerChoice =
  | { kind: "agent"; agent: Agent; label: Agent }
  | { kind: "terminal"; label: "Terminal" };

export function AgentPicker({ payload }: { payload?: AgentPickerPayload }) {
  const popModal = useModalStore((s) => s.popModal);
  // Host activation decides what can be launched, and the capabilities payload
  // is the one place it is published (ADR-0015). A provider the host switched
  // off never reaches this list, so it cannot be picked by accident.
  const { slugs: activatedProviders, loaded, failed } = useActivatedProviders();
  const agents = useMemo(
    () => AGENTS.filter((agent) => activatedProviders.has(agent)),
    [activatedProviders],
  );
  const choices = useMemo<PickerChoice[]>(
    () => [
      ...agents.map((agent) => ({ kind: "agent" as const, agent, label: agent })),
      ...(payload?.onTerminal
        ? [{ kind: "terminal" as const, label: "Terminal" as const }]
        : []),
    ],
    [agents, payload?.onTerminal],
  );

  const [cursor, setCursor] = useState(0);
  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, choices.length - 1)));
  }, [choices.length]);

  function commit(agent: Agent): void {
    const projectId = payload?.projectId;
    const moduleId = payload?.moduleId ?? "";
    if (!projectId) {
      popModal();
      return;
    }
    const mode = payload?.mode ?? "open";
    const prompt = payload?.initialPrompt ?? null;
    const { setActive } = useTicketWorkspaceStore.getState();
    if (mode === "plan") {
      // The launch contract lives in the shared terminal-create launcher
      // (CODIN-839); this component owns only the presentation seam around it.
      launchScratchPlanning({
        projectId,
        moduleId,
        agent,
        initialPrompt: prompt,
      });
      setActive(bucketFor(null, moduleId), "terminal");
      payload?.onLaunched?.();
      popModal();
      return;
    }
    if (mode === "instant") {
      if (!moduleId || !prompt || !prompt.trim()) {
        popModal();
        return;
      }
      launchAgent({
        taskId: null,
        projectId,
        moduleId,
        agent,
        initialPrompt: prompt,
        isPlanning: false,
        isInstant: true,
      });
      setActive(bucketFor(null, moduleId), "terminal");
      payload?.onLaunched?.();
      popModal();
      return;
    }
    // open / open-with-prompt: need a real work item. The explicit payload
    // context identifies it. The synthetic scratch task (TEMP_TASK_ID) is local-only — a
    // task-bound run would request its details from the worktracker and 404
    // (task_fetch_failed). No-task runs belong to the plan/instant branch above.
    const taskId = payload?.taskId;
    if (!taskId) {
      popModal();
      return;
    }
    launchAgent({
      taskId,
      projectId,
      moduleId,
      agent,
      initialPrompt: prompt,
      isPlanning: false,
    });
    setActive(taskId, "terminal");
    payload?.onLaunched?.();
    popModal();
  }

  function commitChoice(choice: PickerChoice): void {
    if (choice.kind === "agent") {
      commit(choice.agent);
      return;
    }
    payload?.onTerminal?.();
    popModal();
  }

  function onAction(actionId: string) {
    if (actionId === MODAL_ACTIONS.next) {
      setCursor((c) => Math.min(choices.length - 1, c + 1));
    } else if (actionId === MODAL_ACTIONS.previous) {
      setCursor((c) => Math.max(0, c - 1));
    } else if (actionId === MODAL_ACTIONS.confirm) {
      const choice = choices[cursor];
      if (choice) commitChoice(choice);
    }
  }

  return (
    <ModalShell
      title="Select Agent"
      bindings={[
        {
          actionId: [MODAL_ACTIONS.previous, MODAL_ACTIONS.next],
          label: "Move",
        },
        { actionId: MODAL_ACTIONS.confirm, label: "Open" },
        { actionId: MODAL_ACTIONS.close, label: "Cancel" },
      ]}
      onAction={onAction}
      width="w-[40ch]"
    >
      {agents.length === 0 && (
        <p className="px-2 py-1 text-sm text-text-muted">
          {providerListPlaceholder({ loaded, failed })}
        </p>
      )}
      {choices.length > 0 && (
        <ul>
          {choices.map((choice, i) => (
            <li
              key={choice.kind === "agent" ? choice.agent : choice.kind}
              onClick={() => commitChoice(choice)}
              className={`cursor-pointer px-2 py-1 ${
                i === cursor
                  ? "bg-selection-bg text-text-primary"
                  : "hover:bg-pane-title"
              }`}
            >
              {choice.label}
            </li>
          ))}
        </ul>
      )}
    </ModalShell>
  );
}
