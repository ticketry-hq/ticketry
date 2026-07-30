import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ModalHost } from "../app/modal/ModalHost";
import { useModalStore } from "../app/modal/modalStore";
import {
  createBrowserRuntime,
  initializeBrowserRuntime,
  initializeStudioRuntime,
  type StudioRuntime,
  type UserNotice,
  type UserNoticeListener,
} from "../runtime";

function notice(overrides: Partial<UserNotice> = {}): UserNotice {
  return {
    id: "runtime-warning-1",
    severity: "warning",
    title: "Runtime warning",
    message: "A native service needs your attention.",
    acknowledgementLabel: "I understand",
    ...overrides,
  };
}

describe("notify-user modal", () => {
  beforeEach(() => {
    initializeBrowserRuntime();
    useModalStore.setState({
      modalStack: [],
      activeBindings: null,
      presentedNoticeIds: new Set(),
    });
  });

  afterEach(() => {
    initializeBrowserRuntime();
  });

  it("renders an accessible severity treatment and focuses acknowledgement", async () => {
    useModalStore.getState().notifyUser(notice());

    render(<ModalHost />);

    expect(await screen.findByRole("dialog", { name: "Runtime warning" }))
      .toBeInTheDocument();
    expect(screen.getByText("A native service needs your attention."))
      .toBeVisible();
    expect(screen.getByText("Warning")).toHaveAttribute(
      "data-severity",
      "warning",
    );
    expect(screen.getByRole("button", { name: "I understand" })).toHaveFocus();
  });

  it("acknowledges or escapes the notice and keeps focus trapped", async () => {
    useModalStore.getState().notifyUser(notice());
    const view = render(<ModalHost />);
    const acknowledgement = await screen.findByRole("button", {
      name: "I understand",
    });

    fireEvent.keyDown(acknowledgement, { key: "Tab" });
    expect(screen.getByRole("button", { name: "Close dialog" })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    );

    useModalStore.getState().notifyUser(notice({ id: "runtime-warning-2" }));
    view.rerender(<ModalHost />);
    fireEvent.click(await screen.findByRole("button", { name: "I understand" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders payload strings as text and never as markup", async () => {
    useModalStore.getState().notifyUser(notice({
      title: "<img src=x onerror=alert(1)>",
      message: "<script>window.evil = true</script>",
    }));

    render(<ModalHost />);

    expect(await screen.findByRole("dialog", {
      name: "<img src=x onerror=alert(1)>",
    })).toBeInTheDocument();
    expect(screen.getByText("<script>window.evil = true</script>")).toBeVisible();
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("script")).toBeNull();
  });

  it("deduplicates an id across startup, events, and rerenders", async () => {
    const subscription: { listener: UserNoticeListener | null } = {
      listener: null,
    };
    const runtime: StudioRuntime = {
      ...createBrowserRuntime({ environment: {} }),
      platform: "desktop",
      startup: () => ({
        ...createBrowserRuntime({ environment: {} }).startup(),
        initialNotices: [notice()],
      }),
      subscribeUserNotices: (next) => {
        subscription.listener = next;
        return () => {
          subscription.listener = null;
        };
      },
    };
    initializeStudioRuntime(runtime);

    const view = render(<ModalHost />);
    expect(await screen.findByRole("dialog", { name: "Runtime warning" }))
      .toBeInTheDocument();

    subscription.listener?.(notice({ title: "Duplicate event" }));
    view.rerender(<ModalHost />);

    expect(useModalStore.getState().modalStack).toHaveLength(1);
    expect(screen.queryByRole("dialog", { name: "Duplicate event" }))
      .not.toBeInTheDocument();
  });

  it("ignores malformed application notices at the modal-store boundary", () => {
    useModalStore.getState().notifyUser({
      ...notice(),
      acknowledgementLabel: "",
    });

    expect(useModalStore.getState().modalStack).toEqual([]);
  });
});
