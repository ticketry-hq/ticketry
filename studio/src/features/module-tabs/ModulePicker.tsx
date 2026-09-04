import {
  type FocusEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import type { Module, ModulePresentation } from "../../shared/api/types";
import { hiddenModuleIds } from "./modulePresentation";
import { useRestoreAndSelectModule } from "./useRestoreAndSelectModule";

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
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const restoreAndSelectModule = useRestoreAndSelectModule();
  const choices = eligibleModulePickerChoices(modules, presentations, query);
  const validActiveIndex = activeIndex <= choices.length ? activeIndex : 0;
  const activeChoiceId = validActiveIndex === 0
    ? CREATE_CHOICE_ID
    : "module-picker-" + choices[validActiveIndex - 1]!.id;

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (activeIndex > choices.length) setActiveIndex(0);
  }, [activeIndex, choices.length]);

  useEffect(() => {
    if (!open) return;
    function dismissOutside(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", dismissOutside);
    return () => document.removeEventListener("pointerdown", dismissOutside);
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
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setOpen(false);
    }
  }

  function createModule() {
    setOpen(false);
    onCreate();
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
      const choiceCount = choices.length + 1;
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
    const module = choices[validActiveIndex - 1];
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
        className="flex w-8 shrink-0 items-center justify-center border-r border-pane-border text-sm text-text-muted hover:bg-pane-panel hover:text-text-primary"
      >
        +
      </button>
      {open ? (
        <div
          id={DIALOG_ID}
          role="dialog"
          aria-label="Module picker"
          onKeyDown={handlePickerKeyDown}
          className="absolute left-0 top-full z-30 mt-1 flex w-64 flex-col border border-pane-border bg-pane-panel p-1 shadow-lg"
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
            className="mb-1 w-full border border-pane-border bg-pane-bg px-2 py-1 text-xs text-text-primary outline-none placeholder:text-text-muted focus:border-focus-accent"
          />
          <div id={CHOICES_ID} role="listbox" aria-label="Module choices">
            <button
              id={CREATE_CHOICE_ID}
              type="button"
              role="option"
              aria-selected={validActiveIndex === 0}
              onClick={createModule}
              className={
                "w-full px-2 py-1.5 text-left text-xs font-medium "
                + "text-text-primary hover:bg-pane-title "
                + (validActiveIndex === 0 ? "bg-pane-title" : "")
              }
            >
              Create new module
            </button>
            {choices.map((module, index) => (
              <button
                key={module.id}
                id={"module-picker-" + module.id}
                type="button"
                role="option"
                aria-label={"Restore " + module.name + " module tab"}
                aria-selected={validActiveIndex === index + 1}
                onClick={() => restoreModule(module.id)}
                className={
                  "w-full truncate px-2 py-1.5 text-left text-xs "
                  + "text-text-muted hover:bg-pane-title hover:text-text-primary "
                  + (
                    validActiveIndex === index + 1
                      ? "bg-pane-title text-text-primary"
                      : ""
                  )
                }
              >
                {module.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
