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
    reasoning_levels: ["low", "high"],
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
    expect(within(reasoning).getByRole("option", { name: "high (unsupported)" }))
      .toBeInTheDocument();

    const model = screen.getByRole("combobox", { name: "Model" });
    const suggestions = document.getElementById(model.getAttribute("list") ?? "");
    expect(suggestions?.querySelector('option[value="gpt-5.4"]')).not.toBeNull();
    expect(suggestions?.querySelector('option[value="sonnet"]')).toBeNull();
    expect(onCommit).toHaveBeenCalledWith({
      provider: "codex",
      model: "",
      reasoning: "high",
    }, "provider");
  });
});
