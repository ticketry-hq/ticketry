import { useLayoutEffect } from "react";
import { taskDetailPoint } from "./taskDetailProbe";
import { moduleLoadPoint } from "./moduleLoadProbe";

const startupPaintStages = new Set<string>();

/** Commit and paint opportunity are separate: neither claims pixel-level visibility. */
export function useTaskDetailCommit(
  taskId: string,
  moduleId: string | null,
  stage: string,
  visible = true,
) {
  useLayoutEffect(() => {
    if (import.meta.env.MODE === "test" || !visible) return;
    const measureStartup = stage === "details-data-ready" || stage === "description";
    if (!import.meta.env.DEV && (!measureStartup || startupPaintStages.has(stage))) return;
    const taskPoint = taskDetailPoint(taskId);
    const modulePoint = moduleLoadPoint(moduleId);
    const point = (suffix: string) => {
      taskPoint(`${stage}-${suffix}`);
      modulePoint(`${stage}-${suffix}`, { task_id: taskId });
    };
    point("committed");
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        point("paint-opportunity");
        if (measureStartup && !startupPaintStages.has(stage)) {
          startupPaintStages.add(stage);
          console.info("[startup-paint]", JSON.stringify({
            stage, task_id: taskId, epoch_ms: performance.timeOrigin + performance.now(),
          }));
        }
      });
    });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [taskId, moduleId, stage, visible]);
}
