#import <AppKit/AppKit.h>
#import <ghostty.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <termios.h>
#include <unistd.h>

// Use the production NSEvent translation and the prepared pinned library.
static ghostty_input_mods_e ghostty_mods(NSEventModifierFlags flags) {
  uint32_t mods = GHOSTTY_MODS_NONE;
  if (flags & NSEventModifierFlagShift) mods |= GHOSTTY_MODS_SHIFT;
  if (flags & NSEventModifierFlagControl) mods |= GHOSTTY_MODS_CTRL;
  if (flags & NSEventModifierFlagOption) mods |= GHOSTTY_MODS_ALT;
  if (flags & NSEventModifierFlagCommand) mods |= GHOSTTY_MODS_SUPER;
  if (flags & NSEventModifierFlagCapsLock) mods |= GHOSTTY_MODS_CAPS;
  return (ghostty_input_mods_e)mods;
}

#include "../libghostty_key_event.m"

static size_t split_zoom_count = 0;
static size_t fullscreen_count = 0;

static void require(bool condition, const char *message) {
  if (condition) return;
  fprintf(stderr, "%s\n", message);
  exit(1);
}

static void wakeup(void *userdata) { (void)userdata; }

static bool action(ghostty_app_t app, ghostty_target_s target,
                   ghostty_action_s value) {
  (void)app;
  (void)target;
  if (value.tag == GHOSTTY_ACTION_TOGGLE_SPLIT_ZOOM) split_zoom_count++;
  if (value.tag == GHOSTTY_ACTION_TOGGLE_FULLSCREEN) fullscreen_count++;
  return true;
}

static bool read_clipboard(void *userdata, ghostty_clipboard_e clipboard,
                           void *state) {
  (void)userdata;
  (void)clipboard;
  (void)state;
  return false;
}

static void confirm_clipboard(void *userdata, const char *value, void *state,
                              ghostty_clipboard_request_e request) {
  (void)userdata;
  (void)value;
  (void)state;
  (void)request;
}

static void write_clipboard(void *userdata, ghostty_clipboard_e clipboard,
                            const ghostty_clipboard_content_s *content,
                            size_t count, bool confirm) {
  (void)userdata;
  (void)clipboard;
  (void)content;
  (void)count;
  (void)confirm;
}

// The child runs inside Ghostty's actual PTY and records unmodified bytes.
static int capture_input(const char *directory) {
  struct termios settings;
  if (tcgetattr(STDIN_FILENO, &settings) != 0) return 2;
  cfmakeraw(&settings);
  if (tcsetattr(STDIN_FILENO, TCSANOW, &settings) != 0) return 2;
  char path[4096];
  snprintf(path, sizeof(path), "%s/bytes", directory);
  int output = open(path, O_WRONLY | O_CREAT | O_TRUNC, 0600);
  if (output < 0) return 2;
  snprintf(path, sizeof(path), "%s/ready", directory);
  int ready = open(path, O_WRONLY | O_CREAT, 0600);
  if (ready < 0) return 2;
  close(ready);
  unsigned char byte;
  while (read(STDIN_FILENO, &byte, 1) == 1)
    if (write(output, &byte, 1) != 1) return 2;
  close(output);
  return 0;
}

static void tick(ghostty_app_t app) {
  ghostty_app_tick(app);
  [[NSRunLoop currentRunLoop]
      runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
}

static void wait_for_ready(ghostty_app_t app, const char *directory) {
  char path[4096];
  snprintf(path, sizeof(path), "%s/ready", directory);
  for (int attempt = 0; attempt < 500; attempt++) {
    if (access(path, F_OK) == 0) return;
    tick(app);
  }
  require(false, "the raw PTY capture child did not start");
}

static void expect_bytes(ghostty_app_t app, const char *directory,
                         const char *expected, size_t length) {
  char path[4096];
  snprintf(path, sizeof(path), "%s/bytes", directory);
  unsigned char actual[64];
  size_t count = 0;
  for (int attempt = 0; attempt < 500; attempt++) {
    FILE *input = fopen(path, "rb");
    if (input != NULL) {
      count = fread(actual, 1, sizeof(actual), input);
      fclose(input);
    }
    if (count >= length) break;
    tick(app);
  }
  if (count != length || memcmp(actual, expected, length) != 0) {
    fprintf(stderr, "PTY bytes:");
    for (size_t index = 0; index < count; index++)
      fprintf(stderr, " %02x", actual[index]);
    fprintf(stderr, " (expected %zu bytes)\n", length);
    exit(1);
  }
}

static ghostty_input_key_s enter_key(NSEventModifierFlags modifiers) {
  NSEvent *event = [NSEvent keyEventWithType:NSEventTypeKeyDown
                                  location:NSZeroPoint
                             modifierFlags:modifiers
                                 timestamp:0
                              windowNumber:0
                                   context:nil
                                characters:@"\r"
               charactersIgnoringModifiers:@"\r"
                                 isARepeat:NO
                                   keyCode:0x24];
  return muxed_ghostty_key_event(event, GHOSTTY_ACTION_PRESS);
}

int main(int argc, char **argv) {
  if (argc == 3 && strcmp(argv[1], "--capture") == 0)
    return capture_input(argv[2]);
  require(argc == 3, "usage: test <ghostty.conf> <capture-directory>");
  @autoreleasepool {
    [NSApplication sharedApplication];
    char *arguments[] = {"ticketry-shift-enter-test", NULL};
    require(ghostty_init(1, arguments) == GHOSTTY_SUCCESS,
            "pinned Ghostty initialization failed");
    ghostty_config_t config = ghostty_config_new();
    ghostty_config_load_file(config, argv[1]);
    ghostty_config_finalize(config);
    require(ghostty_config_diagnostics_count(config) == 0,
            "Ticketry Ghostty configuration has diagnostics");
    ghostty_runtime_config_s runtime = {
        .wakeup_cb = wakeup, .action_cb = action,
        .read_clipboard_cb = read_clipboard,
        .confirm_read_clipboard_cb = confirm_clipboard,
        .write_clipboard_cb = write_clipboard};
    ghostty_app_t app = ghostty_app_new(&runtime, config);
    require(app != NULL, "pinned Ghostty app creation failed");
    // AppKit backing is required by libghostty; the window is never displayed.
    NSWindow *window = [[NSWindow alloc]
        initWithContentRect:NSMakeRect(0, 0, 200, 100)
                  styleMask:NSWindowStyleMaskBorderless
                    backing:NSBackingStoreBuffered defer:NO];
    NSView *view = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 200, 100)];
    view.wantsLayer = YES;
    window.contentView = view;
    char command[8192];
    snprintf(command, sizeof(command), "'%s' --capture '%s'", argv[0], argv[2]);
    ghostty_surface_config_s surface_config = ghostty_surface_config_new();
    surface_config.platform_tag = GHOSTTY_PLATFORM_MACOS;
    surface_config.platform.macos.nsview = view;
    surface_config.scale_factor = 1;
    surface_config.command = command;
    ghostty_surface_t surface = ghostty_surface_new(app, &surface_config);
    require(surface != NULL, "pinned Ghostty surface creation failed");
    wait_for_ready(app, argv[2]);

    ghostty_input_key_s shifted = enter_key(NSEventModifierFlagShift);
    require(shifted.mods == GHOSTTY_MODS_SHIFT &&
                shifted.consumed_mods == GHOSTTY_MODS_SHIFT &&
                shifted.text == NULL,
            "production Shift+Enter translation changed");
    require(ghostty_surface_key_is_binding(surface, shifted, NULL),
            "Shift+Enter did not match the bundled binding");
    ghostty_surface_key(surface, shifted);
    expect_bytes(app, argv[2], "\x1b\r", 2);

    ghostty_input_key_s plain = enter_key(0);
    require(!ghostty_surface_key_is_binding(surface, plain, NULL),
            "plain Enter unexpectedly matched a binding");
    ghostty_surface_key(surface, plain);
    expect_bytes(app, argv[2], "\x1b\r\r", 3);

    require(!ghostty_surface_key_is_binding(surface,
                enter_key(NSEventModifierFlagControl), NULL) &&
            !ghostty_surface_key_is_binding(surface,
                enter_key(NSEventModifierFlagOption), NULL) &&
            !ghostty_surface_key_is_binding(surface,
                enter_key(NSEventModifierFlagShift | NSEventModifierFlagControl), NULL) &&
            !ghostty_surface_key_is_binding(surface,
                enter_key(NSEventModifierFlagShift | NSEventModifierFlagOption), NULL),
            "Ctrl/Alt+Enter was captured by the Shift+Enter binding");
    ghostty_surface_key(surface, enter_key(NSEventModifierFlagCommand |
                                           NSEventModifierFlagShift));
    require(split_zoom_count == 1,
            "Cmd+Shift+Enter lost Ghostty's existing split zoom binding");
    ghostty_surface_key(surface, enter_key(NSEventModifierFlagCommand));
    require(fullscreen_count == 1,
            "Cmd+Enter lost Ghostty's existing fullscreen binding");
    // Allow asynchronous IO to expose accidental output from the Cmd binding.
    for (int attempt = 0; attempt < 10; attempt++) tick(app);
    expect_bytes(app, argv[2], "\x1b\r\r", 3);
    ghostty_surface_free(surface);
    ghostty_app_free(app);
    ghostty_config_free(config);
    puts("native Shift+Enter: ESC CR; Enter: CR; Ctrl/Alt/Cmd bindings preserved");
  }
  return 0;
}
