import { defineConfig } from "vitest/config";
import { editionDefine } from "./scripts/edition-build-policy.mjs";
import base from "./vitest.config";

// Pocock edition suite: its acceptance, the edition manifest parity check and
// the edition-bound Graph Run request mode.
export default defineConfig({
  ...base,
  define: { ...base.define, ...editionDefine({ TICKETRY_EDITION: "pocock" }) },
  test: {
    ...base.test,
    include: [
      "src/test/overhaulPocock*Acceptance.test.tsx",
      "src/shared/config/edition.test.ts",
      "src/features/execution/graphRunRequestMode.test.ts",
    ],
    exclude: [],
  },
});
