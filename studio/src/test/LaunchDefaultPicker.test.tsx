import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  LaunchDefaultPicker,
  type LaunchDefaultPickerValue,
} from "../features/workflows/LaunchDefaultPicker";
import { validateLaunchBindingOptions } from "../features/workflows/launchBindingValidation";
import type { ProviderCapabilities } from "../shared/api/types";

const capabilities: ProviderCapabilities[] = [
  {
    agent: "claude",
    // Deliberately only partly overlapping with codex below: "medium" is
    // shared, "high" and "low" are claude-only here. Reasoning names overlap
    // across providers but not completely, which is what makes carrying one
    // across a provider change a real decision rather than a formality.
    models: [
      { name: "sonnet", reasoning_levels: ["low", "medium", "high"] },
      { name: "opus", reasoning_levels: ["medium", "high"] },
    ],
  },
  {
    agent: "codex",
    models: [
      { name: "gpt-5.4", reasoning_levels: ["minimal", "medium", "xhigh"] },
      { name: "gpt-5.3-codex", reasoning_levels: ["medium", "xhigh"] },
    ],
  },
];

function PickerHarness({
  initialValue = { provider: "claude", model: "", reasoning: "" },
  onCommit = vi.fn(),
}: {
  initialValue?: LaunchDefaultPickerValue;
  onCommit?: (value: LaunchDefaultPickerValue, field: keyof LaunchDefaultPickerValue) => void;
}) {
  const [value, setValue] = useState(initialValue);
  return (
    <LaunchDefaultPicker
      providerCapabilities={capabilities}
      value={value}
      onChange={setValue}
      onCommit={onCommit}
    />
  );
}

describe("LaunchDefaultPicker", () => {
  it("offers only catalog models and commits the newly selected triple", () => {
    const onCommit = vi.fn();
    render(<PickerHarness onCommit={onCommit} />);

    const model = screen.getByRole("combobox", { name: "Model" });
    expect(within(model).getByRole("option", { name: "sonnet" }))
      .toBeInTheDocument();
    expect(within(model).getByRole("option", { name: "opus" }))
      .toBeInTheDocument();

    fireEvent.change(model, { target: { value: "sonnet" } });
    expect(onCommit).toHaveBeenLastCalledWith({
      provider: "claude",
      model: "sonnet",
      reasoning: "",
    }, "model");

  });

  it("uses catalog models from the provider and no reasoning before selection", () => {
    const onCommit = vi.fn();
    render(
      <PickerHarness
        initialValue={{ provider: "claude", model: "sonnet", reasoning: "high" }}
        onCommit={onCommit}
      />,
    );

    const provider = screen.getByRole("combobox", { name: "Agent/provider" });
    fireEvent.change(provider, { target: { value: "codex" } });

    const reasoning = screen.getByRole("combobox", { name: "Reasoning" });
    expect(within(reasoning).queryByRole("option", { name: "minimal" }))
      .not.toBeInTheDocument();
    expect(within(reasoning).queryByRole("option", { name: "low" }))
      .not.toBeInTheDocument();

    const model = screen.getByRole("combobox", { name: "Model" });
    expect(within(model).getByRole("option", { name: "gpt-5.4" }))
      .toBeInTheDocument();
    expect(within(model).queryByRole("option", { name: "sonnet" }))
      .not.toBeInTheDocument();
  });

  it("drops a reasoning the newly chosen provider does not offer", () => {
    // Carrying it forward wrote an (agent, reasoning) pair the server 422s, so
    // the save was lost while the form already showed the new provider.
    const onCommit = vi.fn();
    render(
      <PickerHarness
        initialValue={{ provider: "claude", model: "opus", reasoning: "high" }}
        onCommit={onCommit}
      />,
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Agent/provider" }), {
      target: { value: "codex" },
    });

    expect(onCommit).toHaveBeenCalledWith({
      provider: "codex",
      model: "",
      reasoning: "",
    }, "provider");
    expect(screen.getByRole("combobox", { name: "Reasoning" })).toHaveValue("");
  });

  it("clears reasoning on a provider change even when names overlap", () => {
    const onCommit = vi.fn();
    render(
      <PickerHarness
        initialValue={{ provider: "claude", model: "sonnet", reasoning: "medium" }}
        onCommit={onCommit}
      />,
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Agent/provider" }), {
      target: { value: "codex" },
    });

    expect(onCommit).toHaveBeenCalledWith({
      provider: "codex",
      model: "",
      reasoning: "",
    }, "provider");
  });

  it("retains shared reasoning on model changes and clears unsupported reasoning", () => {
    const onCommit = vi.fn();
    const { unmount } = render(
      <PickerHarness
        initialValue={{ provider: "claude", model: "sonnet", reasoning: "medium" }}
        onCommit={onCommit}
      />,
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Model" }), {
      target: { value: "opus" },
    });
    expect(onCommit).toHaveBeenLastCalledWith({
      provider: "claude", model: "opus", reasoning: "medium",
    }, "model");

    unmount();
    render(
      <PickerHarness
        initialValue={{ provider: "claude", model: "sonnet", reasoning: "low" }}
        onCommit={onCommit}
      />,
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Model" }), {
      target: { value: "opus" },
    });
    expect(onCommit).toHaveBeenLastCalledWith({
      provider: "claude", model: "opus", reasoning: "",
    }, "model");
  });

  it("still marks a reasoning that arrived from the server as unsupported", () => {
    // Only a *user-driven* provider change drops one; a stored pair the server
    // already has must stay visible rather than silently disappear.
    render(
      <PickerHarness
        initialValue={{ provider: "codex", model: "removed-model", reasoning: "high" }}
      />,
    );

    const reasoning = screen.getByRole("combobox", { name: "Reasoning" });
    expect(within(screen.getByRole("combobox", { name: "Model" })).getByRole(
      "option", { name: "removed-model (unsupported)" },
    )).toBeInTheDocument();
    expect(within(reasoning).getByRole("option", { name: "high (unsupported)" }))
      .toBeInTheDocument();
    expect(validateLaunchBindingOptions({
      agent: "codex",
      model: "removed-model",
      reasoning: "high",
    }, capabilities)).toEqual({
      field: "model",
      message: "Model 'removed-model' is not compatible with agent/provider 'codex'.",
    });
  });
});
