import { invoke, isTauri } from "@tauri-apps/api/core";

let availability: Promise<boolean> | null = null;

export function nativeGhosttyAvailable(): Promise<boolean> {
  if (!isTauri()) return Promise.resolve(false);
  availability ??= invoke<boolean>("native_terminal_available").catch(() => false);
  return availability;
}
