import { describe, expect, it, vi } from "vitest";
import {
  getModuleFolder,
  loadModuleLinks,
  setModuleFolder,
} from "../features/module-links";
import { createBrowserRuntime } from "../runtime/browserRuntime";
import { createDesktopRuntime } from "../runtime/desktopRuntime";
import { initializeStudioRuntime } from "../runtime";

const startup = {
  serviceHealth: {
    state: "ready" as const,
    service: "backend",
    message: null,
    logPointer: null,
  },
  initialNotices: [],
};

describe("module link desktop runtime acceptance", () => {
  it("[overhaul-78] persists a module folder through the generated ModuleLink graph only", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    let links = [
      { __typename: "ModuleLinks", id: "link-1", moduleId: "module-1", path: "/repos/old" },
    ];
    const operationNames: string[] = [];
    const graphqlExecute = vi.fn(async (requestJson: string) => {
      const request = JSON.parse(requestJson) as {
        operationName: string;
        variables: { moduleId?: string; path?: string };
      };
      operationNames.push(request.operationName);
      if (request.operationName === "LoadModuleLinks") {
        return JSON.stringify({
          data: { moduleLinks: { __typename: "ModuleLinksConnection", nodes: links } },
        });
      }
      if (request.operationName === "SetModuleLink") {
        const written = {
          __typename: "ModuleLinks",
          id: "link-1",
          moduleId: request.variables.moduleId!,
          path: request.variables.path!,
        };
        links = [written];
        return JSON.stringify({ data: { set_module_link: written } });
      }
      throw new Error(`Unexpected operation ${request.operationName}`);
    });

    initializeStudioRuntime(
      await createDesktopRuntime({
        invoke: vi.fn().mockResolvedValue(startup),
        createGraphQlProxy: () => ({
          graphql_execute: graphqlExecute,
          graphql_subscribe: vi.fn(),
          graphql_unsubscribe: vi.fn(),
        }),
      }),
    );

    await loadModuleLinks();
    expect(getModuleFolder("module-1")).toBe("/repos/old");

    await setModuleFolder("module-1", "/repos/ticketry");

    // No profile selection, no profile replacement, no feature-flag write: the
    // folder is the Module's own typed row and one restricted mutation owns it.
    expect(operationNames).toEqual(["LoadModuleLinks", "SetModuleLink"]);
    expect(getModuleFolder("module-1")).toBe("/repos/ticketry");
    expect(fetchMock).not.toHaveBeenCalled();

    initializeStudioRuntime(createBrowserRuntime({ environment: {} }));
  });
});
