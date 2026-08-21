// libghostty runtime configuration, clipboard integration, and lifecycle.

static NSColor *muxed_ghostty_background_color(void) {
  return [NSColor colorWithSRGBRed:17.0 / 255.0
                            green:19.0 / 255.0
                             blue:23.0 / 255.0
                            alpha:1.0];
}

static bool load_ticketry_ghostty_theme(ghostty_config_t config) {
  NSString *path = [NSBundle.mainBundle pathForResource:@"ticketry-ghostty"
                                                 ofType:@"conf"];
  if (path == nil) return false;
  ghostty_config_load_file(config, path.fileSystemRepresentation);
  return true;
}

static bool ticketry_ghostty_background_is_configured(
    ghostty_config_t config) {
  static const char key[] = "background";
  ghostty_config_color_s background = {0};
  return ghostty_config_get(config, &background, key, sizeof(key) - 1) &&
         background.r == 17 && background.g == 19 && background.b == 23;
}

static ghostty_input_mods_e ghostty_mods(NSEventModifierFlags flags) {
  uint32_t mods = GHOSTTY_MODS_NONE;
  if (flags & NSEventModifierFlagShift) mods |= GHOSTTY_MODS_SHIFT;
  if (flags & NSEventModifierFlagControl) mods |= GHOSTTY_MODS_CTRL;
  if (flags & NSEventModifierFlagOption) mods |= GHOSTTY_MODS_ALT;
  if (flags & NSEventModifierFlagCommand) mods |= GHOSTTY_MODS_SUPER;
  if (flags & NSEventModifierFlagCapsLock) mods |= GHOSTTY_MODS_CAPS;
  return (ghostty_input_mods_e)mods;
}

bool muxed_ghostty_host_is_main_thread(void) {
  return [NSThread isMainThread];
}

static void runtime_wakeup(void *userdata) {
  MuxedGhosttyRuntime *runtime = userdata;
  dispatch_async(dispatch_get_main_queue(), ^{
    if (runtime->app != NULL) ghostty_app_tick(runtime->app);
  });
}

static bool runtime_action(ghostty_app_t app, ghostty_target_s target,
                           ghostty_action_s action);

static void runtime_write_clipboard(
    void *userdata, ghostty_clipboard_e clipboard,
    const ghostty_clipboard_content_s *content, size_t count, bool confirm) {
  (void)userdata;
  (void)clipboard;
  (void)confirm;
  if (count == 0 || content == NULL || content[0].data == NULL) return;
  NSString *value = [NSString stringWithUTF8String:content[0].data];
  if (value == nil) return;
  NSPasteboard *pasteboard = [NSPasteboard generalPasteboard];
  [pasteboard clearContents];
  [pasteboard setString:value forType:NSPasteboardTypeString];
}

static void runtime_close_surface(void *userdata, bool process_alive) {
  (void)userdata;
  (void)process_alive;
}

static void configure_bundled_ghostty_environment(void) {
  NSString *resources = NSBundle.mainBundle.resourcePath;
  if (resources == nil) return;

  NSString *terminfo =
      [resources stringByAppendingPathComponent:@"terminfo"];
  NSString *sentinel =
      [terminfo stringByAppendingPathComponent:@"78/xterm-ghostty"];
  NSString *ghostty =
      [resources stringByAppendingPathComponent:@"ghostty"];
  if (![[NSFileManager defaultManager] fileExistsAtPath:sentinel] ||
      ![[NSFileManager defaultManager] fileExistsAtPath:ghostty])
    return;

  // Finder launches do not inherit the Ghostty environment variables that a
  // development launch gets from its parent shell. Always select Ticketry's
  // pinned resources so native initialization is launch-method independent.
  setenv("GHOSTTY_RESOURCES_DIR", ghostty.fileSystemRepresentation, 1);
  setenv("TERMINFO", terminfo.fileSystemRepresentation, 1);
}

// One line's worth of pixel scrolling and the per-gesture bound, both taken
// from the browser Terminal viewer's wheel policy.
void *muxed_ghostty_runtime_new(void) {
  configure_bundled_ghostty_environment();
  static dispatch_once_t initialized;
  static int initialization_result = -1;
  dispatch_once(&initialized, ^{
    static char *argv[] = {"ticketry", NULL};
    initialization_result = ghostty_init(1, argv);
  });
  if (initialization_result != GHOSTTY_SUCCESS) return NULL;

  MuxedGhosttyRuntime *runtime = calloc(1, sizeof(MuxedGhosttyRuntime));
  runtime->config = ghostty_config_new();
  if (runtime->config == NULL) {
    free(runtime);
    return NULL;
  }
  ghostty_config_load_cli_args(runtime->config);
  if (!load_ticketry_ghostty_theme(runtime->config)) {
    ghostty_config_free(runtime->config);
    free(runtime);
    return NULL;
  }
  ghostty_config_finalize(runtime->config);
  if (!ticketry_ghostty_background_is_configured(runtime->config)) {
    ghostty_config_free(runtime->config);
    free(runtime);
    return NULL;
  }

  ghostty_runtime_config_s config = {
      .userdata = runtime,
      .supports_selection_clipboard = false,
      .wakeup_cb = runtime_wakeup,
      .action_cb = runtime_action,
      .read_clipboard_cb = runtime_read_clipboard,
      .confirm_read_clipboard_cb = runtime_confirm_clipboard,
      .write_clipboard_cb = runtime_write_clipboard,
      .close_surface_cb = runtime_close_surface,
  };
  runtime->app = ghostty_app_new(&config, runtime->config);
  if (runtime->app == NULL) {
    ghostty_config_free(runtime->config);
    free(runtime);
    return NULL;
  }
  ghostty_app_set_color_scheme(runtime->app, GHOSTTY_COLOR_SCHEME_DARK);
  return runtime;
}

void muxed_ghostty_runtime_free(void *opaque) {
  MuxedGhosttyRuntime *runtime = opaque;
  if (runtime == NULL) return;
  if (runtime->app != NULL) ghostty_app_free(runtime->app);
  if (runtime->config != NULL) ghostty_config_free(runtime->config);
  free(runtime);
}
