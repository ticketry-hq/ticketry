import { describe, expect, it, vi } from "vitest";

import {
  focusTerminal,
  registerTerminalFocus,
  rekeyTerminalFocus,
} from "../../features/agents/terminal/internal/terminalRegistry";

describe("terminal focus registry", () => {
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

  it("focuses a registered terminal immediately", () => {
    const focus = vi.fn();
    registerTerminalFocus("session-live", focus);

    focusTerminal("session-live");

    expect(focus).toHaveBeenCalledTimes(1);
  });
});
