#import <AppKit/AppKit.h>
#import <ghostty.h>
#import <stdbool.h>
#import <stdio.h>
#import <stdlib.h>
#import <string.h>

static char last_preedit[64];
static uintptr_t last_preedit_length = 0;
static size_t preedit_count = 0;
static char last_text[64];
static uintptr_t last_text_length = 0;
static size_t text_count = 0;
static double ime_x = 0;
static double ime_y = 0;
static double ime_width = 0;
static double ime_height = 0;

void ghostty_surface_preedit(ghostty_surface_t surface, const char *text,
                             uintptr_t length) {
  (void)surface;
  preedit_count++;
  last_preedit_length = length;
  memcpy(last_preedit, text, length);
  last_preedit[length] = '\0';
}

void ghostty_surface_text(ghostty_surface_t surface, const char *text,
                          uintptr_t length) {
  (void)surface;
  text_count++;
  last_text_length = length;
  memcpy(last_text, text, length);
  last_text[length] = '\0';
}

void ghostty_surface_ime_point(ghostty_surface_t surface, double *x, double *y,
                               double *width, double *height) {
  (void)surface;
  *x = ime_x;
  *y = ime_y;
  *width = ime_width;
  *height = ime_height;
}

@interface MuxedGhosttyView : NSView {
 @public
  ghostty_surface_t _surface;
  BOOL _acceptsInput;
  NSMutableAttributedString *_markedText;
  NSRange _markedSelectedRange;
  NSMutableArray<NSString *> *_keyTextAccumulator;
}
@end

@implementation MuxedGhosttyView
@end

#include "../libghostty_text_input.m"

static void require(bool condition, const char *message) {
  if (condition) return;
  fprintf(stderr, "%s\n", message);
  exit(1);
}

static void reset_calls(void) {
  last_preedit[0] = '\0';
  last_preedit_length = 0;
  preedit_count = 0;
  last_text[0] = '\0';
  last_text_length = 0;
  text_count = 0;
}

int main(void) {
  @autoreleasepool {
    int surface_storage = 0;
    MuxedGhosttyView *view = [[MuxedGhosttyView alloc]
        initWithFrame:NSMakeRect(0, 0, 400, 240)];
    view->_surface = (ghostty_surface_t)&surface_storage;
    view->_acceptsInput = YES;

    [view setMarkedText:@"かな"
          selectedRange:NSMakeRange(2, 0)
        replacementRange:NSMakeRange(NSNotFound, 0)];
    require(preedit_count == 1 && strcmp(last_preedit, "かな") == 0,
            "marked text did not reach Ghostty preedit");
    require(last_preedit_length == 6,
            "preedit length was not measured in UTF-8 bytes");
    require([view hasMarkedText] && NSEqualRanges([view markedRange], NSMakeRange(0, 2)),
            "marked text state was not retained");

    NSAttributedString *commit =
        [[NSAttributedString alloc] initWithString:@"é猫"];
    [view insertText:commit replacementRange:NSMakeRange(NSNotFound, 0)];
    require(preedit_count == 2 && last_preedit_length == 0,
            "committing text did not clear Ghostty preedit");
    require(text_count == 1 && strcmp(last_text, "é猫") == 0,
            "committed text did not reach Ghostty");
    require(last_text_length == 5,
            "committed text length was not measured in UTF-8 bytes");
    require(![view hasMarkedText], "commit did not clear marked text state");
    [commit release];

    NSAttributedString *draft =
        [[NSAttributedString alloc] initWithString:@"draft"];
    [view setMarkedText:draft
          selectedRange:NSMakeRange(5, 0)
        replacementRange:NSMakeRange(NSNotFound, 0)];
    [draft release];
    [view unmarkText];
    require(last_preedit_length == 0 && ![view hasMarkedText],
            "cancelling composition did not clear preedit");

    NSWindow *window = [[NSWindow alloc]
        initWithContentRect:NSMakeRect(100, 200, 500, 400)
                  styleMask:NSWindowStyleMaskBorderless
                    backing:NSBackingStoreBuffered
                      defer:NO];
    [window.contentView addSubview:view];
    view.frame = NSMakeRect(20, 30, 400, 240);
    ime_x = 12;
    ime_y = 20;
    ime_width = 3;
    ime_height = 18;
    NSRange actual_range = NSMakeRange(NSNotFound, 0);
    NSRect candidate = [view firstRectForCharacterRange:NSMakeRange(0, 0)
                                           actualRange:&actual_range];
    NSRect expected_local = NSMakeRect(12, 220, 3, 18);
    NSRect expected = [window convertRectToScreen:
        [view convertRect:expected_local toView:nil]];
    require(NSEqualRects(candidate, expected),
            "candidate rectangle was not converted to screen coordinates");
    require(NSEqualRanges(actual_range, NSMakeRange(NSNotFound, 0)),
            "candidate rectangle reported an unsupported character range");

    reset_calls();
    view->_acceptsInput = NO;
    [view setMarkedText:@"blocked"
          selectedRange:NSMakeRange(7, 0)
        replacementRange:NSMakeRange(NSNotFound, 0)];
    [view insertText:@"blocked" replacementRange:NSMakeRange(NSNotFound, 0)];
    [view unmarkText];
    require(preedit_count == 0 && text_count == 0 && ![view hasMarkedText],
            "disabled input reached Ghostty or retained composition state");

    [view release];
    [window release];
  }
  return 0;
}
