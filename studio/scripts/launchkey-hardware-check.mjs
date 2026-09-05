import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { arch, release } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

export const CHECKS = Object.freeze([
  {
    id: "connect",
    title: "Connected startup",
    action: "Connect the Launchkey Mini MK3 before running npm run desktop:dev. Wait for Studio and the agent status stream to load.",
    expect: "Ticketry claims DAW session mode once, the pad grid changes from standalone mode, and Studio remains usable.",
  },
  {
    id: "hot-plug",
    title: "Hot-plug and reconnect",
    action: "Start Studio with the Launchkey unplugged, connect it, unplug it again, then reconnect it. Allow five seconds after each change.",
    expect: "Studio works while the device is absent, discovers each connection without a relaunch, and restores the current pad and Record lights after reconnect.",
  },
  {
    id: "lighting",
    title: "Run-state lighting",
    action: "Open the test project and arrange visible runs in working, needs-input or permission, completed, and failed states.",
    expect: "Assigned pads follow start order and show green for working, pulsing yellow or flashing orange for attention, blue for completed or quiet, and red for failed or lost. Unused pads stay off.",
  },
  {
    id: "focus",
    title: "Pad focus",
    action: "Press a lit pad for a run that is not currently selected, then press an unused pad.",
    expect: "The lit pad opens and focuses its exact agent terminal. The unused pad does nothing.",
  },
  {
    id: "record",
    title: "Record voice toggle",
    action: "Press Record once, dictate a short phrase through Handy, then press Record again.",
    expect: "The first press starts voice transcription and lights Record. The second press stops transcription and turns the Record light off. Neither press changes the selected run.",
  },
  {
    id: "play",
    title: "Play submission",
    action: "Focus a ready agent terminal, enter a unique marker without submitting it, and press Play once.",
    expect: "Play submits the marker exactly once to the selected agent terminal and does not change run or pane focus.",
  },
  {
    id: "project-switching",
    title: "Project switching",
    action: "Switch from the test project to a second project with a different set of live runs, then press a newly lit pad.",
    expect: "All old assignments clear, pads show only runs from the second project, and the pressed pad focuses a run in that project.",
  },
  {
    id: "shell-exclusion",
    title: "Panel-shell exclusion",
    action: "Open and select a panel shell, enter a unique marker without submitting it, inspect the pad grid, and press Play.",
    expect: "The panel shell receives no pad assignment and Play does not submit its marker. Existing agent-run pad assignments remain unchanged.",
  },
  {
    id: "standalone-restoration",
    title: "Standalone restoration",
    action: "Quit Studio normally while the Launchkey is connected, then use pads, keys, knobs, and transport controls without Ticketry running.",
    expect: "The Launchkey leaves DAW session mode and its standalone controls work again without reconnecting USB or restarting the device.",
  },
]);

export function renderChecklist() {
  const checks = CHECKS.flatMap((check, index) => [
    `${index + 1}. [${check.id}] ${check.title}`,
    `   Action: ${check.action}`,
    `   Pass when: ${check.expect}`,
  ]);
  return [
    "Launchkey Mini MK3 macOS hardware check",
    "",
    "Use a disposable test project and start Studio with npm run desktop:dev unless a step says otherwise.",
    "",
    ...checks,
  ].join("\n");
}

export async function runHardwareCheck({
  platform = process.platform,
  ask,
  now = new Date(),
  metadata = {},
} = {}) {
  if (platform !== "darwin") {
    return {
      exitCode: 2,
      report: "This check requires macOS hardware and cannot certify this host.",
    };
  }
  if (typeof ask !== "function") {
    throw new TypeError("runHardwareCheck requires an ask function");
  }

  const results = [];
  for (const check of CHECKS) {
    while (true) {
      const response = String(await ask(check)).trim();
      const [answer, ...noteWords] = response.split(/\s+/);
      if (!["p", "pass", "f", "fail"].includes(answer)) continue;
      const note = noteWords.join(" ");
      const passed = answer === "p" || answer === "pass";
      if (!passed && !note) continue;
      results.push({ id: check.id, passed, note });
      break;
    }
  }

  const passed = results.every((result) => result.passed);
  const clean = (value) => String(value ?? "unknown")
    .replaceAll("|", "\\|")
    .replaceAll(/\s+/g, " ")
    .trim();
  const rows = results.map((result) =>
    `| ${result.id} | ${result.passed ? "PASS" : "FAIL"} | ${clean(result.note) || "none"} |`
  );
  return {
    exitCode: passed ? 0 : 1,
    report: [
      "# Launchkey Mini MK3 hardware check",
      "",
      "| Field | Value |",
      "| --- | --- |",
      `| Outcome | ${passed ? "PASS" : "FAIL"} |`,
      `| Recorded | ${now.toISOString()} |`,
      `| Revision | \`${clean(metadata.revision)}\` |`,
      `| Host | ${clean(metadata.host)} |`,
      "",
      "| Check | Result | Observation |",
      "| --- | --- | --- |",
      ...rows,
      "",
    ].join("\n"),
  };
}

function commandOutput(command, args, fallback) {
  try {
    return execFileSync(command, args, {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return fallback;
  }
}

function usage() {
  return [
    "Usage: node studio/scripts/launchkey-hardware-check.mjs [--list] [--report PATH]",
    "",
    "Run without --list on a Mac connected to a Launchkey Mini MK3.",
    "Each answer must be `pass [observation]` or `fail <reason>`.",
  ].join("\n");
}

export async function main(args = process.argv.slice(2)) {
  if (args.includes("--help")) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  if (args.includes("--list")) {
    process.stdout.write(`${renderChecklist()}\n`);
    return 0;
  }

  const reportIndex = args.indexOf("--report");
  const reportPath = reportIndex >= 0 ? args[reportIndex + 1] : null;
  const acceptedArgs = reportIndex >= 0
    ? args.filter((_, index) => index !== reportIndex && index !== reportIndex + 1)
    : args;
  if (acceptedArgs.length > 0 || reportIndex >= 0 && !reportPath) {
    process.stderr.write(`${usage()}\n`);
    return 2;
  }

  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  const introduced = new Set();
  try {
    const result = await runHardwareCheck({
      ask: async (check) => {
        if (!introduced.has(check.id)) {
          introduced.add(check.id);
          process.stdout.write(
            `\n[${check.id}] ${check.title}\nAction: ${check.action}\nPass when: ${check.expect}\n`,
          );
        }
        return terminal.question("Result [pass with optional note, or fail with reason]: ");
      },
      metadata: {
        revision: commandOutput("git", ["rev-parse", "--short=12", "HEAD"], "unknown"),
        host: `macOS ${commandOutput("sw_vers", ["-productVersion"], release())} ${arch()}`,
      },
    });

    if (reportPath) {
      const resolved = path.resolve(reportPath);
      await writeFile(resolved, result.report, "utf8");
      process.stdout.write(`\nEvidence written to ${resolved}\n`);
    } else {
      process.stdout.write(`\n${result.report}`);
    }
    return result.exitCode;
  } finally {
    terminal.close();
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
