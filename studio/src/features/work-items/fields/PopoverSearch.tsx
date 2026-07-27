import type { InputHTMLAttributes } from "react";

interface PopoverSearchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "className"> {}

export default function PopoverSearch(props: PopoverSearchProps) {
  return (
    <div className="border-b border-pane-border p-1.5">
      <input
        autoFocus
        type="text"
        className="w-full rounded-md border border-pane-border bg-transparent px-2 py-1 text-sm text-text-primary placeholder:text-text-muted/70 focus:border-text-muted focus:outline-none"
        {...props}
      />
    </div>
  );
}
