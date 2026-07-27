import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  LaunchDefaultPicker,
  type LaunchDefaultPickerValue,
} from "../features/workflows/LaunchDefaultPicker";
import type { ProviderCapabilities } from "../shared/api/types";

const capabilities: ProviderCapabilities[] = [
  {
    agent: "claude",
    accepts_model: true,
    accepts_any_model: false,
    model_aliases: ["sonnet", "opus"],
    model_prefixes: ["claude-"],
    // Deliberately only partly overlapping with codex below: "medium" is
    // shared, "high" and "low" are claude-only here. Reasoning names overlap
    // across providers but not completely, which is what makes carrying one
    // across a provider change a real decision rather than a formality.
    reasoning_levels: ["low", "medium", "high"],
  },
  {
    agent: "codex",
    accepts_model: true,
    accepts_any_model: false,
    model_aliases: ["gpt-5.4", "gpt-5.3-codex"],
    model_prefixes: ["gpt-"],
    reasoning_levels: ["minimal", "medium", "xhigh"],
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
  it("offers known models while accepting and committing free text", () => {
    const onCommit = vi.fn();
    render(<PickerHarness onCommit={onCommit} />);

    const model = screen.getByRole("combobox", { name: "Model" });
    const suggestions = document.getElementById(model.getAttribute("list") ?? "");
    expect(suggestions).not.toBeNull();
    expect(suggestions?.querySelector('option[value="sonnet"]')).not.toBeNull();
    expect(suggestions?.querySelector('option[value="opus"]')).not.toBeNull();

    fireEvent.change(model, { target: { value: "sonnet" } });
    fireEvent.blur(model);
    expect(onCommit).toHaveBeenLastCalledWith({
      provider: "claude",
      model: "sonnet",
      reasoning: "",
    }, "model");

    fireEvent.change(model, { target: { value: "claude-custom-model" } });
    expect(model).toHaveValue("claude-custom-model");
    fireEvent.blur(model);

    expect(onCommit).toHaveBeenLastCalledWith({
      provider: "claude",
      model: "claude-custom-model",
      reasoning: "",
    }, "model");
  });

  it("uses reasoning levels and model suggestions from the selected provider", () => {
    const onCommit = vi.fn();
    render(
      <PickerHarness
        initialValue={{ provider: "claude", model: "", reasoning: "high" }}
        onCommit={onCommit}
      />,
    );

    const provider = screen.getByRole("combobox", { name: "Agent/provider" });
    fireEvent.change(provider, { target: { value: "codex" } });

    const reasoning = screen.getByRole("combobox", { name: "Reasoning" });
    expect(within(reasoning).getByRole("option", { name: "minimal" }))
      .toBeInTheDocument();
    expect(within(reasoning).getByRole("option", { name: "medium" }))
      .toBeInTheDocument();
    expect(within(reasoning).queryByRole("option", { name: "low" }))
      .not.toBeInTheDocument();

    const model = screen.getByRole("combobox", { name: "Model" });
    const suggestions = document.getElementById(model.getAttribute("list") ?? "");
    expect(suggestions?.querySelector('option[value="gpt-5.4"]')).not.toBeNull();
    expect(suggestions?.querySelector('option[value="sonnet"]')).toBeNull();
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

  it("carries a reasoning both providers offer across the change", () => {
    const onCommit = vi.fn();
    render(
      <PickerHarness
        initialValue={{ provider: "claude", model: "", reasoning: "medium" }}
        onCommit={onCommit}
      />,
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Agent/provider" }), {
      target: { value: "codex" },
    });

    expect(onCommit).toHaveBeenCalledWith({
      provider: "codex",
      model: "",
      reasoning: "medium",
    }, "provider");
  });

  it("still marks a reasoning that arrived from the server as unsupported", () => {
    // Only a *user-driven* provider change drops one; a stored pair the server
    // already has must stay visible rather than silently disappear.
    render(
      <PickerHarness
        initialValue={{ provider: "codex", model: "", reasoning: "high" }}
      />,
    );

    const reasoning = screen.getByRole("combobox", { name: "Reasoning" });
    expect(within(reasoning).getByRole("option", { name: "high (unsupported)" }))
      .toBeInTheDocument();
  });
});
