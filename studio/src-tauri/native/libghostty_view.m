// AppKit view behavior, input routing, visibility, and redraw reporting.

static const double kMuxedScrollPixelsPerLine = 24.0;
static const uint16_t kMuxedScrollMaxLines = 20;

static ghostty_input_mouse_momentum_e
muxed_ghostty_mouse_momentum(NSEventPhase phase) {
  switch (phase) {
    case NSEventPhaseBegan:
      return GHOSTTY_MOUSE_MOMENTUM_BEGAN;
    case NSEventPhaseStationary:
      return GHOSTTY_MOUSE_MOMENTUM_STATIONARY;
    case NSEventPhaseChanged:
      return GHOSTTY_MOUSE_MOMENTUM_CHANGED;
    case NSEventPhaseEnded:
      return GHOSTTY_MOUSE_MOMENTUM_ENDED;
    case NSEventPhaseCancelled:
      return GHOSTTY_MOUSE_MOMENTUM_CANCELLED;
    case NSEventPhaseMayBegin:
      return GHOSTTY_MOUSE_MOMENTUM_MAY_BEGIN;
    default:
      return GHOSTTY_MOUSE_MOMENTUM_NONE;
  }
}

static ghostty_input_scroll_mods_t
muxed_ghostty_scroll_mods(NSEvent *event) {
  // libghostty's packed ScrollMods stores precision in bit zero and the
  // three-bit momentum enum immediately above it.
  int precision = event.hasPreciseScrollingDeltas ? 1 : 0;
  int momentum = (int)muxed_ghostty_mouse_momentum(event.momentumPhase);
  return precision | (momentum << 1);
}

@interface MuxedGhosttyView : NSView {
 @public
  ghostty_surface_t _surface;
  muxed_ghostty_surface_owner_s _surfaceOwner;
  atomic_uint_fast64_t _redrawGeneration;
  // Main-thread only: gestures are delivered and disabled on AppKit's thread,
  // so a disabled view can no longer reach its owner's callback context.
  muxed_ghostty_scroll_cb _scrollCallback;
  void *_scrollContext;
  muxed_ghostty_resize_cb _resizeCallback;
  void *_resizeContext;
  uint16_t _reportedColumns;
  uint16_t _reportedRows;
  muxed_ghostty_process_exit_cb _processExitCallback;
  void *_processExitContext;
  muxed_ghostty_chord_cb _chordCallback;
  void *_chordContext;
  BOOL _acceptsInput;
  BOOL _reportsGridResize;
  NSView *_webview;
}
- (instancetype)initWithRuntime:(MuxedGhosttyRuntime *)runtime
                         parent:(NSView *)parent
                        command:(const char *)command
            processExitCallback:(muxed_ghostty_process_exit_cb)processExitCallback
             processExitContext:(void *)processExitContext;
- (void)updateGhosttySize;
- (void)reportGridResize;
- (void)recordRedraw;
@end

@implementation MuxedGhosttyView

- (instancetype)initWithRuntime:(MuxedGhosttyRuntime *)runtime
                         parent:(NSView *)parent
                        command:(const char *)command
            processExitCallback:(muxed_ghostty_process_exit_cb)processExitCallback
             processExitContext:(void *)processExitContext {
  self = [super initWithFrame:NSZeroRect];
  if (self == nil) return nil;

  self.wantsLayer = YES;
  self.layer.backgroundColor = muxed_ghostty_background_color().CGColor;
  // Ghostty's Metal layer can retain its previous drawable extent while a
  // fullscreen transition is settling. Never let those pixels escape the
  // pane frame while the renderer catches up with the new surface size.
  self.layer.masksToBounds = YES;
  self.hidden = YES;
  _acceptsInput = NO;
  // Preserve the terminal's fixed pane insets while AppKit animates the
  // WebView between windowed and fullscreen bounds. JavaScript still applies
  // layout changes such as sidebar movement; this covers parent-only resizes.
  self.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  atomic_init(&_redrawGeneration, 0);
  _processExitCallback = processExitCallback;
  _processExitContext = processExitContext;
  muxed_ghostty_surface_owner_init(&_surfaceOwner, self);
  _webview = parent;
  muxed_ghostty_prepare_transparent_webview(_webview);
  if (!muxed_ghostty_place_sibling(self, _webview, true)) {
    [self release];
    return nil;
  }

  // The target window is authoritative. The view must already belong to it
  // before libghostty chooses its first cell metrics and backing size.
  CGFloat scale = self.window.backingScaleFactor ?: 1.0;
  self.layer.contentsScale = scale;

  ghostty_surface_config_s config = ghostty_surface_config_new();
  config.platform_tag = GHOSTTY_PLATFORM_MACOS;
  config.platform.macos.nsview = self;
  config.userdata = &_surfaceOwner;
  config.scale_factor = scale;
  config.command = command;
  config.wait_after_command = true;
  config.context = GHOSTTY_SURFACE_CONTEXT_TAB;
  _surface = ghostty_surface_new(runtime->app, &config);
  if (_surface == NULL) {
    [self removeFromSuperview];
    [self release];
    return nil;
  }
  muxed_ghostty_surface_owner_activate(&_surfaceOwner, _surface);

  ghostty_surface_set_content_scale(_surface, scale, scale);
  muxed_focus_trace(self, "view created", _acceptsInput);
  return self;
}

- (void)dealloc {
  if (_surface != NULL) {
    ghostty_surface_t surface = _surface;
    _surface = NULL;
    muxed_ghostty_surface_owner_invalidate(&_surfaceOwner);
    ghostty_surface_free(surface);
  }
  [super dealloc];
}

- (BOOL)acceptsFirstResponder {
  return _acceptsInput;
}

- (BOOL)becomeFirstResponder {
  if (!_acceptsInput) {
    muxed_focus_trace(self, "becomeFirstResponder refused", _acceptsInput);
    return NO;
  }
  BOOL accepted = [super becomeFirstResponder];
  if (accepted && _surface != NULL) ghostty_surface_set_focus(_surface, true);
  muxed_focus_trace(self,
                    accepted ? "becomeFirstResponder" : "becomeFirstResponder rejected",
                    _acceptsInput);
  return accepted;
}

- (BOOL)resignFirstResponder {
  BOOL resigned = [super resignFirstResponder];
  if (resigned && _surface != NULL) ghostty_surface_set_focus(_surface, false);
  muxed_focus_trace(self, "resignFirstResponder", _acceptsInput);
  muxed_focus_trace_settled(self, "resignFirstResponder");
  return resigned;
}

- (void)updateTrackingAreas {
  [super updateTrackingAreas];
  NSArray<NSTrackingArea *> *existingAreas = [self.trackingAreas copy];
  for (NSTrackingArea *area in existingAreas) {
    [self removeTrackingArea:area];
  }
  [existingAreas release];
  NSTrackingArea *area = [[NSTrackingArea alloc]
      initWithRect:NSZeroRect
           options:NSTrackingMouseEnteredAndExited | NSTrackingMouseMoved |
                   NSTrackingInVisibleRect | NSTrackingActiveAlways
             owner:self
          userInfo:nil];
  [self addTrackingArea:area];
  [area release];
}

- (void)reportMousePosition:(NSEvent *)event {
  if (!_acceptsInput || _surface == NULL) return;
  NSPoint point = [self convertPoint:event.locationInWindow fromView:nil];
  ghostty_surface_mouse_pos(_surface, point.x, self.bounds.size.height - point.y,
                           ghostty_mods(event.modifierFlags));
}

- (void)mouseEntered:(NSEvent *)event {
  [super mouseEntered:event];
  [self reportMousePosition:event];
}

- (void)mouseExited:(NSEvent *)event {
  [super mouseExited:event];
  if (_acceptsInput && _surface != NULL && NSEvent.pressedMouseButtons == 0)
    ghostty_surface_mouse_pos(_surface, -1, -1,
                             ghostty_mods(event.modifierFlags));
}

- (void)mouseMoved:(NSEvent *)event {
  [self reportMousePosition:event];
}

- (void)viewDidChangeBackingProperties {
  [super viewDidChangeBackingProperties];
  if (_surface == NULL) return;
  CGFloat scale = self.window.backingScaleFactor ?: 1.0;
  self.layer.contentsScale = scale;
  ghostty_surface_set_content_scale(_surface, scale, scale);
  [self updateGhosttySize];
}

- (void)setFrame:(NSRect)frame {
  [super setFrame:frame];
  [self updateGhosttySize];
  [self reportGridResize];
}

- (void)updateGhosttySize {
  if (_surface == NULL || self.bounds.size.width <= 0 ||
      self.bounds.size.height <= 0)
    return;
  NSSize backing = [self convertSizeToBacking:self.bounds.size];
  ghostty_surface_set_size(_surface, (uint32_t)backing.width,
                          (uint32_t)backing.height);
}

- (void)reportGridResize {
  if (!_reportsGridResize || _surface == NULL || _resizeCallback == NULL)
    return;
  ghostty_surface_size_s size = ghostty_surface_size(_surface);
  if (size.columns == 0 || size.rows == 0 ||
      (size.columns == _reportedColumns && size.rows == _reportedRows))
    return;
  _reportedColumns = size.columns;
  _reportedRows = size.rows;
  _resizeCallback(_resizeContext, size.columns, size.rows);
}

- (void)recordRedraw {
  atomic_fetch_add_explicit(&_redrawGeneration, 1, memory_order_release);
}

- (void)keyDown:(NSEvent *)event {
  if (!_acceptsInput || _surface == NULL) return;
  // Studio chords must survive an engaged terminal (#667, #735): the WebView
  // never sees a key while this view is first responder, so each chord is
  // recognised here, hands the keyboard back, and is reported to Studio.
  // Only the chord is native; what it *means* stays owned by the JavaScript
  // binding, which is why this reports instead of acting.
  uint8_t chord = muxed_ghostty_studio_chord(event.modifierFlags, event.keyCode);
  if (chord != MUXED_GHOSTTY_CHORD_NONE) {
    muxed_focus_trace(self, "disengaged by studio chord", _acceptsInput);
    [self.window makeFirstResponder:self.superview];
    if (_chordCallback != NULL) _chordCallback(_chordContext, chord);
    return;
  }

  ghostty_input_key_s key = muxed_ghostty_key_event(
      event, event.isARepeat ? GHOSTTY_ACTION_REPEAT : GHOSTTY_ACTION_PRESS);
  ghostty_surface_key(_surface, key);
}

- (void)keyUp:(NSEvent *)event {
  if (!_acceptsInput || _surface == NULL) return;
  ghostty_input_key_s key = {0};
  key.action = GHOSTTY_ACTION_RELEASE;
  key.keycode = event.keyCode;
  key.mods = ghostty_mods(event.modifierFlags);
  ghostty_surface_key(_surface, key);
}

- (void)mouseDown:(NSEvent *)event {
  if (!_acceptsInput) return;
  [self.window makeFirstResponder:self];
  if (_surface == NULL) return;
  NSPoint point = [self convertPoint:event.locationInWindow fromView:nil];
  ghostty_surface_mouse_pos(_surface, point.x, self.bounds.size.height - point.y,
                           ghostty_mods(event.modifierFlags));
  ghostty_surface_mouse_button(_surface, GHOSTTY_MOUSE_PRESS,
                              GHOSTTY_MOUSE_LEFT,
                              ghostty_mods(event.modifierFlags));
}

- (void)mouseUp:(NSEvent *)event {
  if (!_acceptsInput || _surface == NULL) return;
  ghostty_surface_mouse_button(_surface, GHOSTTY_MOUSE_RELEASE,
                              GHOSTTY_MOUSE_LEFT,
                              ghostty_mods(event.modifierFlags));
}

- (void)mouseDragged:(NSEvent *)event {
  if (!_acceptsInput || _surface == NULL) return;
  NSPoint point = [self convertPoint:event.locationInWindow fromView:nil];
  ghostty_surface_mouse_pos(_surface, point.x, self.bounds.size.height - point.y,
                           ghostty_mods(event.modifierFlags));
}

- (void)rightMouseDown:(NSEvent *)event {
  if (!_acceptsInput || _surface == NULL) return;
  [self reportMousePosition:event];
  ghostty_surface_mouse_button(_surface, GHOSTTY_MOUSE_PRESS,
                              GHOSTTY_MOUSE_RIGHT,
                              ghostty_mods(event.modifierFlags));
}

- (void)rightMouseUp:(NSEvent *)event {
  if (!_acceptsInput || _surface == NULL) return;
  ghostty_surface_mouse_button(_surface, GHOSTTY_MOUSE_RELEASE,
                              GHOSTTY_MOUSE_RIGHT,
                              ghostty_mods(event.modifierFlags));
}

- (void)rightMouseDragged:(NSEvent *)event {
  [self reportMousePosition:event];
}

- (void)otherMouseDown:(NSEvent *)event {
  if (!_acceptsInput || _surface == NULL) return;
  [self reportMousePosition:event];
  ghostty_surface_mouse_button(_surface, GHOSTTY_MOUSE_PRESS,
                              GHOSTTY_MOUSE_MIDDLE,
                              ghostty_mods(event.modifierFlags));
}

- (void)otherMouseUp:(NSEvent *)event {
  if (!_acceptsInput || _surface == NULL) return;
  ghostty_surface_mouse_button(_surface, GHOSTTY_MOUSE_RELEASE,
                              GHOSTTY_MOUSE_MIDDLE,
                              ghostty_mods(event.modifierFlags));
}

- (void)otherMouseDragged:(NSEvent *)event {
  [self reportMousePosition:event];
}

- (void)scrollWheel:(NSEvent *)event {
  if (muxed_focus_trace_enabled()) {
    NSLog(@"[focus-trace] scrollWheel view=%p acceptsInput=%d surface=%p "
          @"precise=%d delta=(%.3f,%.3f) phase=%lu momentum=%lu",
          self, _acceptsInput, _surface, event.hasPreciseScrollingDeltas,
          event.scrollingDeltaX, event.scrollingDeltaY,
          (unsigned long)event.phase, (unsigned long)event.momentumPhase);
  }
  if (!_acceptsInput || _surface == NULL) return;
  // A mouse-tracking program owns its viewport. Match the WASM renderer by
  // letting libghostty encode that wheel event for the program. Ordinary shell
  // scrollback remains durable in tmux.
  if (ghostty_surface_mouse_captured(_surface)) {
    [self reportMousePosition:event];
    double x = event.scrollingDeltaX;
    double y = event.scrollingDeltaY;
    if (event.hasPreciseScrollingDeltas) {
      // Match Ghostty's macOS host, which doubles trackpad travel before
      // handing the gesture to the terminal core.
      x *= 2;
      y *= 2;
    }
    ghostty_surface_mouse_scroll(_surface, x, y,
                                 muxed_ghostty_scroll_mods(event));
    return;
  }
  muxed_ghostty_scroll_intent_s intent = muxed_ghostty_normalize_scroll(
      event.scrollingDeltaY, event.hasPreciseScrollingDeltas);
  if (intent.direction == MUXED_GHOSTTY_SCROLL_NONE) return;
  if (_scrollCallback != NULL)
    _scrollCallback(_scrollContext, intent.direction, intent.lines);
}

@end

static bool runtime_action(ghostty_app_t app, ghostty_target_s target,
                           ghostty_action_s action) {
  (void)app;
  if (action.tag != GHOSTTY_ACTION_SHOW_CHILD_EXITED ||
      target.tag != GHOSTTY_TARGET_SURFACE)
    return false;

  muxed_ghostty_surface_owner_s *owner =
      ghostty_surface_userdata(target.target.surface);
  MuxedGhosttyView *view = muxed_ghostty_owned_viewer(owner);
  if (view == nil) return false;
  if (view->_processExitCallback != NULL)
    view->_processExitCallback(view->_processExitContext,
                               action.action.child_exited.exit_code);
  return true;
}
