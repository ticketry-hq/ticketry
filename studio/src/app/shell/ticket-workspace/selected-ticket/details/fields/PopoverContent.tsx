import type { ReactNode } from "react";

interface PopoverContentProps {
  children: ReactNode;
}

export default function PopoverContent({ children }: PopoverContentProps) {
  return (
    <div className="max-h-[320px] overflow-y-auto">
      {children}
    </div>
  );
}
