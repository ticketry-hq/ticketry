# Silent desktop exits, September 5, 2026

## Observed failure

The installed `/Applications/Ticketry.app/Contents/MacOS/ticketry` exited
without a macOS crash dialog. Ten retained reports in
`~/.config/ticketry/crash-reports/` recorded unclean sessions from commit
`d3f16cf4110343cfbcacdf1804086eb17fc3aa18`, each with
`native_report: "no native report found"`.

Ghostty's Sentry cache recorded a fatal native event at
`2026-09-05T13:24:30.697705Z`, or 18:54:30 IST. Its minidump module list
identified the installed Ticketry executable. The exception stream recorded
exception code 1, `EXC_BAD_ACCESS`, at address `0x2542eac9` on thread 259.
The dump disappeared from Ghostty's cache on a subsequent restart before a
matching stack could be extracted. The exact function responsible for that
event is therefore unconfirmed. Older dumps must not be symbolicated with a
replacement executable and treated as evidence for this event.

## Why no report appeared

The preparation script built Ghostty with its default Sentry option enabled.
Its embedded Breakpad handler intercepted native exceptions before macOS could
write the `.ips` reports Ticketry collects. The prepared-library check only
compared the upstream revision, so changing build options did not invalidate
an existing library.

Preparation now passes `-Dsentry=false`, fingerprints the script and patch,
and rejects a staged library containing Sentry or Breakpad handler symbols.
Future native faults should reach macOS, and Ticketry's existing startup
collector and delayed retry can retain the resulting exception and thread
backtraces. Reports remain local and do not include raw memory dumps.

## Native view race corrected

Terminal presentation commands copied an `NSView` address from the Rust
registry before dispatching to the main thread. Detach could free that view
before the queued command executed. The command then dereferenced freed
memory. This is a concrete use-after-free path consistent with native crashes,
but the missing September 5 stack prevents attributing that event to it.

The C bridge now returns non-reused opaque handles backed by a synchronized
registry of live views. Detach invalidates the handle before freeing the
surface. Late commands resolve to no view, and a replacement view cannot
inherit an old handle. A redraw waiter retains its view until it finishes
reading the atomic redraw counter and releases that reference on the main
thread. Detach also disables queued focus handoffs.

Acceptance case `overhaul-270` executes the native bridge regression tests:
late frame, focus, visibility, callback and redraw commands after detach;
double detach; replacement handle identity; and live-handle cleanup. The build
recipe test verifies that missing or stale recipe stamps force preparation.

## Validation limits

The native bridge compiles with warnings treated as errors. Its standalone
tests, all 395 overhaul acceptance tests, and the 70 diagnostics tests passed.
A shipping-library rebuild was
attempted, but the pinned compiler download reset halfway through. A second
desktop build was also using the same cache. A rebuilt installed application
and a real macOS crash/relaunch capture have not been verified in this session.
