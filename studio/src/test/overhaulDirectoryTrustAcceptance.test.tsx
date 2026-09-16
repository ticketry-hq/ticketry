import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useModalStore } from "../app/modal";
import { DialogHost } from "../app/shell/DialogHost";
import { ModuleFolder } from "../features/agents/terminal/ModuleFolder";
import { getModuleFolder, getModuleLinks, seedModuleLinks } from "../features/module-links";
import * as moduleLinkTransport from "../features/module-links/moduleLinkTransport";
import { createBrowserRuntime } from "../runtime/browserRuntime";
import type { DirectoryTrustResult, StudioRuntime } from "../runtime";
import { useClientStore } from "../state/clientStore";

type Trust = NonNullable<StudioRuntime["prepareDirectoryTrust"]>;

function desktopRuntime(prepareDirectoryTrust: Trust): StudioRuntime {
  return { ...createBrowserRuntime({ environment: {} }), platform: "desktop", prepareDirectoryTrust };
}

function result(
  status: DirectoryTrustResult["status"],
  approval: string | null = null,
  directory = "/canonical/repos/new",
): DirectoryTrustResult {
  return { status, approval, directory };
}

function renderFolder(trust?: Trust): void {
  render(
    <>
      <ModuleFolder
        payload={{ moduleId: "module-1" }}
        runtime={trust ? desktopRuntime(trust) : createBrowserRuntime({ environment: {} })}
      />
      <DialogHost />
    </>,
  );
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "/repos/new" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
}

describe("provider directory trust acceptance", () => {
  beforeEach(() => {
    useClientStore.setState({ dialogs: [] });
    useModalStore.setState({
      modalStack: [{ type: "module-folder", payload: { moduleId: "module-1" } }],
    });
    seedModuleLinks([{ id: "link-module-1", moduleId: "module-1", path: "/repos/old" }]);
    vi.spyOn(moduleLinkTransport, "writeModuleLink").mockImplementation(async (moduleId, path) => {
      seedModuleLinks([
        ...getModuleLinks().filter((link) => link.moduleId !== moduleId),
        { id: `link-${moduleId}`, moduleId, path },
      ]);
    });
  });

  it("[overhaul-300] names the canonical folder and providers, and cancellation keeps the old link", async () => {
    const trust = vi.fn(async (provider: string) =>
      result("approval_required", `${provider}-approval`),
    );
    renderFolder(trust);

    const confirmation = await screen.findByRole("dialog", { name: "Trust module folder?" });
    expect(confirmation).toHaveTextContent("/canonical/repos/new");
    expect(confirmation).toHaveTextContent("Codex, Gemini, and Claude");
    expect(trust).toHaveBeenCalledWith("claude", "/repos/new", null);
    fireEvent.click(within(confirmation).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Trust module folder?" })).not.toBeInTheDocument());
    expect(getModuleFolder("module-1")).toBe("/repos/old");
    expect(moduleLinkTransport.writeModuleLink).not.toHaveBeenCalled();
  });

  it("[overhaul-301] saves an already-trusted folder without confirmation", async () => {
    const trust = vi.fn(async (_provider: string) => result("already_trusted"));
    renderFolder(trust);

    await waitFor(() => expect(getModuleFolder("module-1")).toBe("/repos/new"));
    expect(screen.queryByRole("dialog", { name: "Trust module folder?" })).not.toBeInTheDocument();
    expect(trust.mock.calls.map(([provider]) => provider)).toEqual(["codex", "gemini", "claude"]);
  });

  it.each([
    ["Codex denial", "codex", async () => result("denied"), /Codex has denied trust/],
    ["Codex failure", "codex", async () => { throw new Error("malformed config"); }, /Could not inspect Codex folder trust: malformed config/],
    ["Claude denial", "claude", async () => result("denied"), /Claude has denied trust/],
    ["Claude unsupported version", "claude", async () => result("unsupported"), /Claude does not support durable folder trust/],
    ["Claude failure", "claude", async () => { throw new Error("config busy"); }, /Could not inspect Claude folder trust: config busy/],
  ] as const)("[overhaul-302] reports %s without confirmation or a link write", async (_case, failingProvider, failure, message) => {
    const trust = vi.fn(async (provider: string) =>
      provider === failingProvider ? failure() : result("already_trusted"),
    );
    renderFolder(trust);

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByRole("dialog", { name: "Trust module folder?" })).not.toBeInTheDocument();
    expect(moduleLinkTransport.writeModuleLink).not.toHaveBeenCalled();
    expect(getModuleFolder("module-1")).toBe("/repos/old");
  });

  it("[overhaul-303] inspects, prepares, then saves a replacement in that order", async () => {
    const events: string[] = [];
    const trust = vi.fn(async (provider: string, _directory: string, approval: string | null) => {
      events.push(`${approval ? "prepare" : "inspect"}:${provider}`);
      if (provider === "gemini") return result("already_trusted");
      return approval ? result("prepared") : result("approval_required", "codex-approval");
    });
    vi.mocked(moduleLinkTransport.writeModuleLink).mockImplementation(async (moduleId, path) => {
      events.push("save");
      seedModuleLinks([{ id: `link-${moduleId}`, moduleId, path }]);
    });
    renderFolder(trust);
    fireEvent.click(await screen.findByRole("button", { name: "Trust folder" }));

    await waitFor(() => expect(getModuleFolder("module-1")).toBe("/repos/new"));
    expect(events).toEqual([
      "inspect:codex", "inspect:gemini", "inspect:claude",
      "inspect:codex", "inspect:gemini", "inspect:claude",
      "prepare:codex", "prepare:claude", "save",
    ]);
  });

  it("[overhaul-304] keeps partial success and retries only the provider still needing trust", async () => {
    let codexTrusted = false;
    let claudeAttempts = 0;
    const trust = vi.fn(async (provider: string, _directory: string, approval: string | null) => {
      if (provider === "codex") {
        if (codexTrusted) return result("already_trusted");
        if (approval) { codexTrusted = true; return result("prepared"); }
        return result("approval_required", "codex-approval");
      }
      if (provider === "gemini") return result("already_trusted");
      if (approval && claudeAttempts++ === 0) throw new Error("config busy");
      return approval ? result("prepared") : result("approval_required", "claude-approval");
    });
    renderFolder(trust);
    fireEvent.click(await screen.findByRole("button", { name: "Trust folder" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not prepare Claude folder trust: config busy");
    expect(getModuleFolder("module-1")).toBe("/repos/old");
    expect(moduleLinkTransport.writeModuleLink).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const retry = await screen.findByRole("dialog", { name: "Trust module folder?" });
    expect(retry).toHaveTextContent("Claude");
    expect(retry).not.toHaveTextContent("Codex");
    fireEvent.click(within(retry).getByRole("button", { name: "Trust folder" }));
    await waitFor(() => expect(getModuleFolder("module-1")).toBe("/repos/new"));
    expect(moduleLinkTransport.writeModuleLink).toHaveBeenCalledTimes(1);
  });

  it("[overhaul-305] preserves browser folder setup without provider calls", async () => {
    renderFolder();
    await act(async () => { await Promise.resolve(); });
    expect(getModuleFolder("module-1")).toBe("/repos/new");
  });

  it("[overhaul-306] renews consent when the canonical folder or provider set changes", async () => {
    let inspectionRound = 0;
    const trust = vi.fn(async (provider: string, _directory: string, approval: string | null) => {
      if (approval) return result("prepared", null, "/canonical/new-target");
      if (provider === "codex") inspectionRound += 1;
      const directory = inspectionRound === 1 ? "/canonical/old-target" : "/canonical/new-target";
      if (provider === "claude") return result("already_trusted", null, directory);
      if (provider === "gemini" && inspectionRound > 1) return result("already_trusted", null, directory);
      return result("approval_required", `${provider}-${inspectionRound}`, directory);
    });
    renderFolder(trust);

    const first = await screen.findByRole("dialog", { name: "Trust module folder?" });
    expect(first).toHaveTextContent("/canonical/old-target");
    expect(first).toHaveTextContent("Codex and Gemini");
    fireEvent.click(within(first).getByRole("button", { name: "Trust folder" }));

    const renewed = await screen.findByRole("dialog", { name: "Trust module folder?" });
    expect(renewed).toHaveTextContent("/canonical/new-target");
    expect(renewed).toHaveTextContent("Codex");
    expect(renewed).not.toHaveTextContent("Codex and Gemini");
    expect(moduleLinkTransport.writeModuleLink).not.toHaveBeenCalled();
    expect(trust.mock.calls.filter(([, , approval]) => approval).length).toBe(0);

    fireEvent.click(within(renewed).getByRole("button", { name: "Trust folder" }));
    await waitFor(() => expect(getModuleFolder("module-1")).toBe("/repos/new"));
  });
});
