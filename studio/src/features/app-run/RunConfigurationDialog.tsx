import { useMemo, useState } from "react";

import { ModalShell } from "../../app/modal/ModalShell";
import { useModalStore } from "../../app/modal/modalStore";
import { saveRunConfiguration } from "./api/appRunApi";
import { useModuleAppRun } from "./useModuleAppRun";

export function RunConfigurationDialog({ moduleId }: { moduleId: string }) {
  const popModal = useModalStore((state) => state.popModal);
  const run = useModuleAppRun(moduleId);
  if (run.loading) return null;
  return (
    <RunConfigurationForm
      moduleId={moduleId}
      configured={Boolean(run.configuration)}
      command={run.configuration?.command ?? ""}
      environment={run.configuration?.environment ?? {}}
      previewUrl={run.configuration?.preview_url ?? ""}
      onSaved={async () => {
        await run.refetch();
        popModal();
      }}
    />
  );
}

function RunConfigurationForm({
  moduleId,
  configured,
  command: initialCommand,
  environment,
  previewUrl: initialPreviewUrl,
  onSaved,
}: {
  moduleId: string;
  configured: boolean;
  command: string;
  environment: unknown;
  previewUrl: string;
  onSaved: () => Promise<void>;
}) {
  const initialEnvironment = useMemo(
    () =>
      Object.entries(
        environment && typeof environment === "object"
          ? (environment as Record<string, string>)
          : {},
      )
        .map(([name, value]) => `${name}=${value}`)
        .join("\n"),
    [environment],
  );
  const [command, setCommand] = useState(initialCommand);
  const [environmentText, setEnvironmentText] = useState(initialEnvironment);
  const [previewUrl, setPreviewUrl] = useState(initialPreviewUrl);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const environment: Record<string, string> = {};
    for (const line of environmentText.split("\n")) {
      if (!line.trim()) continue;
      const separator = line.indexOf("=");
      if (separator < 1) {
        setProblem(`Environment line needs NAME=value: ${line}`);
        return;
      }
      const name = line.slice(0, separator).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        setProblem(`Environment name is invalid: ${name}`);
        return;
      }
      environment[name] = line.slice(separator + 1);
    }
    if (!command.trim()) {
      setProblem("Enter the command that starts this module's app.");
      return;
    }
    setSaving(true);
    setProblem(null);
    try {
      await saveRunConfiguration(configured, {
        moduleId,
        command: command.trim(),
        environment,
        previewUrl: previewUrl.trim() || null,
      });
      await onSaved();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="Run configuration" ariaLabel="Run configuration">
      <div className="space-y-4 text-sm">
        <label className="block">
          <span className="mb-1 block text-text-muted">Command</span>
          <input
            data-testid="run-configuration-command"
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            className="w-full border border-pane-border bg-pane-bg px-2 py-1.5"
            placeholder="npm run dev"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-text-muted">Environment variables</span>
          <textarea
            data-testid="run-configuration-environment"
            value={environmentText}
            onChange={(event) => setEnvironmentText(event.target.value)}
            className="h-28 w-full border border-pane-border bg-pane-bg px-2 py-1.5 font-mono"
            placeholder="PORT=5174"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-text-muted">Preview URL</span>
          <input
            data-testid="run-configuration-preview-url"
            type="url"
            value={previewUrl}
            onChange={(event) => setPreviewUrl(event.target.value)}
            className="w-full border border-pane-border bg-pane-bg px-2 py-1.5"
            placeholder="http://127.0.0.1:5174"
          />
        </label>
        {problem ? <p role="alert" className="text-lifecycle-attention">{problem}</p> : null}
        <div className="flex justify-end">
          <button
            type="button"
            data-testid="run-configuration-save"
            disabled={saving}
            onClick={() => void submit()}
            className="border border-focus-accent bg-pane-title px-3 py-1.5 font-semibold text-focus-accent disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
