import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  upsertModuleLink: vi.fn(),
  validateModuleFolder: vi.fn(),
}));

vi.mock("../shared/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shared/api/client")>()),
  ...api,
}));

import {
  getModuleFolder,
  seedModuleLinks,
  setModuleFolder,
} from "../features/module-links";
import { queryClient } from "../shared/query/queryClient";

describe("Module-link folder mutations", () => {
  beforeEach(() => {
    queryClient.clear();
    seedModuleLinks([]);
    api.validateModuleFolder.mockReset().mockResolvedValue({
      valid: true,
      reason: null,
    });
    api.upsertModuleLink.mockReset().mockImplementation(
      async (moduleId: string, localPath: string) => ({
        id: `link-${moduleId}`,
        module_id: moduleId,
        local_path: localPath,
        created_at: "2026-08-19T00:00:00Z",
        updated_at: "2026-08-19T00:00:00Z",
      }),
    );
  });

  it("rejects a relative path before server validation", async () => {
    await expect(setModuleFolder("module-1", "repo/local")).rejects.toThrow(
      "complete filesystem path",
    );
    expect(api.validateModuleFolder).not.toHaveBeenCalled();
    expect(api.upsertModuleLink).not.toHaveBeenCalled();
  });

  it("does not mutate a link rejected by folder validation", async () => {
    api.validateModuleFolder.mockResolvedValue({
      valid: false,
      reason: "module_folder_missing",
    });

    await expect(
      setModuleFolder("module-1", "/missing/repo"),
    ).rejects.toThrow("module_folder_missing");
    expect(api.upsertModuleLink).not.toHaveBeenCalled();
    expect(getModuleFolder("module-1")).toBeUndefined();
  });

  it("accepts the authoritative Module link returned by upsert", async () => {
    await setModuleFolder("module-1", "/repos/ticketry");

    expect(api.validateModuleFolder).toHaveBeenCalledWith("/repos/ticketry");
    expect(api.upsertModuleLink).toHaveBeenCalledWith(
      "module-1",
      "/repos/ticketry",
    );
    expect(getModuleFolder("module-1")).toBe("/repos/ticketry");
  });
});
