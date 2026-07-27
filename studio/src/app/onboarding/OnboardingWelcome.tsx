import { type FormEvent, useState } from "react";
import { apiErrorMessage } from "../../shared/api/client";
import type { ProviderCatalog } from "../../shared/api/types";
import * as api from "../../features/studio/lib/api";
import { useTasksStore } from "../../features/studio/stores/tasksStore";
import { useLaunchProviderCatalog } from "../../features/workflows/launchProviderCatalog";
import { useOnboardingStore } from "./onboardingStore";
import { useOnboardingTourStore } from "./onboardingTourStore";
import { OnboardingProviders } from "./OnboardingProviders";

type WelcomePane = "providers" | "project";

const EMPTY_CATALOG: ProviderCatalog = {
  activated_providers: [],
  global_default: null,
};

export default function OnboardingWelcome() {
  const acknowledgeOnboarding = useOnboardingStore(
    (state) => state.acknowledgeOnboarding,
  );
  const [pane, setPane] = useState<WelcomePane>("providers");
  const createProject = useTasksStore((state) => state.createProject);
  const startTour = useOnboardingTourStore((state) => state.start);
  const [name, setName] = useState("Coding");
  const [slug, setSlug] = useState("CODING");
  const [creating, setCreating] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [skipError, setSkipError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (creating || skipping || !name.trim() || !slug.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const project = await createProject({
        name: name.trim(),
        slug: slug.trim(),
        description: "",
      });
      startTour(project.id);
    } catch (cause) {
      setCreateError(apiErrorMessage(cause));
      setCreating(false);
    }
  };

  const skip = async () => {
    if (skipping) return;
    setSkipping(true);
    setSkipError(null);
    try {
      await api.putProviderCatalog(EMPTY_CATALOG);
      useLaunchProviderCatalog.setState({ capabilities: [], loaded: true });
      await acknowledgeOnboarding();
    } catch (cause) {
      setSkipError(apiErrorMessage(cause));
      setSkipping(false);
    }
  };

  return (
    <div
      className="flex h-full w-full items-center justify-center overflow-y-auto bg-pane-bg px-6 py-8"
      data-testid="onboarding-welcome"
    >
      <main className="w-full max-w-xl rounded-xl border border-pane-border bg-pane-panel p-8 shadow-xl">
        <div className="text-xs font-bold uppercase tracking-[0.2em] text-focus-accent">
          Welcome to WorkTracker
        </div>

        {pane === "providers" ? (
          <OnboardingProviders onContinue={() => setPane("project")} />
        ) : (
          <>
            <h1 className="mt-3 text-2xl font-semibold text-text-primary">
              Your first project
            </h1>
            <p className="mt-2 text-sm leading-6 text-text-secondary">
              Projects organize modules and stories. Use these defaults or make
              them your own.
            </p>

            <form className="mt-7" onSubmit={(event) => void submit(event)}>
              <label className="block text-xs font-bold uppercase tracking-wider text-text-secondary">
                Project name
                <input
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  data-testid="onboarding-project-name"
                  className="mt-2 block w-full rounded-md border border-pane-border bg-pane-bg px-3 py-2 text-base font-normal normal-case tracking-normal text-text-primary outline-none focus:border-focus-accent"
                />
              </label>
              <label className="mt-5 block text-xs font-bold uppercase tracking-wider text-text-secondary">
                Project key
                <input
                  value={slug}
                  onChange={(event) => setSlug(event.target.value)}
                  data-testid="onboarding-project-key"
                  className="mt-2 block w-full rounded-md border border-pane-border bg-pane-bg px-3 py-2 font-mono text-sm font-normal tracking-normal text-text-primary outline-none focus:border-focus-accent"
                />
              </label>

              {createError ? (
                <p
                  className="mt-4 text-sm text-lifecycle-danger"
                  data-testid="onboarding-create-error"
                  role="alert"
                >
                  {createError}
                </p>
              ) : null}

              <div className="mt-7 flex justify-end">
                <button
                  type="submit"
                  disabled={
                    creating || skipping || !name.trim() || !slug.trim()
                  }
                  data-testid="onboarding-create-project"
                  className="rounded-md bg-focus-accent px-4 py-2 text-sm font-semibold text-pane-bg disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {creating ? "Creating…" : "Create project"}
                </button>
              </div>
            </form>
          </>
        )}

        {skipError ? (
          <p
            data-testid="onboarding-skip-error"
            role="alert"
            className="mt-4 text-sm text-lifecycle-danger"
          >
            {skipError}
          </p>
        ) : null}
        <div className="mt-4">
          <button
            type="button"
            disabled={skipping}
            onClick={() => void skip()}
            data-testid="onboarding-skip"
            className="rounded-md px-3 py-2 text-sm font-semibold text-text-muted hover:text-text-primary disabled:opacity-50"
          >
            {skipping ? "Skipping…" : skipError ? "Retry skip" : "Skip"}
          </button>
        </div>
      </main>
    </div>
  );
}
