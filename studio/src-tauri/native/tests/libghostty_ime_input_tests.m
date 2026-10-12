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

// Deterministic AppKit input-context substitution: each step names what the
// input method does with the next key, then the production keyDown runs.
typedef enum {
  IME_PASS,     // ordinary key: AppKit requests insertNewline:
  IME_CONSUME,  // the input method swallows the key without text
  IME_COMMIT,   // the key commits composed text
  IME_CANCEL,   // the key cancels composition
  IME_MARK,     // the key starts composition
} ImeBehavior;

static ImeBehavior ime_behavior = IME_PASS;
static unsigned ime_events = 0;

@interface ImeTestInputContext : NSTextInputContext
@end

@implementation ImeTestInputContext
- (BOOL)handleEvent:(NSEvent *)event {
  (void)event;
  ime_events++;
  id<NSTextInputClient> client = (id<NSTextInputClient>)self.client;
  switch (ime_behavior) {
    case IME_PASS:
      [client doCommandBySelector:@selector(insertNewline:)];
      break;
    case IME_CONSUME:
      break;
    case IME_COMMIT:
      [client insertText:@"かな" replacementRange:NSMakeRange(NSNotFound, 0)];
      break;
    case IME_CANCEL:
      [client unmarkText];
      break;
    case IME_MARK:
      [client setMarkedText:@"か" selectedRange:NSMakeRange(1, 0)
           replacementRange:NSMakeRange(NSNotFound, 0)];
      break;
  }
  return YES;
}
@end

@interface ImeTestView : MuxedGhosttyView {
 @public
  ImeTestInputContext *_testInputContext;
}
@end

@implementation ImeTestView
- (NSTextInputContext *)inputContext {
  return _testInputContext;
}
@end

static void press(MuxedGhosttyView *view, ghostty_app_t app,
                  ImeBehavior behavior, NSEventModifierFlags modifiers) {
  ime_behavior = behavior;
  [view keyDown:enter_event(modifiers)];
  for (int attempt = 0; attempt < 20; attempt++) tick(app);
}

static void mark(MuxedGhosttyView *view) {
  [(id<NSTextInputClient>)view setMarkedText:@"かな"
        selectedRange:NSMakeRange(2, 0)
      replacementRange:NSMakeRange(NSNotFound, 0)];
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
    ImeTestView *view = [[ImeTestView alloc]
        initWithRuntime:&runtime parent:webview command:command
        processExitCallback:NULL processExitContext:NULL];
    require(view != nil, "production Ghostty view creation failed");
    view->_testInputContext = [[ImeTestInputContext alloc] initWithClient:view];
    view.frame = window.contentView.bounds;
    view.hidden = NO;
    view->_acceptsInput = YES;
    [window makeFirstResponder:view];
    wait_for_ready(runtime.app, argv[2]);

    // Marked/consumed input: Shift+Enter must never reach the ESC CR binding,
    // even when the key commits or cancels composition.
    mark(view);
    press(view, runtime.app, IME_CONSUME, NSEventModifierFlagShift);
    expect_bytes(runtime.app, argv[2], "", 0);
    require([view hasMarkedText], "consumed key dropped marked text");
    press(view, runtime.app, IME_CANCEL, NSEventModifierFlagShift);
    expect_bytes(runtime.app, argv[2], "", 0);
    press(view, runtime.app, IME_MARK, NSEventModifierFlagShift);
    expect_bytes(runtime.app, argv[2], "", 0);
    require([view hasMarkedText], "composition-starting key lost marked text");
    press(view, runtime.app, IME_COMMIT, NSEventModifierFlagShift);
    expect_bytes(runtime.app, argv[2], "\xe3\x81\x8b\xe3\x81\xaa", 6);
    require(![view hasMarkedText], "committed composition kept marked text");
    press(view, runtime.app, IME_CONSUME, NSEventModifierFlagShift);
    expect_bytes(runtime.app, argv[2], "\xe3\x81\x8b\xe3\x81\xaa", 6);
    // During composition the input method keeps first refusal over Ctrl.
    mark(view);
    unsigned before = ime_events;
    press(view, runtime.app, IME_CONSUME, NSEventModifierFlagControl);
    require(ime_events == before + 1, "marked Ctrl key bypassed the input method");
    expect_bytes(runtime.app, argv[2], "\xe3\x81\x8b\xe3\x81\xaa", 6);
    [(id<NSTextInputClient>)view unmarkText];

    // Ordinary keys keep Ghostty's translation and the bundled binding.
    press(view, runtime.app, IME_PASS, NSEventModifierFlagShift);
    expect_bytes(runtime.app, argv[2], "\xe3\x81\x8b\xe3\x81\xaa\x1b\r", 8);
    press(view, runtime.app, IME_PASS, 0);
    expect_bytes(runtime.app, argv[2],
                 "\xe3\x81\x8b\xe3\x81\xaa\x1b\r\r", 9);

    // Ctrl+Enter keeps Ghostty's CSI 27;5;13~, Cmd+Enter stays on Ghostty's
    // fullscreen binding (no PTY bytes) and Alt+Enter keeps ESC CR.
    before = ime_events;
    press(view, runtime.app, IME_CONSUME, NSEventModifierFlagControl);
    press(view, runtime.app, IME_CONSUME, NSEventModifierFlagCommand);
    require(ime_events == before,
            "unmarked Ctrl/Cmd keys were offered to the input method");
    press(view, runtime.app, IME_PASS, NSEventModifierFlagOption);
    require(ime_events == before + 1, "Alt key skipped the input method");
    expect_bytes(runtime.app, argv[2],
                 "\xe3\x81\x8b\xe3\x81\xaa\x1b\r\r"
                 "\x1b[27;5;13~\x1b\r", 21);

    ghostty_surface_free(view->_surface);
    view->_surface = NULL;
    [view->_testInputContext release];
    [view release];
    [webview release];
    [window release];
    ghostty_app_free(runtime.app);
    ghostty_config_free(config);
    puts("native production host IME: no ESC CR during marked/consumed input; "
         "normal Shift+Enter/Enter and Ctrl/Alt/Cmd preserved; "
         "UTF-8 committed once");
  }
  return 0;
}
