#import <AppKit/AppKit.h>
#import <ghostty.h>
#import <stdbool.h>
#import <stdio.h>
#import <string.h>

typedef struct {
  ghostty_surface_t surface;
  void *state;
  char value[256];
  bool confirmed;
} Completion;

static Completion completions[16];
static size_t completion_count = 0;

@interface TestPasteboard : NSObject {
  NSString *_value;
}
- (instancetype)initWithValue:(NSString *)value;
- (NSString *)stringForType:(NSPasteboardType)type;
@end

@implementation TestPasteboard
- (instancetype)initWithValue:(NSString *)value {
  self = [super init];
  if (self != nil) _value = [value copy];
  return self;
}

- (NSString *)stringForType:(NSPasteboardType)type {
  return [type isEqualToString:NSPasteboardTypeString] ? _value : nil;
}

- (void)dealloc {
  [_value release];
  [super dealloc];
}
@end

static void record_completion(ghostty_surface_t surface, const char *value,
                              void *state, bool confirmed) {
  Completion *completion = &completions[completion_count++];
  completion->surface = surface;
  completion->state = state;
  snprintf(completion->value, sizeof(completion->value), "%s", value);
  completion->confirmed = confirmed;
}

void ghostty_surface_complete_clipboard_request(ghostty_surface_t surface,
                                                const char *value, void *state,
                                                bool confirmed) {
  record_completion(surface, value, state, confirmed);
}

#include "../libghostty_clipboard.m"

static void require(bool condition, const char *message) {
  if (condition) return;
  fprintf(stderr, "%s\n", message);
  exit(1);
}

static void require_completion(size_t index, ghostty_surface_t surface,
                               void *state, const char *value,
                               bool confirmed) {
  require(completion_count == index + 1,
          "paste did not complete exactly once");
  Completion completion = completions[index];
  require(completion.surface == surface,
          "paste reached a different retained surface");
  require(completion.state == state, "paste lost its request state");
  require(strcmp(completion.value, value) == 0,
          "multiline paste content changed during completion");
  require(completion.confirmed == confirmed,
          "paste confirmation state was incorrect");
}

static void paste_text(muxed_ghostty_surface_owner_s *owner,
                       ghostty_surface_t surface, void *state,
                       NSString *value) {
  TestPasteboard *pasteboard =
      [[[TestPasteboard alloc] initWithValue:value] autorelease];
  size_t before = completion_count;
  require(muxed_ghostty_read_clipboard(
              owner, GHOSTTY_CLIPBOARD_STANDARD, state,
              (NSPasteboard *)pasteboard, record_completion),
          "standard pasteboard text was declined");
  require_completion(before, surface, state, value.UTF8String, false);
}

static void test_workspace_navigation(void) {
  int surface_storage[2] = {0};
  int state_storage[3] = {0};
  ghostty_surface_t first_surface = (ghostty_surface_t)&surface_storage[0];
  ghostty_surface_t second_surface = (ghostty_surface_t)&surface_storage[1];
  void *first_state = &state_storage[0];
  void *second_state = &state_storage[1];
  void *returned_state = &state_storage[2];
  struct {
    ghostty_app_t app;
    ghostty_config_t config;
  } runtime_userdata = {
      .app = (ghostty_app_t)(uintptr_t)1,
      .config = (ghostty_config_t)(uintptr_t)2,
  };

  size_t before_wrong_userdata = completion_count;
  require(!runtime_read_clipboard(&runtime_userdata,
                                  GHOSTTY_CLIPBOARD_STANDARD, first_state),
          "runtime userdata was accepted as a surface owner");
  require(completion_count == before_wrong_userdata,
          "runtime userdata produced a clipboard completion");

  muxed_ghostty_surface_owner_s first_owner;
  muxed_ghostty_surface_owner_s second_owner;
  muxed_ghostty_surface_owner_init(&first_owner, &surface_storage[0]);
  muxed_ghostty_surface_owner_init(&second_owner, &surface_storage[1]);
  muxed_ghostty_surface_owner_activate(&first_owner, first_surface);
  muxed_ghostty_surface_owner_activate(&second_owner, second_surface);

  paste_text(&first_owner, first_surface, first_state,
             @"first workspace\nline two");
  paste_text(&second_owner, second_surface, second_state,
             @"second workspace\nline two");
  paste_text(&first_owner, first_surface, returned_state,
             @"first workspace\nreturned");

  size_t before_confirmation = completion_count;
  runtime_confirm_clipboard(&first_owner, "first workspace\nreturned",
                            returned_state,
                            GHOSTTY_CLIPBOARD_REQUEST_PASTE);
  require_completion(before_confirmation, first_surface, returned_state,
                     "first workspace\nreturned", true);

  size_t before_unsupported = completion_count;
  TestPasteboard *unsupported = [[[TestPasteboard alloc]
      initWithValue:@"unsupported"] autorelease];
  require(!muxed_ghostty_read_clipboard(
              &first_owner, GHOSTTY_CLIPBOARD_SELECTION, first_state,
              (NSPasteboard *)unsupported, record_completion),
          "a non-standard clipboard request was accepted");
  require(completion_count == before_unsupported,
          "a non-standard clipboard request produced a completion");
  require(muxed_ghostty_owned_viewer(&second_owner) == &surface_storage[1],
          "navigation discarded the retained viewer");
  muxed_ghostty_surface_owner_invalidate(&second_owner);
}

static void test_retained_viewer_teardown(void) {
  int surface_storage[3] = {0};
  int state_storage[3] = {0};
  int viewer_storage[3] = {0};
  ghostty_surface_t retained_surface = (ghostty_surface_t)&surface_storage[0];
  ghostty_surface_t other_surface = (ghostty_surface_t)&surface_storage[1];
  ghostty_surface_t replacement_surface =
      (ghostty_surface_t)&surface_storage[2];
  void *retained_state = &state_storage[0];
  void *other_state = &state_storage[1];
  void *replacement_state = &state_storage[2];

  muxed_ghostty_surface_owner_s retained_owner;
  muxed_ghostty_surface_owner_s other_owner;
  muxed_ghostty_surface_owner_s replacement_owner;
  muxed_ghostty_surface_owner_init(&retained_owner, &viewer_storage[0]);
  muxed_ghostty_surface_owner_init(&other_owner, &viewer_storage[1]);
  muxed_ghostty_surface_owner_activate(&retained_owner, retained_surface);
  muxed_ghostty_surface_owner_activate(&other_owner, other_surface);

  paste_text(&retained_owner, retained_surface, retained_state,
             @"retained viewer\nfirst paste");
  paste_text(&other_owner, other_surface, other_state,
             @"other retained viewer");

  muxed_ghostty_surface_owner_invalidate(&retained_owner);
  size_t before_stale_completion = completion_count;
  require(!muxed_ghostty_complete_clipboard_text(
              &retained_owner, retained_state, @"stale paste",
              record_completion),
          "a replaced viewer accepted stale clipboard text");
  runtime_confirm_clipboard(&retained_owner, "stale confirmation",
                            retained_state,
                            GHOSTTY_CLIPBOARD_REQUEST_PASTE);
  require(completion_count == before_stale_completion,
          "a replaced viewer produced a stale completion");
  require(muxed_ghostty_owned_surface(&retained_owner) == NULL &&
              muxed_ghostty_owned_viewer(&retained_owner) == NULL,
          "a replaced viewer retained clipboard ownership");

  muxed_ghostty_surface_owner_init(&replacement_owner, &viewer_storage[2]);
  muxed_ghostty_surface_owner_activate(&replacement_owner,
                                       replacement_surface);
  paste_text(&replacement_owner, replacement_surface, replacement_state,
             @"replacement viewer\nmultiline paste");
  paste_text(&other_owner, other_surface, other_state,
             @"other viewer\nafter replacement");

  muxed_ghostty_surface_owner_invalidate(&replacement_owner);
  size_t before_disposed_completion = completion_count;
  require(!muxed_ghostty_complete_clipboard_text(
              &replacement_owner, replacement_state, @"disposed paste",
              record_completion),
          "a disposed viewer accepted clipboard text");
  runtime_confirm_clipboard(&replacement_owner, "disposed confirmation",
                            replacement_state,
                            GHOSTTY_CLIPBOARD_REQUEST_PASTE);
  require(completion_count == before_disposed_completion,
          "a disposed viewer produced a stale or duplicate completion");
  require(muxed_ghostty_owned_surface(&other_owner) == other_surface,
          "disposing a replacement affected another retained viewer");
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    const char *test_case = argc > 1 ? argv[1] : "all";
    if (strcmp(test_case, "workspace-navigation") == 0 ||
        strcmp(test_case, "all") == 0) {
      test_workspace_navigation();
      puts("workspace-navigation: ok");
    }
    if (strcmp(test_case, "retained-viewer-teardown") == 0 ||
        strcmp(test_case, "all") == 0) {
      test_retained_viewer_teardown();
      puts("retained-viewer-teardown: ok");
    }
    if (strcmp(test_case, "workspace-navigation") == 0 ||
        strcmp(test_case, "retained-viewer-teardown") == 0 ||
        strcmp(test_case, "all") == 0)
      return 0;
    fprintf(stderr, "unknown native clipboard case: %s\n", test_case);
    return 2;
  }
}
