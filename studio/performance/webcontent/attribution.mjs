/**
 * Deciding which WKWebView content process belongs to the packaged window.
 *
 * macOS gives no user-space link between an application and the
 * `com.apple.WebKit.WebContent` XPC service rendering its WebView: launchd is
 * the parent of every content process, `ps` shows no arguments, and the
 * responsible-process link needs root. A developer machine routinely runs a
 * dozen content processes for Safari, Mail and every other WebKit client, so
 * "the biggest WebKit process" is a number that reads like evidence and is not.
 *
 * The one signal available without privileges is launch order: WebKit spawns
 * the content process for a window within seconds of the application starting.
 * This module attributes a content process only when exactly one started inside
 * that window, and reports why it cannot when several did. An operator may
 * override the rule, and the override is recorded as an assertion so no reader
 * mistakes it for a measurement.
 */
export const WEB_CONTENT_COMMAND = "com.apple.WebKit.WebContent";

/** How long after the GUI process starts its content process may appear. */
export const DEFAULT_LAUNCH_WINDOW_SECONDS = 60;

function unattributed(reason, extra = {}) {
  return { pid: null, reason, evidence: null, ...extra };
}

function isWebContent(row) {
  return typeof row.command === "string" && row.command.includes(WEB_CONTENT_COMMAND);
}

/**
 * @param platform         process.platform of the measuring host.
 * @param processTable     rows of `{pid, ppid, startedAtMs, command}`.
 * @param guiPid           the packaged application's GUI process.
 * @param expectedGuiCommand  when given, the GUI row's command must contain it.
 * @param windowSeconds    launch-correlation window, in seconds.
 * @param assertedWebContentPid  operator override; recorded, never inferred.
 */
export function resolveWebContentProcess({
  platform = process.platform,
  processTable = [],
  guiPid,
  expectedGuiCommand = null,
  windowSeconds = DEFAULT_LAUNCH_WINDOW_SECONDS,
  assertedWebContentPid = null,
} = {}) {
  if (platform !== "darwin") {
    return unattributed(
      `WebContent attribution is macOS-only, and this host reports ${platform}`,
    );
  }
  const gui = processTable.find((row) => row.pid === guiPid);
  if (!gui) return unattributed(`GUI process ${guiPid} is not running`);
  if (expectedGuiCommand && !gui.command.includes(expectedGuiCommand)) {
    return unattributed(
      `PID ${guiPid} runs ${gui.command}, not ${expectedGuiCommand}`,
    );
  }

  const contentProcesses = processTable.filter(isWebContent);
  if (assertedWebContentPid !== null) {
    const asserted = contentProcesses.find((row) => row.pid === assertedWebContentPid);
    if (!asserted) {
      return unattributed(
        `the asserted PID ${assertedWebContentPid} is not a WebKit content process`,
      );
    }
    const offsetSeconds = (asserted.startedAtMs - gui.startedAtMs) / 1000;
    return {
      pid: asserted.pid,
      reason: null,
      evidence: {
        rule: "operator-asserted",
        guiPid,
        guiStartedAtMs: gui.startedAtMs,
        webContentStartedAtMs: asserted.startedAtMs,
        offsetSeconds,
        // Whether the assertion would also have been reached by the launch
        // window. A corroborated assertion is still an assertion.
        corroborated: offsetSeconds >= 0 && offsetSeconds <= windowSeconds,
        note:
          "the operator named this process; it was not derived from launch "
          + "correlation and carries no independent evidence",
      },
    };
  }

  const inWindow = contentProcesses.filter((row) => {
    const offsetSeconds = (row.startedAtMs - gui.startedAtMs) / 1000;
    return offsetSeconds >= 0 && offsetSeconds <= windowSeconds;
  });
  if (inWindow.length === 0) {
    return unattributed(
      `no WebKit content process started within ${windowSeconds}s of GUI process `
      + `${guiPid}, so none can be attributed to its window`,
      { candidates: [] },
    );
  }
  if (inWindow.length > 1) {
    const candidates = inWindow.map(({ pid }) => pid).sort((left, right) => left - right);
    return unattributed(
      `${inWindow.length} WebKit content processes started within ${windowSeconds}s of `
      + `GUI process ${guiPid}, so none can be attributed to its window with confidence`,
      { candidates },
    );
  }

  const [attributed] = inWindow;
  return {
    pid: attributed.pid,
    reason: null,
    evidence: {
      rule: "single WebKit content process launched inside the GUI launch window",
      guiPid,
      guiStartedAtMs: gui.startedAtMs,
      webContentStartedAtMs: attributed.startedAtMs,
      offsetSeconds: (attributed.startedAtMs - gui.startedAtMs) / 1000,
      windowSeconds,
      rejectedPids: contentProcesses
        .filter((row) => row.pid !== attributed.pid)
        .map(({ pid }) => pid)
        .sort((left, right) => left - right),
      note:
        "launch correlation is circumstantial. It is the strongest signal macOS "
        + "exposes without root, and it refuses rather than guesses when several "
        + "content processes share the window.",
    },
  };
}
