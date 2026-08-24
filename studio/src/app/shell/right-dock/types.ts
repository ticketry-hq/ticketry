import type { ComponentType, ReactNode } from "react";
import type { IconProps } from "../../../shared/ui/icons";

export interface RightDockContext {
  projectId: string | null;
  moduleId: string | null;
}

export interface RightDockViewRegistration {
  id: string;
  label: string;
  icon: ComponentType<IconProps>;
  isAvailable: (context: RightDockContext) => boolean;
  render: (context: RightDockContext) => ReactNode;
}
