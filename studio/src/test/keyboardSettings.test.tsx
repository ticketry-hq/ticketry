import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useModalStore } from "../app/modal";
import { SettingsModal } from "../features/studio/modals/SettingsModal";
import { studioKeymapRegistry } from "../app/navigation/keymapRegistry";
import { KeyboardSettingsPanel } from "../features/studio/modals/KeyboardSettingsPanel";
import { useConfigStore } from "../features/studio/stores/configStore";
import { useWorkflowEditorStore } from "../features/workflows/workflowEditorStore";

vi.mock("../features/workflows/WorkflowSettingsPanel", () => ({
  WorkflowSettingsPanel: () => <div>Workflow panel</div>,
}));

it("hides keyboard customization", () => {
  useModalStore.setState({
    modalStack: [{ type: "settings" }],
    activeBindings: null,
  });

  render(<SettingsModal />);

  expect(screen.queryByRole("tab", { name: "Keyboard" })).not.toBeInTheDocument();
  expect(
    studioKeymapRegistry
      .getEffectiveBindings()
      .some((binding) => binding.actionId === "open-web"),
  ).toBe(false);
});

it("lists the sidebar toggle for rebinding only when the sidebar exists", () => {
  const panel = () => (
    <KeyboardSettingsPanel
      bindings={studioKeymapRegistry.getConfigurableBindings()}
      overridden={new Set()}
      recordingKey={null}
      message={null}
      saving={false}
      onRecord={vi.fn()}
      onReset={vi.fn()}
      onRestoreDefaults={vi.fn()}
    />
  );
  useConfigStore.setState({
    features: { sidebar: false, projects: false },
  });
  const { rerender } = render(panel());

  expect(screen.queryByText("Toggle sidebar")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", {
      name: "Record Toggle sidebar binding",
    }),
  ).not.toBeInTheDocument();

  useConfigStore.setState({
    features: { sidebar: true, projects: false },
  });
  rerender(panel());

  expect(screen.getByText("Toggle sidebar")).toBeInTheDocument();
  expect(
    screen.getByRole("button", {
      name: "Record Toggle sidebar binding",
    }),
  ).toHaveTextContent("\\");
});

describe.skip("keyboard settings behavior while hidden", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    studioKeymapRegistry.setOverrides([]);
    useModalStore.setState({
      modalStack: [{ type: "settings" }],
      activeBindings: null,
    });
    useWorkflowEditorStore.setState({
    });
  });

  async function openKeyboard() {
    fireEvent.click(screen.getByRole("tab", { name: "Keyboard" }));
    await screen.findByRole("button", { name: "Record Settings binding" });
  }

  function mockEchoingSave() {
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { value: unknown };
      return new Response(JSON.stringify(body), { status: 200 });
    });
  }

  it("records a chord, applies it immediately, and persists the override", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          value: [
            {
              context: "global",
              actionId: "settings",
              chord: {
                key: "k",
                alt: false,
                control: true,
                meta: false,
                shift: false,
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    render(<SettingsModal />);
    await openKeyboard();
    fireEvent.click(screen.getByRole("button", { name: "Record Settings binding" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "k", ctrlKey: true });

    expect(screen.getByRole("button", { name: "Record Settings binding" })).toHaveTextContent(
      "Ctrl+K",
    );
    expect(
      studioKeymapRegistry.getEffectiveBinding("global", "settings")?.chord,
    ).toEqual({
      key: "k",
      alt: false,
      control: true,
      meta: false,
      shift: false,
    });

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      value: [
        {
          context: "global",
          actionId: "settings",
          chord: {
            key: "k",
            alt: false,
            control: true,
            meta: false,
            shift: false,
          },
        },
      ],
    });
  });

  it("cancels recording with Esc without closing Settings", async () => {
    const fetch = mockEchoingSave();
    render(<SettingsModal />);
    await openKeyboard();

    fireEvent.click(screen.getByRole("button", { name: "Record Settings binding" }));
    expect(screen.getByText("Press a chord…")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(screen.queryByText("Press a chord…")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(useModalStore.getState().modalStack).toEqual([{ type: "settings" }]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses browser-owned chords and keeps close-modal locked", async () => {
    const fetch = mockEchoingSave();
    render(<SettingsModal runtimePlatform="browser" />);
    await openKeyboard();

    expect(
      screen.getByRole("button", { name: "Record Close modal binding" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Record Status binding" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "w", metaKey: true });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Cmd+W is owned by the browser",
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(studioKeymapRegistry.getOverrides()).toEqual([]);
  });

  it("allows browser-owned chords in the desktop runtime", async () => {
    const fetch = mockEchoingSave();
    render(<SettingsModal runtimePlatform="desktop" />);
    await openKeyboard();

    fireEvent.click(screen.getByRole("button", { name: "Record Status binding" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "w", metaKey: true });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record Status binding" })).toHaveTextContent(
      "Cmd+W",
    );
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  });

  it("blocks same-context duplicates", async () => {
    const fetch = mockEchoingSave();
    render(<SettingsModal />);
    await openKeyboard();

    fireEvent.click(screen.getByRole("button", { name: "Record Settings binding" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "s", ctrlKey: true });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Ctrl+S is already bound to Status in global",
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(studioKeymapRegistry.getOverrides()).toEqual([]);
  });

  it("warns about cross-context shadowing but saves the chord", async () => {
    const fetch = mockEchoingSave();
    render(<SettingsModal />);
    await openKeyboard();

    fireEvent.click(screen.getByRole("button", { name: "Record Settings binding" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter" });

    expect(screen.getByRole("status")).toHaveTextContent(
      "Enter also binds Confirm modal in modal",
    );
    expect(screen.getByRole("button", { name: "Record Settings binding" })).toHaveTextContent(
      "Enter",
    );
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  });

  it("keeps fixed edit-view actions out of configuration", async () => {
    studioKeymapRegistry.setOverrides([
      {
        context: "capture",
        actionId: "edit-view.next-zone",
        chord: {
          key: "x",
          alt: false,
          control: false,
          meta: false,
          shift: false,
        },
      },
    ]);
    const fetch = mockEchoingSave();
    render(<SettingsModal />);
    await openKeyboard();

    expect(
      screen.queryByRole("button", { name: /Record edit-view\./ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/edit-view\./)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Restore defaults" }),
    ).toBeDisabled();

    fireEvent.click(
      screen.getByRole("button", { name: "Record Settings binding" }),
    );
    fireEvent.keyDown(screen.getByRole("dialog"), {
      key: "Tab",
      shiftKey: true,
    });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      value: [
        {
          context: "global",
          actionId: "settings",
          chord: {
            key: "Tab",
            alt: false,
            control: false,
            meta: false,
            shift: true,
          },
        },
      ],
    });
  });

  it("fuzzy-filters bindings by action label and context, then clearing restores all rows", async () => {
    render(<SettingsModal />);
    await openKeyboard();
    const allBindingCount =
      studioKeymapRegistry.getConfigurableBindings().length;
    const search = screen.getByRole("searchbox", { name: "Search bindings" });

    fireEvent.change(search, { target: { value: "opn agt" } });
    expect(
      screen.getAllByRole("button", { name: /^Record .+ binding$/ }),
    ).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "Record Open Agent binding" }),
    ).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "fcsd pn" } });
    const contextMatches = screen.getAllByRole("button", {
      name: /^Record .+ binding$/,
    });
    expect(contextMatches.length).toBeGreaterThan(1);
    expect(screen.getAllByText("Focused pane")).toHaveLength(contextMatches.length);

    fireEvent.change(search, { target: { value: "" } });
    expect(
      screen.getAllByRole("button", { name: /^Record .+ binding$/ }),
    ).toHaveLength(allBindingCount);
  });

  it("records and resets a binding while its row is filtered", async () => {
    const fetch = mockEchoingSave();
    render(<SettingsModal />);
    await openKeyboard();

    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search bindings" }),
      { target: { value: "sttngs" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Record Settings binding" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "k", ctrlKey: true });

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Record Settings binding" })).toHaveTextContent(
      "Ctrl+K",
    );

    fireEvent.click(screen.getByRole("button", { name: "Reset Settings binding" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: "Record Settings binding" })).toHaveTextContent(
      "E",
    );
  });

  it("shows every binding and resets one row or all overrides", async () => {
    studioKeymapRegistry.setOverrides([
      {
        context: "global",
        actionId: "settings",
        chord: {
          key: "k",
          alt: false,
          control: true,
          meta: false,
          shift: false,
        },
      },
      {
        context: "global",
        actionId: "status",
        chord: {
          key: "u",
          alt: false,
          control: false,
          meta: false,
          shift: false,
        },
      },
    ]);
    const fetch = mockEchoingSave();
    render(<SettingsModal />);
    await openKeyboard();

    expect(screen.getAllByRole("button", { name: /^Record .+ binding$/ })).toHaveLength(
      studioKeymapRegistry.getConfigurableBindings().length,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reset Settings binding" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Record Settings binding" })).toHaveTextContent(
      "E",
    );
    expect(screen.getByRole("button", { name: "Record Status binding" })).toHaveTextContent(
      "U",
    );

    fireEvent.click(screen.getByRole("button", { name: "Restore defaults" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(studioKeymapRegistry.getOverrides()).toEqual([]);
    expect(screen.getByRole("button", { name: "Record Status binding" })).toHaveTextContent(
      "S",
    );
  });
});
