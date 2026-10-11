import { spawn } from "node:child_process";
import { acquireStackSlot, slotWaitReporter } from "./feature-e2e/stackSlots.mjs";

// Holds one machine-wide e2e stack slot for as long as the wrapped server runs.
// Playwright signals the whole process group, so the server receives shutdown
// signals directly; this wrapper only waits for it and then frees the slot.
const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("usage: node studio/scripts/with-e2e-stack-slot.mjs <command> [args...]");
  process.exit(2);
}

let stopping = false;
const stopWhileQueued = () => { stopping = true; };
process.on("SIGINT", stopWhileQueued);
process.on("SIGTERM", stopWhileQueued);

const owner = `pid ${process.pid} in ${process.cwd()} (data ${process.env.MUXED_DATA_DIR ?? "default"})`;
let slot;
try {
  slot = await acquireStackSlot({ owner, onWait: slotWaitReporter("e2e server"), shouldStop: () => stopping });
} catch (error) {
  console.error(`[e2e-queue] ${error.message}`);
  process.exit(1);
}

const child = spawn(command, args, { stdio: "inherit", env: process.env });
child.once("error", (error) => {
  console.error(`[e2e-queue] Could not start ${command}: ${error.message}`);
  slot.release();
  process.exit(1);
});
child.once("exit", (code, signal) => {
  slot.release();
  process.exit(code ?? (signal ? 1 : 0));
});
