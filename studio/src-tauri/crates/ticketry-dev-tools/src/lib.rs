//! The developer command line: the tools that generate, export, and verify.
//!
//! Nothing the product ships runs from here. These are the commands a
//! developer or a generation script invokes: the three `prepare_*` binaries
//! that stand up throwaway databases for `sea-orm-cli` to read entities out
//! of, the two `export_foundation_*` binaries that write the GraphQL SDL and
//! the taurpc bindings the frontend is typed against, the browser GraphQL
//! adapter `npm run web` serves the Studio frontend from, the launch-trace
//! report reader, and the slice-copy verifiers.
//!
//! The crate's own root is empty on purpose. Each tool is a `src/bin/`
//! binary, so it links only what it uses and the desktop build never sees any
//! of them — that separation is what the `development-tools` feature and its
//! `required-features` bookkeeping used to buy by hand.
