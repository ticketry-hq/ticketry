#import <AppKit/AppKit.h>
#import <dispatch/dispatch.h>
#import <ghostty.h>
#import <stdlib.h>

#import "libghostty_host.h"

typedef struct {
  ghostty_app_t app;
  ghostty_config_t config;
} MuxedGhosttyRuntime;

static ghostty_input_mods_e ghostty_mods(NSEventModifierFlags flags) {
  uint32_t mods = GHOSTTY_MODS_NONE;
  if (flags & NSEventModifierFlagShift) mods |= GHOSTTY_MODS_SHIFT;
  if (flags & NSEventModifierFlagControl) mods |= GHOSTTY_MODS_CTRL;
  if (flags & NSEventModifierFlagOption) mods |= GHOSTTY_MODS_ALT;
  if (flags & NSEventModifierFlagCommand) mods |= GHOSTTY_MODS_SUPER;
  if (flags & NSEventModifierFlagCapsLock) mods |= GHOSTTY_MODS_CAPS;
  return (ghostty_input_mods_e)mods;
}

static void runtime_wakeup(void *userdata) {
  MuxedGhosttyRuntime *runtime = userdata;
  dispatch_async(dispatch_get_main_queue(), ^{
    if (runtime->app != NULL) ghostty_app_tick(runtime->app);
  });
}

static bool runtime_action(ghostty_app_t app, ghostty_target_s target,
                           ghostty_action_s action) {
  (void)app;
  (void)target;
  (void)action;
  return false;
}

static bool runtime_read_clipboard(void *userdata, ghostty_clipboard_e clipboard,
                                   void *state) {
  (void)userdata;
  (void)clipboard;
  (void)state;
  return false;
}

static void runtime_confirm_clipboard(
    void *userdata, const char *value, void *state,
    ghostty_clipboard_request_e request) {
  (void)userdata;
  (void)value;
  (void)state;
  (void)request;
}

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

@interface MuxedGhosttyView : NSView {
 @public
  ghostty_surface_t _surface;
}
- (instancetype)initWithRuntime:(MuxedGhosttyRuntime *)runtime
                         parent:(NSView *)parent
                        command:(const char *)command;
- (void)updateGhosttySize;
@end

@implementation MuxedGhosttyView

- (instancetype)initWithRuntime:(MuxedGhosttyRuntime *)runtime
                         parent:(NSView *)parent
                        command:(const char *)command {
  self = [super initWithFrame:NSZeroRect];
  if (self == nil) return nil;

  self.wantsLayer = YES;
  self.layer.backgroundColor = NSColor.blackColor.CGColor;

  ghostty_surface_config_s config = ghostty_surface_config_new();
  config.platform_tag = GHOSTTY_PLATFORM_MACOS;
  config.platform.macos.nsview = self;
  config.userdata = self;
  config.scale_factor = NSScreen.mainScreen.backingScaleFactor;
  config.command = command;
  config.wait_after_command = true;
  config.context = GHOSTTY_SURFACE_CONTEXT_TAB;
  _surface = ghostty_surface_new(runtime->app, &config);
  if (_surface == NULL) {
    [self release];
    return nil;
  }

  [parent addSubview:self positioned:NSWindowAbove relativeTo:nil];
  return self;
}

- (void)dealloc {
  if (_surface != NULL) {
    ghostty_surface_free(_surface);
    _surface = NULL;
  }
  [super dealloc];
}

- (BOOL)acceptsFirstResponder {
  return YES;
}

- (BOOL)becomeFirstResponder {
  BOOL accepted = [super becomeFirstResponder];
  if (accepted && _surface != NULL) ghostty_surface_set_focus(_surface, true);
  return accepted;
}

- (BOOL)resignFirstResponder {
  BOOL resigned = [super resignFirstResponder];
  if (resigned && _surface != NULL) ghostty_surface_set_focus(_surface, false);
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
}

- (void)updateGhosttySize {
  if (_surface == NULL || self.bounds.size.width <= 0 ||
      self.bounds.size.height <= 0)
    return;
  NSSize backing = [self convertSizeToBacking:self.bounds.size];
  ghostty_surface_set_size(_surface, (uint32_t)backing.width,
                          (uint32_t)backing.height);
}

- (void)keyDown:(NSEvent *)event {
  if (_surface == NULL) return;
  if ((event.modifierFlags & NSEventModifierFlagCommand) &&
      event.keyCode == 0x35) {
    [self.window makeFirstResponder:self.superview];
    return;
  }

  ghostty_input_key_s key = {0};
  key.action = event.isARepeat ? GHOSTTY_ACTION_REPEAT : GHOSTTY_ACTION_PRESS;
  key.keycode = event.keyCode;
  key.mods = ghostty_mods(event.modifierFlags);
  key.consumed_mods =
      ghostty_mods(event.modifierFlags &
                   ~(NSEventModifierFlagControl | NSEventModifierFlagCommand));
  NSString *unshifted = [event charactersByApplyingModifiers:0];
  if (unshifted.length == 1) key.unshifted_codepoint = [unshifted characterAtIndex:0];

  NSString *text = event.characters;
  if (text.length == 1) {
    unichar scalar = [text characterAtIndex:0];
    if (scalar < 0x20 || (scalar >= 0xF700 && scalar <= 0xF8FF)) text = nil;
  }
  key.text = text.UTF8String;
  ghostty_surface_key(_surface, key);
}

- (void)keyUp:(NSEvent *)event {
  if (_surface == NULL) return;
  ghostty_input_key_s key = {0};
  key.action = GHOSTTY_ACTION_RELEASE;
  key.keycode = event.keyCode;
  key.mods = ghostty_mods(event.modifierFlags);
  ghostty_surface_key(_surface, key);
}

- (void)mouseDown:(NSEvent *)event {
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
  if (_surface == NULL) return;
  ghostty_surface_mouse_button(_surface, GHOSTTY_MOUSE_RELEASE,
                              GHOSTTY_MOUSE_LEFT,
                              ghostty_mods(event.modifierFlags));
}

- (void)mouseDragged:(NSEvent *)event {
  if (_surface == NULL) return;
  NSPoint point = [self convertPoint:event.locationInWindow fromView:nil];
  ghostty_surface_mouse_pos(_surface, point.x, self.bounds.size.height - point.y,
                           ghostty_mods(event.modifierFlags));
}

- (void)scrollWheel:(NSEvent *)event {
  if (_surface == NULL) return;
  int mods = event.hasPreciseScrollingDeltas ? 1 : 0;
  ghostty_surface_mouse_scroll(_surface, event.scrollingDeltaX,
                              event.scrollingDeltaY, mods);
}

@end

void *muxed_ghostty_runtime_new(void) {
  configure_bundled_ghostty_environment();
  static dispatch_once_t initialized;
  static int initialization_result = -1;
  dispatch_once(&initialized, ^{
    char *argv[] = {"ticketry", NULL};
    initialization_result = ghostty_init(1, argv);
  });
  if (initialization_result != GHOSTTY_SUCCESS) return NULL;

  MuxedGhosttyRuntime *runtime = calloc(1, sizeof(MuxedGhosttyRuntime));
  runtime->config = ghostty_config_new();
  if (runtime->config == NULL) {
    free(runtime);
    return NULL;
  }
  ghostty_config_finalize(runtime->config);

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

void *muxed_ghostty_view_new(void *opaque, void *parent_view,
                             const char *command) {
  if (opaque == NULL || parent_view == NULL || command == NULL) return NULL;
  return [[MuxedGhosttyView alloc]
      initWithRuntime:(MuxedGhosttyRuntime *)opaque
               parent:(NSView *)parent_view
              command:command];
}

void muxed_ghostty_view_free(void *opaque) {
  MuxedGhosttyView *view = opaque;
  if (view == nil) return;
  [view removeFromSuperview];
  [view release];
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
  NSRect viewport = parent.safeAreaRect;
  if (viewport.size.width <= 0 || viewport.size.height <= 0)
    viewport = parent.bounds;
  double scale_x = viewport.size.width / viewport_width;
  double scale_y = viewport.size.height / viewport_height;
  NSRect frame = NSMakeRect(NSMinX(viewport) + x * scale_x, 0,
                            width * scale_x, height * scale_y);
  if (parent.isFlipped)
    frame.origin.y = NSMinY(viewport) + y * scale_y;
  else
    frame.origin.y = NSMaxY(viewport) - (y + height) * scale_y;
  view.frame = frame;
  [view updateGhosttySize];

  ghostty_surface_size_s size = ghostty_surface_size(view->_surface);
  return (muxed_ghostty_grid_size_s){size.columns, size.rows};
}

void muxed_ghostty_view_focus(void *opaque) {
  MuxedGhosttyView *view = opaque;
  if (view != nil) [view.window makeFirstResponder:view];
}
