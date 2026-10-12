import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { toast } from "../../../../../state/clientStore";
import { useOnboardingTourStore } from "../../../../onboarding/onboardingTourStore";
import { apiErrorMessage } from "../../../../../shared/api/errors";
import {
  useCreateWorkItem,
  capturedStoryOutsideResults,
  CapturedIdeaRecovery,
} from "../../../../../features/work-items";
import { useStudioStore } from "../../../../../features/projects";
import { loadIssueTypes } from "../../../../../features/settings";
import { useClientStore } from "../../../../../state/clientStore";
import { focusFirstStory } from "../storiesFocus";

/** `unavailableReason` disables capture and is shown in place of the prompt. */
export function IdeaEntry({ unavailableReason = null }: { unavailableReason?: string | null } = {}) {
  const selectedProjectId = useStudioStore((state) => state.selectedProjectId);
  const selectedModuleId = useClientStore((state) => state.selectedModuleId);
  const createStory = useCreateWorkItem({
    projectId: selectedProjectId ?? "",
    moduleId: selectedModuleId ?? "",
  });
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [capturedOutsideResults, setCapturedOutsideResults] = useState(false);
  // #623: focus needs to read at a glance — the caret alone was invisible
  // against the pane, so the field carries an accent border plus a soft ring.
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scope = JSON.stringify([selectedProjectId, selectedModuleId]);
  const previousScopeRef = useRef(scope);
  const submissionRef = useRef(0);
  const inFlightRef = useRef(false);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${input.scrollHeight}px`;
  }, [draft]);

  useEffect(() => {
    if (previousScopeRef.current === scope) return;
    previousScopeRef.current = scope;
    submissionRef.current += 1;
    inFlightRef.current = false;
    setPending(false);
    setDraft("");
    setCapturedOutsideResults(false);
  }, [scope]);

  async function submit(): Promise<void> {
    const name = draft.trim();
    if (
      !name || !selectedProjectId || !selectedModuleId || inFlightRef.current ||
      unavailableReason
    ) {
      return;
    }
    const projectId = selectedProjectId;
    const moduleId = selectedModuleId;
    const submission = ++submissionRef.current;
    inFlightRef.current = true;
    setPending(true);

    try {
      const issueTypes = await loadIssueTypes(projectId);
      const storyType = issueTypes.find(
        (type) => type.level === "task" && type.name === "Story",
      );
      if (!storyType) throw new Error("The Story issue type is unavailable.");
      const created = await createStory.mutateAsync({
        name,
        parent_id: moduleId,
        issue_type_id: storyType.id,
        sprint_id: null,
      });
      if (
        submissionRef.current !== submission ||
        useStudioStore.getState().selectedProjectId !== projectId ||
        useClientStore.getState().selectedModuleId !== moduleId
      ) {
        return;
      }

      const ui = useClientStore.getState();
      setCapturedOutsideResults(capturedStoryOutsideResults(projectId, created, ui.storySearchQuery));
      if (created.state && ui.collapsedStateIds.has(created.state)) {
        ui.toggleStateCollapsed(created.state);
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
      <div
        data-idea-entry-field="true"
        data-focused={focused}
        className="border border-pane-border bg-pane-bg transition-[border-color,box-shadow] duration-150 data-[focused=true]:border-focus-accent data-[focused=true]:shadow-[0_0_0_2px_rgba(122,162,247,0.25)]"
      >
        <textarea
          ref={inputRef}
          data-idea-entry="true"
          data-coach-anchor="story-add"
          aria-label="Capture an idea"
          aria-busy={pending}
          rows={1}
          value={unavailableReason ? "" : draft}
          readOnly={pending}
          disabled={unavailableReason !== null}
          placeholder={unavailableReason ?? "Capture an idea…"}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="block min-h-7 w-full resize-none overflow-hidden bg-transparent px-2 py-1 text-sm leading-5 text-text-primary caret-focus-accent outline-none placeholder:text-text-muted disabled:cursor-not-allowed"
        />
      </div>
      {capturedOutsideResults && selectedProjectId ? <CapturedIdeaRecovery projectId={selectedProjectId}
        onDismiss={() => setCapturedOutsideResults(false)} /> : null}
    </div>
  );
}
