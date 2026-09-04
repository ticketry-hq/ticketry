import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useModalStore } from "../app/modal/modalStore";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { SettingsModal } from "../features/studio/modals/SettingsModal";
import { installDesktopGraphQlRuntime } from "./desktopGraphQlRuntime";

describe("overhaul acceptance — Conversations settings", () => {
  beforeEach(() => {
    useModalStore.setState({
      modalStack: [{ type: "settings" }],
      presentedNoticeIds: new Set(),
    });
  });

  it("[overhaul-203] navigates to Conversations settings and edits the starter prompt", async () => {
    const saves: unknown[] = [];
    installDesktopGraphQlRuntime(async (document, variables) => {
      const operation = documentOperationName(document);
      if (operation === "LoadInstantLaunchSetting") {
        return {
          instant_launch_setting: {
            __typename: "KeybindingSetting",
            scope: "host",
            key: "instant_launch",
            value: {
              initial_prompt: "Keep changes local.",
              auto_close: false,
            },
            updated_at: "2026-08-30T10:00:00Z",
          },
        } as never;
      }
      if (operation === "UpdateInstantLaunchSetting") {
        saves.push(variables);
        const input = variables as {
          initialPrompt: string;
          autoClose: boolean;
        };
        return {
          update_instant_launch_setting: {
            __typename: "KeybindingSetting",
            scope: "host",
            key: "instant_launch",
            value: {
              initial_prompt: input.initialPrompt,
              auto_close: input.autoClose,
            },
            updated_at: "2026-08-30T11:00:00Z",
          },
        } as never;
      }
      return {} as never;
    });

    render(<SettingsModal />);

    fireEvent.click(screen.getByRole("tab", { name: "Conversations" }));

    expect(
      screen.getByRole("heading", { name: "Conversations" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Starter prompt" }),
    ).toBeVisible();
    const prompt = await screen.findByRole("textbox", {
      name: "Conversation starter prompt",
    });
    expect(prompt).toHaveValue("Keep changes local.");
    fireEvent.change(prompt, {
      target: { value: "Keep changes local and run focused tests." },
    });
    fireEvent.click(screen.getByRole("checkbox", {
      name: /Auto-close successful runs/,
    }));
    fireEvent.click(
      screen.getByRole("button", { name: "Save conversation settings" }),
    );

    await waitFor(() => expect(saves).toEqual([{
      initialPrompt: "Keep changes local and run focused tests.",
      autoClose: true,
    }]));
    expect(await screen.findByText("Conversation settings saved.")).toBeVisible();
  });
});
