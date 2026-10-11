import { defineConfig } from "vitest/config";
import base from "./vitest.config";

export default defineConfig({
  ...base,
  define: { ...base.define, __TICKETRY_ROADMAP_ENABLED__: false },
  test: {
    ...base.test,
    include: ["src/test/overhaulRoadmapOff*Acceptance.test.tsx"],
    exclude: [],
  },
});
