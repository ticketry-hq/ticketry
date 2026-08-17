import { afterEach, describe, expect, it, vi } from "vitest";

import { useModalStore } from "../../app/modal/modalStore";
import {
  focusTerminal,
  registerTerminalFocus,
  rekeyTerminalFocus,
} from "../../features/agents/terminal/internal/terminalRegistry";

describe("terminal focus registry", () => {
  afterEach(() => {
    useModalStore.setState({ modalStack: [] });
  });

  it("delivers a focus request issued before the terminal registered", () => {
    // Selecting a tab focuses its terminal in the same tick, before that
    // terminal is visible enough to register a focuser.
    focusTerminal("session-late");
    const focus = vi.fn();

    registerTerminalFocus("session-late", focus);

    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("spends a held request once", () => {
    focusTerminal("session-once");
    const release = registerTerminalFocus("session-once", vi.fn());
    release();
    const second = vi.fn();

    registerTerminalFocus("session-once", second);

    expect(second).not.toHaveBeenCalled();
  });

  it("supersedes a held request when another terminal is selected", () => {
    focusTerminal("session-abandoned");
    focusTerminal("session-wanted");
    const abandoned = vi.fn();
    const wanted = vi.fn();

    registerTerminalFocus("session-abandoned", abandoned);
    registerTerminalFocus("session-wanted", wanted);

    expect(abandoned).not.toHaveBeenCalled();
    expect(wanted).toHaveBeenCalledTimes(1);
  });

  it("follows a held request across the ready rekey", () => {
    // A spawn is focused under its temporary id and rekeyed to the server id
    // when the ready frame arrives, which may land first.
    focusTerminal("tmp_1");
    rekeyTerminalFocus("tmp_1", "session-1");
    const focus = vi.fn();

    registerTerminalFocus("session-1", focus);

    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("abandons a held request when a modal opens over it", () => {
    // The request was banked while the viewer was still attaching; a dialog
    // then took the foreground. Delivering it on the post-close reveal would
    // steal focus from whatever the modal restored it to.
    focusTerminal("session-occluded");
    useModalStore.getState().openSettings();
    useModalStore.getState().popModal();
    const focus = vi.fn();

    registerTerminalFocus("session-occluded", focus);

    expect(focus).not.toHaveBeenCalled();
  });

  it("focuses a registered terminal immediately", () => {
    const focus = vi.fn();
    registerTerminalFocus("session-live", focus);

    focusTerminal("session-live");

    expect(focus).toHaveBeenCalledTimes(1);
  });
});
