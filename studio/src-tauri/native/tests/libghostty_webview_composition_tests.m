#import <AppKit/AppKit.h>
#import <dispatch/dispatch.h>
#import "../../vendor/libghostty/include/ghostty.h"
#import <math.h>
#import <stdbool.h>
#import <stdatomic.h>
#import <stdio.h>
#import <stdlib.h>
#import <string.h>
#import <time.h>
#import <unistd.h>

#include "../libghostty_host.h"

_Static_assert(__builtin_types_compatible_p(
                   __typeof__(muxed_ghostty_view_present), bool(void *)),
               "presentation must report AppKit ordering failure");
_Static_assert(__builtin_types_compatible_p(
                   __typeof__(muxed_ghostty_view_set_webview_interaction),
                   bool(void *, bool)),
               "ownership changes must report AppKit ordering failure");

static NSColor *muxed_ghostty_background_color(void) {
  return [NSColor colorWithSRGBRed:17.0 / 255.0
                            green:19.0 / 255.0
                             blue:23.0 / 255.0
                            alpha:1.0];
}

#include "../libghostty_webview_composition.m"

typedef struct {
  ghostty_app_t app;
  ghostty_config_t config;
} MuxedGhosttyRuntime;

#include "../libghostty_surface_owner.m"

static size_t mouse_position_count = 0;
static size_t mouse_button_count = 0;
static size_t key_press_count = 0;
static char last_key_text[16] = {0};
static bool mouse_captured = false;
static size_t ghostty_scroll_count = 0;
static double ghostty_scroll_x = 0;
static double ghostty_scroll_y = 0;
static ghostty_input_scroll_mods_t ghostty_scroll_mods = 0;
static size_t tmux_scroll_count = 0;
static uint8_t tmux_scroll_direction = MUXED_GHOSTTY_SCROLL_NONE;
static uint16_t tmux_scroll_lines = 0;

static ghostty_input_mods_e ghostty_mods(NSEventModifierFlags flags) {
  (void)flags;
  return GHOSTTY_MODS_NONE;
}

static ghostty_input_key_s muxed_ghostty_key_event(NSEvent *event,
                                                    ghostty_input_action_e action) {
  ghostty_input_key_s key = {0};
  key.action = action;
  key.text = event.characters.UTF8String;
  return key;
}

static void muxed_focus_trace(NSView *view, const char *event, BOOL accepts) {
  (void)view;
  (void)event;
  (void)accepts;
}

static void muxed_focus_trace_settled(NSView *view, const char *event) {
  (void)view;
  (void)event;
}

static bool muxed_focus_trace_enabled(void) { return false; }

uint8_t muxed_ghostty_studio_chord(uint64_t modifiers, uint16_t key_code) {
  (void)modifiers;
  (void)key_code;
  return MUXED_GHOSTTY_CHORD_NONE;
}

ghostty_surface_config_s ghostty_surface_config_new(void) {
  return (ghostty_surface_config_s){0};
}
ghostty_surface_t ghostty_surface_new(ghostty_app_t app,
                                     const ghostty_surface_config_s *config) {
  (void)app;
  (void)config;
  return NULL;
}
void ghostty_surface_free(ghostty_surface_t surface) { (void)surface; }
void ghostty_surface_draw(ghostty_surface_t surface) { (void)surface; }
void *ghostty_surface_userdata(ghostty_surface_t surface) {
  (void)surface;
  return NULL;
}
void ghostty_surface_set_content_scale(ghostty_surface_t surface, double x,
                                       double y) {
  (void)surface;
  (void)x;
  (void)y;
}
void ghostty_surface_set_focus(ghostty_surface_t surface, bool focused) {
  (void)surface;
  (void)focused;
}
void ghostty_surface_set_size(ghostty_surface_t surface, uint32_t width,
                              uint32_t height) {
  (void)surface;
  (void)width;
  (void)height;
}
ghostty_surface_size_s ghostty_surface_size(ghostty_surface_t surface) {
  (void)surface;
  return (ghostty_surface_size_s){.columns = 80, .rows = 24};
}
bool ghostty_surface_key(ghostty_surface_t surface, ghostty_input_key_s key) {
  (void)surface;
  key_press_count++;
  if (key.text != NULL) {
    strncpy(last_key_text, key.text, sizeof(last_key_text) - 1);
    last_key_text[sizeof(last_key_text) - 1] = '\0';
  }
  return true;
}
void ghostty_surface_text(ghostty_surface_t surface, const char *text,
                          uintptr_t length) {
  (void)surface;
  (void)text;
  (void)length;
}
void ghostty_surface_preedit(ghostty_surface_t surface, const char *text,
                             uintptr_t length) {
  (void)surface;
  (void)text;
  (void)length;
}
void ghostty_surface_ime_point(ghostty_surface_t surface, double *x, double *y,
                               double *width, double *height) {
  (void)surface;
  *x = 0;
  *y = 0;
  *width = 0;
  *height = 0;
}
void ghostty_surface_mouse_pos(ghostty_surface_t surface, double x, double y,
                               ghostty_input_mods_e mods) {
  (void)surface;
  (void)x;
  (void)y;
  (void)mods;
  mouse_position_count++;
}
bool ghostty_surface_mouse_button(ghostty_surface_t surface,
                                  ghostty_input_mouse_state_e state,
                                  ghostty_input_mouse_button_e button,
                                  ghostty_input_mods_e mods) {
  (void)surface;
  (void)state;
  (void)button;
  (void)mods;
  mouse_button_count++;
  return true;
}
bool ghostty_surface_mouse_captured(ghostty_surface_t surface) {
  (void)surface;
  return mouse_captured;
}
void ghostty_surface_mouse_scroll(ghostty_surface_t surface, double x, double y,
                                  ghostty_input_scroll_mods_t mods) {
  (void)surface;
  ghostty_scroll_count++;
  ghostty_scroll_x = x;
  ghostty_scroll_y = y;
  ghostty_scroll_mods = mods;
}

#include "../libghostty_view.m"
#include "../libghostty_view_bridge.m"

@interface MuxedTestWebView : NSView
@property(nonatomic) BOOL disabledBackgroundThroughKvc;
@property(nonatomic, retain) NSColor *underPageBackgroundColor;
@end

@interface MuxedTestScrollEvent : NSEvent {
 @public
  CGFloat _testDeltaX;
  CGFloat _testDeltaY;
  BOOL _testPrecise;
  NSEventPhase _testMomentum;
}
@end

@implementation MuxedTestScrollEvent
- (CGFloat)scrollingDeltaX { return _testDeltaX; }
- (CGFloat)scrollingDeltaY { return _testDeltaY; }
- (BOOL)hasPreciseScrollingDeltas { return _testPrecise; }
- (NSEventPhase)momentumPhase { return _testMomentum; }
@end

@implementation MuxedTestWebView
- (void)setValue:(id)value forKey:(NSString *)key {
  if ([key isEqualToString:@"drawsBackground"]) {
    self.disabledBackgroundThroughKvc = ![value boolValue];
    return;
  }
  [super setValue:value forKey:key];
}
@end

static void require(bool condition, const char *message) {
  if (condition) return;
  fprintf(stderr, "%s\n", message);
  exit(1);
}

static bool is_above(NSView *candidate, NSView *reference) {
  NSArray<NSView *> *siblings = candidate.superview.subviews;
  return [siblings indexOfObjectIdenticalTo:candidate] >
         [siblings indexOfObjectIdenticalTo:reference];
}

static NSEvent *mouse_event(NSEventType type) {
  return [NSEvent mouseEventWithType:type
                            location:NSMakePoint(20, 30)
                       modifierFlags:0
                           timestamp:0
                        windowNumber:0
                             context:nil
                         eventNumber:0
                          clickCount:1
                            pressure:1
                        ];
}

static NSEvent *key_event(NSString *characters) {
  return [NSEvent keyEventWithType:NSEventTypeKeyDown
                          location:NSZeroPoint
                     modifierFlags:0
                         timestamp:0
                      windowNumber:0
                           context:nil
                        characters:characters
       charactersIgnoringModifiers:characters
                          isARepeat:NO
                            keyCode:0];
}

static void send_all_mouse_streams(MuxedGhosttyView *view) {
  NSEvent *left = mouse_event(NSEventTypeLeftMouseDown);
  NSEvent *right = mouse_event(NSEventTypeRightMouseDown);
  NSEvent *middle = mouse_event(NSEventTypeOtherMouseDown);
  [view mouseEntered:left];
  [view mouseMoved:left];
  [view mouseExited:left];
  [view mouseDown:left];
  [view mouseDragged:left];
  [view mouseUp:left];
  [view rightMouseDown:right];
  [view rightMouseDragged:right];
  [view rightMouseUp:right];
  [view otherMouseDown:middle];
  [view otherMouseDragged:middle];
  [view otherMouseUp:middle];
}

static void record_tmux_scroll(void *context, uint8_t direction,
                               uint16_t lines) {
  (void)context;
  tmux_scroll_count++;
  tmux_scroll_direction = direction;
  tmux_scroll_lines = lines;
}

int main(void) {
  @autoreleasepool {
    (void)&muxed_ghostty_owned_surface;
    (void)&runtime_action;
    NSView *content = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 800, 600)];
    MuxedTestWebView *webview =
        [[MuxedTestWebView alloc] initWithFrame:content.bounds];
    NSView *ghostty = [[NSView alloc] initWithFrame:NSMakeRect(8, 10, 784, 580)];
    [content addSubview:webview];

    muxed_ghostty_prepare_transparent_webview(webview);
    require(webview.disabledBackgroundThroughKvc,
            "the WKWebView background was not disabled through KVC");
    require(webview.underPageBackgroundColor == NSColor.clearColor,
            "the WKWebView under-page background is not transparent");
    require(webview.wantsLayer &&
                CGColorGetAlpha(webview.layer.backgroundColor) == 0,
            "the WKWebView layer is not transparent");
    require(content.wantsLayer &&
                CGColorEqualToColor(content.layer.backgroundColor,
                                    muxed_ghostty_background_color().CGColor),
            "the exposed AppKit container does not match the terminal background");

    require(muxed_ghostty_place_sibling(ghostty, webview, true),
            "the initial WebView-owned composition was rejected");
    require(ghostty.superview == content && is_above(webview, ghostty),
            "initial presentation did not keep Ghostty below the WebView");

    NSView *original = ghostty;
    require(muxed_ghostty_place_sibling(ghostty, webview, false),
            "explicit terminal selection was rejected");
    require(ghostty == original && ghostty.superview == content &&
                is_above(ghostty, webview),
            "terminal selection recreated or detached Ghostty instead of raising it");
    require(!ghostty.hidden,
            "terminal selection hid Ghostty instead of keeping the live surface attached");

    require(muxed_ghostty_place_sibling(ghostty, webview, true),
            "WebView ownership could not lower Ghostty");
    require(ghostty == original && is_above(webview, ghostty),
            "WebView ownership did not lower the existing Ghostty view");
    require(!muxed_ghostty_place_sibling(ghostty, nil, true),
            "invalid sibling ordering did not report failure");

    MuxedGhosttyView *input_view = [MuxedGhosttyView new];
    int surface_storage = 0;
    input_view->_surface = (ghostty_surface_t)&surface_storage;
    input_view.frame = NSMakeRect(0, 0, 200, 100);
    input_view->_webview = webview;
    input_view.hidden = YES;
    require(muxed_ghostty_view_present(input_view),
            "the public presentation seam rejected valid sibling ordering");
    require(is_above(input_view, webview) && input_view->_acceptsInput,
            "the public presentation seam did not start above WebKit with input");
    require(!muxed_ghostty_view_is_hidden(input_view) &&
                muxed_ghostty_view_accepts_input(input_view),
            "native benchmark inspection missed an interactive visible view");
    send_all_mouse_streams(input_view);
    require(mouse_position_count >= 5,
            "a presented Ghostty view dropped mouse position or drag input");
    require(mouse_button_count == 6,
            "a presented Ghostty view dropped a supported mouse button stream");
    [input_view keyDown:key_event(@"a")];
    require(key_press_count == 1 && strcmp(last_key_text, "a") == 0,
            "a presented Ghostty view did not route a key press directly");

    muxed_ghostty_view_set_scroll_callback(input_view, record_tmux_scroll, NULL);
    MuxedTestScrollEvent *scroll = [MuxedTestScrollEvent new];
    scroll->_testDeltaX = 1.25;
    scroll->_testDeltaY = 2.5;
    scroll->_testPrecise = YES;
    scroll->_testMomentum = NSEventPhaseChanged;
    mouse_captured = true;
    [input_view scrollWheel:scroll];
    require(ghostty_scroll_count == 1 && ghostty_scroll_x == 2.5 &&
                ghostty_scroll_y == 5.0 && ghostty_scroll_mods == 7,
            "a captured wheel gesture did not reach the hosted program");
    require(tmux_scroll_count == 0,
            "a captured wheel gesture also entered tmux copy mode");

    mouse_captured = false;
    scroll->_testDeltaX = 0;
    scroll->_testDeltaY = 3;
    scroll->_testPrecise = NO;
    scroll->_testMomentum = NSEventPhaseNone;
    [input_view scrollWheel:scroll];
    require(ghostty_scroll_count == 1,
            "an uncaptured wheel gesture was sent to the hosted program");
    require(tmux_scroll_count == 1 &&
                tmux_scroll_direction == MUXED_GHOSTTY_SCROLL_UP &&
                tmux_scroll_lines == 3,
            "an uncaptured wheel gesture did not use durable tmux scrollback");
    [scroll release];

    require(muxed_ghostty_view_set_webview_interaction(input_view, true),
            "the public ownership seam rejected WebView ownership");
    require(is_above(webview, input_view) && !input_view->_acceptsInput,
            "WebView ownership did not lower and disable the existing view");
    size_t lowered_mouse_positions = mouse_position_count;
    size_t lowered_mouse_buttons = mouse_button_count;
    muxed_ghostty_view_hide(input_view);
    require(input_view.hidden && is_above(webview, input_view) &&
                !input_view.acceptsFirstResponder,
            "a hidden retained view was raised or remained input eligible");
    require(muxed_ghostty_view_is_hidden(input_view) &&
                !muxed_ghostty_view_accepts_input(input_view),
            "native benchmark inspection misreported a hidden retained view");
    send_all_mouse_streams(input_view);
    require(mouse_position_count == lowered_mouse_positions &&
                mouse_button_count == lowered_mouse_buttons,
            "a hidden retained view forwarded pointer input");
    input_view->_webview = nil;
    require(!muxed_ghostty_view_set_webview_interaction(input_view, false),
            "the public ownership seam swallowed an ordering failure");
    input_view->_surface = NULL;
    [input_view release];

    [ghostty release];
    [webview release];
    [content release];
  }
  return 0;
}
