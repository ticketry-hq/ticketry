/**
 * CODING-1304 — a harness that runs the real `ghostty-wasm` surface in a
 * browser against a scripted byte stream instead of a tmux viewer.
 *
 * Everything below the transport is production code: the wasm runtime, the
 * libghostty-vt terminal, the frame reader, the Canvas painter and the key
 * encoder. Only the byte source is a fixture, so this shows what the renderer
 * actually draws without needing a live agent run.
 */
import { openGhosttyWasmSurface } from "../src/features/agents/terminal/ghostty-wasm/internal/surface";
import { rendererMeasurements } from "../src/features/agents/terminal/ghostty-wasm/internal/rendererMeasurement";
import type {
  TerminalClient,
  TerminalClientEvent,
  TerminalClientTransport,
} from "../src/features/agents/terminal/internal/terminalClient";

const E = "\x1b";
const encoder = new TextEncoder();

function rampLine(): string {
  let out = "";
  for (let index = 0; index < 58; index += 1) {
    const t = index / 57;
    const r = Math.round(122 + t * (247 - 122));
    const g = Math.round(162 - t * (162 - 118));
    const b = Math.round(247 - t * (247 - 180));
    out += `${E}[38;2;${r};${g};${b}m█`;
  }
  return `${out}${E}[0m`;
}

const SCRIPT: string[] = [
  `${E}[38;2;122;162;247m╭─ ticketry ${E}[38;2;86;95;137m──────────────────────────────────────────────${E}[38;2;122;162;247m╮${E}[0m\r\n`,
  `${E}[38;2;122;162;247m│${E}[0m  ${E}[1;38;2;158;206;106mghostty-wasm${E}[0m  ${E}[38;2;86;95;137mlibghostty-vt → Canvas 2D → WKWebView${E}[0m     ${E}[38;2;122;162;247m│${E}[0m\r\n`,
  `${E}[38;2;122;162;247m╰──────────────────────────────────────────────────────────╯${E}[0m\r\n`,
  `\r\n`,
  `${E}[38;2;86;95;137m# 16-colour palette${E}[0m\r\n`,
  `  ${E}[30m███${E}[31m███${E}[32m███${E}[33m███${E}[34m███${E}[35m███${E}[36m███${E}[37m███${E}[0m\r\n`,
  `  ${E}[90m███${E}[91m███${E}[92m███${E}[93m███${E}[94m███${E}[95m███${E}[96m███${E}[97m███${E}[0m\r\n`,
  `\r\n`,
  `${E}[38;2;86;95;137m# attributes${E}[0m\r\n`,
  `  ${E}[1mbold${E}[0m   ${E}[3mitalic${E}[0m   ${E}[4munderline${E}[0m   ${E}[9mstrikethrough${E}[0m   ${E}[7minverse${E}[0m\r\n`,
  `\r\n`,
  `${E}[38;2;86;95;137m# 24-bit colour ramp${E}[0m\r\n`,
  `  ${rampLine()}\r\n`,
  `\r\n`,
  `${E}[38;2;86;95;137m# unicode${E}[0m\r\n`,
  `  wide 日本語   emoji 🚀 🔬   combining é ü ñ   box ┌─┬─┐ ╔═╦═╗\r\n`,
  `\r\n`,
  `${E}[38;2;158;206;106m❯${E}[0m ${E}[38;2;192;202;245mgit status --short${E}[0m\r\n`,
  `${E}[38;2;158;206;106m M${E}[0m studio/src/features/agents/terminal/Terminal.tsx\r\n`,
  `${E}[38;2;158;206;106m??${E}[0m studio/src/features/agents/terminal/ghostty-wasm/\r\n`,
  `\r\n`,
  `${E}[38;2;158;206;106m❯${E}[0m `,
];

/** A transport that replays fixture bytes instead of attaching a tmux viewer. */
const fixtureTransport: TerminalClientTransport = {
  attach(params, onEvent: (event: TerminalClientEvent) => void): TerminalClient {
    let index = 0;
    let timer: ReturnType<typeof setInterval> | null = null;
    queueMicrotask(() => {
      onEvent({ type: "ready", sessionId: "demo-viewer", agentRunId: params.agentRunId });
      timer = setInterval(() => {
        if (index >= SCRIPT.length) {
          if (timer) clearInterval(timer);
          timer = null;
          return;
        }
        onEvent({ type: "output", bytes: encoder.encode(SCRIPT[index]) });
        index += 1;
      }, 45);
    });
    return {
      input(bytes) {
        // Echo typed input the way a shell would, so the key encoder is live.
        onEvent({ type: "output", bytes });
      },
      resize() {},
      scroll() {},
      detach() {
        if (timer) clearInterval(timer);
      },
      suspend: () => false,
      resume() {},
      status: () => "ready",
    };
  },
};

const host = document.querySelector<HTMLDivElement>("#terminal");
const status = document.querySelector<HTMLDivElement>("#status");
if (!host || !status) throw new Error("demo host is missing");

const surface = openGhosttyWasmSurface({
  agentRunId: "demo-run",
  host,
  transport: fixtureTransport,
  onFailure: (reason, detail) => {
    status.textContent = `renderer unavailable — ${reason}: ${detail}`;
    status.dataset.state = "failed";
  },
});
surface.focus();

window.setInterval(() => {
  if (status.dataset.state === "failed") return;
  const sample = rendererMeasurements().find((entry) => entry.renderer === "ghostty-wasm");
  if (!sample) return;
  status.dataset.state = "ready";
  const memory = sample.wasmMemoryBytes;
  status.textContent = [
    `cold attach ${sample.coldAttachMs?.toFixed(1) ?? "—"} ms`,
    `${sample.frames} frames`,
    `paint p50 ${sample.paintMsP50.toFixed(2)} ms / p95 ${sample.paintMsP95.toFixed(2)} ms`,
    `${sample.bytes} bytes parsed`,
    `wasm ${memory ? (memory / 1024 / 1024).toFixed(1) : "—"} MiB`,
  ].join("   ·   ");
}, 250);
