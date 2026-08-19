import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadKeybindingOverrides,
  saveKeybindingOverrides,
} from "../app/navigation/keymapSettings";
import {
  studioKeymapRegistry,
  type BindingOverride,
} from "../app/navigation/keymapRegistry";
import { createDesktopRuntime } from "../runtime/desktopRuntime";
import { initializeStudioRuntime } from "../runtime";

const startup = {
  endpoints: {
    workTrackerApi: "http://127.0.0.1:8787/api/work-tracker",
    agentApi: "http://127.0.0.1:8787/api",
    statusApi: "http://127.0.0.1:8787/api",
    terminalWebSocket: "ws://127.0.0.1:8787/ws/terminal",
  },
  values: { workTrackerApiKey: "" },
  serviceHealth: {
    state: "ready",
    service: "backend",
    message: null,
    logPointer: null,
  },
  initialNotices: [],
};

const chord = (key: string, meta = false): BindingOverride["chord"] => ({
  key,
  alt: false,
  control: false,
  meta,
  shift: false,
});

const loadedOverride: BindingOverride = {
  context: "global",
  actionId: "settings",
  chord: chord(",", true),
};

function setting(value: unknown) {
  return {
    scope: "host",
    key: "keybindings",
    value,
    updated_at: "2026-08-12T12:00:00+00:00",
  };
}

async function install(
  graphqlExecute: (request: string) => Promise<string>,
): Promise<void> {
  initializeStudioRuntime(await createDesktopRuntime({
    invoke: vi.fn().mockResolvedValue(startup),
    createGraphQlProxy: () => ({
      graphql_execute: vi.fn(graphqlExecute),
      graphql_subscribe: vi.fn(),
      graphql_unsubscribe: vi.fn(),
    }),
  }));
}

describe("host keybinding settings runtime acceptance", () => {
  beforeEach(() => {
    studioKeymapRegistry.setOverrides([]);
  });

  it("[overhaul-75] loads, saves from the authoritative response, and reloads after restart through generated GraphQL", async () => {
    const savedOverride: BindingOverride = {
      context: "global",
      actionId: "plan",
      chord: chord("p", true),
    };
    const operations: string[] = [];
    await install(async (encoded) => {
      const request = JSON.parse(encoded) as {
        operationName: string;
        variables: { value?: unknown };
      };
      operations.push(request.operationName);
      if (request.operationName === "LoadKeybindingSetting") {
        return JSON.stringify({
          data: { keybinding_setting: setting([loadedOverride]) },
        });
      }
      expect(request.operationName).toBe("UpdateKeybindingSetting");
      expect(request.variables.value).toEqual([loadedOverride]);
      return JSON.stringify({
        data: { update_keybinding_setting: setting([savedOverride]) },
      });
    });

    await loadKeybindingOverrides();
    expect(
      studioKeymapRegistry.getEffectiveBinding("global", "settings")?.chord,
    ).toEqual(loadedOverride.chord);

    await saveKeybindingOverrides([loadedOverride]);
    expect(
      studioKeymapRegistry.getEffectiveBinding("global", "plan")?.chord,
    ).toEqual(savedOverride.chord);
    expect(studioKeymapRegistry.getOverrides()).toEqual([savedOverride]);

    studioKeymapRegistry.setOverrides([]);
    await loadKeybindingOverrides();
    expect(
      studioKeymapRegistry.getEffectiveBinding("global", "settings")?.chord,
    ).toEqual(loadedOverride.chord);
    expect(operations).toEqual([
      "LoadKeybindingSetting",
      "UpdateKeybindingSetting",
      "LoadKeybindingSetting",
    ]);
  });

  it("[overhaul-76] treats missing or malformed stored keybindings as defaults", async () => {
    studioKeymapRegistry.setOverrides([loadedOverride]);
    await install(async () => JSON.stringify({
      data: { keybinding_setting: null },
    }));

    await loadKeybindingOverrides();

    expect(studioKeymapRegistry.getOverrides()).toEqual([]);
  });

  it("[overhaul-77] keeps safe startup defaults and reports an actionable save failure when GraphQL is unavailable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await install(async () => JSON.stringify({
      errors: [{
        message: "Keyboard shortcut storage is unavailable.",
        extensions: { code: "settings_store_unavailable" },
      }],
    }));

    studioKeymapRegistry.setOverrides([loadedOverride]);
    await loadKeybindingOverrides();
    expect(studioKeymapRegistry.getOverrides()).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      "[keymap] binding overrides unavailable; using defaults",
      expect.any(Error),
    );

    await expect(saveKeybindingOverrides([loadedOverride])).rejects.toMatchObject({
      code: "settings_store_unavailable",
      message: "Keyboard shortcut storage is unavailable.",
    });
    expect(studioKeymapRegistry.getOverrides()).toEqual([]);
  });
});
