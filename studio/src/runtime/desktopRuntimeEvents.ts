import type {
  RuntimeStartupConfiguration,
  ServiceHealthListener,
  UserNoticeListener,
  StudioRuntime,
} from "./contract";
import type { DesktopInvoke, DesktopRuntimeListen } from "./desktopRuntime";
import {
  parseDesktopServiceHealth,
  parseDesktopConfigurationHealth,
} from "./desktopRuntimeConfiguration";
import { validateUserNotice } from "./userNotice";

export function desktopRuntimeEvents(
  startup: RuntimeStartupConfiguration,
  invoke: DesktopInvoke,
  listen?: DesktopRuntimeListen,
): Pick<StudioRuntime, "subscribeServiceHealth" | "subscribeUserNotices"> {
  const deliveredNoticeIds = new Set(
    startup.initialNotices.map((notice) => notice.id),
  );
  return {
    subscribeServiceHealth: (listener: ServiceHealthListener) => {
      listener(startup.serviceHealth);
      if (!listen) return () => {};
      let active = true;
      let unlisten: (() => void) | undefined;
      void listen("desktop-service-health", (event) => {
        const health = parseDesktopServiceHealth(event.payload);
        if (active && health) listener(health);
      }).then(async (stop) => {
        unlisten = stop;
        if (!active) {
          stop();
          return;
        }
        // Services finish behind the open window, so a `ready` event may have
        // fired before this listener registered. Re-read the live health once.
        const current = await invoke<unknown>("desktop_runtime_configuration")
          .then((value) => parseDesktopConfigurationHealth(value))
          .catch(() => null);
        if (active && current) listener(current);
      });
      return () => {
        active = false;
        unlisten?.();
      };
    },
    subscribeUserNotices: (listener: UserNoticeListener) => {
      if (!listen) return () => {};
      let active = true;
      let unlisten: (() => void) | undefined;
      void listen("desktop-user-notice", (event) => {
        const notice = validateUserNotice(event.payload);
        if (!active || !notice || deliveredNoticeIds.has(notice.id)) return;
        deliveredNoticeIds.add(notice.id);
        listener(notice);
      }).then((stop) => {
        unlisten = stop;
        if (!active) stop();
      });
      return () => {
        active = false;
        unlisten?.();
      };
    },
  };
}
