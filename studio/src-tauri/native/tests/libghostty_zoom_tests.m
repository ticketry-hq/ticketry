static uint8_t reported_zoom_chord = MUXED_GHOSTTY_CHORD_NONE;

static void record_zoom_chord(void *context, uint8_t chord) {
  (void)context;
  reported_zoom_chord = chord;
}

static void test_native_font_zoom(void) {
  NSView *parent = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 800, 600)];
  MuxedGhosttyView *view = [MuxedGhosttyView new];
  int surface_storage = 0;
  view->_surface = &surface_storage;
  view->_baseFontSize = 14;
  view->_fontZoom = 1;
  view->_webview = parent;
  view->_acceptsInput = YES;
  view->_chordCallback = record_zoom_chord;
  [parent addSubview:view];
  void *handle = muxed_ghostty_register_view(view);

  NSEvent *zoom_event = [NSEvent keyEventWithType:NSEventTypeKeyDown
      location:NSZeroPoint modifierFlags:NSEventModifierFlagCommand
      timestamp:0 windowNumber:0 context:nil characters:@"="
      charactersIgnoringModifiers:@"=" isARepeat:NO keyCode:0x18];
  [view keyDown:zoom_event];
  require(reported_zoom_chord == MUXED_GHOSTTY_CHORD_ZOOM_IN && key_press_count == 0,
          "native zoom entered the terminal instead of the application");
  require(view->_acceptsInput, "zoom disengaged terminal input");

  muxed_ghostty_view_set_frame(handle, 0, 0, 400, 300, 800, 600);
  require(font_action_count == 0, "100% zoom changed the configured font");
  muxed_ghostty_view_set_frame(handle, 0, 0, 200, 150, 400, 300);
  require(strcmp(last_font_action, "set_font_size:28.0000") == 0,
          "native font did not follow the WebView's 200% zoom");
  require(view.frame.size.width == 400 && view.frame.size.height == 300,
          "zoom changed the native pane's physical coverage");
  muxed_ghostty_view_set_frame(handle, 0, 0, 200, 150, 400, 300);
  require(font_action_count == 1, "unchanged zoom reapplied font metrics");
  muxed_ghostty_view_set_frame(handle, 0, 0, 800, 600, 1600, 1200);
  require(strcmp(last_font_action, "set_font_size:7.0000") == 0,
          "zoom out did not scale the native font");
  muxed_ghostty_view_set_frame(handle, 0, 0, 400, 300, 800, 600);
  require(strcmp(last_font_action, "set_font_size:14.0000") == 0,
          "zoom reset did not restore the configured font");
  require(view->_surface == &surface_storage,
          "zoom replaced the terminal surface");
  muxed_ghostty_sync_font_zoom(view->_surface, 14, NAN, &view->_fontZoom);
  require(font_action_count == 3, "invalid zoom reached Ghostty");
  view->_surface = NULL;
  muxed_ghostty_view_free(handle);
  [parent release];
}
