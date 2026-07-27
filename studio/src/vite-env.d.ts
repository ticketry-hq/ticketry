/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Worktracker API base URL; defaults to /api/work-tracker via the dev proxy. */
  readonly VITE_WT_API_BASE?: string;
  /** The worktracker x-api-key token. */
  readonly VITE_WT_API_KEY?: string;
  /** Studio agent-runtime API root; defaults to /api. */
  readonly VITE_AGENT_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
