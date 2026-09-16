import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useModalStore } from "../app/modal";
import { DialogHost } from "../app/shell/DialogHost";
import { ModuleFolder } from "../features/agents/terminal/ModuleFolder";
import {
  getModuleFolder,
  getModuleLinks,
  seedModuleLinks,
} from "../features/module-links";
import * as moduleLinkTransport from "../features/module-links/moduleLinkTransport";
import { createBrowserRuntime } from "../runtime/browserRuntime";
import type { StudioRuntime } from "../runtime";
import { useClientStore } from "../state/clientStore";

function desktopRuntime(
  prepareDirectoryTrust: NonNullable<StudioRuntime["prepareDirectoryTrust"]>,
): StudioRuntime {
  return {
    ...createBrowserRuntime({ environment: {} }),
    platform: "desktop",
    prepareDirectoryTrust,
  };
}

describe("directory trust acceptance", () => {
  beforeEach(() => {
    useClientStore.setState({ dialogs: [] });
    useModalStore.setState({
      modalStack: [{ type: "module-folder", payload: { moduleId: "module-1" } }],
    });
    seedModuleLinks([
      { id: "link-module-1", moduleId: "module-1", path: "/repos/old" },
    ]);
    vi.spyOn(moduleLinkTransport, "writeModuleLink").mockImplementation(
      async (moduleId, path) => {
        seedModuleLinks([
          ...getModuleLinks().filter((link) => link.moduleId !== moduleId),
          { id: `link-${moduleId}`, moduleId, path },
        ]);
      },
    );
  });

  it("[overhaul-284] confirms missing Gemini trust before saving and cancellation keeps the old link", async () => {
    const trust = vi.fn().mockResolvedValue({
      status: "approval_required",
      approval: "approval-token",
    });
    const write = vi.mocked(moduleLinkTransport.writeModuleLink);
    render(
      <>
        <ModuleFolder
          payload={{ moduleId: "module-1" }}
          runtime={desktopRuntime(trust)}
        />
        <DialogHost />
      </>,
    );

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "/repos/new" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const confirmation = await screen.findByRole("dialog", {
      name: "Trust this folder for Gemini?",
    });
    expect(confirmation).toBeVisible();
    expect(trust).toHaveBeenCalledWith("gemini", "/repos/new", null);
    expect(write).not.toHaveBeenCalled();
    fireEvent.click(within(confirmation).getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", {
          name: "Trust this folder for Gemini?",
        }),
      ).not.toBeInTheDocument(),
    );
    expect(getModuleFolder("module-1")).toBe("/repos/old");
    expect(write).not.toHaveBeenCalled();
    expect(useModalStore.getState().modalStack).toHaveLength(1);
  });

  it("[overhaul-285] prepares trust before replacing the old link", async () => {
    const events: string[] = [];
    const trust = vi
      .fn()
      .mockImplementation(async (_provider, _directory, approved) => {
        events.push(approved ? "prepare" : "inspect");
        return approved
          ? { status: "prepared", approval: null }
          : { status: "approval_required", approval: "approval-token" };
      });
    vi.mocked(moduleLinkTransport.writeModuleLink).mockImplementation(
      async (moduleId, path) => {
        events.push("save");
        seedModuleLinks([{ id: `link-${moduleId}`, moduleId, path }]);
      },
    );
    render(
      <>
        <ModuleFolder
          payload={{ moduleId: "module-1" }}
          runtime={desktopRuntime(trust)}
        />
        <DialogHost />
      </>,
    );

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "/repos/new" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(await screen.findByRole("button", { name: "Trust folder" }));

    await waitFor(() => expect(getModuleFolder("module-1")).toBe("/repos/new"));
    expect(events).toEqual(["inspect", "prepare", "save"]);
    expect(trust).toHaveBeenNthCalledWith(
      2,
      "gemini",
      "/repos/new",
      "approval-token",
    );
  });

  it.each([
    ["denied", "Gemini has denied trust for this folder."],
    ["unsupported", "Gemini does not support durable folder trust."],
  ] as const)(
    "[overhaul-286] reports %s without confirmation or a link write",
    async (outcome, message) => {
      const trust = vi
        .fn()
        .mockResolvedValue({ status: outcome, approval: null });
      const write = vi.mocked(moduleLinkTransport.writeModuleLink);
      render(
        <>
          <ModuleFolder
            payload={{ moduleId: "module-1" }}
            runtime={desktopRuntime(trust)}
          />
          <DialogHost />
        </>,
      );

      fireEvent.change(screen.getByRole("textbox"), {
        target: { value: "/repos/new" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      expect(
        screen.queryByRole("dialog", {
          name: "Trust this folder for Gemini?",
        }),
      ).not.toBeInTheDocument();
      expect(write).not.toHaveBeenCalled();
      expect(getModuleFolder("module-1")).toBe("/repos/old");
    },
  );

  it("[overhaul-287] requires fresh inspection when preparation rejects the approval", async () => {
    const trust = vi
      .fn()
      .mockResolvedValueOnce({
        status: "approval_required",
        approval: "stale-approval",
      })
      .mockResolvedValueOnce({
        status: "approval_required",
        approval: "fresh-approval",
      });
    const write = vi.mocked(moduleLinkTransport.writeModuleLink);
    render(
      <>
        <ModuleFolder
          payload={{ moduleId: "module-1" }}
          runtime={desktopRuntime(trust)}
        />
        <DialogHost />
      </>,
    );

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "/repos/new" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(await screen.findByRole("button", { name: "Trust folder" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The folder changed before Gemini trust was saved.",
    );
    expect(trust).toHaveBeenLastCalledWith(
      "gemini",
      "/repos/new",
      "stale-approval",
    );
    expect(write).not.toHaveBeenCalled();
    expect(getModuleFolder("module-1")).toBe("/repos/old");
  });

  it("[overhaul-288] retains the old link after failure and safely retries from inspection", async () => {
    const trust = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("Gemini trust configuration is unreadable."),
      )
      .mockResolvedValueOnce({ status: "already_trusted", approval: null });
    render(
      <ModuleFolder
        payload={{ moduleId: "module-1" }}
        runtime={desktopRuntime(trust)}
      />,
    );

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "/repos/new" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Gemini trust configuration is unreadable.",
    );
    expect(getModuleFolder("module-1")).toBe("/repos/old");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(trust).toHaveBeenCalledTimes(2);
    expect(getModuleFolder("module-1")).toBe("/repos/new");
  });
});
