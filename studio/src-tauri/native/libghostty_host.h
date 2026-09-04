#ifndef MUXED_LIBGHOSTTY_HOST_H
#define MUXED_LIBGHOSTTY_HOST_H

#include <stdbool.h>
#include <stdint.h>

typedef struct {
  uint16_t columns;
  uint16_t rows;
} muxed_ghostty_grid_size_s;

// Scroll bridge intent reported by a wheel or precise trackpad gesture.
// A gesture with no vertical component is not a scroll intent at all.
enum {
  MUXED_GHOSTTY_SCROLL_NONE = 0,
  MUXED_GHOSTTY_SCROLL_UP = 1,
  MUXED_GHOSTTY_SCROLL_DOWN = 2,
};

typedef struct {
  uint8_t direction;
  uint16_t lines;
} muxed_ghostty_scroll_intent_s;

typedef void (*muxed_ghostty_scroll_cb)(void *context, uint8_t direction,
                                       uint16_t lines);
typedef void (*muxed_ghostty_process_exit_cb)(void *context,
                                             uint32_t exit_code);
typedef void (*muxed_ghostty_resize_cb)(void *context, uint16_t columns,
                                       uint16_t rows);
// Studio chords the hosted view keeps from the terminal. While the view is
// first responder the WebView receives no keys at all, so each chord that must
// survive an engaged terminal is recognised here and reported to Studio.
typedef enum {
  MUXED_GHOSTTY_CHORD_NONE = 0,
  // The terminal panel's toggle chord (Ctrl+`).
  MUXED_GHOSTTY_CHORD_PANEL_TOGGLE = 1,
  // The global Settings chord (Cmd+E).
  MUXED_GHOSTTY_CHORD_SETTINGS = 2,
  // Module-position chords (Cmd+1 through Cmd+9, then Cmd+0).
  MUXED_GHOSTTY_CHORD_MODULE_POSITION_1 = 3,
  MUXED_GHOSTTY_CHORD_MODULE_POSITION_2 = 4,
  MUXED_GHOSTTY_CHORD_MODULE_POSITION_3 = 5,
  MUXED_GHOSTTY_CHORD_MODULE_POSITION_4 = 6,
  MUXED_GHOSTTY_CHORD_MODULE_POSITION_5 = 7,
  MUXED_GHOSTTY_CHORD_MODULE_POSITION_6 = 8,
  MUXED_GHOSTTY_CHORD_MODULE_POSITION_7 = 9,
  MUXED_GHOSTTY_CHORD_MODULE_POSITION_8 = 10,
  MUXED_GHOSTTY_CHORD_MODULE_POSITION_9 = 11,
  MUXED_GHOSTTY_CHORD_MODULE_POSITION_10 = 12,
  // The edit-view body disengage chord (Cmd+Escape).
  MUXED_GHOSTTY_CHORD_BODY_DISENGAGE = 13,
} muxed_ghostty_chord_e;

// Reported when the hosted view recognises a Studio chord instead of
// forwarding it to the terminal. The view has already handed the keyboard back
// to the WebView by the time this arrives.
typedef void (*muxed_ghostty_chord_cb)(void *context, uint8_t chord);

// True when the caller is on AppKit's main thread. Preparation waits (which
// depend on the main runloop pumping libghostty ticks) must never be entered
// from there.
bool muxed_ghostty_host_is_main_thread(void);

void *muxed_ghostty_runtime_new(void);
void muxed_ghostty_runtime_free(void *runtime);

void *muxed_ghostty_view_new(void *runtime, void *parent_view,
                             const char *command,
                             muxed_ghostty_process_exit_cb process_exit_callback,
                             void *process_exit_context);
void muxed_ghostty_view_free(void *view);
muxed_ghostty_grid_size_s
muxed_ghostty_view_set_frame(void *view, double x, double y, double width,
                             double height, double viewport_width,
                             double viewport_height);
uint64_t muxed_ghostty_view_arm_redraw(void *view);
bool muxed_ghostty_view_wait_for_redraw(void *view, uint64_t generation,
                                        uint32_t timeout_milliseconds);
bool muxed_ghostty_view_present(void *view);
void muxed_ghostty_view_hide(void *view);
muxed_ghostty_grid_size_s
muxed_ghostty_view_show(void *view, double x, double y, double width,
                       double height, double viewport_width,
                       double viewport_height);
bool muxed_ghostty_view_is_focused(void *view);
bool muxed_ghostty_view_is_hidden(void *view);
bool muxed_ghostty_view_accepts_input(void *view);
void muxed_ghostty_view_focus(void *view);
// Dynamic sibling ordering is the CODING-1391 fallback. WebKit stays above
// while a DOM overlay owns input; otherwise Ghostty is raised for native input.
bool muxed_ghostty_view_set_webview_interaction(void *view,
                                                bool webview_owns_input);

// Normalization policy shared with the browser Terminal viewer: pixel deltas
// are divided by one line's worth of scrolling, line deltas count directly,
// and the result is bounded to a small number of lines per gesture.
muxed_ghostty_scroll_intent_s
muxed_ghostty_normalize_scroll(double vertical_delta, bool precise);

// Vertical gestures are reported to the terminal owner instead of reaching
// libghostty's mouse-scroll entry point. Callbacks arrive on the main thread.
void muxed_ghostty_view_set_scroll_callback(void *view,
                                           muxed_ghostty_scroll_cb callback,
                                           void *context);
// AppKit can resize the hosted view after the WebView's JavaScript resize
// event (notably during fullscreen transitions). Report the resulting Ghostty
// grid so the durable tmux window stays aligned with the native surface.
void muxed_ghostty_view_set_resize_callback(void *view,
                                           muxed_ghostty_resize_cb callback,
                                           void *context);
// After this returns on the main thread the view can no longer emit a
// gesture, so the caller may release the callback context.
// While the hosted view is first responder the WebView receives no keys at
// all, so every Studio chord that must survive an engaged terminal is
// recognised natively and reported here. Studio still decides what each chord
// does.
void muxed_ghostty_view_set_chord_callback(void *view,
                                          muxed_ghostty_chord_cb callback,
                                          void *context);
void muxed_ghostty_view_disable_chord_callback(void *view);

// The chord policy the hosted view applies, exposed so Ticketry can assert it
// against the Studio keymap's exact-modifier match. Returns a
// muxed_ghostty_chord_e value; MUXED_GHOSTTY_CHORD_NONE means the key belongs
// to the terminal.
uint8_t muxed_ghostty_studio_chord(uint64_t modifier_flags, uint16_t key_code);

void muxed_ghostty_view_disable_scroll_callback(void *view);
void muxed_ghostty_view_disable_resize_callback(void *view);
void muxed_ghostty_view_disable_process_exit_callback(void *view);

#endif
