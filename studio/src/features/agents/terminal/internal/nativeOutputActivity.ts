import { createWorkTrackerClient } from "@worktracker/typescript-sdk/client";
import { apiBase, apiKey } from "../../../../shared/api/client";

/**
 * The native renderer's report of the shared terminal-output observation.
 *
 * libghostty owns the desktop viewer's PTY, so Studio never sees the bytes and
 * must not guess what changed. It reports only that an attached viewer is
 * rendering a durable session; the backend captures the screen, compares the
 * output identity, and decides whether anything advanced. A reconnect or
 * reload that redraws the same screen therefore extends no deadline.
 */
export interface OutputActivityClient {
  report(agentRunId: string): Promise<void>;
}

/**
 * Reports once, when a native viewer takes ownership of a durable session.
 *
 * Studio has no output signal for a native viewer — libghostty keeps the bytes
 * — so a repeating report would be an unconditional heartbeat, not evidence of
 * output: every tick would cost an authenticated round trip, a `capture-pane`
 * subprocess, and a database write per attached viewer whether or not the
 * terminal produced anything. The backend's live-session sweep (#679) already
 * observes every live durable session on its own cadence, independent of any
 * viewer, so ongoing observation is the backend's job and needs no client
 * chatter at all.
 *
 * What attaching genuinely adds is promptness: a session the sweep has already
 * projected as stalled is re-observed the moment somebody opens it, instead of
 * waiting out the remainder of a sweep interval. That is worth exactly one
 * report.
 *
 * Reporting is status telemetry: a failed report is dropped, never surfaced,
 * so it can neither block nor disturb native rendering.
 */
export function reportNativeViewerAttached(
  client: OutputActivityClient,
  agentRunId: string,
): void {
  void client.report(agentRunId).catch(() => {});
}

/** Desktop's companion to the viewer lease on the same authenticated surface. */
export const desktopOutputActivity: OutputActivityClient = {
  async report(agentRunId) {
    await createWorkTrackerClient({
      baseUrl: apiBase(),
      apiKey: apiKey(),
    }).terminals.terminalsViewersOutputCreate({
      viewerOutputReport: { agent_run_id: agentRunId },
    });
  },
};
