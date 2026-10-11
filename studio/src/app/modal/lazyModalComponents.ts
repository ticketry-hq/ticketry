import { lazy } from "react";
import type { ChunkRecovery } from "./recoverableChunkImport";

/**
 * Fresh `React.lazy` wrappers for every modal chunk.
 *
 * `React.lazy` caches a rejected import forever, so a failed chunk can only be
 * re-attempted by discarding the wrapper. The host calls this again on retry;
 * `recovery` then bypasses the browser's cached failed import.
 * Each import specifier stays a literal so the bundler can split the chunk.
 */
export function createLazyModalComponents(recovery: ChunkRecovery) {
  return {
    AgentPicker: lazy(async () => ({
      default: await recovery.load(
        "AgentPicker",
        () => import("../../features/agents/terminal/AgentPicker"),
        (module) => module.AgentPicker,
      ),
    })),
    PromptInput: lazy(async () => ({
      default: await recovery.load(
        "PromptInput",
        () => import("../../features/agents/terminal/PromptInput"),
        (module) => module.PromptInput,
      ),
    })),
    ModuleFolder: lazy(async () => ({
      default: await recovery.load(
        "ModuleFolder",
        () => import("../../features/agents/terminal/ModuleFolder"),
        (module) => module.ModuleFolder,
      ),
    })),
    SettingsModal: lazy(async () => ({
      default: await recovery.load(
        "SettingsModal",
        () => import("../../features/studio/modals/SettingsModal"),
        (module) => module.SettingsModal,
      ),
    })),
    KeyboardShortcutsModal: lazy(async () => ({
      default: await recovery.load(
        "KeyboardShortcutsModal",
        () => import("../../features/studio/modals/KeyboardShortcutsModal"),
        (module) => module.KeyboardShortcutsModal,
      ),
    })),
    StatusUpdate: lazy(async () => ({
      default: await recovery.load(
        "StatusUpdate",
        () => import("../../features/studio/modals/StatusUpdate"),
        (module) => module.StatusUpdate,
      ),
    })),
    StoryWorkflowGuideDialog: lazy(async () => ({
      default: await recovery.load(
        "StoryWorkflowGuideDialog",
        () => import("./StoryWorkflowGuideModal"),
        (module) => module.StoryWorkflowGuideModal,
      ),
    })),
    ParentUpdate: lazy(async () => ({
      default: await recovery.load(
        "ParentUpdate",
        () => import("../../features/studio/modals/ParentUpdate"),
        (module) => module.ParentUpdate,
      ),
    })),
    AddModule: lazy(async () => ({
      default: await recovery.load(
        "AddModule",
        () => import("../../features/studio/modals/AddModule"),
        (module) => module.AddModule,
      ),
    })),
    AddProject: lazy(async () => ({
      default: await recovery.load(
        "AddProject",
        () => import("../../features/studio/modals/AddProject"),
        (module) => module.AddProject,
      ),
    })),
    NotifyUserModal: lazy(async () => ({
      default: await recovery.load(
        "NotifyUserModal",
        () => import("./NotifyUserModal"),
        (module) => module.NotifyUserModal,
      ),
    })),
  };
}

export type LazyModalComponents = ReturnType<typeof createLazyModalComponents>;
