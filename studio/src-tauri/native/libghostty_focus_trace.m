// Opt-in first-responder tracing for the hosted Ghostty view.
//
// The view loses the keyboard whenever AppKit moves first responder away from
// it, and the app cannot see that happen from JavaScript: the webview is a
// sibling responder, so a steal leaves no DOM event behind. Set
// MUXED_TERMINAL_FOCUS_TRACE=1 before launching Studio to log every
// focus-relevant transition (and who holds the keyboard after it) to stderr.

static BOOL muxed_focus_trace_enabled(void) {
  static BOOL enabled = NO;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    const char *flag = getenv("MUXED_TERMINAL_FOCUS_TRACE");
    enabled = flag != NULL && flag[0] != '\0' && strcmp(flag, "0") != 0;
  });
  return enabled;
}

static NSString *muxed_focus_trace_responder(NSView *view) {
  NSResponder *responder = view.window.firstResponder;
  if (responder == nil) return @"<none>";
  if (responder == (NSResponder *)view) return @"<this terminal>";
  return [NSString stringWithFormat:@"%@ %p", [responder class], responder];
}

static void muxed_focus_trace(NSView *view, const char *event,
                              BOOL accepts_input) {
  if (!muxed_focus_trace_enabled() || view == nil) return;
  NSLog(@"[focus-trace] %s view=%p hidden=%d acceptsInput=%d windowKey=%d "
        @"appActive=%d firstResponder=%@",
        event, view, view.isHidden, accepts_input,
        view.window.isKeyWindow, NSApp.isActive,
        muxed_focus_trace_responder(view));
}

// A responder that is resigning has not yet been replaced, so the interesting
// fact — who took the keyboard — is only knowable on the next runloop turn.
static void muxed_focus_trace_settled(NSView *view, const char *event) {
  if (!muxed_focus_trace_enabled() || view == nil) return;
  NSString *label = [NSString stringWithUTF8String:event];
  NSView *traced = [view retain];
  dispatch_async(dispatch_get_main_queue(), ^{
    if (muxed_focus_trace_enabled()) {
      NSLog(@"[focus-trace] %@ (settled) view=%p hidden=%d windowKey=%d "
            @"appActive=%d firstResponder=%@",
            label, traced, traced.isHidden, traced.window.isKeyWindow,
            NSApp.isActive, muxed_focus_trace_responder(traced));
    }
    [traced release];
  });
}
