import process from "node:process";

/**
 * Runs `cleanup` before SIGINT or SIGTERM ends the harness, then re-raises the
 * signal so the process still exits by it. Returns the uninstaller.
 */
export function cleanupOnInterrupt(cleanup) {
  const handleSignal = (signal) => {
    void cleanup().finally(() => process.kill(process.pid, signal));
  };
  const handleInterrupt = () => handleSignal("SIGINT");
  const handleTermination = () => handleSignal("SIGTERM");
  process.once("SIGINT", handleInterrupt);
  process.once("SIGTERM", handleTermination);
  return () => {
    process.off("SIGINT", handleInterrupt);
    process.off("SIGTERM", handleTermination);
  };
}
