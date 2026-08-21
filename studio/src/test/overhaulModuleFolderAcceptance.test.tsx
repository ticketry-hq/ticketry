import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  listModuleLinks: vi.fn(),
  upsertModuleLink: vi.fn(),
  validateModuleFolder: vi.fn(),
}));
const selectModule = vi.hoisted(() => vi.fn());

vi.mock("../shared/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shared/api/client")>()),
  ...api,
}));
vi.mock("../state/clientStore", () => ({
  useClientStore: {
    getState: () => ({ selectModule }),
  },
}));

import { useModalStore } from "../app/modal";
import { ModuleFolder } from "../features/agents/terminal/ModuleFolder";
import {
  getModuleFolder,
  seedModuleLinks,
} from "../features/module-links";
import { queryClient } from "../shared/query/queryClient";

const savedLink = (localPath: string) => ({
  id: "link-1",
  module_id: "module-1",
  local_path: localPath,
  created_at: "2026-08-19T00:00:00Z",
  updated_at: "2026-08-19T00:00:01Z",
});

describe("Module-link folder mutation acceptance", () => {
  beforeEach(() => {
    queryClient.clear();
    seedModuleLinks([savedLink("/repos/old")]);
    api.listModuleLinks.mockReset().mockResolvedValue([
      savedLink("/repos/old"),
    ]);
    api.validateModuleFolder.mockReset().mockResolvedValue({
      valid: true,
      reason: null,
    });
    api.upsertModuleLink
      .mockReset()
      .mockImplementation(async (_moduleId: string, path: string) =>
        savedLink(path),
      );
    selectModule.mockReset().mockResolvedValue(undefined);
    useModalStore.setState({
      modalStack: [
        {
          type: "module-folder",
          payload: { moduleId: "module-1", resumeModuleSelection: true },
        },
      ],
    });
  });

  it("[overhaul-134] validates and round-trips a changed folder through the Module link", async () => {
    render(
      <ModuleFolder
        payload={{ moduleId: "module-1", resumeModuleSelection: true }}
      />,
    );

    const input = screen.getByRole("textbox");
    expect(input).toHaveValue("/repos/old");
    fireEvent.change(input, { target: { value: "  /repos/new  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(api.validateModuleFolder).toHaveBeenCalledWith("/repos/new"),
    );
    expect(api.upsertModuleLink).toHaveBeenCalledWith(
      "module-1",
      "/repos/new",
    );
    expect(getModuleFolder("module-1")).toBe("/repos/new");
    expect(selectModule).toHaveBeenCalledWith("module-1");
    expect(useModalStore.getState().modalStack).toEqual([]);
  });
});
