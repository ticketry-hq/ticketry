import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { toast } from "../../../../../app/stores/toastStore";
import { useOnboardingTourStore } from "../../../../../app/onboarding/onboardingTourStore";
import { apiErrorMessage } from "../../../../../shared/api/client";
import { useTasksStore } from "../../../stores/tasksStore";
import { useUIStore } from "../../../stores/uiStore";
import { focusFirstStory } from "../storiesFocus";

export function IdeaEntry() {
  const selectedProjectId = useTasksStore((state) => state.selectedProjectId);
  const selectedModuleId = useTasksStore((state) => state.selectedModuleId);
  const createStory = useTasksStore((state) => state.createStory);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const previousModuleRef = useRef(selectedModuleId);
  const submissionRef = useRef(0);
  const inFlightRef = useRef(false);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${input.scrollHeight}px`;
  }, [draft]);

  useEffect(() => {
    if (previousModuleRef.current === selectedModuleId) return;
    previousModuleRef.current = selectedModuleId;
    submissionRef.current += 1;
    inFlightRef.current = false;
    setPending(false);
    setDraft("");
  }, [selectedModuleId]);

  async function submit(): Promise<void> {
    const name = draft.trim();
    if (!name || !selectedProjectId || !selectedModuleId || inFlightRef.current) {
      return;
    }

    const projectId = selectedProjectId;
    const moduleId = selectedModuleId;
    const submission = ++submissionRef.current;
    inFlightRef.current = true;
    setPending(true);

    try {
      const created = await createStory(projectId, moduleId, name);
      if (
        submissionRef.current !== submission ||
        useTasksStore.getState().selectedModuleId !== moduleId
      ) {
        return;
      }

      const ui = useUIStore.getState();
      if (ui.collapsedStateNames.has(created.state.name)) {
        ui.toggleStateCollapsed(created.state.name);
      }
      useOnboardingTourStore.getState().storyCreated(created.id);
      setDraft("");
      setPending(false);
      inputRef.current?.focus({ preventScroll: true });
    } catch (error) {
      if (submissionRef.current !== submission) return;
      setPending(false);
      inputRef.current?.focus({ preventScroll: true });
      toast.error(`Story could not be created: ${apiErrorMessage(error)}`);
    } finally {
      if (submissionRef.current === submission) {
        inFlightRef.current = false;
      }
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      focusFirstStory(inputRef.current);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      inputRef.current?.blur();
      return;
    }

    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.stopPropagation();
      void submit();
    }
  }

  return (
    <div className="mb-2 min-w-0">
      <textarea
        ref={inputRef}
        data-idea-entry="true"
        data-coach-anchor="story-add"
        aria-label="Capture an idea"
        aria-busy={pending}
        rows={1}
        value={draft}
        readOnly={pending}
        placeholder="Capture an idea…"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        className="block min-h-7 w-full resize-none overflow-hidden rounded border border-pane-border bg-pane-bg px-2 py-1 text-sm leading-5 text-text-primary outline-none placeholder:text-text-muted focus:border-focus-accent"
      />
    </div>
  );
}
