import {
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import type { Module, ModulePresentation } from "../../shared/api/types";
import { useStudioStore } from "../projects";
import { clearStorySprintFilter } from "../work-items";
import { useEffectiveModuleTabs } from "./effectiveModuleTabs";
import { hiddenModuleIds } from "./modulePresentation";
import { useRestoreAndSelectModule } from "./useRestoreAndSelectModule";
import { ROADMAP_ENABLED } from "../../shared/config/roadmapAvailability";

interface ModulePickerProps {
  modules: readonly Module[];
  presentations: readonly ModulePresentation[] | undefined;
  onCreate: () => void;
}

export function eligibleModulePickerChoices(
  modules: readonly Module[],
  presentations: readonly ModulePresentation[] | undefined,
  query: string,
): Module[] {
  const hiddenIds = hiddenModuleIds(presentations);
  const normalizedQuery = query.toLocaleLowerCase();
  return modules.filter(
    (module) =>
      !module.is_archived
      && hiddenIds.has(module.id)
      && module.name.toLocaleLowerCase().includes(normalizedQuery),
  );
}

const SHOW_ALL_CHOICE_ID = "module-picker-show-all";
const CREATE_CHOICE_ID = "module-picker-create";
const DIALOG_ID = "module-picker-dialog";
const CHOICES_ID = "module-picker-choices";

export function ModulePicker({
  modules,
  presentations,
  onCreate,
}: ModulePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [dialogPosition, setDialogPosition] = useState<CSSProperties>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const restoreAndSelectModule = useRestoreAndSelectModule();
  const projectId = useStudioStore((state) => state.selectedProjectId);
  const projection = useEffectiveModuleTabs(projectId, modules, presentations);
  const restricted = ROADMAP_ENABLED && projection.restricted && projection.selection !== null;
  const choices = projection.entries.filter(({ module, status }) => status === "hidden"
    && module.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(({ module }) => module);
  const choiceOffset = restricted ? 2 : 1;
  const choiceCount = choices.length + choiceOffset;
  const validActiveIndex = activeIndex < choiceCount ? activeIndex : 0;
  const activeChoiceId = validActiveIndex === 0
    ? CREATE_CHOICE_ID
    : restricted && validActiveIndex === 1 ? SHOW_ALL_CHOICE_ID
    : "module-picker-" + choices[validActiveIndex - choiceOffset]!.id;

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (activeIndex >= choiceCount) setActiveIndex(0);
  }, [activeIndex, choiceCount]);

  useEffect(() => {
    if (open) {
      document.getElementById(activeChoiceId)?.scrollIntoView({ block: "nearest" });
    }
  }, [open, activeChoiceId]);

  useEffect(() => {
    if (!open) return;
    function dismissOutside(event: PointerEvent) {
      const target = event.target as Node;
      if (
        !containerRef.current?.contains(target)
        && !dialogRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", dismissOutside);
    return () => document.removeEventListener("pointerdown", dismissOutside);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const triggerBounds = triggerRef.current?.getBoundingClientRect();
      if (!triggerBounds) return;
      setDialogPosition({
        top: triggerBounds.bottom + 4,
        right: window.innerWidth - triggerBounds.right,
        maxHeight: `min(24rem, calc(100dvh - ${triggerBounds.bottom + 12}px))`,
      });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, {
      capture: true,
      passive: true,
    });
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  function togglePicker() {
    setOpen((current) => {
      if (!current) {
        setQuery("");
        setActiveIndex(0);
      }
      return !current;
    });
  }

  function closeAndRestoreFocus() {
    // Move focus before unmounting the dialog. Waiting for a post-render effect
    // lets the edit-view pane focus effects win the same commit intermittently.
    triggerRef.current?.focus({ preventScroll: true });
    setOpen(false);
    requestAnimationFrame(() => {
      triggerRef.current?.focus({ preventScroll: true });
    });
  }

  function handleFocusLeave(event: FocusEvent<HTMLDivElement>) {
    const nextFocus = event.relatedTarget as Node | null;
    if (
      nextFocus
      && !containerRef.current?.contains(nextFocus)
      && !dialogRef.current?.contains(nextFocus)
    ) {
      setOpen(false);
    }
  }

  function createModule() {
    setOpen(false);
    onCreate();
  }

  function showAllSprints() {
    if (projectId) clearStorySprintFilter(projectId);
    closeAndRestoreFocus();
  }

  function restoreModule(moduleId: string) {
    setOpen(false);
    restoreAndSelectModule(moduleId);
  }

  function handlePickerKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeAndRestoreFocus();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => (current + step + choiceCount) % choiceCount);
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (validActiveIndex === 0) {
      createModule();
      return;
    }
    if (restricted && validActiveIndex === 1) { showAllSprints(); return; }
    const module = choices[validActiveIndex - choiceOffset];
    if (module) restoreModule(module.id);
  }

  return (
    <div
      ref={containerRef}
      onBlur={handleFocusLeave}
      className="relative flex h-full shrink-0"
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label="Open module picker"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={DIALOG_ID}
        onClick={togglePicker}
        className="flex w-8 shrink-0 items-center justify-center border-l border-pane-border text-sm text-text-muted hover:bg-pane-panel hover:text-text-primary"
      >
        +
      </button>
      {open ? createPortal(
        <div
          ref={dialogRef}
          id={DIALOG_ID}
          role="dialog"
          aria-label="Module picker"
          onKeyDown={handlePickerKeyDown}
          onBlur={handleFocusLeave}
          style={dialogPosition}
          className="fixed z-50 flex w-64 flex-col border border-pane-border bg-pane-panel p-1 shadow-lg"
        >
          <input
            ref={searchRef}
            type="search"
            role="combobox"
            aria-label="Search modules"
            aria-expanded="true"
            aria-activedescendant={activeChoiceId}
            aria-controls={CHOICES_ID}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            placeholder="Search modules"
            className="mb-1 w-full shrink-0 border border-pane-border bg-pane-bg px-2 py-1 text-base text-text-primary outline-none placeholder:text-text-muted focus:border-focus-accent"
          />
          <div id={CHOICES_ID} role="listbox" aria-label="Module choices" className="min-h-0 overflow-y-auto overscroll-contain">
            <button
              id={CREATE_CHOICE_ID}
              type="button"
              role="option"
              aria-selected={validActiveIndex === 0}
              onClick={createModule}
              className={
                "w-full px-2 py-1.5 text-left text-base "
                + "text-text-primary hover:bg-pane-title "
                + (validActiveIndex === 0 ? "bg-pane-title" : "")
              }
            >
              Create new module
            </button>
            {restricted ? <button
              id={SHOW_ALL_CHOICE_ID}
              type="button"
              role="option"
              aria-selected={validActiveIndex === 1}
              onClick={showAllSprints}
              className={"w-full px-2 py-1.5 text-left text-base text-text-primary hover:bg-pane-title " + (validActiveIndex === 1 ? "bg-pane-title" : "")}
            >Show all sprints</button> : null}
            {choices.map((module, index) => (
              <button
                key={module.id}
                id={"module-picker-" + module.id}
                type="button"
                role="option"
                aria-label={"Restore " + module.name + " module tab"}
                disabled={projection.loading}
                aria-selected={validActiveIndex === index + choiceOffset}
                onClick={() => restoreModule(module.id)}
                className={
                  "w-full truncate px-2 py-1.5 text-left text-base "
                  + "text-text-muted hover:bg-pane-title hover:text-text-primary "
                  + (
                    validActiveIndex === index + choiceOffset
                      ? "bg-pane-title text-text-primary"
                      : ""
                  )
                }
              >
                {module.name}
                {restricted && projection.entries.find((entry) => entry.module.id === module.id)?.sprintEligible === false
                  ? <span className="block text-xs">Clears sprint filter to show all modules</span> : null}
              </button>
            ))}
          </div>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
