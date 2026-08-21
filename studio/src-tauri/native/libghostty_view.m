// AppKit view behavior, input routing, visibility, and redraw reporting.

static const double kMuxedScrollPixelsPerLine = 24.0;
static const uint16_t kMuxedScrollMaxLines = 20;

// AppKit virtual key codes for the two chords the view refuses to forward.
static const uint16_t kMuxedEscapeKeyCode = 0x35;
static const uint16_t kMuxedGraveKeyCode = 0x32;
static const uint16_t kMuxedEKeyCode = 0x0E;

// Hardware positions for 1 through 9, followed by 0, on a Mac keyboard.
static const uint16_t kMuxedModulePositionKeyCodes[] = {
    0x12, 0x13, 0x14, 0x15, 0x17, 0x16, 0x1A, 0x1C, 0x19, 0x1D,
};

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

uint8_t muxed_ghostty_studio_chord(uint64_t modifier_flags, uint16_t key_code) {
  NSEventModifierFlags chord =
      modifier_flags & (NSEventModifierFlagControl | NSEventModifierFlagCommand |
                        NSEventModifierFlagOption | NSEventModifierFlagShift);
  // Exact modifier match, like the Studio keymap. Ctrl+Shift+grave is a
  // different chord and still belongs to the terminal, and so does a bare
  // letter: only a modified chord can be taken from someone who is typing.
  if (key_code == kMuxedGraveKeyCode && chord == NSEventModifierFlagControl) {
    return MUXED_GHOSTTY_CHORD_PANEL_TOGGLE;
  }
  if (key_code == kMuxedEKeyCode && chord == NSEventModifierFlagCommand) {
    return MUXED_GHOSTTY_CHORD_SETTINGS;
  }
  // Cmd+Escape leaves typing mode. The view has always handed the keyboard
  // back for it; reporting it as a chord is what lets Studio's engaged state
  // follow the keyboard instead of being left behind (#753).
  if (key_code == kMuxedEscapeKeyCode && chord == NSEventModifierFlagCommand) {
    return MUXED_GHOSTTY_CHORD_BODY_DISENGAGE;
  }
  if (chord == NSEventModifierFlagCommand) {
    for (uint8_t index = 0; index < 10; index++) {
      if (key_code == kMuxedModulePositionKeyCodes[index]) {
        return MUXED_GHOSTTY_CHORD_MODULE_POSITION_1 + index;
      }
    }
  }
  return MUXED_GHOSTTY_CHORD_NONE;
}

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
  [parent addSubview:self positioned:NSWindowAbove relativeTo:nil];

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
    // Surface teardown may synchronously ask the runtime for host services.
    // Make every such request unavailable before libghostty begins teardown.
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

static ghostty_input_key_s muxed_ghostty_key_event(NSEvent *event,
                                                   ghostty_input_action_e action) {
  ghostty_input_key_s key = {0};
  key.action = action;
  key.keycode = event.keyCode;
  key.mods = ghostty_mods(event.modifierFlags);
  key.consumed_mods =
      ghostty_mods(event.modifierFlags &
                   ~(NSEventModifierFlagControl | NSEventModifierFlagCommand));
  NSString *unshifted = [event charactersByApplyingModifiers:0];
  if (unshifted.length == 1)
    key.unshifted_codepoint = [unshifted characterAtIndex:0];

  NSString *text = event.characters;
  if (text.length == 1) {
    unichar scalar = [text characterAtIndex:0];
    if (scalar < 0x20 || (scalar >= 0xF700 && scalar <= 0xF8FF)) text = nil;
  }
  key.text = text.UTF8String;
  return key;
}

- (BOOL)performKeyEquivalent:(NSEvent *)event {
  if (!_acceptsInput || _surface == NULL || event.type != NSEventTypeKeyDown)
    return NO;

  // NSWindow asks the whole view tree for key equivalents. With two visible
  // terminals, an unfocused view must not claim Cmd+V (or any other Ghostty
  // binding) before AppKit reaches the terminal that actually owns input.
  if (self.window.firstResponder != self) return NO;

  // AppKit offers Command-modified keys to this path before keyDown. Ask
  // libghostty whether it owns the event so bindings such as Cmd++ reach the
  // native surface instead of falling through to the WebView's zoom handler.
  ghostty_input_key_s key =
      muxed_ghostty_key_event(event, GHOSTTY_ACTION_PRESS);
  ghostty_binding_flags_e flags = 0;
  if (!ghostty_surface_key_is_binding(_surface, key, &flags)) return NO;

  [self keyDown:event];
  return YES;
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

- (void)scrollWheel:(NSEvent *)event {
  if (!_acceptsInput) return;
  // Wheel and trackpad gestures express Scroll bridge intent. They are never
  // forwarded to libghostty, whose fallback would write keys to the hosted
  // command, and a horizontal-only gesture produces no terminal action.
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
