import { useId, useState } from "react";

type Destination = { branch: string; checkout?: string | null };

export function MergeDestinationPicker({ destinations, sourceBranch, value, disabled, onSelect }: {
  destinations: readonly Destination[];
  sourceBranch: string;
  value: string | null;
  disabled: boolean;
  onSelect: (branch: string) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const matches = destinations.filter(({ branch }) =>
    branch !== sourceBranch && branch.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const activeIndex = Math.min(highlighted, matches.length - 1);
  const show = () => {
    setSearch("");
    setHighlighted(0);
    setOpen(true);
  };
  const select = (branch: string) => {
    setOpen(false);
    onSelect(branch);
  };

  return (
    <div className="relative mt-2" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      <input
        role="combobox"
        aria-label="Local merge destination"
        aria-autocomplete="list"
        aria-expanded={open && !disabled}
        aria-controls={`${id}-options`}
        aria-describedby={`${id}-order`}
        aria-activedescendant={open && !disabled && activeIndex >= 0 ? `${id}-${activeIndex}` : undefined}
        autoComplete="off"
        disabled={disabled}
        placeholder="Search branches…"
        value={open ? search : value ?? ""}
        className="w-full min-w-0 border border-pane-border bg-pane-bg pl-2 pr-6 py-1 text-xs text-text-primary disabled:opacity-50"
        onFocus={show}
        onClick={() => { if (!open) show(); }}
        onChange={(event) => { setSearch(event.target.value); setHighlighted(0); setOpen(true); }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) { event.stopPropagation(); setOpen(false); }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) show();
            else setHighlighted(Math.max(0, Math.min(matches.length - 1,
              activeIndex + (event.key === "ArrowDown" ? 1 : -1))));
          }
          if (event.key === "Enter" && open) {
            event.preventDefault();
            if (matches[activeIndex]) select(matches[activeIndex].branch);
          }
        }}
      />
      <span aria-hidden="true" className="pointer-events-none absolute right-2 top-1 text-text-muted">▾</span>
      <p id={`${id}-order`} className="mt-1 text-xs text-text-muted">Most recent commits first</p>
      {open && !disabled ? (
        <ul id={`${id}-options`} role="listbox" aria-label="Local branches"
          className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto border border-pane-border bg-pane-bg shadow-lg">
          {matches.map((candidate, index) => (
            <li key={candidate.branch} id={`${id}-${index}`} role="option"
              aria-selected={candidate.branch === value}
              ref={(node) => { if (index === activeIndex) node?.scrollIntoView?.({ block: "nearest" }); }}
              className={`cursor-pointer px-2 py-1 text-xs text-text-primary ${index === activeIndex ? "bg-white/10" : ""}`}
              onMouseDown={(event) => event.preventDefault()}
              onMouseMove={() => setHighlighted(index)}
              onClick={() => select(candidate.branch)}>
              <span className="block break-all">{candidate.branch}</span>
              <span className="block break-all text-text-muted">{candidate.checkout ?? "Not checked out"}</span>
            </li>
          ))}
          {matches.length === 0 ? <li role="presentation" className="px-2 py-2 text-xs text-text-muted">No matching branches</li> : null}
        </ul>
      ) : null}
    </div>
  );
}
