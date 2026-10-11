#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>
#import <objc/runtime.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <termios.h>
#include <unistd.h>
#include "../libghostty_host.m"

static void require(bool condition, const char *message) {
  if (condition) return;
  fprintf(stderr, "%s\n", message);
  exit(1);
}
#include "libghostty_pty_capture.h"

static NSEvent *enter_event(NSEventModifierFlags modifiers) {
  return [NSEvent keyEventWithType:NSEventTypeKeyDown location:NSZeroPoint
                   modifierFlags:modifiers timestamp:0 windowNumber:0
                         context:nil characters:@"\r"
      charactersIgnoringModifiers:@"\r" isARepeat:NO keyCode:0x24];
}

int main(int argc, char **argv) {
  if (argc == 3 && strcmp(argv[1], "--capture") == 0)
    return capture_input(argv[2]);
  require(argc == 3, "usage: test <ghostty.conf> <capture-directory>");
  @autoreleasepool {
    [NSApplication sharedApplication];
    char *arguments[] = {"ticketry-ime-input-test", NULL};
    require(ghostty_init(1, arguments) == GHOSTTY_SUCCESS,
            "pinned Ghostty initialization failed");
    ghostty_config_t config = ghostty_config_new();
    ghostty_config_load_file(config, argv[1]);
    ghostty_config_finalize(config);
    require(ghostty_config_diagnostics_count(config) == 0,
            "Ticketry Ghostty configuration has diagnostics");
    ghostty_runtime_config_s callbacks = {
        .wakeup_cb = runtime_wakeup, .action_cb = runtime_action,
        .read_clipboard_cb = runtime_read_clipboard,
        .confirm_read_clipboard_cb = runtime_confirm_clipboard,
        .write_clipboard_cb = runtime_write_clipboard};
    MuxedGhosttyRuntime runtime = {.config = config};
    callbacks.userdata = &runtime;
    runtime.app = ghostty_app_new(&callbacks, config);
    require(runtime.app != NULL, "pinned Ghostty app creation failed");
    NSWindow *window = [[NSWindow alloc]
        initWithContentRect:NSMakeRect(0, 0, 400, 200)
                  styleMask:NSWindowStyleMaskBorderless
                    backing:NSBackingStoreBuffered defer:NO];
    WKWebView *webview = [[WKWebView alloc] initWithFrame:window.contentView.bounds];
    [window.contentView addSubview:webview];
    char command[8192];
    snprintf(command, sizeof(command), "'%s' --capture '%s'", argv[0], argv[2]);
    MuxedGhosttyView *view = [[MuxedGhosttyView alloc]
        initWithRuntime:&runtime parent:webview command:command
        processExitCallback:NULL processExitContext:NULL];
    require(view != nil, "production Ghostty view creation failed");
    view.frame = window.contentView.bounds;
    view.hidden = NO;
    view->_acceptsInput = YES;
    [window makeFirstResponder:view];
    wait_for_ready(runtime.app, argv[2]);

    // On the old host this selector is absent; exercising its keyDown still
    // reproduces the concrete ESC CR leak instead of failing at compilation.
    SEL mark = @selector(setMarkedText:selectedRange:replacementRange:);
    if ([view respondsToSelector:mark])
      [(id<NSTextInputClient>)view setMarkedText:@"かな"
            selectedRange:NSMakeRange(2, 0)
          replacementRange:NSMakeRange(NSNotFound, 0)];
    [view keyDown:enter_event(NSEventModifierFlagShift)];
    for (int attempt = 0; attempt < 20; attempt++) tick(runtime.app);
    expect_bytes(runtime.app, argv[2], "", 0);
    require([view respondsToSelector:mark],
            "production host is missing NSTextInputClient composition");
    [(id<NSTextInputClient>)view unmarkText];

    ghostty_surface_free(view->_surface);
    view->_surface = NULL;
    [view release];
    [webview release];
    [window release];
    ghostty_app_free(runtime.app);
    ghostty_config_free(config);
    puts("native production host IME: no ESC CR during marked input");
  }
  return 0;
}
