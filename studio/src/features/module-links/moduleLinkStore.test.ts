/**
 * The link store is the only place Studio holds a Module's local folder, so
 * these cases pin what the cache shows before, during, and after a write.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { createBrowserRuntime } from "../../runtime/browserRuntime";
import { createDesktopRuntime } from "../../runtime/desktopRuntime";
import { initializeStudioRuntime } from "../../runtime";
import {
  clearModuleFolder,
  getModuleFolder,
  getModuleLinks,
  loadModuleLinks,
  recentModuleFolders,
  setModuleFolder,
} from ".";

const startup = {
  serviceHealth: {
    state: "ready" as const,
    service: "backend",
    message: null,
    logPointer: null,
  },
  initialNotices: [],
};

interface Request {
  operationName: string;
  variables: { moduleId?: string; path?: string };
}

async function installHost(
  respond: (request: Request) => Promise<string> | string,
): Promise<void> {
  initializeStudioRuntime(
    await createDesktopRuntime({
      invoke: vi.fn().mockResolvedValue(startup),
      createGraphQlProxy: () => ({
        graphql_execute: async (requestJson: string) =>
          respond(JSON.parse(requestJson) as Request),
        graphql_subscribe: vi.fn(),
        graphql_unsubscribe: vi.fn(),
      }),
    }),
  );
}

function link(moduleId: string, path: string) {
  return { __typename: "ModuleLinks" as const, id: `link-${moduleId}`, moduleId, path };
}

function connection(...links: ReturnType<typeof link>[]): string {
  return JSON.stringify({
    data: { moduleLinks: { __typename: "ModuleLinksConnection", nodes: links } },
  });
}

afterEach(() => {
  initializeStudioRuntime(createBrowserRuntime({ environment: {} }));
});

describe("module link store", () => {
  it("reads a Module's folder from the generated link graph", async () => {
    await installHost(() => connection(link("module-1", "/repos/ticketry")));

    await loadModuleLinks();

    expect(getModuleFolder("module-1")).toBe("/repos/ticketry");
    expect(getModuleFolder("module-2")).toBeUndefined();
  });

  it("answers for either spelling of a Module's identity", async () => {
    const compact = "0123456789abcdef0123456789abcdef";
    await installHost(() => connection(link(compact, "/repos/ticketry")));

    await loadModuleLinks();

    expect(
      getModuleFolder("01234567-89ab-cdef-0123-456789abcdef"),
    ).toBe("/repos/ticketry");
  });

  it("binds the Module and sends only the path on a write", async () => {
    const seen: Request[] = [];
    await installHost((request) => {
      seen.push(request);
      if (request.operationName === "LoadModuleLinks") return connection();
      return JSON.stringify({
        data: { set_module_link: link(request.variables.moduleId!, request.variables.path!) },
      });
    });

    await loadModuleLinks();
    await setModuleFolder("module-1", "/repos/ticketry");

    const write = seen.find((request) => request.operationName === "SetModuleLink");
    expect(write?.variables).toEqual({ moduleId: "module-1", path: "/repos/ticketry" });
    expect(getModuleFolder("module-1")).toBe("/repos/ticketry");
  });

  it("shows the new folder while the write is in flight", async () => {
    let release: (() => void) | undefined;
    const inFlight = new Promise<void>((resolve) => {
      release = resolve;
    });
    await installHost(async (request) => {
      if (request.operationName === "LoadModuleLinks") {
        return connection(link("module-1", "/repos/previous"));
      }
      await inFlight;
      return JSON.stringify({
        data: { set_module_link: link("module-1", "/repos/ticketry") },
      });
    });

    await loadModuleLinks();
    const write = setModuleFolder("module-1", "/repos/ticketry");
    await Promise.resolve();

    expect(getModuleFolder("module-1")).toBe("/repos/ticketry");

    release!();
    await write;
    expect(getModuleFolder("module-1")).toBe("/repos/ticketry");
  });

  it("rolls back to the linked folder when the host refuses the write", async () => {
    await installHost((request) => {
      if (request.operationName === "LoadModuleLinks") {
        return connection(link("module-1", "/repos/previous"));
      }
      return JSON.stringify({
        errors: [
          {
            message: "the linked folder is not a directory",
            extensions: { code: "module_link_folder_invalid" },
          },
        ],
      });
    });

    await loadModuleLinks();
    await expect(setModuleFolder("module-1", "/repos/ticketry")).rejects.toThrow();

    expect(getModuleFolder("module-1")).toBe("/repos/previous");
    expect(getModuleLinks()).toHaveLength(1);
  });

  it("leaves the graph untouched when a Module was never linked and the write fails", async () => {
    await installHost((request) => {
      if (request.operationName === "LoadModuleLinks") return connection();
      return JSON.stringify({
        errors: [{ message: "no such folder", extensions: { code: "module_link_folder_invalid" } }],
      });
    });

    await loadModuleLinks();
    await expect(setModuleFolder("module-1", "/repos/ticketry")).rejects.toThrow();

    expect(getModuleFolder("module-1")).toBeUndefined();
    expect(getModuleLinks()).toHaveLength(0);
  });

  it("refuses a folder that is not a complete path before reaching the host", async () => {
    const seen: string[] = [];
    await installHost((request) => {
      seen.push(request.operationName);
      return connection();
    });

    await loadModuleLinks();
    await expect(setModuleFolder("module-1", "repos/ticketry")).rejects.toThrow(
      "Module folders require a complete filesystem path.",
    );

    expect(seen).toEqual(["LoadModuleLinks"]);
  });

  it("drops the row when a Module is unlinked", async () => {
    await installHost((request) => {
      if (request.operationName === "LoadModuleLinks") {
        return connection(link("module-1", "/repos/ticketry"));
      }
      return JSON.stringify({ data: { clear_module_link: true } });
    });

    await loadModuleLinks();
    await clearModuleFolder("module-1");

    expect(getModuleFolder("module-1")).toBeUndefined();
  });

  it("offers already-linked folders most recently written first", async () => {
    await installHost(() =>
      connection(
        link("module-1", "/repos/first"),
        link("module-2", "/repos/second"),
        link("module-3", "/repos/second"),
      ),
    );

    const links = await loadModuleLinks();

    expect(recentModuleFolders(links)).toEqual(["/repos/second", "/repos/first"]);
  });
});
