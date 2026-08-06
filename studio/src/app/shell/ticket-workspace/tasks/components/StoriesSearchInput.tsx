import { useRef, type KeyboardEvent } from "react";
import { IconSearch, IconX } from "../../../../../shared/ui/icons";
import { useUIStore } from "../../../../../features/studio/stores/uiStore";
import { focusFirstStory, focusStoryTree } from "../storiesFocus";

export function StoriesSearchInput() {
  const query = useUIStore((state) => state.storySearchQuery);
  const setQuery = useUIStore((state) => state.setStorySearchQuery);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      focusFirstStory(inputRef.current);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setQuery("");
      focusStoryTree(inputRef.current);
    }
  }

  return (
    <div className="relative mb-2 flex min-w-0 items-center">
      <IconSearch
        size={13}
        className="pointer-events-none absolute left-2 text-text-muted"
      />
      <input
        ref={inputRef}
        type="text"
        aria-label="Search stories"
        placeholder="Search…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={handleKeyDown}
        className="h-7 w-full rounded-md border border-transparent bg-pane-title/50 pl-7 pr-6 text-[13px] font-medium text-text-primary outline-none transition-all placeholder:text-text-muted hover:bg-pane-title focus:border-focus-accent focus:bg-pane-title"
      />
      {query ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => setQuery("")}
          className="absolute right-2 text-text-muted hover:text-text-primary"
        >
          <IconX size={13} />
        </button>
      ) : null}
    </div>
  );
}
