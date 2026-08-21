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

static Completion completions[8];
static size_t completion_count = 0;

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

int main(void) {
  @autoreleasepool {
    int surface_storage[2] = {0};
    int state_storage[2] = {0};
    ghostty_surface_t first_surface = (ghostty_surface_t)&surface_storage[0];
    ghostty_surface_t second_surface = (ghostty_surface_t)&surface_storage[1];
    void *first_state = &state_storage[0];
    void *second_state = &state_storage[1];
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
    NSString *values[] = {@"one line", @"first\nsecond", @"snowman ☃", @""};
    const char *expected[] = {"one line", "first\nsecond", "snowman ☃", ""};

    for (size_t index = 0; index < 4; index++) {
      size_t before = completion_count;
      require(muxed_ghostty_complete_clipboard_text(
                  &first_owner, first_state, values[index], record_completion),
              "text clipboard value was declined");
      require(completion_count == before + 1,
              "text clipboard value did not complete exactly once");
      require(strcmp(completions[before].value, expected[index]) == 0,
              "text clipboard value changed during completion");
      require(completions[before].surface == first_surface &&
                  completions[before].state == first_state,
              "completion lost its requesting surface or state");
      require(!completions[before].confirmed,
              "standard paste was marked as pre-confirmed");
    }

    size_t before_confirmation = completion_count;
    runtime_confirm_clipboard(&first_owner, "first\nsecond", first_state,
                              GHOSTTY_CLIPBOARD_REQUEST_PASTE);
    require(completion_count == before_confirmation + 1,
            "protected paste did not complete exactly once");
    Completion confirmed = completions[before_confirmation];
    require(confirmed.surface == first_surface &&
                confirmed.state == first_state,
            "confirmation lost its requesting surface or state");
    require(confirmed.confirmed,
            "protected paste was not marked as confirmed");

    size_t before_osc_52 = completion_count;
    require(!muxed_ghostty_confirm_clipboard_text(
                &first_owner, first_state, "terminal request",
                GHOSTTY_CLIPBOARD_REQUEST_OSC_52_READ, record_completion),
            "OSC 52 clipboard read was approved");
    require(completion_count == before_osc_52,
            "OSC 52 clipboard read produced a completion");

    size_t before_unsupported = completion_count;
    require(!muxed_ghostty_complete_clipboard_text(
                &first_owner, first_state, nil, record_completion),
            "non-text clipboard content was accepted");
    require(completion_count == before_unsupported,
            "non-text clipboard content produced a completion");

    size_t before_second_surface = completion_count;
    require(muxed_ghostty_complete_clipboard_text(
                &second_owner, second_state, @"second surface",
                record_completion),
            "second surface clipboard value was declined");
    require(completion_count == before_second_surface + 1,
            "second surface clipboard value did not complete exactly once");
    Completion second = completions[before_second_surface];
    require(second.surface == second_surface && second.state == second_state,
            "second request completed against the first surface or state");
    require(strcmp(second.value, "second surface") == 0,
            "second surface clipboard value changed during completion");

    size_t before_unavailable = completion_count;
    muxed_ghostty_surface_owner_invalidate(&first_owner);
    require(!muxed_ghostty_complete_clipboard_text(
                &first_owner, first_state, @"unavailable", record_completion),
            "an unavailable surface accepted clipboard text");
    require(completion_count == before_unavailable,
            "an unavailable surface produced a completion");
    require(muxed_ghostty_owned_viewer(&first_owner) == NULL,
            "an unavailable surface retained its viewer");
    require(muxed_ghostty_owned_surface(&second_owner) == second_surface,
            "invalidating one owner affected a different surface");
  }

  return 0;
}
