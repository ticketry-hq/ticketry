import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatPendingRequests } from "./ChatPendingRequests";
import type { ChatEvent } from "./types";

describe("Chat pending requests", () => {
  it("renders only approval decisions advertised by Codex", async () => {
    const onRespondToApproval = vi.fn().mockResolvedValue(undefined);
    const events: ChatEvent[] = [{
      sequence: 1,
      event_type: "thread.approval-response-requested",
      created_at: "2026-08-08T00:00:00Z",
      payload: {
        requestId: "approval-1",
        requestKind: "item/commandExecution/requestApproval",
        payload: {
          command: "npm test",
          availableDecisions: ["decline", "cancel"],
        },
      },
    }];

    render(
      <ChatPendingRequests
        events={events}
        onRespondToApproval={onRespondToApproval}
        onRespondToUserInput={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Decline" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Cancel turn" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Approve once" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Always allow this session" }))
      .toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    await waitFor(() => {
      expect(onRespondToApproval).toHaveBeenCalledWith("approval-1", "decline");
    });
  });

  it("submits structured input while masking secret free-form answers", async () => {
    const onRespondToUserInput = vi.fn().mockResolvedValue(undefined);
    const events: ChatEvent[] = [{
      sequence: 1,
      event_type: "thread.user-input-response-requested",
      created_at: "2026-08-08T00:00:00Z",
      payload: {
        requestId: "input-1",
        requestKind: "item/tool/requestUserInput",
        payload: {
          questions: [
            {
              id: "scope",
              header: "Scope",
              question: "Which surface?",
              options: [{ label: "Studio", description: "The desktop UI" }],
            },
            {
              id: "token",
              header: "Token",
              question: "Enter the temporary token",
              options: null,
              isOther: true,
              isSecret: true,
            },
          ],
        },
      },
    }];

    render(
      <ChatPendingRequests
        events={events}
        onRespondToApproval={vi.fn()}
        onRespondToUserInput={onRespondToUserInput}
      />,
    );

    const panel = screen.getByRole("region", { name: "Codex needs input" });
    expect(panel).toHaveAttribute("aria-live", "assertive");
    await waitFor(() => expect(panel).toHaveFocus());

    fireEvent.click(screen.getByRole("radio", { name: /Studio/ }));
    const secret = screen.getByLabelText("Token answer");
    expect(secret).toHaveAttribute("type", "password");
    fireEvent.change(secret, { target: { value: "temporary-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit answers" }));

    await waitFor(() => {
      expect(onRespondToUserInput).toHaveBeenCalledWith("input-1", {
        scope: ["Studio"],
        token: ["temporary-secret"],
      });
    });
    expect(localStorage.getItem("temporary-secret")).toBeNull();
  });
});
