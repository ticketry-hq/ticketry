import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  loadProviderCatalog: vi.fn(),
  loadProviderCapabilities: vi.fn(),
  loadConfigurableProviderCapabilities: vi.fn(),
  updateProviderCatalog: vi.fn(),
  getProviderCapabilitiesSnapshot: vi.fn(() => []),
  setProviderCapabilities: vi.fn(),
}));

vi.mock("../features/workflows/providerQueries", () => api);

import {
  ModelConfigurationPanel,
  type ModelConfigurationPanelHandle,
} from "../features/workflows/ModelConfigurationPanel";
import {
  commitPendingSettingsChanges,
  createSettingsChangeLedger,
  syncPendingSettingsChanges,
  type SettingsChangeLedger,
} from "../features/settings/changeLedger";

describe("Codex profile settings acceptance", () => {
  beforeEach(() => {
    const catalog = {
      activated_providers: ["codex"],
      codex_profiles: ["existing"],
      global_default: {
        provider: "codex",
        profile: null,
        model: "gpt-6-astra",
        reasoning: "high",
      },
    };
    const capabilities = [{
      agent: "codex",
      accepts_model: true,
      accepts_any_model: false,
      model_aliases: ["gpt-6-astra"],
      reasoning_levels: ["high"],
      model_reasoning_levels: { "gpt-6-astra": ["high"] },
    }];
    api.loadProviderCatalog.mockReset().mockResolvedValue(catalog);
    api.loadProviderCapabilities.mockReset().mockResolvedValue(capabilities);
    api.loadConfigurableProviderCapabilities.mockReset().mockResolvedValue(capabilities);
    api.updateProviderCatalog.mockReset().mockImplementation(async (value) => value);
  });

  it("[overhaul-297] registers, deduplicates, selects, saves, and removes Codex profiles", async () => {
    const ref = createRef<ModelConfigurationPanelHandle>();
    render(<ModelConfigurationPanel ref={ref} />);

    const input = await screen.findByLabelText("New Codex profile");
    fireEvent.change(input, { target: { value: "  work  " } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.change(input, { target: { value: "work" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.change(screen.getByLabelText("Codex profile"), {
      target: { value: "work" },
    });

    expect(screen.getByLabelText("Model")).toBeDisabled();
    expect(screen.getByLabelText("Reasoning")).toBeDisabled();
    ref.current!.save();

    await waitFor(() => expect(api.updateProviderCatalog).toHaveBeenCalledWith({
      activated_providers: ["codex"],
      codex_profiles: ["existing", "work"],
      global_default: {
        provider: "codex",
        profile: "work",
        model: null,
        reasoning: null,
      },
    }));

    fireEvent.click(screen.getByRole("button", { name: "Remove Codex profile work" }));
    expect(screen.getByLabelText("Codex profile")).toHaveValue("");
  });

  it("[CODING-1826] records profile registry additions and removals in the change ledger", async () => {
    const ref = createRef<ModelConfigurationPanelHandle>();
    let ledger: SettingsChangeLedger = createSettingsChangeLedger();
    render(
      <ModelConfigurationPanel
        ref={ref}
        onCommitStateChange={(state) => {
          ledger = syncPendingSettingsChanges(ledger, "Models", state.changes);
        }}
        onChangesApplied={(changes) => {
          ledger = commitPendingSettingsChanges(ledger, "Models", changes);
        }}
      />,
    );

    const input = await screen.findByLabelText("New Codex profile");
    fireEvent.change(input, { target: { value: "work" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Remove Codex profile existing" }),
    );

    await waitFor(() =>
      expect(
        ledger.entries.filter((entry) => entry.tone === "pending").map((entry) =>
          entry.summary
        ).sort(),
      ).toEqual([
        "Codex profile existing removed",
        "Codex profile work registered",
      ]));

    ref.current!.save();

    await waitFor(() => expect(api.updateProviderCatalog).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        ledger.entries.filter((entry) => entry.tone === "applied").map((entry) =>
          entry.summary
        ).sort(),
      ).toEqual([
        "Codex profile existing removed",
        "Codex profile work registered",
      ]));
    expect(ledger.entries.some((entry) => entry.tone === "pending")).toBe(false);
  });
});
