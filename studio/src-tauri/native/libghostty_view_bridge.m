// Narrow C facade used by Rust to operate the hosted Ghostty view.

void *muxed_ghostty_view_new(void *opaque, void *parent_view,
                             const char *command,
                             muxed_ghostty_process_exit_cb process_exit_callback,
                             void *process_exit_context) {
  if (opaque == NULL || parent_view == NULL || command == NULL) return NULL;
  return [[MuxedGhosttyView alloc]
      initWithRuntime:(MuxedGhosttyRuntime *)opaque
               parent:(NSView *)parent_view
              command:command
  processExitCallback:process_exit_callback
   processExitContext:process_exit_context];
}

void muxed_ghostty_view_free(void *opaque) {
  MuxedGhosttyView *view = opaque;
  if (view == nil) return;
  muxed_focus_trace(view, "view freed", view->_acceptsInput);
  muxed_ghostty_surface_owner_invalidate(&view->_surfaceOwner);
  view->_scrollCallback = NULL;
  view->_scrollContext = NULL;
  view->_resizeCallback = NULL;
  view->_resizeContext = NULL;
  view->_processExitCallback = NULL;
  view->_processExitContext = NULL;
  view->_chordCallback = NULL;
  view->_chordContext = NULL;
  [view removeFromSuperview];
  [view release];
}

void muxed_ghostty_view_set_resize_callback(
    void *opaque, muxed_ghostty_resize_cb callback, void *context) {
  MuxedGhosttyView *view = opaque;
  if (view == nil) return;
  view->_resizeCallback = callback;
  view->_resizeContext = context;
  if (view->_surface == NULL) return;
  ghostty_surface_size_s size = ghostty_surface_size(view->_surface);
  view->_reportedColumns = size.columns;
  view->_reportedRows = size.rows;
}

void muxed_ghostty_view_disable_resize_callback(void *opaque) {
  MuxedGhosttyView *view = opaque;
  if (view == nil) return;
  view->_resizeCallback = NULL;
  view->_resizeContext = NULL;
}

muxed_ghostty_grid_size_s
muxed_ghostty_view_set_frame(void *opaque, double x, double y, double width,
                             double height, double viewport_width,
                             double viewport_height) {
  MuxedGhosttyView *view = opaque;
  if (view == nil || view.superview == nil || viewport_width <= 0 ||
      viewport_height <= 0)
    return (muxed_ghostty_grid_size_s){0, 0};

  NSView *parent = view.superview;
  // getBoundingClientRect is relative to WebKit's safe content viewport. On a
  // notched display AppKit can move that viewport between the menu/titlebar
  // area and the fullscreen safe area without changing the WKWebView bounds'
  // origin. Map into safeAreaRect so the missing top translation is not baked
  // into the scale or retained from the previous window mode.
  NSView *coordinateView = view->_webview ?: parent;
  NSRect viewport = coordinateView.safeAreaRect;
  if (viewport.size.width <= 0 || viewport.size.height <= 0)
    viewport = coordinateView.bounds;
  double scale_x = viewport.size.width / viewport_width;
  double scale_y = viewport.size.height / viewport_height;
  NSRect frame = NSMakeRect(NSMinX(viewport) + x * scale_x, 0,
                            width * scale_x, height * scale_y);
  if (coordinateView.isFlipped)
    frame.origin.y = NSMinY(viewport) + y * scale_y;
  else
    frame.origin.y = NSMaxY(viewport) - (y + height) * scale_y;
  view.frame = [coordinateView convertRect:frame toView:parent];
  [view updateGhosttySize];

  ghostty_surface_size_s size = ghostty_surface_size(view->_surface);
  return (muxed_ghostty_grid_size_s){size.columns, size.rows};
}

uint64_t muxed_ghostty_view_arm_redraw(void *opaque) {
  MuxedGhosttyView *view = opaque;
  if (view == nil || view->_surface == NULL) return UINT64_MAX;
  uint64_t generation = atomic_load_explicit(&view->_redrawGeneration,
                                              memory_order_acquire);
  // The embedded Metal renderer draws on its own thread, so a refresh does
  // not round-trip through GHOSTTY_ACTION_RENDER. Force the documented
  // synchronous draw on AppKit's thread and acknowledge it only after the
  // renderer has finished presenting the frame to the view's layer.
  ghostty_surface_draw(view->_surface);
  [view recordRedraw];
  return generation;
}

bool muxed_ghostty_view_wait_for_redraw(void *opaque, uint64_t generation,
                                        uint32_t timeout_milliseconds) {
  MuxedGhosttyView *view = opaque;
  if (view == nil || generation == UINT64_MAX) return false;

  struct timespec started;
  clock_gettime(CLOCK_MONOTONIC, &started);
  for (;;) {
    if (atomic_load_explicit(&view->_redrawGeneration, memory_order_acquire) >
        generation)
      return true;
    struct timespec now;
    clock_gettime(CLOCK_MONOTONIC, &now);
    int64_t elapsed_nanoseconds =
        (int64_t)(now.tv_sec - started.tv_sec) * 1000000000LL +
        (int64_t)(now.tv_nsec - started.tv_nsec);
    uint64_t elapsed = (uint64_t)(elapsed_nanoseconds / 1000000LL);
    if (elapsed >= timeout_milliseconds) return false;
    usleep(1000);
  }
}

bool muxed_ghostty_view_present(void *opaque) {
  MuxedGhosttyView *view = opaque;
  if (view == nil || view->_webview == nil) return false;
  if (!muxed_ghostty_place_sibling(view, view->_webview, false)) return false;
  view->_reportsGridResize = YES;
  view->_acceptsInput = YES;
  view.hidden = NO;
  [view reportGridResize];
  muxed_focus_trace(view, "presented", view->_acceptsInput);
  return true;
}

void muxed_ghostty_view_hide(void *opaque) {
  MuxedGhosttyView *view = opaque;
  if (view == nil) return;
  muxed_focus_trace(view, "hide requested", view->_acceptsInput);
  view->_reportsGridResize = NO;
  view->_acceptsInput = NO;
  if (view.window.firstResponder == view)
    [view.window makeFirstResponder:view.superview];
  if (view->_surface != NULL) ghostty_surface_set_focus(view->_surface, false);
  if (view->_webview != nil)
    muxed_ghostty_place_sibling(view, view->_webview, true);
  view.hidden = YES;
}

muxed_ghostty_grid_size_s
muxed_ghostty_view_show(void *opaque, double x, double y, double width,
                       double height, double viewport_width,
                       double viewport_height) {
  muxed_ghostty_grid_size_s size = muxed_ghostty_view_set_frame(
      opaque, x, y, width, height, viewport_width, viewport_height);
  if (size.columns == 0 || size.rows == 0) return size;
  if (!muxed_ghostty_view_present(opaque))
    return (muxed_ghostty_grid_size_s){0, 0};
  return size;
}

bool muxed_ghostty_view_is_focused(void *opaque) {
  MuxedGhosttyView *view = opaque;
  return view != nil && view.window.firstResponder == view;
}

bool muxed_ghostty_view_is_hidden(void *opaque) {
  MuxedGhosttyView *view = opaque;
  return view == nil || view.hidden;
}

bool muxed_ghostty_view_accepts_input(void *opaque) {
  MuxedGhosttyView *view = opaque;
  return view != nil && !view.hidden && view->_acceptsInput;
}

void muxed_ghostty_view_focus(void *opaque) {
  MuxedGhosttyView *view = opaque;
  if (view == nil) return;
  muxed_focus_trace(view, "focus requested", view->_acceptsInput);
  if (view->_acceptsInput) [view.window makeFirstResponder:view];
  muxed_focus_trace_settled(view, "focus requested");
}

bool muxed_ghostty_view_set_webview_interaction(void *opaque,
                                                bool webview_owns_input) {
  MuxedGhosttyView *view = opaque;
  if (view == nil || view->_webview == nil) return false;
  if (view.hidden && !webview_owns_input) return false;

  if (webview_owns_input) {
    view->_acceptsInput = NO;
    if (view.window.firstResponder == view)
      [view.window makeFirstResponder:view->_webview];
    if (view->_surface != NULL) ghostty_surface_set_focus(view->_surface, false);
  }
  if (!muxed_ghostty_place_sibling(view, view->_webview,
                                    webview_owns_input))
    return false;
  if (!webview_owns_input) {
    view->_acceptsInput = YES;
    [view.window makeFirstResponder:view];
    // The selection starts in WKWebView's pointer handler. WebKit may finish
    // that event by restoring its own content view as first responder after
    // this command returns, so settle the handoff once more next run-loop.
    // A meanwhile-opened overlay flips _acceptsInput back to NO and cancels
    // this guarded retry.
    MuxedGhosttyView *focusView = [view retain];
    dispatch_async(dispatch_get_main_queue(), ^{
      if (!focusView.hidden && focusView->_acceptsInput)
        [focusView.window makeFirstResponder:focusView];
      muxed_focus_trace(focusView, "terminal focus handoff settled",
                        focusView->_acceptsInput);
      [focusView release];
    });
  }
  muxed_focus_trace(view,
                    webview_owns_input ? "WebView owns overlay input"
                                       : "Ghostty owns terminal input",
                    view->_acceptsInput);
  return true;
}

muxed_ghostty_scroll_intent_s
muxed_ghostty_normalize_scroll(double vertical_delta, bool precise) {
  if (!isfinite(vertical_delta) || vertical_delta == 0.0)
    return (muxed_ghostty_scroll_intent_s){MUXED_GHOSTTY_SCROLL_NONE, 0};

  double unit = precise ? kMuxedScrollPixelsPerLine : 1.0;
  double lines = round(fabs(vertical_delta) / unit);
  if (lines < 1.0) lines = 1.0;
  if (lines > (double)kMuxedScrollMaxLines) lines = (double)kMuxedScrollMaxLines;
  // AppKit reports a positive vertical delta when the content moves down,
  // which is the gesture that reviews history.
  uint8_t direction = vertical_delta > 0.0 ? MUXED_GHOSTTY_SCROLL_UP
                                           : MUXED_GHOSTTY_SCROLL_DOWN;
  return (muxed_ghostty_scroll_intent_s){direction, (uint16_t)lines};
}

void muxed_ghostty_view_set_scroll_callback(void *opaque,
                                           muxed_ghostty_scroll_cb callback,
                                           void *context) {
  MuxedGhosttyView *view = opaque;
  if (view == nil) return;
  view->_scrollCallback = callback;
  view->_scrollContext = context;
}

void muxed_ghostty_view_disable_scroll_callback(void *opaque) {
  MuxedGhosttyView *view = opaque;
  if (view == nil) return;
  view->_scrollCallback = NULL;
  view->_scrollContext = NULL;
}

void muxed_ghostty_view_set_chord_callback(void *opaque,
                                          muxed_ghostty_chord_cb callback,
                                          void *context) {
  MuxedGhosttyView *view = opaque;
  if (view == nil) return;
  view->_chordCallback = callback;
  view->_chordContext = context;
}

void muxed_ghostty_view_disable_chord_callback(void *opaque) {
  MuxedGhosttyView *view = opaque;
  if (view == nil) return;
  view->_chordCallback = NULL;
  view->_chordContext = NULL;
}

void muxed_ghostty_view_disable_process_exit_callback(void *opaque) {
  MuxedGhosttyView *view = opaque;
  if (view == nil) return;
  view->_processExitCallback = NULL;
  view->_processExitContext = NULL;
}
