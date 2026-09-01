import { lazy } from "react";

/**
 * Fresh `React.lazy` wrappers for every modal chunk.
 *
 * `React.lazy` caches a rejected import forever, so a failed chunk can only be
 * re-attempted by discarding the wrapper. The host calls this again on retry.
 * Each import specifier stays a literal so the bundler can split the chunk.
 */
export function createLazyModalComponents() {
  return {
    AgentPicker: lazy(async () => ({
      default: (await import("../../features/agents/terminal/AgentPicker")).AgentPicker,
    })),
    PromptInput: lazy(async () => ({
      default: (await import("../../features/agents/terminal/PromptInput")).PromptInput,
    })),
    ModuleFolder: lazy(async () => ({
      default: (await import("../../features/agents/terminal/ModuleFolder")).ModuleFolder,
    })),
    SettingsModal: lazy(async () => ({
      default: (await import("../../features/studio/modals/SettingsModal")).SettingsModal,
    })),
    KeyboardShortcutsModal: lazy(async () => ({
      default: (
        await import("../../features/studio/modals/KeyboardShortcutsModal")
      ).KeyboardShortcutsModal,
    })),
    StatusUpdate: lazy(async () => ({
      default: (await import("../../features/studio/modals/StatusUpdate")).StatusUpdate,
    })),
    ParentUpdate: lazy(async () => ({
      default: (await import("../../features/studio/modals/ParentUpdate")).ParentUpdate,
    })),
    AddModule: lazy(async () => ({
      default: (await import("../../features/studio/modals/AddModule")).AddModule,
    })),
    AddProject: lazy(async () => ({
      default: (await import("../../features/studio/modals/AddProject")).AddProject,
    })),
    NotifyUserModal: lazy(async () => ({
      default: (await import("./NotifyUserModal")).NotifyUserModal,
    })),
  };
}

export type LazyModalComponents = ReturnType<typeof createLazyModalComponents>;
