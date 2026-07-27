import React from "react";
import ReactDOM from "react-dom/client";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import StudioApp from "./app/studio/App";
import { ModalHost } from "./app/modal/ModalHost";
import ToastHost from "./app/shell/ToastHost";

// Self-hosted fonts (Fontsource, upright variable axes only — no external
// request). Hanken Grotesk = UI/body; JetBrains Mono = KEY-N / code.
import "@fontsource-variable/hanken-grotesk/wght.css";
import "@fontsource-variable/jetbrains-mono/wght.css";

// Preload the always-used Latin faces: with font-display:swap, waiting for
// stylesheet-driven discovery causes a visible font flash on cold loads.
import hankenLatinUrl from "@fontsource-variable/hanken-grotesk/files/hanken-grotesk-latin-wght-normal.woff2?url";
import monoLatinUrl from "@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2?url";
import "./app/styles/tailwind.css";
import "./app/styles/studio-surface.css";
import { createDesktopRuntime } from "./runtime/desktopRuntime";
import {
  initializeBrowserRuntime,
  initializeStudioRuntime,
} from "./runtime";

// Studio uses the dark theme from boot.
document.documentElement.classList.add("dark");

for (const href of [hankenLatinUrl, monoLatinUrl]) {
  const link = document.createElement("link");
  link.rel = "preload";
  link.as = "font";
  link.type = "font/woff2";
  link.crossOrigin = "anonymous";
  link.href = href;
  document.head.appendChild(link);
}

const root = ReactDOM.createRoot(document.getElementById("root")!);

async function startStudio(): Promise<void> {
  try {
    if (isTauri()) {
      initializeStudioRuntime(await createDesktopRuntime({ invoke, listen }));
    } else {
      initializeBrowserRuntime();
    }
    root.render(
      <React.StrictMode>
        <div className="h-screen w-screen">
          <div className="studio-surface h-full">
            <StudioApp />
          </div>
          <ModalHost />
          <ToastHost />
        </div>
      </React.StrictMode>,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    root.render(
      <div className="flex h-screen w-screen items-center justify-center bg-pane-bg p-8 text-text-primary">
        <div className="max-w-xl">
          <h1 className="text-lg font-semibold">Studio could not start</h1>
          <p className="mt-2 text-sm text-text-muted">{message}</p>
          <p className="mt-2 text-sm text-text-muted">
            Check the runtime endpoint configuration and reload Studio.
          </p>
        </div>
      </div>
    );
  }
}

void startStudio();
