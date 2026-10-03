import { useRef, type ReactNode } from "react";

interface Tab {
  id: string;
  label: ReactNode;
  accessibleLabel: string;
  closeLabel: string;
}
interface TabStripProps {
  label: string;
  tabs: Tab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}

export function TabStrip({ label, tabs, activeId, onSelect, onClose }: TabStripProps) {
  const refs = useRef(new Map<string, HTMLButtonElement>());
  return <div role="tablist" aria-label={label} className="flex min-w-0 overflow-x-auto">
    {tabs.map((tab, index) => <div key={tab.id} className="flex shrink-0 items-center border-r border-pane-border">
      <button type="button" role="tab" aria-label={tab.accessibleLabel} aria-selected={tab.id === activeId}
        tabIndex={tab.id === activeId || (activeId === null && index === 0) ? 0 : -1}
        ref={(node) => { if (node) refs.current.set(tab.id, node); else refs.current.delete(tab.id); }}
        className={`px-3 py-1 ${tab.id === activeId ? "bg-pane-panel text-focus-accent" : "text-text-secondary"}`}
        onClick={() => onSelect(tab.id)}
        onKeyDown={(event) => {
          const target = event.key === "ArrowRight" ? tabs[(index + 1) % tabs.length]
            : event.key === "ArrowLeft" ? tabs[(index - 1 + tabs.length) % tabs.length]
            : event.key === "Home" ? tabs[0] : event.key === "End" ? tabs[tabs.length - 1] : undefined;
          if (!target) return;
          event.preventDefault(); onSelect(target.id); refs.current.get(target.id)?.focus();
        }}>{tab.label}</button>
      <button type="button" aria-label={tab.closeLabel} onClick={() => {
        onClose(tab.id);
        const target = tab.id === activeId ? tabs[index + 1] ?? tabs[index - 1] : tabs.find((candidate) => candidate.id === activeId);
        if (target) refs.current.get(target.id)?.focus();
      }} className="px-2 text-text-secondary hover:text-text-primary">×</button>
    </div>)}
  </div>;
}
