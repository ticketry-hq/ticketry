import { worktreesRightDockView } from "../../../features/worktrees";
import type { RightDockViewRegistration } from "./types";

export const rightDockRegistry: readonly RightDockViewRegistration[] = [
  worktreesRightDockView,
];
