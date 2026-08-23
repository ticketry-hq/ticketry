/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Rust GraphQL development adapter; defaults to /graphql. */
  readonly VITE_GRAPHQL_API?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
