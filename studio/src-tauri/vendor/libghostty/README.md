# libghostty build output

Run `npm run libghostty:prepare` from `studio/` before building the
macOS native-terminal spike. The script checks out Ghostty v1.3.1 at
`332b2aefc6e72d363aa93ab6ecfc86eeeeb5ed28`, applies the committed
native-static build patch, and writes `include/ghostty.h`, `lib/libghostty.a`,
and `REVISION` here. `BUILD_RECIPE` fingerprints the preparation script and
patch, so changes to build options invalidate an existing library.

Build with `-Dsentry=false`. Ticketry collects macOS crash reports; Ghostty's
embedded handler would intercept native faults and prevent those reports.
Preparation rejects a library containing Sentry or Breakpad handler symbols.

Generated library artifacts are intentionally ignored.
