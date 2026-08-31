#import <AppKit/AppKit.h>
#import <dispatch/dispatch.h>
#import <ghostty.h>
#import <stdbool.h>
#import <stdio.h>
#import <stdlib.h>
#import <string.h>

#include "../libghostty_surface_owner.m"

static size_t completion_count = 0;
static ghostty_surface_t completed_surface = NULL;
static void *completed_state = NULL;
static bool completed_confirmed = false;
static char completed_value[128] = {0};

void ghostty_surface_complete_clipboard_request(ghostty_surface_t surface,
                                                const char *value, void *state,
                                                bool confirmed) {
  completion_count++;
  completed_surface = surface;
  completed_state = state;
  completed_confirmed = confirmed;
  snprintf(completed_value, sizeof(completed_value), "%s",
           value == NULL ? "" : value);
}

#include "../libghostty_clipboard.m"

@interface MuxedTestPasteboard : NSObject {
 @private
  NSString *_value;
}
@end

@implementation MuxedTestPasteboard

- (NSString *)stringForType:(NSPasteboardType)type {
  return [type isEqualToString:NSPasteboardTypeString] ? _value : nil;
}

- (NSInteger)clearContents {
  [_value release];
  _value = nil;
  return 1;
}

- (BOOL)setString:(NSString *)string forType:(NSPasteboardType)type {
  if (![type isEqualToString:NSPasteboardTypeString]) return NO;
  [_value release];
  _value = [string copy];
  return YES;
}

- (void)dealloc {
  [_value release];
  [super dealloc];
}

@end

static void require(bool condition, const char *message) {
  if (condition) return;
  fprintf(stderr, "%s\n", message);
  exit(1);
}

int main(void) {
  @autoreleasepool {
    int surface_storage = 0;
    int state_storage = 0;
    ghostty_surface_t surface = (ghostty_surface_t)&surface_storage;
    muxed_ghostty_surface_owner_s owner = {0};
    muxed_ghostty_surface_owner_init(&owner, NULL);
    muxed_ghostty_surface_owner_activate(&owner, surface);
    require(muxed_ghostty_owned_viewer(&owner) == NULL,
            "the test owner unexpectedly retained a viewer");

    NSPasteboard *pasteboard = (NSPasteboard *)[MuxedTestPasteboard new];
    [pasteboard clearContents];
    require([pasteboard setString:@"paste me" forType:NSPasteboardTypeString],
            "text could not be placed on the test pasteboard");
    require([[pasteboard stringForType:NSPasteboardTypeString]
                isEqualToString:@"paste me"],
            "text could not be read back from the test pasteboard");

    require(muxed_ghostty_read_pasteboard(&owner, pasteboard, &state_storage),
            "an owned surface could not read text from the pasteboard");
    require(completion_count == 1 && completed_surface == surface &&
                completed_state == &state_storage && !completed_confirmed &&
                strcmp(completed_value, "paste me") == 0,
            "the clipboard completion did not preserve Ghostty's request");

    ghostty_clipboard_content_s content[] = {
        {.mime = "application/json", .data = "ignored"},
        {.mime = "text/plain", .data = "copy me"},
    };
    require(muxed_ghostty_write_pasteboard(pasteboard, content, 2),
            "plain text was not written to the pasteboard");
    require([[pasteboard stringForType:NSPasteboardTypeString]
                isEqualToString:@"copy me"],
            "the wrong clipboard MIME entry was written");
    require(!runtime_read_clipboard(&owner, GHOSTTY_CLIPBOARD_SELECTION,
                                    &state_storage),
            "the unsupported selection clipboard was read");
    runtime_write_clipboard(&owner, GHOSTTY_CLIPBOARD_SELECTION, content, 2,
                            false);

    muxed_ghostty_surface_owner_invalidate(&owner);
    runtime_confirm_clipboard(&owner, NULL, &state_storage,
                              GHOSTTY_CLIPBOARD_REQUEST_PASTE);
    require(!muxed_ghostty_read_pasteboard(&owner, pasteboard, &state_storage),
            "an invalidated surface read the clipboard");
    require(completion_count == 1,
            "an invalidated surface completed a clipboard request");

    [pasteboard release];
  }
  return 0;
}
